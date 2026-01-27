#!/usr/bin/env bun
/**
 * MCP (Model Context Protocol) Server for myDevices CLI
 *
 * This server exposes myDevices CLI commands as MCP tools that can be used by
 * Claude Code and other MCP-compatible LLM clients.
 *
 * Usage:
 *   bun run src/mcp-server.ts
 *
 * Add to Claude Code MCP config:
 *   {
 *     "mcpServers": {
 *       "mydevices": {
 *         "command": "bun",
 *         "args": ["run", "/path/to/mydevices-cli/src/mcp-server.ts"]
 *       }
 *     }
 *   }
 */

import { spawn } from 'child_process';
import { createInterface } from 'readline';

// ============================================================================
// MCP Protocol Types
// ============================================================================

interface MCPRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ============================================================================
// Tool Definitions
// ============================================================================

const TOOLS: MCPTool[] = [
  // Auth
  {
    name: 'mydevices_auth_whoami',
    description: 'Check current authentication status',
    inputSchema: { type: 'object', properties: {} },
  },

  // Devices
  {
    name: 'mydevices_devices_list',
    description: 'List all IoT devices with optional filtering',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Results per page (default: 20)' },
        page: { type: 'number', description: 'Page number (default: 0)' },
        location_id: { type: 'string', description: 'Filter by location ID' },
      },
    },
  },
  {
    name: 'mydevices_devices_get',
    description: 'Get device details by ID or hardware ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Device ID or hardware ID' },
        hardware_id: { type: 'boolean', description: 'Treat ID as hardware ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'mydevices_devices_readings',
    description: 'Get device sensor readings',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Device ID' },
        channel: { type: 'number', description: 'Filter by channel number' },
      },
      required: ['id'],
    },
  },

  // Templates
  {
    name: 'mydevices_templates_list',
    description: 'List device templates with optional search and filtering',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Results per page' },
        search: { type: 'string', description: 'Search by name' },
        manufacturer: { type: 'string', description: 'Filter by manufacturer' },
        category: { type: 'string', description: 'Filter by category (module, gateway)' },
      },
    },
  },
  {
    name: 'mydevices_templates_get',
    description: 'Get template details by ID including capabilities',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Template ID' },
        show_capabilities: { type: 'boolean', description: 'Include capability details' },
      },
      required: ['id'],
    },
  },
  {
    name: 'mydevices_templates_create',
    description: 'Create a new device template',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Template name' },
        manufacturer: { type: 'string', description: 'Manufacturer name' },
        model: { type: 'string', description: 'Model name' },
        category: { type: 'string', description: 'Category (module or gateway)' },
        subcategory: { type: 'string', description: 'Subcategory (lora, mqtt, ble)' },
        description: { type: 'string', description: 'Template description' },
        codec: { type: 'string', description: 'Codec ID to use' },
      },
      required: ['name', 'manufacturer', 'model', 'category', 'subcategory'],
    },
  },
  {
    name: 'mydevices_templates_assign_codec',
    description: 'Assign a codec to a template',
    inputSchema: {
      type: 'object',
      properties: {
        template_id: { type: 'string', description: 'Template ID' },
        codec_id: { type: 'string', description: 'Codec ID' },
      },
      required: ['template_id', 'codec_id'],
    },
  },
  {
    name: 'mydevices_templates_scaffold_decoder',
    description: 'Generate a decoder.js skeleton from template capabilities',
    inputSchema: {
      type: 'object',
      properties: {
        template_id: { type: 'string', description: 'Template ID' },
      },
      required: ['template_id'],
    },
  },
  {
    name: 'mydevices_templates_datatypes_list',
    description: 'List available datatypes for capabilities',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search by name' },
      },
    },
  },
  {
    name: 'mydevices_templates_capabilities_create',
    description: 'Create a capability for a template',
    inputSchema: {
      type: 'object',
      properties: {
        template_id: { type: 'string', description: 'Template ID' },
        name: { type: 'string', description: 'Capability name' },
        channel: { type: 'number', description: 'Channel number (start at 500)' },
        datatype_id: { type: 'number', description: 'Datatype ID' },
      },
      required: ['template_id', 'name', 'channel', 'datatype_id'],
    },
  },

  // Codecs
  {
    name: 'mydevices_codecs_list',
    description: 'List codecs',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Results limit' },
        opensource: { type: 'boolean', description: 'Filter opensource codecs' },
        public: { type: 'boolean', description: 'Filter public codecs' },
      },
    },
  },
  {
    name: 'mydevices_codecs_get',
    description: 'Get codec details by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Codec ID' },
        show_source: { type: 'boolean', description: 'Include source code' },
      },
      required: ['id'],
    },
  },
  {
    name: 'mydevices_codecs_decode',
    description: 'Test decoding a payload with a codec',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Codec ID' },
        data: { type: 'string', description: 'Payload data to decode' },
        format: { type: 'string', description: 'Data format (hex, base64)', default: 'hex' },
        fport: { type: 'number', description: 'LoRaWAN fport number' },
        validate_template: { type: 'string', description: 'Validate against template ID' },
      },
      required: ['id', 'data'],
    },
  },
  {
    name: 'mydevices_codecs_encode',
    description: 'Test encoding a command with a codec',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Codec ID' },
        channel: { type: 'number', description: 'Target channel' },
        value: { type: 'string', description: 'Value to encode' },
      },
      required: ['id', 'channel', 'value'],
    },
  },

  // Registry
  {
    name: 'mydevices_registry_list',
    description: 'List registered devices (pre-provisioning)',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Results per page' },
        status: { type: 'string', description: 'Filter by status (PENDING, PAIRED, DECOMMISSIONED)' },
        network: { type: 'string', description: 'Filter by network' },
        device_type: { type: 'string', description: 'Filter by device type ID' },
      },
    },
  },
  {
    name: 'mydevices_registry_get',
    description: 'Get registry entry by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Registry entry ID or hardware ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'mydevices_registry_create',
    description: 'Register a new device',
    inputSchema: {
      type: 'object',
      properties: {
        hardware_id: { type: 'string', description: 'Device hardware ID' },
        device_type: { type: 'string', description: 'Device type/template ID' },
        network: { type: 'string', description: 'Network ID' },
        sku: { type: 'string', description: 'Product SKU' },
      },
      required: ['hardware_id', 'device_type', 'network'],
    },
  },
  {
    name: 'mydevices_registry_unpair',
    description: 'Unpair a device (changes status to PENDING)',
    inputSchema: {
      type: 'object',
      properties: {
        hardware_id: { type: 'string', description: 'Device hardware ID' },
      },
      required: ['hardware_id'],
    },
  },
  {
    name: 'mydevices_registry_networks',
    description: 'List available networks for device registration',
    inputSchema: { type: 'object', properties: {} },
  },

  // Gateways
  {
    name: 'mydevices_gateways_list',
    description: 'List gateways',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Results per page' },
        status: { type: 'string', description: 'Filter by status' },
        network: { type: 'string', description: 'Filter by network' },
      },
    },
  },
  {
    name: 'mydevices_gateways_get',
    description: 'Get gateway details including metadata',
    inputSchema: {
      type: 'object',
      properties: {
        hardware_id: { type: 'string', description: 'Gateway hardware ID' },
      },
      required: ['hardware_id'],
    },
  },
  {
    name: 'mydevices_gateways_pings',
    description: 'Show gateway keepalive ping histogram',
    inputSchema: {
      type: 'object',
      properties: {
        hardware_id: { type: 'string', description: 'Gateway hardware ID' },
        hours: { type: 'number', description: 'Show last N hours (default: 24)' },
      },
      required: ['hardware_id'],
    },
  },
  {
    name: 'mydevices_gateways_stats',
    description: 'Show gateway packet statistics',
    inputSchema: {
      type: 'object',
      properties: {
        hardware_id: { type: 'string', description: 'Gateway hardware ID' },
      },
      required: ['hardware_id'],
    },
  },

  // Companies, Locations, Users
  {
    name: 'mydevices_companies_list',
    description: 'List companies',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Results per page' },
      },
    },
  },
  {
    name: 'mydevices_locations_list',
    description: 'List locations',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Results per page' },
        company_id: { type: 'string', description: 'Filter by company ID' },
      },
    },
  },
  {
    name: 'mydevices_users_list',
    description: 'List users',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Results per page' },
      },
    },
  },
];

