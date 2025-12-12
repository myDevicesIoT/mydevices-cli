import { Command } from 'commander';
import ora from 'ora';
import { apiGet, apiPost, apiPut, apiDelete } from '../lib/api.js';
import { output, success, error, header, detail } from '../lib/output.js';
import type { Company, ApiResponse, GlobalOptions, ListOptions } from '../types/index.js';

export function createCompaniesCommands(): Command {
  const companies = new Command('companies').description('Manage companies');

  companies
    .command('list')
    .description('List all companies')
    .option('-l, --limit <number>', 'Results per page', '20')
    .option('-p, --page <number>', 'Page number', '0')
    .option('--user-id <id>', 'Filter by user ID')
    .option('--external-id <id>', 'Filter by external ID')
    .option('--json', 'Output as JSON')
    .action(async (options: ListOptions & { userId?: string; externalId?: string }) => {
      const spinner = ora('Fetching companies...').start();
      try {
        const params: Record<string, unknown> = {
          limit: parseInt(options.limit as unknown as string, 10),
          page: parseInt(options.page as unknown as string, 10),
        };
        if (options.userId) params.user_id = options.userId;
        if (options.externalId) params.external_id = options.externalId;

        const response = await apiGet<ApiResponse<Company>>('/v1.0/admin/companies', params);
        spinner.stop();

        const companies = response.rows || [];
        output(companies, {
          json: options.json,
          tableHeaders: ['ID', 'Name', 'City', 'State', 'Status'],
          tableMapper: (c: Company) => [c.id, c.name, c.city, c.state, c.status],
          footer: `Total: ${response.count || companies.length} companies`,
        });
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to fetch companies');
        process.exit(1);
      }
    });

  companies
    .command('get')
    .description('Get a company by ID')
    .argument('<id>', 'Company ID')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: GlobalOptions) => {
      const spinner = ora('Fetching company...').start();
      try {
        const company = await apiGet<Company>(`/v1.0/admin/companies/${id}`);
        spinner.stop();

        if (options.json) {
          output(company, { json: true });
        } else {
          header(`Company: ${company.name}`);
          detail('ID', company.id);
          detail('Address', company.address);
          detail('City', company.city);
          detail('State', company.state);
          detail('ZIP', company.zip);
          detail('Country', company.country);
          detail('Timezone', company.timezone);
          detail('Industry', company.industry);
          detail('Status', company.status);
          detail('Created', company.created_at);
        }
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to fetch company');
        process.exit(1);
      }
    });

  companies
    .command('create')
    .description('Create a new company')
    .requiredOption('-n, --name <name>', 'Company name')
    .option('--address <address>', 'Street address')
    .option('--city <city>', 'City')
    .option('--state <state>', 'State')
    .option('--zip <zip>', 'ZIP code')
    .option('--country <country>', 'Country')
    .option('--timezone <timezone>', 'Timezone')
    .option('--user-id <userId>', 'Owner user ID')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const spinner = ora('Creating company...').start();
      try {
        const data: Record<string, unknown> = { name: options.name };
        if (options.address) data.address = options.address;
        if (options.city) data.city = options.city;
        if (options.state) data.state = options.state;
        if (options.zip) data.zip = options.zip;
        if (options.country) data.country = options.country;
        if (options.timezone) data.timezone = options.timezone;
        if (options.userId) data.user_id = options.userId;

        const company = await apiPost<Company>('/v1.0/admin/companies', data);
        spinner.stop();

        if (options.json) {
          output(company, { json: true });
        } else {
          success('Company created successfully');
          detail('ID', company.id);
        }
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to create company');
        process.exit(1);
      }
    });

  companies
    .command('update')
    .description('Update a company')
    .argument('<id>', 'Company ID')
    .option('-n, --name <name>', 'Company name')
    .option('--address <address>', 'Street address')
    .option('--city <city>', 'City')
    .option('--state <state>', 'State')
    .option('--zip <zip>', 'ZIP code')
    .option('--country <country>', 'Country')
    .option('--timezone <timezone>', 'Timezone')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options) => {
      const spinner = ora('Updating company...').start();
      try {
        const data: Record<string, unknown> = {};
        if (options.name) data.name = options.name;
        if (options.address) data.address = options.address;
        if (options.city) data.city = options.city;
        if (options.state) data.state = options.state;
        if (options.zip) data.zip = options.zip;
        if (options.country) data.country = options.country;
        if (options.timezone) data.timezone = options.timezone;

        const company = await apiPut<Company>(`/v1.0/admin/companies/${id}`, data);
        spinner.stop();

        if (options.json) {
          output(company, { json: true });
        } else {
          success('Company updated successfully');
        }
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to update company');
        process.exit(1);
      }
    });

  companies
    .command('delete')
    .description('Delete a company')
    .argument('<id>', 'Company ID')
    .action(async (id: string) => {
      const spinner = ora('Deleting company...').start();
      try {
        await apiDelete(`/v1.0/admin/companies/${id}`);
        spinner.stop();
        success('Company deleted successfully');
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to delete company');
        process.exit(1);
      }
    });

  companies
    .command('count')
    .description('Get total company count')
    .action(async () => {
      try {
        const response = await apiGet<{ count: number }>('/v1.0/admin/companies/count');
        console.log(response.count);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to get count');
        process.exit(1);
      }
    });

  return companies;
}
