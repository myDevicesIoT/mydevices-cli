import { Command } from 'commander';

// ============================================================================
// Command Schema Types
// ============================================================================

interface OptionSchema {
  name: string;
  flags: string;
  description: string;
  required: boolean;
  default?: string;
  choices?: string[];
}

interface ArgumentSchema {
  name: string;
  description: string;
  required: boolean;
}

interface CommandSchema {
  name: string;
  description: string;
  arguments: ArgumentSchema[];
  options: OptionSchema[];
  subcommands?: CommandSchema[];
  examples?: string[];
}

interface CLISchema {
  name: string;
  version: string;
  description: string;
  commands: CommandSchema[];
}

// ============================================================================
// Command Definitions
// ============================================================================

function getCommandSchema(): CLISchema {
  return {
    name: 'mydevices',
    version: '1.0.0',
    description: 'CLI tool for managing myDevices IoT platform',
    commands: [
      {
        name: 'auth',
        description: 'Authentication commands',
        arguments: [],
        options: [],
        subcommands: [
          {
            name: 'login',
            description: 'Login to myDevices platform',
            arguments: [],
            options: [
              { name: 'realm', flags: '--realm <realm>', description: 'Auth realm', required: false },
              { name: 'client-id', flags: '--client-id <id>', description: 'OAuth client ID', required: false },
              { name: 'client-secret', flags: '--client-secret <secret>', description: 'OAuth client secret', required: false },
            ],
            examples: [
              'mydevices auth login',
              'mydevices auth login --realm mycompany --client-id abc --client-secret xyz',
            ],
          },
          { name: 'logout', description: 'Logout and clear stored credentials', arguments: [], options: [] },
          { name: 'whoami', description: 'Show current authentication status', arguments: [], options: [{ name: 'json', flags: '--json', description: 'Output as JSON', required: false }] },
          { name: 'token', description: 'Display current access token', arguments: [], options: [] },
        ],
      },
      {
        name: 'devices',
        description: 'Manage IoT devices',
        arguments: [],
        options: [],
        subcommands: [
          {
            name: 'list',
            description: 'List all devices',
            arguments: [],
            options: [
              { name: 'limit', flags: '-l, --limit <number>', description: 'Results per page', required: false, default: '20' },
              { name: 'page', flags: '-p, --page <number>', description: 'Page number', required: false, default: '0' },
              { name: 'location-id', flags: '--location-id <id>', description: 'Filter by location', required: false },
              { name: 'json', flags: '--json', description: 'Output as JSON', required: false },
            ],
            examples: ['mydevices devices list', 'mydevices devices list --limit 50 --json'],
          },
          {
            name: 'get',
            description: 'Get device by ID or hardware ID',
            arguments: [{ name: 'id', description: 'Device ID or hardware ID', required: true }],
            options: [
              { name: 'hardware-id', flags: '--hardware-id', description: 'Treat ID as hardware ID', required: false },
              { name: 'json', flags: '--json', description: 'Output as JSON', required: false },
            ],
            examples: ['mydevices devices get abc123', 'mydevices devices get 0011223344556677 --hardware-id'],
          },
          {
            name: 'readings',
            description: 'Get device sensor readings',
            arguments: [{ name: 'id', description: 'Device ID', required: true }],
            options: [
              { name: 'channel', flags: '-c, --channel <number>', description: 'Filter by channel', required: false },
              { name: 'start', flags: '--start <date>', description: 'Start time', required: false },
              { name: 'end', flags: '--end <date>', description: 'End time', required: false },
              { name: 'json', flags: '--json', description: 'Output as JSON', required: false },
            ],
          },
          {
            name: 'command',
            description: 'Send command to device',
            arguments: [{ name: 'id', description: 'Device ID', required: true }],
            options: [
              { name: 'channel', flags: '-c, --channel <number>', description: 'Target channel', required: true },
              { name: 'value', flags: '-v, --value <value>', description: 'Command value', required: true },
            ],
          },
          { name: 'count', description: 'Get total device count', arguments: [], options: [{ name: 'json', flags: '--json', description: 'Output as JSON', required: false }] },
        ],
      },
      {
        name: 'templates',
        description: 'Manage device templates (profiles)',
        arguments: [],
        options: [],
        subcommands: [
          {
            name: 'list',
            description: 'List device templates',
            arguments: [],
            options: [
              { name: 'limit', flags: '-l, --limit <number>', description: 'Results per page', required: false, default: '20' },
              { name: 'page', flags: '-p, --page <number>', description: 'Page number', required: false, default: '0' },
              { name: 'search', flags: '--search <term>', description: 'Search by name', required: false },
              { name: 'manufacturer', flags: '--manufacturer <name>', description: 'Filter by manufacturer', required: false },
              { name: 'category', flags: '--category <category>', description: 'Filter by category (module, gateway)', required: false },
              { name: 'json', flags: '--json', description: 'Output as JSON', required: false },
            ],
            examples: ['mydevices templates list', 'mydevices templates list --search dragino --json'],
          },
          {
            name: 'get',
            description: 'Get template by ID',
            arguments: [{ name: 'id', description: 'Template ID', required: true }],
            options: [
              { name: 'show-capabilities', flags: '--show-capabilities', description: 'Show capability details', required: false },
              { name: 'json', flags: '--json', description: 'Output as JSON', required: false },
            ],
          },
          {
            name: 'create',
            description: 'Create a new device template',
            arguments: [],
            options: [
              { name: 'name', flags: '-n, --name <name>', description: 'Template name', required: true },
              { name: 'manufacturer', flags: '--manufacturer <name>', description: 'Manufacturer name', required: true },
              { name: 'model', flags: '--model <model>', description: 'Model name', required: true },
              { name: 'category', flags: '--category <category>', description: 'Category (module, gateway)', required: true },
              { name: 'subcategory', flags: '--subcategory <subcategory>', description: 'Subcategory (lora, mqtt, ble)', required: true },
              { name: 'description', flags: '--description <text>', description: 'Template description', required: false },
              { name: 'codec', flags: '--codec <codecId>', description: 'Codec ID to use', required: false },
              { name: 'json', flags: '--json', description: 'Output as JSON', required: false },
            ],
            examples: [
              'mydevices templates create -n "Acme Sensor" --manufacturer "Acme" --model "TH-100" --category module --subcategory lora',
            ],
          },
          {
            name: 'assign-codec',
            description: 'Assign a codec to a template',
            arguments: [
              { name: 'template-id', description: 'Template ID', required: true },
              { name: 'codec-id', description: 'Codec ID', required: true },
            ],
            options: [{ name: 'json', flags: '--json', description: 'Output as JSON', required: false }],
            examples: ['mydevices templates assign-codec abc-123 lorawan.acme.sensor'],
          },
          {
            name: 'scaffold-decoder',
            description: 'Generate a decoder.js skeleton from template capabilities',
            arguments: [{ name: 'template-id', description: 'Template ID', required: true }],
            options: [{ name: 'output', flags: '-o, --output <file>', description: 'Output file path', required: false }],
            examples: ['mydevices templates scaffold-decoder abc-123 -o decoder.js'],
          },
          {
            name: 'datatypes',
            description: 'Manage datatypes for capabilities',
            arguments: [],
            options: [],
            subcommands: [
              {
                name: 'list',
                description: 'List available datatypes',
                arguments: [],
                options: [
                  { name: 'search', flags: '--search <term>', description: 'Search by name', required: false },
                  { name: 'json', flags: '--json', description: 'Output as JSON', required: false },
                ],
              },
              {
                name: 'get',
                description: 'Get datatype properties (icons, units)',
                arguments: [{ name: 'id', description: 'Datatype ID', required: true }],
                options: [{ name: 'json', flags: '--json', description: 'Output as JSON', required: false }],
              },
            ],
          },
          {
            name: 'capabilities',
            description: 'Manage template capabilities (channels)',
            arguments: [],
            options: [],
            subcommands: [
              {
                name: 'list',
                description: 'List capabilities for a template',
                arguments: [{ name: 'template-id', description: 'Template ID', required: true }],
                options: [{ name: 'json', flags: '--json', description: 'Output as JSON', required: false }],
              },
              {
                name: 'create',
                description: 'Create a capability for a template',
                arguments: [{ name: 'template-id', description: 'Template ID', required: true }],
                options: [
                  { name: 'name', flags: '-n, --name <name>', description: 'Capability name', required: true },
                  { name: 'channel', flags: '-c, --channel <number>', description: 'Channel number (start at 500)', required: true },
                  { name: 'datatype-id', flags: '--datatype-id <id>', description: 'Datatype ID', required: true },
                  { name: 'json', flags: '--json', description: 'Output as JSON', required: false },
                ],
                examples: ['mydevices templates capabilities create abc-123 -n "Temperature" -c 500 --datatype-id 27'],
              },
              {
                name: 'delete',
                description: 'Delete a capability',
                arguments: [
                  { name: 'template-id', description: 'Template ID', required: true },
                  { name: 'capability-id', description: 'Capability ID', required: true },
                ],
                options: [],
              },
            ],
          },
        ],
      },
      {
        name: 'codecs',
        description: 'Manage codecs for payload encoding/decoding',
        arguments: [],
        options: [],
        subcommands: [
          {
            name: 'list',
            description: 'List codecs',
            arguments: [],
            options: [
              { name: 'limit', flags: '-l, --limit <number>', description: 'Results limit', required: false, default: '20' },
              { name: 'opensource', flags: '--opensource', description: 'Filter opensource codecs', required: false },
              { name: 'public', flags: '--public', description: 'Filter public codecs', required: false },
              { name: 'json', flags: '--json', description: 'Output as JSON', required: false },
            ],
          },
          {
            name: 'get',
            description: 'Get codec by ID',
            arguments: [{ name: 'id', description: 'Codec ID', required: true }],
            options: [
              { name: 'show-source', flags: '--show-source', description: 'Show source code', required: false },
              { name: 'json', flags: '--json', description: 'Output as JSON', required: false },
            ],
          },
          {
            name: 'create',
            description: 'Create a new codec',
            arguments: [],
            options: [
              { name: 'name', flags: '-n, --name <name>', description: 'Codec name', required: true },
              { name: 'decoder', flags: '--decoder <file>', description: 'Path to decoder.js', required: false },
              { name: 'encoder', flags: '--encoder <file>', description: 'Path to encoder.js', required: false },
              { name: 'timeout', flags: '--timeout <ms>', description: 'Execution timeout', required: false, default: '100' },
              { name: 'json', flags: '--json', description: 'Output as JSON', required: false },
            ],
            examples: ['mydevices codecs create -n "my-sensor" --decoder ./decoder.js --encoder ./encoder.js'],
          },
          {
            name: 'decode',
            description: 'Test decoding a payload',
            arguments: [{ name: 'id', description: 'Codec ID', required: true }],
            options: [
              { name: 'data', flags: '-d, --data <data>', description: 'Payload data to decode', required: true },
              { name: 'format', flags: '-f, --format <format>', description: 'Data format (hex, base64)', required: false, default: 'hex' },
              { name: 'fport', flags: '--fport <number>', description: 'LoRaWAN fport', required: false },
              { name: 'validate-template', flags: '--validate-template <id>', description: 'Validate against template', required: false },
              { name: 'json', flags: '--json', description: 'Output as JSON', required: false },
            ],
            examples: [
              'mydevices codecs decode my-codec -d "00fa320d48" -f hex',
              'mydevices codecs decode my-codec -d "00fa320d48" -f hex --validate-template abc-123',
            ],
          },
          {
            name: 'encode',
            description: 'Test encoding a command',
            arguments: [{ name: 'id', description: 'Codec ID', required: true }],
            options: [
              { name: 'channel', flags: '-c, --channel <number>', description: 'Target channel', required: true },
              { name: 'value', flags: '-v, --value <value>', description: 'Value to encode', required: true },
              { name: 'json', flags: '--json', description: 'Output as JSON', required: false },
            ],
            examples: ['mydevices codecs encode my-codec -c 1 -v 25.5'],
          },
        ],
      },
      {
        name: 'registry',
        description: 'Device registry (pre-provisioning)',
        arguments: [],
        options: [],
        subcommands: [
          {
            name: 'list',
            description: 'List registered devices',
            arguments: [],
            options: [
              { name: 'limit', flags: '-l, --limit <number>', description: 'Results per page', required: false, default: '20' },
              { name: 'page', flags: '-p, --page <number>', description: 'Page number', required: false, default: '0' },
              { name: 'status', flags: '--status <status>', description: 'Filter by status (PENDING, PAIRED, DECOMMISSIONED)', required: false },
              { name: 'network', flags: '--network <network>', description: 'Filter by network', required: false },
              { name: 'device-type', flags: '--device-type <id>', description: 'Filter by device type ID', required: false },
              { name: 'json', flags: '--json', description: 'Output as JSON', required: false },
            ],
            examples: ['mydevices registry list --status PENDING', 'mydevices registry list --device-type abc-123 --json'],
          },
          {
            name: 'get',
            description: 'Get registry entry by ID',
            arguments: [{ name: 'id', description: 'Registry entry ID or hardware ID', required: true }],
            options: [{ name: 'json', flags: '--json', description: 'Output as JSON', required: false }],
          },
          {
            name: 'create',
            description: 'Register a new device',
            arguments: [],
            options: [
              { name: 'hardware-id', flags: '--hardware-id <id>', description: 'Device hardware ID', required: true },
              { name: 'device-type', flags: '--device-type <id>', description: 'Device type/template ID', required: true },
              { name: 'network', flags: '--network <network>', description: 'Network ID', required: true },
              { name: 'sku', flags: '--sku <sku>', description: 'Product SKU', required: false },
              { name: 'json', flags: '--json', description: 'Output as JSON', required: false },
            ],
            examples: ['mydevices registry create --hardware-id 1234567890abcdef --device-type abc-123 --network iotinabox.chirpstackio'],
          },
          {
            name: 'unpair',
            description: 'Unpair a device (changes status to PENDING)',
            arguments: [{ name: 'hardware-id', description: 'Device hardware ID', required: true }],
            options: [{ name: 'json', flags: '--json', description: 'Output as JSON', required: false }],
          },
          {
            name: 'networks',
            description: 'List available networks for registration',
            arguments: [],
            options: [{ name: 'json', flags: '--json', description: 'Output as JSON', required: false }],
          },
        ],
      },
      {
        name: 'gateways',
        description: 'View gateway information',
        arguments: [],
        options: [],
        subcommands: [
          {
            name: 'list',
            description: 'List gateways',
            arguments: [],
            options: [
              { name: 'limit', flags: '-l, --limit <number>', description: 'Results per page', required: false, default: '20' },
              { name: 'page', flags: '-p, --page <number>', description: 'Page number', required: false, default: '0' },
              { name: 'status', flags: '--status <status>', description: 'Filter by status', required: false },
              { name: 'network', flags: '--network <network>', description: 'Filter by network', required: false },
              { name: 'json', flags: '--json', description: 'Output as JSON', required: false },
            ],
          },
          {
            name: 'get',
            description: 'Get gateway details',
            arguments: [{ name: 'hardware-id', description: 'Gateway hardware ID', required: true }],
            options: [{ name: 'json', flags: '--json', description: 'Output as JSON', required: false }],
            examples: ['mydevices gateways get eui-647fdafffe01433c'],
          },
          {
            name: 'pings',
            description: 'Show gateway keepalive ping histogram',
            arguments: [{ name: 'hardware-id', description: 'Gateway hardware ID', required: true }],
            options: [
              { name: 'hours', flags: '--hours <hours>', description: 'Show last N hours', required: false, default: '24' },
              { name: 'start', flags: '--start <timestamp>', description: 'Start time (Unix or ISO)', required: false },
              { name: 'end', flags: '--end <timestamp>', description: 'End time (Unix or ISO)', required: false },
              { name: 'timezone', flags: '--timezone <tz>', description: 'Timezone', required: false },
              { name: 'json', flags: '--json', description: 'Output as JSON', required: false },
            ],
            examples: ['mydevices gateways pings eui-647fdafffe01433c --hours 48'],
          },
          {
            name: 'stats',
            description: 'Show gateway packet statistics',
            arguments: [{ name: 'hardware-id', description: 'Gateway hardware ID', required: true }],
            options: [{ name: 'json', flags: '--json', description: 'Output as JSON', required: false }],
          },
        ],
      },
      {
        name: 'companies',
        description: 'Manage companies',
        arguments: [],
        options: [],
        subcommands: [
          {
            name: 'list',
            description: 'List companies',
            arguments: [],
            options: [
              { name: 'limit', flags: '-l, --limit <number>', description: 'Results per page', required: false, default: '20' },
              { name: 'page', flags: '-p, --page <number>', description: 'Page number', required: false, default: '0' },
              { name: 'json', flags: '--json', description: 'Output as JSON', required: false },
            ],
          },
          {
            name: 'get',
            description: 'Get company by ID',
            arguments: [{ name: 'id', description: 'Company ID', required: true }],
            options: [{ name: 'json', flags: '--json', description: 'Output as JSON', required: false }],
          },
          { name: 'count', description: 'Get total company count', arguments: [], options: [{ name: 'json', flags: '--json', description: 'Output as JSON', required: false }] },
        ],
      },
      {
        name: 'locations',
        description: 'Manage locations',
        arguments: [],
        options: [],
        subcommands: [
          {
            name: 'list',
            description: 'List locations',
            arguments: [],
            options: [
              { name: 'limit', flags: '-l, --limit <number>', description: 'Results per page', required: false, default: '20' },
              { name: 'page', flags: '-p, --page <number>', description: 'Page number', required: false, default: '0' },
              { name: 'company-id', flags: '--company-id <id>', description: 'Filter by company', required: false },
              { name: 'json', flags: '--json', description: 'Output as JSON', required: false },
            ],
          },
          {
            name: 'get',
            description: 'Get location by ID',
            arguments: [{ name: 'id', description: 'Location ID', required: true }],
            options: [{ name: 'json', flags: '--json', description: 'Output as JSON', required: false }],
          },
          { name: 'count', description: 'Get total location count', arguments: [], options: [{ name: 'json', flags: '--json', description: 'Output as JSON', required: false }] },
        ],
      },
      {
        name: 'users',
        description: 'Manage users',
        arguments: [],
        options: [],
        subcommands: [
          {
            name: 'list',
            description: 'List users',
            arguments: [],
            options: [
              { name: 'limit', flags: '-l, --limit <number>', description: 'Results per page', required: false, default: '20' },
              { name: 'page', flags: '-p, --page <number>', description: 'Page number', required: false, default: '0' },
              { name: 'json', flags: '--json', description: 'Output as JSON', required: false },
            ],
          },
          {
            name: 'get',
            description: 'Get user by ID',
            arguments: [{ name: 'id', description: 'User ID', required: true }],
            options: [{ name: 'json', flags: '--json', description: 'Output as JSON', required: false }],
          },
          { name: 'count', description: 'Get total user count', arguments: [], options: [{ name: 'json', flags: '--json', description: 'Output as JSON', required: false }] },
        ],
      },
      {
        name: 'rules',
        description: 'Manage rules and alerts',
        arguments: [],
        options: [],
        subcommands: [
          {
            name: 'list',
            description: 'List rules',
            arguments: [],
            options: [
              { name: 'limit', flags: '-l, --limit <number>', description: 'Results per page', required: false, default: '20' },
              { name: 'page', flags: '-p, --page <number>', description: 'Page number', required: false, default: '0' },
              { name: 'json', flags: '--json', description: 'Output as JSON', required: false },
            ],
          },
          {
            name: 'get',
            description: 'Get rule by ID',
            arguments: [{ name: 'id', description: 'Rule ID', required: true }],
            options: [{ name: 'json', flags: '--json', description: 'Output as JSON', required: false }],
          },
          { name: 'count', description: 'Get total rule count', arguments: [], options: [{ name: 'json', flags: '--json', description: 'Output as JSON', required: false }] },
        ],
      },
      {
        name: 'config',
        description: 'CLI configuration',
        arguments: [],
        options: [],
        subcommands: [
          { name: 'list', description: 'List all configuration values', arguments: [], options: [{ name: 'json', flags: '--json', description: 'Output as JSON', required: false }] },
          {
            name: 'get',
            description: 'Get a configuration value',
            arguments: [{ name: 'key', description: 'Configuration key', required: true }],
            options: [],
          },
          {
            name: 'set',
            description: 'Set a configuration value',
            arguments: [
              { name: 'key', description: 'Configuration key', required: true },
              { name: 'value', description: 'Configuration value', required: true },
            ],
            options: [],
          },
          { name: 'reset', description: 'Reset configuration to defaults', arguments: [], options: [] },
        ],
      },
    ],
  };
}