// ============================================================================
// Tool Execution
// ============================================================================

function buildCliArgs(toolName: string, params: Record<string, unknown>): string[] {
  const args: string[] = [];

  // Parse tool name to get command path
  // e.g., mydevices_templates_capabilities_create -> templates capabilities create
  const parts = toolName.replace('mydevices_', '').split('_');
  args.push(...parts);

  // Add --json flag for machine-readable output
  args.push('--json');

  // Convert params to CLI args
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;

    // Handle positional arguments (id, hardware_id as first arg, etc.)
    if (key === 'id' || (key === 'hardware_id' && !toolName.includes('registry_create'))) {
      // Insert before --json
      args.splice(args.length - 1, 0, String(value));
      continue;
    }

    if (key === 'template_id' && toolName.includes('capabilities')) {
      args.splice(args.length - 1, 0, String(value));
      continue;
    }

    if (key === 'template_id' && toolName.includes('assign_codec')) {
      args.splice(args.length - 1, 0, String(value));
      continue;
    }

    if (key === 'codec_id' && toolName.includes('assign_codec')) {
      args.splice(args.length - 1, 0, String(value));
      continue;
    }

    if (key === 'template_id' && toolName.includes('scaffold_decoder')) {
      args.splice(args.length - 1, 0, String(value));
      continue;
    }

    // Convert snake_case to kebab-case for flags
    const flag = `--${key.replace(/_/g, '-')}`;

    if (typeof value === 'boolean') {
      if (value) args.push(flag);
    } else {
      args.push(flag, String(value));
    }
  }

  return args;
}

