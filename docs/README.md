# myDevices CLI Documentation

## Guides

| Guide | Description |
|-------|-------------|
| [Bulk Import](./bulk-import.md) | Import locations and devices from CSV files |
| [Device Templates](./device-templates.md) | Creating device integrations with templates and capabilities |
| [Codecs](./codecs.md) | Writing and testing payload decoders/encoders |
| [API Reference](./api-reference.md) | Complete API endpoints reference |
| [LLM Integration](./llm-integration.md) | MCP server setup and command schema for AI assistants |

## Quick Start

```bash
# Login
mydevices auth login

# List devices
mydevices devices list

# Create a device template
mydevices templates create -n "My Sensor" --manufacturer "Acme" ...

# Add capabilities
mydevices templates capabilities create <template-id> -n "Temperature" -c 500 --datatype-id 27
```

## Command Groups

| Command | Description |
|---------|-------------|
| `auth` | Authentication (login, logout, token) |
| `bulk` | Bulk import from CSV files |
| `companies` | Company management |
| `locations` | Location management |
| `users` | User management |
| `devices` | Device management, readings, commands |
| `rules` | Rules and alerts |
| `templates` | Device templates, capabilities, datatypes |
| `codecs` | Codec management and testing |
| `config` | CLI configuration |

## Global Options

All commands support:

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON (for scripting) |
| `--help` | Show command help |

List commands support:

| Option | Description |
|--------|-------------|
| `-l, --limit <n>` | Results per page (default: 20) |
| `-p, --page <n>` | Page number (default: 0) |
