import { Command } from 'commander';
import ora from 'ora';
import { apiGet, apiPost, apiPut, apiDelete } from '../lib/api.js';
import { output, success, error, header, detail } from '../lib/output.js';
import type { Location, ApiResponse, GlobalOptions, ListOptions } from '../types/index.js';

export function createLocationsCommands(): Command {
  const locations = new Command('locations').description('Manage locations');

  locations
    .command('list')
    .description('List all locations')
    .option('-l, --limit <number>', 'Results per page', '20')
    .option('-p, --page <number>', 'Page number', '0')
    .option('--user-id <id>', 'Filter by user ID')
    .option('--external-id <id>', 'Filter by external ID')
    .option('--json', 'Output as JSON')
    .action(async (options: ListOptions & { userId?: string; externalId?: string }) => {
      const spinner = ora('Fetching locations...').start();
      try {
        const params: Record<string, unknown> = {
          limit: parseInt(options.limit as unknown as string, 10),
          page: parseInt(options.page as unknown as string, 10),
        };
        if (options.userId) params.user_id = options.userId;
        if (options.externalId) params.external_id = options.externalId;

        const response = await apiGet<ApiResponse<Location>>('/v1.0/admin/locations', params);
        spinner.stop();

        const locations = response.rows || [];
        output(locations, {
          json: options.json,
          tableHeaders: ['ID', 'Name', 'City', 'State', 'Status'],
          tableMapper: (l: Location) => [l.id, l.name, l.city, l.state, l.status],
          footer: `Total: ${response.count || locations.length} locations`,
        });
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to fetch locations');
        process.exit(1);
      }
    });

  locations
    .command('get')
    .description('Get a location by ID')
    .argument('<id>', 'Location ID')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: GlobalOptions) => {
      const spinner = ora('Fetching location...').start();
      try {
        const location = await apiGet<Location>(`/v1.0/admin/locations/${id}`);
        spinner.stop();

        if (options.json) {
          output(location, { json: true });
        } else {
          header(`Location: ${location.name}`);
          detail('ID', location.id);
          detail('Address', location.address);
          detail('City', location.city);
          detail('State', location.state);
          detail('ZIP', location.zip);
          detail('Country', location.country);
          detail('Timezone', location.timezone);
          detail('Company ID', location.company_id);
          detail('Status', location.status);
          detail('Created', location.created_at);
        }
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to fetch location');
        process.exit(1);
      }
    });

  locations
    .command('create')
    .description('Create a new location')
    .requiredOption('-n, --name <name>', 'Location name')
    .option('--address <address>', 'Street address')
    .option('--city <city>', 'City')
    .option('--state <state>', 'State')
    .option('--zip <zip>', 'ZIP code')
    .option('--country <country>', 'Country')
    .option('--timezone <timezone>', 'Timezone')
    .option('--user-id <userId>', 'Owner user ID')
    .option('--company-id <companyId>', 'Company ID')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const spinner = ora('Creating location...').start();
      try {
        const data: Record<string, unknown> = { name: options.name };
        if (options.address) data.address = options.address;
        if (options.city) data.city = options.city;
        if (options.state) data.state = options.state;
        if (options.zip) data.zip = options.zip;
        if (options.country) data.country = options.country;
        if (options.timezone) data.timezone = options.timezone;
        if (options.userId) data.user_id = options.userId;
        if (options.companyId) data.company_id = options.companyId;

        const location = await apiPost<Location>('/v1.0/admin/locations', data);
        spinner.stop();

        if (options.json) {
          output(location, { json: true });
        } else {
          success('Location created successfully');
          detail('ID', location.id);
        }
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to create location');
        process.exit(1);
      }
    });

  locations
    .command('update')
    .description('Update a location')
    .argument('<id>', 'Location ID')
    .option('-n, --name <name>', 'Location name')
    .option('--address <address>', 'Street address')
    .option('--city <city>', 'City')
    .option('--state <state>', 'State')
    .option('--zip <zip>', 'ZIP code')
    .option('--country <country>', 'Country')
    .option('--timezone <timezone>', 'Timezone')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options) => {
      const spinner = ora('Updating location...').start();
      try {
        const data: Record<string, unknown> = {};
        if (options.name) data.name = options.name;
        if (options.address) data.address = options.address;
        if (options.city) data.city = options.city;
        if (options.state) data.state = options.state;
        if (options.zip) data.zip = options.zip;
        if (options.country) data.country = options.country;
        if (options.timezone) data.timezone = options.timezone;

        const location = await apiPut<Location>(`/v1.0/admin/locations/${id}`, data);
        spinner.stop();

        if (options.json) {
          output(location, { json: true });
        } else {
          success('Location updated successfully');
        }
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to update location');
        process.exit(1);
      }
    });

  locations
    .command('delete')
    .description('Delete a location')
    .argument('<id>', 'Location ID')
    .option('--user-id <userId>', 'User ID (required for deletion)')
    .action(async (id: string, options: { userId?: string }) => {
      const spinner = ora('Deleting location...').start();
      try {
        const data: Record<string, unknown> = {};
        if (options.userId) data.user_id = options.userId;

        await apiDelete(`/v1.0/admin/locations/${id}`, data);
        spinner.stop();
        success('Location deleted successfully');
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to delete location');
        process.exit(1);
      }
    });

  locations
    .command('count')
    .description('Get total location count')
    .action(async () => {
      try {
        const response = await apiGet<{ count: number }>('/v1.0/admin/locations/count');
        console.log(response.count);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to get count');
        process.exit(1);
      }
    });

  return locations;
}