async function executeTool(toolName: string, params: Record<string, unknown>): Promise<unknown> {
  const args = buildCliArgs(toolName, params);

  return new Promise((resolve, reject) => {
    const proc = spawn('mydevices', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `Command exited with code ${code}`));
        return;
      }

      try {
        const result = JSON.parse(stdout);
        resolve(result);
      } catch {
        // If not JSON, return as text
        resolve({ output: stdout.trim() });
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

// ============================================================================
// MCP Server
// ============================================================================

function sendResponse(response: MCPResponse): void {
  console.log(JSON.stringify(response));
}

async function handleRequest(request: MCPRequest): Promise<void> {
  const { id, method, params } = request;

  try {
    switch (method) {
      case 'initialize':
        sendResponse({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: 'mydevices-cli',
              version: '1.0.0',
            },
          },
        });
        break;

      case 'tools/list':
        sendResponse({
          jsonrpc: '2.0',
          id,
          result: {
            tools: TOOLS,
          },
        });
        break;

      case 'tools/call': {
        const toolName = (params as { name: string }).name;
        const toolParams = ((params as { arguments?: Record<string, unknown> }).arguments) || {};

        const tool = TOOLS.find((t) => t.name === toolName);
        if (!tool) {
          sendResponse({
            jsonrpc: '2.0',
            id,
            error: {
              code: -32602,
              message: `Unknown tool: ${toolName}`,
            },
          });
          return;
        }

        try {
          const result = await executeTool(toolName, toolParams);
          sendResponse({
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            },
          });
        } catch (err) {
          sendResponse({
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: `Error: ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
              isError: true,
            },
          });
        }
        break;
      }

      case 'notifications/initialized':
        // No response needed for notifications
        break;

      default:
        sendResponse({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Unknown method: ${method}`,
          },
        });
    }
  } catch (err) {
    sendResponse({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message: err instanceof Error ? err.message : 'Internal error',
      },
    });
  }
}

// ============================================================================
// Main
// ============================================================================

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', async (line) => {
  try {
    const request = JSON.parse(line) as MCPRequest;
    await handleRequest(request);
  } catch (err) {
    // Invalid JSON, ignore
  }
});

// Log to stderr for debugging (won't interfere with MCP protocol)
console.error('myDevices MCP Server started');
