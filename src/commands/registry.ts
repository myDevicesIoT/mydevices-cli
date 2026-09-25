import { writeFileSync } from 'fs';
import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { apiGet, apiPost, apiDelete } from '../lib/api.js';
import { getConfig } from '../lib/config.js';
import {
  DEFAULT_TEMPLATE_FILE,
  LOOKUP_COLUMNS,
  LOOKUP_STATUSES,
  countByStatus,
  findRegistryEntry,
  getRegistryPath,
  lookupMany,
  writeLookupTemplate,
  type LookupResult,
  type LookupStatus,
  type RegistryEntry,
} from '../lib/registry-lookup.js';
import { readIdList } from '../lib/eui-list.js';
import { assertResultsPath, assertWritableDir, writeResults } from '../lib/results-file.js';
import { output, success, error, header, detail, outputTable } from '../lib/output.js';
import type { ApiResponse, GlobalOptions, ListOptions } from '../types/index.js';

interface Network {
  id: string;
  network: string;
  name: string;
  activationSupported: boolean;
  options?: Record<string, unknown>;
}

// ============================================================================
// Helper Functions
// ============================================================================

function getUnpairPath(hardwareId: string): string {
  const clientId = getConfig('clientId');
  return `/v1.1/organizations/${clientId}/applications/${clientId}/things/${hardwareId}/unpair`;
}

function getNetworksPath(): string {
  const clientId = getConfig('clientId');
  return `/v1.1/networks/${clientId}`;
}

function formatStatus(status: string): string {
  switch (status) {
    case 'PAIRED':
      return 'paired';
    case 'PENDING':
      return 'pending';
    case 'DECOMMISSIONED':
      return 'decommissioned';
    default:
      return status.toLowerCase();
  }
}

// ============================================================================
// Main Registry Command
// ============================================================================

