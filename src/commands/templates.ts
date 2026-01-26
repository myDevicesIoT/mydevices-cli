import { Command } from 'commander';
import ora from 'ora';
import { readFileSync, existsSync } from 'fs';
import { apiGet, apiPost, apiPut, apiDelete } from '../lib/api.js';
import { getConfig } from '../lib/config.js';
import { output, success, error, header, detail, outputTable } from '../lib/output.js';
import type {
  DeviceTemplate,
  TemplateMeta,
  TemplateChannel,
  DeviceUse,
  ApiResponse,
  GlobalOptions,
  ListOptions,
} from '../types/index.js';

/**
 * Get the base path for templates API
 */
function getTemplatesPath(): string {
  const clientId = getConfig('clientId');
  return `/v1.1/organizations/${clientId}/applications/${clientId}/things/types`;
}

/**
 * Get a meta value from the template meta array
 */
function getMetaValue(meta: TemplateMeta[] | undefined, key: string): string | undefined {
  if (!meta) return undefined;
  const item = meta.find((m) => m.key === key);
  return item?.value;
}

/**
 * Build meta array from options
 */
function buildMeta(options: {
  deviceType?: string;
  broadcastInterval?: string;
  imageUrl?: string;
  trackingDevice?: boolean;
  resourceLinks?: string;
}): TemplateMeta[] {
  const meta: TemplateMeta[] = [];

  if (options.deviceType) {
    meta.push({ key: 'device_type', value: options.deviceType });
  }
  if (options.broadcastInterval) {
    meta.push({ key: 'broadcast_interval', value: options.broadcastInterval });
  }
  if (options.imageUrl) {
    meta.push({ key: 'image_url', value: options.imageUrl });
  }
  if (options.trackingDevice !== undefined) {
    meta.push({ key: 'is_tracking_device', value: String(options.trackingDevice) });
  }
  if (options.resourceLinks) {
    let links = options.resourceLinks;
    if (existsSync(options.resourceLinks)) {
      links = readFileSync(options.resourceLinks, 'utf-8');
    }
    meta.push({ key: 'resource_links', value: links });
  }

  return meta;
}

// ============================================================================
// Datatype Types
// ============================================================================

interface Datatype {
  id: number;
  name: string;
  label: string;
  payload: string;
  application_id?: string | null;
}

interface DatatypeProperty {
  id: number;
  type: string;
  label: string;
  data_types_id: number;
  data: Record<string, unknown>;
}

// ============================================================================
// Main Templates Command
// ============================================================================