// ============================================================================
// Main Describe Command
// ============================================================================

export function createDescribeCommands(): Command {
  const describe = new Command('describe')
    .description('Output CLI command schema (for LLM integration)')
    .option('--json', 'Output as JSON (default)')
    .option('--yaml', 'Output as YAML')
    .option('--markdown', 'Output as Markdown')
    .action((options) => {
      const schema = getCommandSchema();

      if (options.markdown) {
        console.log(schemaToMarkdown(schema));
      } else if (options.yaml) {
        console.log(schemaToYaml(schema));
      } else {
        console.log(JSON.stringify(schema, null, 2));
      }
    });

  return describe;
}

// ============================================================================
// Format Converters
// ============================================================================

function schemaToMarkdown(schema: CLISchema): string {
  let md = `# ${schema.name} CLI Reference\n\n`;
  md += `${schema.description}\n\n`;
  md += `Version: ${schema.version}\n\n`;

  for (const cmd of schema.commands) {
    md += commandToMarkdown(cmd, 2);
  }

  return md;
}

function commandToMarkdown(cmd: CommandSchema, level: number): string {
  const heading = '#'.repeat(level);
  let md = `${heading} ${cmd.name}\n\n`;
  md += `${cmd.description}\n\n`;

  if (cmd.arguments.length > 0) {
    md += '**Arguments:**\n';
    for (const arg of cmd.arguments) {
      const req = arg.required ? '(required)' : '(optional)';
      md += `- \`${arg.name}\` ${req} - ${arg.description}\n`;
    }
    md += '\n';
  }

  if (cmd.options.length > 0) {
    md += '**Options:**\n';
    for (const opt of cmd.options) {
      const def = opt.default ? ` (default: ${opt.default})` : '';
      md += `- \`${opt.flags}\` - ${opt.description}${def}\n`;
    }
    md += '\n';
  }

  if (cmd.examples && cmd.examples.length > 0) {
    md += '**Examples:**\n```bash\n';
    md += cmd.examples.join('\n');
    md += '\n```\n\n';
  }

  if (cmd.subcommands) {
    for (const sub of cmd.subcommands) {
      md += commandToMarkdown(sub, level + 1);
    }
  }

  return md;
}