export function createRegistryCommands(): Command {
  const registry = new Command('registry').description('Manage device registry (pre-provisioning)');

  // --------------------------------------------------------------------------
  // registry list
  // --------------------------------------------------------------------------
  registry
    .command('list')
    .description('List registered devices')
    .option('-l, --limit <number>', 'Results per page', '20')
    .option('-p, --page <number>', 'Page number', '0')
    .option('--status <status>', 'Filter by status (PENDING, PAIRED, DECOMMISSIONED)')
    .option('--network <network>', 'Filter by network')
    .option('--device-type <id>', 'Filter by device type ID')
    .option('--hardware-id <id>', 'Filter by hardware ID')
    .option('--filter <expression>', 'Raw filter expression (e.g., "status eq PAIRED,network eq iotinabox")')
    .option('--json', 'Output as JSON')
    .action(async (options: ListOptions & {
      status?: string;
      network?: string;
      deviceType?: string;
      hardwareId?: string;
      filter?: string;
    }) => {
      const spinner = ora('Fetching registry entries...').start();
      try {
        const params: Record<string, unknown> = {
          limit: parseInt(options.limit as unknown as string, 10),
          page: parseInt(options.page as unknown as string, 10),
        };

        // Build filter expression
        const filters: string[] = [];
        if (options.status) filters.push(`status eq ${options.status.toUpperCase()}`);
        if (options.network) filters.push(`network eq ${options.network}`);
        if (options.deviceType) filters.push(`device_type_id eq ${options.deviceType}`);
        if (options.hardwareId) filters.push(`hardware_id eq ${options.hardwareId}`);

        // Allow raw filter to override or add to filters
        if (options.filter) {
          filters.push(options.filter);
        }

        if (filters.length > 0) {
          params.filter = filters.join(',');
        }

        const response = await apiGet<ApiResponse<RegistryEntry>>(getRegistryPath(), params);
        spinner.stop();

        const entries = response.rows || [];
        output(entries, {
          json: options.json,
          tableHeaders: ['Hardware ID', 'Status', 'Device Type', 'Network', 'Created'],
          tableMapper: (e: RegistryEntry) => [
            e.hardware_id,
            formatStatus(e.status),
            e.device_type?.name || e.device_type_id,
            e.network,
            e.created_at ? new Date(e.created_at).toLocaleDateString() : '-',
          ],
          footer: `Total: ${response.count || entries.length} entries`,
        });
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to fetch registry entries');
        process.exit(1);
      }
    });

  // --------------------------------------------------------------------------
  // registry get
  // --------------------------------------------------------------------------
  registry
    .command('get')
    .description('Get a registry entry by ID or hardware ID')
    .argument('<id>', 'Registry entry ID or hardware ID')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: GlobalOptions) => {
      const spinner = ora('Fetching registry entry...').start();
      try {
        const entry = await findRegistryEntry(id);
        if (!entry) {
          throw new Error('Resource not found.');
        }
        spinner.stop();

        if (options.json) {
          output(entry, { json: true });
        } else {
          header(`Registry Entry: ${entry.hardware_id}`);
          detail('ID', entry.id);
          detail('Hardware ID', entry.hardware_id);
          detail('Status', formatStatus(entry.status));
          detail('Network', entry.network);
          detail('SKU', entry.sku);
          detail('Application ID', entry.application_id);
          detail('Paired To', entry.paired_to_app_id);
          detail('Paired At', entry.paired_at);
          detail('Created At', entry.created_at);

          if (entry.device_type) {
            console.log('');
            header('Device Type');
            detail('ID', entry.device_type.id);
            detail('Name', entry.device_type.name);
            detail('Manufacturer', entry.device_type.manufacturer);
            detail('Model', entry.device_type.model);
            detail('Category', `${entry.device_type.category}/${entry.device_type.subcategory}`);
            detail('Codec', entry.device_type.codec);
          }

          if (entry.devices && entry.devices.length > 0) {
            console.log('');
            header(`Paired Devices (${entry.devices.length})`);
            console.log(JSON.stringify(entry.devices, null, 2));
          }
        }
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to fetch registry entry');
        process.exit(1);
      }
    });

  // --------------------------------------------------------------------------
  // registry lookup
  // --------------------------------------------------------------------------
  registry
    .command('lookup')
    .description('Look up registry status for a file of hardware IDs (sensors or gateways)')
    .argument('[file]', 'CSV or text file of hardware IDs')
    .option('--template [file]', `Write a starter input file and exit (default: ${DEFAULT_TEMPLATE_FILE})`)
    .option('--column <name>', 'CSV column containing hardware IDs (auto-detected if not specified)')
    .option('--delimiter <char>', 'Force CSV delimiter (auto-detect by default)')
    .option('--only <status>', `Only show and write rows with this status (${LOOKUP_STATUSES.join(', ')})`)
    .option('--write <file>', 'Write the (filtered) hardware IDs to a file, one per line')
    .option('--concurrency <n>', 'Lookups in flight (1-20)', '5')
    .option('--json', 'Output as JSON')
    .option('--output <file>', 'Save results (.csv or .json)')
    .action(async (file: string | undefined, options: {
      template?: string | boolean;
      column?: string;
      delimiter?: string;
      only?: string;
      write?: string;
      concurrency: string;
      json?: boolean;
      output?: string;
    }) => {
      if (options.template !== undefined) {
        const path = typeof options.template === 'string' ? options.template : DEFAULT_TEMPLATE_FILE;
        try {
          writeLookupTemplate(path);
        } catch (err) {
          error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
        success(`Template written to ${path}. Add one ID per line under hardware_id, then run: mydevices registry lookup ${path}`);
        return;
      }

      if (!file) {
        error('Missing <file>. Pass a file of hardware IDs, or use --template to create one.');
        process.exit(1);
      }

      const clientId = getConfig('clientId');
      if (!clientId) {
        error('No clientId configured. Run "mydevices auth login" first.');
        process.exit(1);
      }

      let only: LookupStatus | undefined;
      if (options.only) {
        const value = options.only.toUpperCase();
        if (!LOOKUP_STATUSES.includes(value as LookupStatus)) {
          error(`--only must be one of: ${LOOKUP_STATUSES.join(', ')}`);
          process.exit(1);
        }
        only = value as LookupStatus;
      }

      if (!/^\d+$/.test(options.concurrency) || +options.concurrency < 1 || +options.concurrency > 20) {
        error(`--concurrency must be an integer from 1 to 20 (got "${options.concurrency}")`);
        process.exit(1);
      }
      const concurrency = parseInt(options.concurrency, 10);

      if (options.output) {
        try {
          assertResultsPath(options.output);
        } catch (err) {
          error((err as Error).message);
          process.exit(1);
        }
      }

      if (options.write) {
        try {
          assertWritableDir(options.write, '--write');
        } catch (err) {
          error((err as Error).message);
          process.exit(1);
        }
      }

      let ids: string[];
      try {
        ids = readIdList(file, { column: options.column, delimiter: options.delimiter }).ids;
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to read file');
        process.exit(1);
      }

      if (!options.json) {
        console.log(chalk.cyan(`Looking up ${ids.length} IDs in the registry as clientId "${clientId}"`));
      }
      const spinner = ora('Looking up...').start();
      const results = await lookupMany(ids, {
        concurrency,
        onProgress: (done, total) => {
          spinner.text = `Looking up ${done}/${total}`;
        },
      });
      spinner.stop();

      const counts = countByStatus(results);
      const shown: LookupResult[] = only ? results.filter((r) => r.status === only) : results;

      if (options.json) {
        console.log(JSON.stringify({ clientId, counts, results: shown }, null, 2));
      } else {
        outputTable(
          ['Hardware ID', 'Status', 'Device Type', 'Paired To', 'Paired At', 'Network'],
          shown.map((r) => [
            r.hardware_id,
            r.status,
            r.device_type || '-',
            r.paired_to_app_id || '-',
            r.paired_at || '-',
            r.network || '-',
          ]),
          {
            footer:
              Object.entries(counts).map(([status, n]) => `${status}: ${n}`).join('  ') +
              (only ? `  (showing ${only})` : '') +
              (counts['NOT-FOUND'] ? `\nNOT-FOUND = not visible to clientId "${clientId}"` : ''),
          }
        );
        const errors = results.filter((r) => r.status === 'ERROR');
        for (const r of errors) {
          console.log(chalk.red(`  ${r.hardware_id}: ${r.error}`));
        }
      }

      if (options.write) {
        writeFileSync(options.write, shown.map((r) => r.hardware_id).join('\n') + (shown.length > 0 ? '\n' : ''));
        if (options.json) {
          console.error(`✓ Wrote ${shown.length} IDs to ${options.write}`);
        } else {
          success(`Wrote ${shown.length} IDs to ${options.write}`);
        }
      }

      if (options.output) {
        writeResults(options.output, shown.map((r) => ({ ...r })), LOOKUP_COLUMNS, { clientId, file, only: only ?? null, counts });
        if (options.json) {
          console.error(`✓ Results saved to ${options.output}`);
        } else {
          success(`Results saved to ${options.output}`);
        }
      }

      if (counts['ERROR']) {
        process.exit(1);
      }
    });

  // --------------------------------------------------------------------------
  // registry create
  // --------------------------------------------------------------------------
  registry
    .command('create')
    .description('Register a new device')
    .option('--hardware-id <id>', 'Device hardware ID (required unless using --data)')
    .option('--device-type <id>', 'Device type/template ID (required unless using --data)')
    .option('--network <network>', 'Network ID (required unless using --data, use "registry networks" to list)')
    .option('--sku <sku>', 'Product SKU')
    .option('-d, --data <json>', 'JSON body (individual options override)')
    .option('--json', 'Output as JSON')
    .action(async (options: GlobalOptions & {
      hardwareId?: string;
      deviceType?: string;
      network?: string;
      sku?: string;
      data?: string;
    }) => {
      try {
        const clientId = getConfig('clientId');

        // Parse JSON data if provided
        let data: Record<string, unknown> = { application_id: clientId };
        if (options.data) {
          try {
            const parsed = JSON.parse(options.data);
            data = { ...data, ...parsed };
          } catch {
            error('Invalid JSON in --data option');
            process.exit(1);
          }
        }

        // Individual options override JSON data
        if (options.hardwareId) data.hardware_id = options.hardwareId;
        if (options.deviceType) data.device_type_id = options.deviceType;
        if (options.network) data.network = options.network;
        if (options.sku !== undefined) {
          data.sku = options.sku || null;
        } else if (!data.sku) {
          data.sku = null;
        }

        // Validate required fields
        if (!data.hardware_id) {
          error('--hardware-id is required (or provide in --data)');
          process.exit(1);
        }
        if (!data.device_type_id) {
          error('--device-type is required (or provide device_type_id in --data)');
          process.exit(1);
        }
        if (!data.network) {
          error('--network is required (or provide in --data)');
          process.exit(1);
        }

        const spinner = ora('Registering device...').start();
        const entry = await apiPost<RegistryEntry>(getRegistryPath(), data);
        spinner.stop();

        if (options.json) {
          output(entry, { json: true });
        } else {
          success('Device registered successfully');
          detail('ID', entry.id);
          detail('Hardware ID', entry.hardware_id);
          detail('Status', formatStatus(entry.status));
          detail('Network', entry.network);
          detail('Device Type', entry.device_type_id);
        }
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to register device');
        process.exit(1);
      }
    });

  // --------------------------------------------------------------------------
  // registry unpair
  // --------------------------------------------------------------------------
  registry
    .command('unpair')
    .description('Unpair a device (changes status from PAIRED to PENDING)')
    .argument('<hardware-id>', 'Device hardware ID')
    .option('--json', 'Output as JSON')
    .action(async (hardwareId: string, options: GlobalOptions) => {
      const spinner = ora('Unpairing device...').start();
      try {
        await apiDelete(getUnpairPath(hardwareId));
        spinner.stop();

        if (options.json) {
          output({ success: true, hardware_id: hardwareId, status: 'PENDING' }, { json: true });
        } else {
          success('Device unpaired successfully');
          detail('Hardware ID', hardwareId);
          detail('Status', 'pending');
        }
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to unpair device');
        process.exit(1);
      }
    });

  // --------------------------------------------------------------------------
  // registry networks
  // --------------------------------------------------------------------------
  registry
    .command('networks')
    .description('List available networks for device registration')
    .option('--json', 'Output as JSON')
    .action(async (options: GlobalOptions) => {
      const spinner = ora('Fetching networks...').start();
      try {
        const networks = await apiGet<Network[]>(getNetworksPath());
        spinner.stop();

        output(networks, {
          json: options.json,
          tableHeaders: ['ID', 'Name', 'Activation Supported'],
          tableMapper: (n: Network) => [
            n.id,
            n.name,
            n.activationSupported ? 'yes' : 'no',
          ],
          footer: `Total: ${networks.length} networks`,
        });
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to fetch networks');
        process.exit(1);
      }
    });

  return registry;
}
