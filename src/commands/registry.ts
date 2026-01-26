import { Command } from 'commander';
import ora from 'ora';
import { apiGet, apiPost, apiDelete } from '../lib/api.js';
import { getConfig } from '../lib/config.js';
import { output, success, error, header, detail, outputTable } from '../lib/output.js';
import type { ApiResponse, GlobalOptions, ListOptions } from '../types/index.js';

// ============================================================================
// Types
// ============================================================================

interface RegistryDeviceType {
  id: string;
  name: string;
  description?: string;
  category: string;
  subcategory: string;
  codec?: string;
  model?: string;
  manufacturer?: string;
  transport_protocol?: string;
}

interface RegistryEntry {
  id: string;
  application_id: string;
  paired_to_app_id?: string;
  hardware_id: string;
  network: string;
  device_type_id: string;
  sku?: string;
  status: 'PENDING' | 'PAIRED' | 'DECOMMISSIONED';
  paired_at?: string;
  created_at: string;
  device_type?: RegistryDeviceType;
  devices?: unknown[];
}

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

function getRegistryPath(): string {
  const clientId = getConfig('clientId');
  return `/v1.1/organizations/${clientId}/applications/${clientId}/things/registry`;
}

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
        const entry = await apiGet<RegistryEntry>(`${getRegistryPath()}/${id}`);
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
  // registry create
  // --------------------------------------------------------------------------
  registry
    .command('create')
    .description('Register a new device')
    .requiredOption('--hardware-id <id>', 'Device hardware ID')
    .requiredOption('--device-type <id>', 'Device type/template ID')
    .requiredOption('--network <network>', 'Network ID (use "registry networks" to list)')
    .option('--sku <sku>', 'Product SKU')
    .option('--json', 'Output as JSON')
    .action(async (options: GlobalOptions & {
      hardwareId: string;
      deviceType: string;
      network: string;
      sku?: string;
    }) => {
      const spinner = ora('Registering device...').start();
      try {
        const clientId = getConfig('clientId');
        const data: Record<string, unknown> = {
          application_id: clientId,
          hardware_id: options.hardwareId,
          device_type_id: options.deviceType,
          network: options.network,
        };
        if (options.sku) {
          data.sku = options.sku;
        } else {
          data.sku = null;
        }

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
        spinner.stop();
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