function schemaToYaml(schema: CLISchema, indent = 0): string {
  const pad = '  '.repeat(indent);
  let yaml = '';

  yaml += `${pad}name: ${schema.name}\n`;
  yaml += `${pad}version: ${schema.version}\n`;
  yaml += `${pad}description: ${schema.description}\n`;
  yaml += `${pad}commands:\n`;

  for (const cmd of schema.commands) {
    yaml += commandToYaml(cmd, indent + 1);
  }

  return yaml;
}

function commandToYaml(cmd: CommandSchema, indent: number): string {
  const pad = '  '.repeat(indent);
  let yaml = `${pad}- name: ${cmd.name}\n`;
  yaml += `${pad}  description: ${cmd.description}\n`;

  if (cmd.arguments.length > 0) {
    yaml += `${pad}  arguments:\n`;
    for (const arg of cmd.arguments) {
      yaml += `${pad}    - name: ${arg.name}\n`;
      yaml += `${pad}      description: ${arg.description}\n`;
      yaml += `${pad}      required: ${arg.required}\n`;
    }
  }

  if (cmd.options.length > 0) {
    yaml += `${pad}  options:\n`;
    for (const opt of cmd.options) {
      yaml += `${pad}    - name: ${opt.name}\n`;
      yaml += `${pad}      flags: "${opt.flags}"\n`;
      yaml += `${pad}      description: ${opt.description}\n`;
      if (opt.default) yaml += `${pad}      default: "${opt.default}"\n`;
    }
  }

  if (cmd.subcommands && cmd.subcommands.length > 0) {
    yaml += `${pad}  subcommands:\n`;
    for (const sub of cmd.subcommands) {
      yaml += commandToYaml(sub, indent + 2);
    }
  }

  return yaml;
}

// Export schema for MCP server
export { getCommandSchema, CLISchema, CommandSchema, OptionSchema, ArgumentSchema };
