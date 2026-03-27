import { Command } from 'commander';
import ora from 'ora';
import { apiGet, apiPost, apiPut, apiDelete } from '../lib/api.js';
import { getConfig } from '../lib/config.js';
import { output, success, error, header, detail, outputTable } from '../lib/output.js';
import type {
  Integration,
  IntegrationVariable,
  Fuse,
  FuseSetting,
  ApiResponse,
  GlobalOptions,
  ListOptions,
} from '../types/index.js';

/**
 * Get the base path for integrations catalog API
 */
function getIntegrationsPath(): string {
  const clientId = getConfig('clientId');
  return `/v1.1/organizations/${clientId}/applications/${clientId}/integrations`;
}

/**
 * Get the base path for fuses (configured integration instances)
 */
function getFusesPath(): string {
  const clientId = getConfig('clientId');
  return `/v1.1/organizations/${clientId}/applications/${clientId}/fuses`;
}

/**
 * Parse --setting flags into FuseSetting array
 * Format: "name=value"
 */
function parseSettings(settings: string[] | undefined): FuseSetting[] {
  if (!settings || settings.length === 0) return [];
  return settings.map((s) => {
    const eqIndex = s.indexOf('=');
    if (eqIndex === -1) {
      throw new Error(`Invalid setting format "${s}". Use name=value`);
    }
    return {
      name: s.substring(0, eqIndex),
      value: s.substring(eqIndex + 1),
    };
  });
}

