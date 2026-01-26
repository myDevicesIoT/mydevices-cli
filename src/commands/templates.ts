import { Command } from 'commander';
import ora from 'ora';
import { apiGet, apiPost, apiPut, apiDelete } from '../lib/api.js';
import { getConfig } from '../lib/config.js';
import { output, success, error, header, detail } from '../lib/output.js';
import type { DeviceTemplate, ApiResponse, GlobalOptions, ListOptions } from '../types/index.js';

/**
 * Get the base path for templates API
 */
function getTemplatesPath(): string {
  const clientId = getConfig('clientId');
  return `/v1.1/organizations/${clientId}/applications/${clientId}/things/types`;
}

export function createTemplatesCommands(): Command {
  const templates = new Command('templates').description('Manage device templates');

  templates
    .command('list')
    .description('List device templates')
    .option('-l, --limit <number>', 'Results per page', '20')
    .option('-p, --page <number>', 'Page number', '0')
    .option('--sort <sort>', 'Sort order (e.g., "name asc")', 'name asc')
    .option('--catalog <catalog>', 'Catalog filter (application, public)', 'application')
    .option('--manufacturer <name>', 'Filter by manufacturer')
    .option('--category <category>', 'Filter by category (module, gateway)')
    .option('--subcategory <subcategory>', 'Filter by subcategory (lora, mqtt, ble)')
    .option('--search <term>', 'Search by name')
    .option('--json', 'Output as JSON')
    .action(async (options: ListOptions & {
      sort?: string;
      catalog?: string;
      manufacturer?: string;
      category?: string;
      subcategory?: string;
      search?: string;
    }) => {
      const spinner = ora('Fetching templates...').start();
      try {
        const params: Record<string, unknown> = {
          limit: parseInt(options.limit as unknown as string, 10),
          page: parseInt(options.page as unknown as string, 10),
        };
        if (options.sort) params.sort = options.sort;
        if (options.catalog) params.catalog = options.catalog;
        if (options.manufacturer) params.manufacturer = options.manufacturer;
        if (options.category) params.category = options.category;
        if (options.subcategory) params.subcategory = options.subcategory;
        if (options.search) params.name = options.search;

        const response = await apiGet<ApiResponse<DeviceTemplate>>(getTemplatesPath(), params);
        spinner.stop();

        const templates = response.rows || [];
        output(templates, {
          json: options.json,
          tableHeaders: ['ID', 'Name', 'Manufacturer', 'Category', 'Codec'],
          tableMapper: (t: DeviceTemplate) => [
            t.id,
            t.name,
            t.manufacturer,
            `${t.category}/${t.subcategory}`,
            t.codec,
          ],
          footer: `Total: ${response.count || templates.length} templates`,
        });
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to fetch templates');
        process.exit(1);
      }
    });

  templates
    .command('get')
    .description('Get a device template by ID')
    .argument('<id>', 'Template ID')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: GlobalOptions) => {
      const spinner = ora('Fetching template...').start();
      try {
        const template = await apiGet<DeviceTemplate>(`${getTemplatesPath()}/${id}`);
        spinner.stop();

        if (options.json) {
          output(template, { json: true });
        } else {
          header(`Template: ${template.name}`);
          detail('ID', template.id);
          detail('Name', template.name);
          detail('Description', template.description);
          detail('Manufacturer', template.manufacturer);
          detail('Model', template.model);
          detail('Category', template.category);
          detail('Subcategory', template.subcategory);
          detail('Transport', template.transport_protocol);
          detail('Codec', template.codec);
          detail('Certifications', template.certifications);
          detail('IP Rating', template.ip_rating);
          detail('Public', template.is_public);
          detail('Status', template.status === 0 ? 'active' : 'deactivated');
          detail('Created', template.created_at);
          detail('Updated', template.updated_at);
        }
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to fetch template');
        process.exit(1);
      }
    });

  templates
    .command('create')
    .description('Create a new device template')
    .requiredOption('-n, --name <name>', 'Template name')
    .requiredOption('--manufacturer <name>', 'Manufacturer name')
    .requiredOption('--model <model>', 'Model name')
    .requiredOption('--category <category>', 'Category (module, gateway)')
    .requiredOption('--subcategory <subcategory>', 'Subcategory (lora, mqtt, ble)')
    .option('--description <text>', 'Template description')
    .option('--codec <codecId>', 'Codec ID to use')
    .option('--transport <protocol>', 'Transport protocol', 'lorawan')
    .option('--certifications <certs>', 'Certifications (e.g., FCC;CE)')
    .option('--ip-rating <rating>', 'IP rating (e.g., IP65)')
    .option('--public', 'Make template public')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const spinner = ora('Creating template...').start();
      try {
        const data: Record<string, unknown> = {
          name: options.name,
          manufacturer: options.manufacturer,
          model: options.model,
          category: options.category,
          subcategory: options.subcategory,
          transport_protocol: options.transport,
        };
        if (options.description) data.description = options.description;
        if (options.codec) data.codec = options.codec;
        if (options.certifications) data.certifications = options.certifications;
        if (options.ipRating) data.ip_rating = options.ipRating;
        if (options.public) data.is_public = true;

        const template = await apiPost<DeviceTemplate>(getTemplatesPath(), data);
        spinner.stop();

        if (options.json) {
          output(template, { json: true });
        } else {
          success('Template created successfully');
          detail('ID', template.id);
          detail('Name', template.name);
        }
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to create template');
        process.exit(1);
      }
    });

  templates
    .command('update')
    .description('Update a device template')
    .argument('<id>', 'Template ID')
    .option('-n, --name <name>', 'Template name')
    .option('--description <text>', 'Template description')
    .option('--codec <codecId>', 'Codec ID to use')
    .option('--certifications <certs>', 'Certifications')
    .option('--ip-rating <rating>', 'IP rating')
    .option('--public', 'Make template public')
    .option('--private', 'Make template private')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options) => {
      const spinner = ora('Updating template...').start();
      try {
        const data: Record<string, unknown> = {};
        if (options.name) data.name = options.name;
        if (options.description) data.description = options.description;
        if (options.codec) data.codec = options.codec;
        if (options.certifications) data.certifications = options.certifications;
        if (options.ipRating) data.ip_rating = options.ipRating;
        if (options.public) data.is_public = true;
        if (options.private) data.is_public = false;

        const template = await apiPut<DeviceTemplate>(`${getTemplatesPath()}/${id}`, data);
        spinner.stop();

        if (options.json) {
          output(template, { json: true });
        } else {
          success('Template updated successfully');
        }
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to update template');
        process.exit(1);
      }
    });

  templates
    .command('delete')
    .description('Delete a device template')
    .argument('<id>', 'Template ID')
    .action(async (id: string) => {
      const spinner = ora('Deleting template...').start();
      try {
        await apiDelete(`${getTemplatesPath()}/${id}`);
        spinner.stop();
        success('Template deleted successfully');
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to delete template');
        process.exit(1);
      }
    });

  return templates;
}