export function createTemplatesCommands(): Command {
  const templates = new Command('templates').description('Manage device templates');

  // --------------------------------------------------------------------------
  // templates list
  // --------------------------------------------------------------------------
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
    .option('--search <term>', 'Search by name (partial match)')
    .option('--filter <expression>', 'Raw filter expression (e.g., "name like %sensor%")')
    .option('--json', 'Output as JSON')
    .action(async (options: ListOptions & {
      sort?: string;
      catalog?: string;
      manufacturer?: string;
      category?: string;
      subcategory?: string;
      search?: string;
      filter?: string;
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
        if (options.search) {
          params.filter = `name like %${options.search}%`;
        }
        if (options.filter) {
          params.filter = options.filter;
        }

        const response = await apiGet<ApiResponse<DeviceTemplate>>(getTemplatesPath(), params);
        spinner.stop();

        const templateList = response.rows || [];
        output(templateList, {
          json: options.json,
          tableHeaders: ['ID', 'Name', 'Manufacturer', 'Category', 'Codec'],
          tableMapper: (t: DeviceTemplate) => [
            t.id,
            t.name,
            t.manufacturer,
            `${t.category}/${t.subcategory}`,
            t.codec,
          ],
          footer: `Total: ${response.count || templateList.length} templates`,
        });
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to fetch templates');
        process.exit(1);
      }
    });

  // --------------------------------------------------------------------------
  // templates get
  // --------------------------------------------------------------------------
  templates
    .command('get')
    .description('Get a device template by ID')
    .argument('<id>', 'Template ID')
    .option('--json', 'Output as JSON')
    .option('--show-capabilities', 'Show capability details')
    .option('--show-meta', 'Show all metadata')
    .action(async (id: string, options: GlobalOptions & { showCapabilities?: boolean; showMeta?: boolean }) => {
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

          if (template.meta && template.meta.length > 0) {
            console.log('');
            header('Metadata');
            detail('Device Type', getMetaValue(template.meta, 'device_type'));
            detail('Broadcast Interval', getMetaValue(template.meta, 'broadcast_interval'));
            detail('Image URL', getMetaValue(template.meta, 'image_url'));
            detail('Is Tracking Device', getMetaValue(template.meta, 'is_tracking_device'));

            if (options.showMeta) {
              console.log('\nAll Meta:');
              template.meta.forEach((m) => {
                const displayValue = m.value.length > 80 ? m.value.substring(0, 80) + '...' : m.value;
                console.log(`  ${m.key}: ${displayValue}`);
              });
            }
          }

          if (template.channels && template.channels.length > 0) {
            console.log('');
            header(`Capabilities (${template.channels.length})`);
            if (options.showCapabilities) {
              outputTable(
                ['Channel', 'Name', 'Widget', 'Template', 'Data Type ID'],
                template.channels.map((c: TemplateChannel) => [
                  c.channel,
                  c.name,
                  c.data?.widget || '-',
                  c.data?.template || '-',
                  c.data_types_id || '-',
                ])
              );
            } else {
              const channelNames = template.channels.map((c: TemplateChannel) => c.name).join(', ');
              console.log(`  ${channelNames}`);
              console.log('  (use --show-capabilities for details)');
            }
          }

          if (template.device_use && template.device_use.length > 0) {
            console.log('');
            header(`Device Uses (${template.device_use.length})`);
            template.device_use.forEach((du: DeviceUse) => {
              const rulesCount = du.settings?.rules?.length || 0;
              console.log(`  - ${du.name}${du.default ? ' (default)' : ''} - ${rulesCount} rules`);
            });
          }
        }
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to fetch template');
        process.exit(1);
      }
    });

  // --------------------------------------------------------------------------
  // templates create
  // --------------------------------------------------------------------------
  templates
    .command('create')
    .description('Create a new device template (Step 1: create template, then add capabilities)')
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
    .option('--device-type <type>', 'Device type metadata (required for meaningful template)')
    .option('--broadcast-interval <minutes>', 'Broadcast interval in minutes (required)')
    .option('--image-url <url>', 'Device image URL')
    .option('--tracking-device', 'Mark as tracking device')
    .option('--resource-links <json>', 'Resource links JSON array or path to JSON file')
    .option('--from-file <file>', 'Create template from JSON file (overrides other options)')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const spinner = ora('Creating template...').start();
      try {
        let data: Record<string, unknown>;

        if (options.fromFile) {
          if (!existsSync(options.fromFile)) {
            throw new Error(`Template file not found: ${options.fromFile}`);
          }
          data = JSON.parse(readFileSync(options.fromFile, 'utf-8'));
        } else {
          data = {
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

          const meta = buildMeta({
            deviceType: options.deviceType,
            broadcastInterval: options.broadcastInterval,
            imageUrl: options.imageUrl,
            trackingDevice: options.trackingDevice,
            resourceLinks: options.resourceLinks,
          });
          if (meta.length > 0) {
            data.meta = meta;
          }
        }

        const template = await apiPost<DeviceTemplate>(getTemplatesPath(), data);
        spinner.stop();

        if (options.json) {
          output(template, { json: true });
        } else {
          success('Template created successfully');
          detail('ID', template.id);
          detail('Name', template.name);
          console.log('');
          console.log('Next step: Add capabilities using:');
          console.log(`  mydevices templates capabilities create ${template.id} --name "Temperature" --channel 500 --datatype-id 27`);
        }
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to create template');
        process.exit(1);
      }
    });

  // --------------------------------------------------------------------------
  // templates update
  // --------------------------------------------------------------------------
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
    .option('--device-type <type>', 'Device type')
    .option('--broadcast-interval <minutes>', 'Broadcast interval in minutes')
    .option('--image-url <url>', 'Device image URL')
    .option('--tracking-device', 'Mark as tracking device')
    .option('--resource-links <json>', 'Resource links JSON array or path to JSON file')
    .option('--from-file <file>', 'Update template from JSON file')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options) => {
      const spinner = ora('Updating template...').start();
      try {
        let data: Record<string, unknown>;

        if (options.fromFile) {
          if (!existsSync(options.fromFile)) {
            throw new Error(`Template file not found: ${options.fromFile}`);
          }
          data = JSON.parse(readFileSync(options.fromFile, 'utf-8'));
        } else {
          data = {};
          if (options.name) data.name = options.name;
          if (options.description) data.description = options.description;
          if (options.codec) data.codec = options.codec;
          if (options.certifications) data.certifications = options.certifications;
          if (options.ipRating) data.ip_rating = options.ipRating;
          if (options.public) data.is_public = true;
          if (options.private) data.is_public = false;

          const meta = buildMeta({
            deviceType: options.deviceType,
            broadcastInterval: options.broadcastInterval,
            imageUrl: options.imageUrl,
            trackingDevice: options.trackingDevice,
            resourceLinks: options.resourceLinks,
          });
          if (meta.length > 0) {
            data.meta = meta;
          }
        }

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

  // --------------------------------------------------------------------------
  // templates delete
  // --------------------------------------------------------------------------
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

  // --------------------------------------------------------------------------
  // templates assign-codec
  // --------------------------------------------------------------------------
  templates
    .command('assign-codec')
    .description('Assign a codec to a template')
    .argument('<template-id>', 'Template ID')
    .argument('<codec-id>', 'Codec ID (e.g., lorawan.acme.sensor)')
    .option('--json', 'Output as JSON')
    .action(async (templateId: string, codecId: string, options: GlobalOptions) => {
      const spinner = ora('Fetching template...').start();
      try {
        // First, get the current template
        const template = await apiGet<DeviceTemplate>(`${getTemplatesPath()}/${templateId}`);

        spinner.text = 'Assigning codec...';

        // Update the codec field and PUT the full template
        const updatedTemplate = {
          ...template,
          codec: codecId,
        };

        const result = await apiPut<DeviceTemplate>(
          `${getTemplatesPath()}/${templateId}`,
          updatedTemplate
        );
        spinner.stop();

        if (options.json) {
          output(result, { json: true });
        } else {
          success('Codec assigned successfully');
          detail('Template', result.name);
          detail('Template ID', result.id);
          detail('Codec', result.codec);
        }
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to assign codec');
        process.exit(1);
      }
    });

  // --------------------------------------------------------------------------
  // templates datatypes (subcommand group)
  // --------------------------------------------------------------------------
  const datatypes = new Command('datatypes').description('Manage datatypes for capabilities');

  datatypes
    .command('list')
    .description('List available datatypes')
    .option('-l, --limit <number>', 'Results per page', '50')
    .option('-p, --page <number>', 'Page number', '0')
    .option('--search <term>', 'Search by name')
    .option('--json', 'Output as JSON')
    .action(async (options: ListOptions & { search?: string }) => {
      const spinner = ora('Fetching datatypes...').start();
      try {
        const params: Record<string, unknown> = {
          limit: parseInt(options.limit as unknown as string, 10),
          page: parseInt(options.page as unknown as string, 10),
        };

        const response = await apiGet<ApiResponse<Datatype>>('/v1.0/things/datatypes', params);
        spinner.stop();

        let datatypeList = response.rows || [];

        // Client-side search filter
        if (options.search) {
          const searchLower = options.search.toLowerCase();
          datatypeList = datatypeList.filter((d) =>
            d.name.toLowerCase().includes(searchLower) ||
            d.label.toLowerCase().includes(searchLower) ||
            d.payload.toLowerCase().includes(searchLower)
          );
        }

        output(datatypeList, {
          json: options.json,
          tableHeaders: ['ID', 'Name', 'Label', 'Payload'],
          tableMapper: (d: Datatype) => [d.id, d.name, d.label, d.payload],
          footer: `Total: ${options.search ? datatypeList.length : response.count || datatypeList.length} datatypes`,
        });
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to fetch datatypes');
        process.exit(1);
      }
    });

  datatypes
    .command('get')
    .description('Get a datatype with its properties (icons, units, etc.)')
    .argument('<id>', 'Datatype ID')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: GlobalOptions) => {
      const spinner = ora('Fetching datatype properties...').start();
      try {
        const properties = await apiGet<ApiResponse<DatatypeProperty>>(
          `/v1.0/things/datatypes/${id}/properties`,
          { limit: 100, page: 0 }
        );
        spinner.stop();

        const props = properties.rows || [];

        if (options.json) {
          output(props, { json: true });
        } else {
          // Group by type
          const icons = props.filter((p) => p.type === 'icon');
          const units = props.filter((p) => p.type === 'unit');
          const ruleTemplates = props.filter((p) => p.type === 'rule_template');
          const templates = props.filter((p) => p.type === 'template');

          header(`Datatype ${id} Properties`);

          if (icons.length > 0) {
            console.log('\nIcons:');
            icons.forEach((i) => {
              const iconData = i.data as { name?: string; value?: string };
              console.log(`  - ${i.label} (${iconData.value || '-'})`);
            });
          }

          if (units.length > 0) {
            console.log('\nUnits:');
            units.forEach((u) => {
              const unitData = u.data as { display?: string; payload?: string; default?: boolean };
              const defaultMark = unitData.default ? ' (default)' : '';
              console.log(`  - ${u.label}: ${unitData.display || '-'} [${unitData.payload || '-'}]${defaultMark}`);
            });
          }

          if (ruleTemplates.length > 0) {
            console.log('\nRule Templates:');
            ruleTemplates.forEach((r) => {
              const ruleData = r.data as { type?: string };
              console.log(`  - ${r.label} (${ruleData.type || '-'})`);
            });
          }

          if (templates.length > 0) {
            console.log('\nCapability Templates:');
            templates.forEach((t) => {
              const templateData = t.data as { value?: string };
              console.log(`  - ${t.label}: ${templateData.value || '-'}`);
            });
          }
        }
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to fetch datatype properties');
        process.exit(1);
      }
    });

  templates.addCommand(datatypes);

  // --------------------------------------------------------------------------
  // templates capabilities (subcommand group)
  // --------------------------------------------------------------------------
  const capabilities = new Command('capabilities').description('Manage template capabilities (channels)');

  capabilities
    .command('list')
    .description('List capabilities for a template')
    .argument('<template-id>', 'Template ID')
    .option('-l, --limit <number>', 'Results per page', '50')
    .option('-p, --page <number>', 'Page number', '0')
    .option('--json', 'Output as JSON')
    .action(async (templateId: string, options: ListOptions) => {
      const spinner = ora('Fetching capabilities...').start();
      try {
        const params: Record<string, unknown> = {
          limit: parseInt(options.limit as unknown as string, 10),
          page: parseInt(options.page as unknown as string, 10),
        };

        const response = await apiGet<ApiResponse<TemplateChannel>>(
          `${getTemplatesPath()}/${templateId}/channels`,
          params
        );
        spinner.stop();

        const channelList = response.rows || [];
        output(channelList, {
          json: options.json,
          tableHeaders: ['ID', 'Channel', 'Name', 'Template', 'Widget', 'Datatype ID'],
          tableMapper: (c: TemplateChannel) => [
            c.id,
            c.channel,
            c.name,
            c.data?.template || '-',
            c.data?.widget || '-',
            c.data_types_id || '-',
          ],
          footer: `Total: ${response.count || channelList.length} capabilities`,
        });
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to fetch capabilities');
        process.exit(1);
      }
    });

  capabilities
    .command('create')
    .description('Create a capability for a template')
    .argument('<template-id>', 'Template ID')
    .requiredOption('-n, --name <name>', 'Capability name (e.g., "Temperature")')
    .requiredOption('-c, --channel <number>', 'Channel number (start at 500)')
    .requiredOption('--datatype-id <id>', 'Datatype ID (use "templates datatypes list" to find)')
    .option('--template <type>', 'Capability template type: value or status', 'value')
    .option('--widget <widget>', 'Widget type', 'device-data')
    .option('--order <number>', 'Display order', '0')
    .option('--from-file <file>', 'Create from JSON file (overrides other options)')
    .option('--json', 'Output as JSON')
    .action(async (templateId: string, options) => {
      const spinner = ora('Creating capability...').start();
      try {
        let data: Record<string, unknown>;

        if (options.fromFile) {
          if (!existsSync(options.fromFile)) {
            throw new Error(`Capability file not found: ${options.fromFile}`);
          }
          data = JSON.parse(readFileSync(options.fromFile, 'utf-8'));
        } else {
          const datatypeId = parseInt(options.datatypeId, 10);

          // Fetch datatype properties to auto-populate icon, units, rule_templates
          const propsResponse = await apiGet<ApiResponse<DatatypeProperty>>(
            `/v1.0/things/datatypes/${datatypeId}/properties`,
            { limit: 100, page: 0 }
          );
          const props = propsResponse.rows || [];

          // Find icon (first one or default)
          const icons = props.filter((p) => p.type === 'icon');
          const icon = icons.length > 0 ? icons[0].data : {
            name: 'Sensor',
            value: 'dev-icon dev-sensor',
            color: '#000',
            type: 'css',
          };

          // Get all units
          const units = props
            .filter((p) => p.type === 'unit')
            .map((u) => ({
              ...u.data,
              id: u.id,
              label: u.label,
              data_types_id: u.data_types_id,
            }));

          // Get rule templates
          const ruleTemplates = props
            .filter((p) => p.type === 'rule_template')
            .map((r) => ({
              id: crypto.randomUUID(),
              type: (r.data as { type?: string }).type || 'min_max',
              label: options.name,
              order: 0,
              enabled: true,
              notification_template: `Alert: {{{location_name}}} {{{device_name}}} {{{child_name}}} {{template_reading}}{{template_unit}} exceeds threshold. {{template_date}}.`,
            }));

          // Build capability data
          data = {
            name: options.name,
            channel: String(options.channel),
            data_types_id: datatypeId,
            order: parseInt(options.order, 10),
            datatype: 'DEPRECATED',
            data: {
              template: options.template,
              widget: options.widget,
              icon,
              chart: {
                name: 'line',
                label: 'Line Chart',
              },
              units,
              statuses: [],
              commands: [],
              properties: [],
              rule_templates: ruleTemplates,
            },
          };
        }

        const capability = await apiPost<TemplateChannel>(
          `${getTemplatesPath()}/${templateId}/channels`,
          data
        );
        spinner.stop();

        if (options.json) {
          output(capability, { json: true });
        } else {
          success('Capability created successfully');
          detail('ID', capability.id);
          detail('Name', capability.name);
          detail('Channel', capability.channel);
          detail('Datatype ID', capability.data_types_id);
        }
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to create capability');
        process.exit(1);
      }
    });

  capabilities
    .command('update')
    .description('Update a capability')
    .argument('<template-id>', 'Template ID')
    .argument('<capability-id>', 'Capability ID')
    .option('-n, --name <name>', 'Capability name')
    .option('--order <number>', 'Display order')
    .option('--from-file <file>', 'Update from JSON file')
    .option('--json', 'Output as JSON')
    .action(async (templateId: string, capabilityId: string, options) => {
      const spinner = ora('Updating capability...').start();
      try {
        let data: Record<string, unknown>;

        if (options.fromFile) {
          if (!existsSync(options.fromFile)) {
            throw new Error(`Capability file not found: ${options.fromFile}`);
          }
          data = JSON.parse(readFileSync(options.fromFile, 'utf-8'));
        } else {
          data = {};
          if (options.name) data.name = options.name;
          if (options.order) data.order = parseInt(options.order, 10);
        }

        const capability = await apiPut<TemplateChannel>(
          `${getTemplatesPath()}/${templateId}/channels/${capabilityId}`,
          data
        );
        spinner.stop();

        if (options.json) {
          output(capability, { json: true });
        } else {
          success('Capability updated successfully');
        }
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to update capability');
        process.exit(1);
      }
    });

  capabilities
    .command('delete')
    .description('Delete a capability')
    .argument('<template-id>', 'Template ID')
    .argument('<capability-id>', 'Capability ID')
    .action(async (templateId: string, capabilityId: string) => {
      const spinner = ora('Deleting capability...').start();
      try {
        await apiDelete(`${getTemplatesPath()}/${templateId}/channels/${capabilityId}`);
        spinner.stop();
        success('Capability deleted successfully');
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to delete capability');
        process.exit(1);
      }
    });

  templates.addCommand(capabilities);

  return templates;
}
