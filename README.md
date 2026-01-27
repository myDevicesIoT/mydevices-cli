# myDevices CLI

Command-line tool for managing your myDevices IoT platform.

## Installation

### Quick Install (Recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/myDevicesIoT/mydevices-cli/main/install.sh | bash
```

This automatically detects your platform and installs the latest version.

**Options:**
```bash
# Install specific version
VERSION=v1.1.0 curl -fsSL https://raw.githubusercontent.com/myDevicesIoT/mydevices-cli/main/install.sh | bash

# Install to custom directory
INSTALL_DIR=~/.local/bin curl -fsSL https://raw.githubusercontent.com/myDevicesIoT/mydevices-cli/main/install.sh | bash
```

### Download Binary

Download the latest release for your platform from [GitHub Releases](https://github.com/myDevicesIoT/mydevices-cli/releases):

| Platform | Download |
|----------|----------|
| macOS (Apple Silicon) | `mydevices-darwin-arm64` |
| macOS (Intel) | `mydevices-darwin-x64` |
| Linux (x64) | `mydevices-linux-x64` |
| Linux (ARM64) | `mydevices-linux-arm64` |
| Windows | `mydevices-windows-x64.exe` |

After downloading:

```bash
# macOS/Linux: Make it executable and move to PATH
chmod +x mydevices-darwin-arm64
sudo mv mydevices-darwin-arm64 /usr/local/bin/mydevices

# Verify installation
mydevices --version
```

### Build from Source

Requires [Bun](https://bun.sh) installed.

```bash
git clone https://github.com/myDevicesIoT/mydevices-cli.git
cd mydevices-cli
bun install
bun run build
```

## Quick Start

```bash
# 1. Configure the CLI
mydevices config init

# 2. Login with your credentials
mydevices auth login

# 3. Start using the CLI
mydevices devices list
```

## Commands

### Authentication

```bash
mydevices auth login       # Interactive login
mydevices auth logout      # Clear credentials
mydevices auth whoami      # Show auth status
mydevices auth token       # Print access token
```

### Configuration

```bash
mydevices config init      # Interactive setup
mydevices config list      # Show all settings
mydevices config get <key> # Get a setting
mydevices config set <key> <value>  # Set a setting
```

### Companies

```bash
mydevices companies list [--json]
mydevices companies get <id>
mydevices companies create --name "Company Name" --city "City"
mydevices companies update <id> --name "New Name"
mydevices companies delete <id>
mydevices companies count
```

### Locations

```bash
mydevices locations list [--json]
mydevices locations get <id>
mydevices locations create --name "Location Name"
mydevices locations update <id> --name "New Name"
mydevices locations delete <id>
mydevices locations count
```

### Users

```bash
mydevices users list [--email user@example.com]
mydevices users get <id>
mydevices users create --email "user@example.com" --notify
mydevices users update <id> --first-name "John"
mydevices users delete <id>
mydevices users count
mydevices users permissions set <user-id> --location-id <loc-id> --permission edit
mydevices users permissions delete <user-id> --location-id <loc-id>
```

### Devices

```bash
mydevices devices list [--location-id <id>] [--status 0]
mydevices devices get <id>
mydevices devices create --name "Sensor" --hardware-id "001122334455"
mydevices devices update <id> --name "New Name"
mydevices devices delete <id>
mydevices devices count
mydevices devices latest <id>          # Latest sensor readings
mydevices devices readings <id>        # Historical readings
mydevices devices cmd <id> --channel 1 --value 100  # Send command
mydevices devices status <hardware-id> # Lookup by hardware ID
```

### Rules

```bash
mydevices rules list [--json]
mydevices rules count
```

## Output Formats

All list commands support `--json` flag for machine-readable output:

```bash
# Human-readable table (default)
mydevices devices list

# JSON output for scripting
mydevices devices list --json

# Pipe to jq for processing
mydevices devices list --json | jq '.[] | .id'
```

## Environment Variables

For CI/CD and automation, credentials can be passed via environment variables:

```bash
export MYDEVICES_REALM=your-realm
export MYDEVICES_CLIENT_ID=your-client-id
export MYDEVICES_CLIENT_SECRET=your-client-secret

mydevices auth login  # Will use env vars instead of prompting
```

## Development

```bash
# Run in development mode
bun run dev

# Type check
bun run typecheck

# Build binary
bun run build
```

## License

MIT