export function createIntegrationsCommands(): Command {
  const integrations = new Command('integrations').description('Manage integrations');

  // ── list (catalog) ───────────────────────────────────────────────────
  integrations
    .command('list')
    .description('List available integration types')
    .option('-l, --limit <number>', 'Results per page', '15')
    .option('-p, --page <number>', 'Page number', '0')
    .option('-t, --type <type>', 'Filter by type (inbound, outbound)')
    .option('-a, --active <value>', 'Filter by active status (1 or 0)')
    .option('--json', 'Output as JSON')
    .action(async (options: ListOptions & { type?: string; active?: string }) => {
      const spinner = ora('Fetching integrations...').start();
      try {
        const params: Record<string, unknown> = {
          limit: parseInt(String(options.limit ?? '15'), 10),
          page: parseInt(String(options.page ?? '0'), 10),
        };

        const filters: string[] = [];
        if (options.type) {
          filters.push(`type eq ${options.type}`);
        }
        if (options.active !== undefined) {
          params.active = options.active;
        }
        if (filters.length > 0) {
          params.filter = filters.join(',');
        }

        const response = await apiGet<ApiResponse<Integration>>(getIntegrationsPath(), params);
        spinner.stop();

        const items = response.rows || [];
        output(items, {
          json: options.json,
          tableHeaders: ['ID', 'Name', 'Type', 'Auth', 'Active', 'Events'],
          tableMapper: (i: Integration) => [
            i.id,
            i.name,
            i.type,
            i.authentication,
            i.active === 1 ? 'yes' : 'no',
            i.events,
          ],
          footer: `Total: ${response.count ?? items.length} integrations`,
        });
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to fetch integrations');
        process.exit(1);
      }
    });

  // ── get (catalog detail) ─────────────────────────────────────────────
  integrations
    .command('get')
    .description('Get integration type details and configuration variables')
    .argument('<id>', 'Integration ID')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: GlobalOptions) => {
      const spinner = ora('Fetching integration...').start();
      try {
        const integration = await apiGet<Integration>(`${getIntegrationsPath()}/${id}`);
        spinner.stop();

        if (options.json) {
          output(integration, { json: true });
        } else {
          header(`Integration: ${integration.name}`);
          detail('ID', integration.id);
          detail('Alias', integration.alias);
          detail('Description', integration.description);
          detail('Type', integration.type);
          detail('Authentication', integration.authentication);
          detail('Events', integration.events);
          detail('Active', integration.active === 1 ? 'yes' : 'no');
          detail('Required Fields', integration.required_fields);
          detail('Documentation', integration.documentation);
          detail('Icon', integration.icon);
          detail('Created', integration.created_at);
          detail('Updated', integration.updated_at);

          if (integration.variables && integration.variables.length > 0) {
            console.log();
            header('Configuration Variables');
            outputTable(
              ['Name', 'Label', 'Type', 'Required', 'Default', 'Description'],
              integration.variables.map((v: IntegrationVariable) => [
                v.name,
                v.label,
                v.datatype,
                v.is_required === 1 ? 'yes' : 'no',
                v.default_value,
                v.description,
              ])
            );
          }
        }
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to fetch integration');
        process.exit(1);
      }
    });

  // ── configured list ──────────────────────────────────────────────────
  integrations
    .command('configured')
    .description('List configured integration instances')
    .option('-l, --limit <number>', 'Results per page', '20')
    .option('-p, --page <number>', 'Page number', '0')
    .option('--json', 'Output as JSON')
    .action(async (options: ListOptions) => {
      const spinner = ora('Fetching configured integrations...').start();
      try {
        const params: Record<string, unknown> = {
          limit: parseInt(String(options.limit ?? '20'), 10),
          page: parseInt(String(options.page ?? '0'), 10),
        };

        const response = await apiGet<ApiResponse<Fuse>>(getFusesPath(), params);
        spinner.stop();

        const items = response.rows || [];
        output(items, {
          json: options.json,
          tableHeaders: ['ID', 'Name', 'Integration ID', 'Events', 'Active', 'Auth Status'],
          tableMapper: (f: Fuse) => [
            f.id,
            f.name,
            f.integration_id,
            f.event_subscriptions,
            f.active === 1 ? 'yes' : 'no',
            f.auth_status,
          ],
          footer: `Total: ${response.count ?? items.length} configured integrations`,
        });
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to fetch configured integrations');
        process.exit(1);
      }
    });

  // ── create ───────────────────────────────────────────────────────────
  integrations
    .command('create')
    .description('Create a configured integration instance')
    .requiredOption('--integration-id <id>', 'Integration type ID')
    .requiredOption('-n, --name <name>', 'Instance name')
    .option('-s, --setting <name=value>', 'Configuration setting (repeatable)', (val: string, prev: string[]) => [...prev, val], [] as string[])
    .option('-e, --events <events>', 'Event subscriptions (comma-separated, e.g. uplink,alert)')
    .option('-d, --devices <pattern>', 'Device subscriptions pattern', '*')
    .option('--fields <fields>', 'Data fields to include (comma-separated)')
    .option('--global', 'Apply globally')
    .option('--inactive', 'Create in inactive state')
    .option('--json', 'Output as JSON')
    .action(async (options: GlobalOptions & {
      integrationId: string;
      name: string;
      setting: string[];
      events?: string;
      devices?: string;
      fields?: string;
      global?: boolean;
      inactive?: boolean;
    }) => {
      const spinner = ora('Creating integration instance...').start();
      try {
        const settings = parseSettings(options.setting);
        const clientId = getConfig('clientId');

        const data: Record<string, unknown> = {
          integration_id: options.integrationId,
          name: options.name,
          active: options.inactive ? 0 : 1,
          application_id: clientId,
          device_subscriptions: options.devices ?? '*',
          is_global: options.global ? 1 : 0,
          settings,
        };

        if (options.events) {
          data.event_subscriptions = options.events;
        }
        if (options.fields) {
          data.fields = options.fields;
        }

        const fuse = await apiPost<Fuse>(getFusesPath(), data);
        spinner.stop();

        if (options.json) {
          output(fuse, { json: true });
        } else {
          success('Integration instance created');
          detail('ID', fuse.id);
          detail('Name', fuse.name);
        }
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to create integration instance');
        process.exit(1);
      }
    });

  // ── update ───────────────────────────────────────────────────────────
  integrations
    .command('update')
    .description('Update a configured integration instance')
    .argument('<id>', 'Fuse ID')
    .option('-n, --name <name>', 'Instance name')
    .option('-s, --setting <name=value>', 'Configuration setting (repeatable)', (val: string, prev: string[]) => [...prev, val], [] as string[])
    .option('-e, --events <events>', 'Event subscriptions (comma-separated)')
    .option('-d, --devices <pattern>', 'Device subscriptions pattern')
    .option('--fields <fields>', 'Data fields to include (comma-separated)')
    .option('--active', 'Set active')
    .option('--inactive', 'Set inactive')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: GlobalOptions & {
      name?: string;
      setting: string[];
      events?: string;
      devices?: string;
      fields?: string;
      active?: boolean;
      inactive?: boolean;
    }) => {
      const spinner = ora('Updating integration instance...').start();
      try {
        const data: Record<string, unknown> = {};

        if (options.name) data.name = options.name;
        if (options.events) data.event_subscriptions = options.events;
        if (options.devices) data.device_subscriptions = options.devices;
        if (options.fields) data.fields = options.fields;
        if (options.active) data.active = 1;
        if (options.inactive) data.active = 0;

        const settings = parseSettings(options.setting);
        if (settings.length > 0) {
          data.settings = settings;
        }

        const fuse = await apiPut<Fuse>(`${getFusesPath()}/${id}`, data);
        spinner.stop();

        if (options.json) {
          output(fuse, { json: true });
        } else {
          success('Integration instance updated');
          detail('ID', fuse.id ?? id);
          detail('Name', fuse.name);
        }
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to update integration instance');
        process.exit(1);
      }
    });

  // ── delete ───────────────────────────────────────────────────────────
  integrations
    .command('delete')
    .description('Delete a configured integration instance')
    .argument('<id>', 'Fuse ID')
    .action(async (id: string) => {
      const spinner = ora('Deleting integration instance...').start();
      try {
        await apiDelete(`${getFusesPath()}/${id}`);
        spinner.stop();
        success('Integration instance deleted');
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to delete integration instance');
        process.exit(1);
      }
    });

  return integrations;
}
