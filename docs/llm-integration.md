# LLM Integration Guide

This guide explains how to integrate the myDevices CLI with LLMs like Claude Code.

## Command Schema

The CLI provides a machine-readable schema via the `describe` command:

```bash
# JSON format (default)
mydevices describe --json

# YAML format
mydevices describe --yaml

# Markdown format
mydevices describe --markdown
```

The JSON schema includes all commands, subcommands, arguments, options, and examples.

## MCP Server (Model Context Protocol)

The myDevices CLI includes an MCP server for direct integration with Claude Code and other MCP-compatible clients.

### Setup with Claude Code

1. Add to your Claude Code MCP configuration (`~/.config/claude-code/mcp.json`):

```json
{
  "mcpServers": {
    "mydevices": {
      "command": "bun",
      "args": ["run", "/path/to/mydevices-cli/src/mcp-server.ts"]
    }
  }
}
```

2. Or if you have the CLI installed globally:

```json
{
  "mcpServers": {
    "mydevices": {
      "command": "bun",
      "args": ["run", "mcp"],
      "cwd": "/path/to/mydevices-cli"
    }
  }
}
```

3. Restart Claude Code to load the MCP server.

### Available Tools

The MCP server exposes these tools:

| Tool | Description |
|------|-------------|
| `mydevices_devices_list` | List IoT devices |
| `mydevices_devices_get` | Get device details |
| `mydevices_devices_readings` | Get sensor readings |
| `mydevices_templates_list` | List device templates |
| `mydevices_templates_get` | Get template details |
| `mydevices_templates_create` | Create a template |
| `mydevices_templates_assign_codec` | Assign codec to template |
| `mydevices_templates_scaffold_decoder` | Generate decoder skeleton |
| `mydevices_templates_datatypes_list` | List datatypes |
| `mydevices_templates_capabilities_create` | Add capability to template |
| `mydevices_codecs_list` | List codecs |
| `mydevices_codecs_get` | Get codec details |
| `mydevices_codecs_decode` | Test decode a payload |
| `mydevices_codecs_encode` | Test encode a command |
| `mydevices_registry_list` | List registered devices |
| `mydevices_registry_get` | Get registry entry |
| `mydevices_registry_create` | Register a device |
| `mydevices_registry_unpair` | Unpair a device |
| `mydevices_registry_networks` | List networks |
| `mydevices_gateways_list` | List gateways |
| `mydevices_gateways_get` | Get gateway details |
| `mydevices_gateways_pings` | Get ping histogram |
| `mydevices_gateways_stats` | Get packet statistics |

### Example Usage in Claude Code

Once configured, you can ask Claude to:

- "List all pending devices in the registry"
- "Show me the ping histogram for gateway eui-647fdafffe01433c"
- "Create a temperature sensor template for Acme Corp"
- "Decode this LoRaWAN payload: 00fa320d48"

## Direct CLI Integration

LLMs can also use the CLI directly via shell commands. Always use `--json` for machine-readable output:

```bash
# List devices
mydevices devices list --json

# Get device readings
mydevices devices get abc123 --json

# Decode payload
mydevices codecs decode my-codec -d "00fa320d48" -f hex --json
```

## Authentication

Before using the CLI or MCP server, authenticate:

```bash
mydevices auth login
```

Credentials are stored in `~/.config/mydevices-cli-nodejs/config.json`.

## See Also

- [Device Templates Guide](./device-templates.md)
- [Codecs Guide](./codecs.md)
- [API Reference](./api-reference.md)
