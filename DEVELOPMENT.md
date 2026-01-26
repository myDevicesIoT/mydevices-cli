# Development Guide

This document covers the architecture, patterns, and processes for developing the myDevices CLI.

## Architecture Overview

```
src/
├── index.ts              # Entry point - registers all commands
├── commands/             # Command implementations
│   ├── auth.ts           # Authentication (login, logout, whoami, token)
│   ├── companies.ts      # Company CRUD operations
│   ├── config.ts         # CLI configuration management
│   ├── devices.ts        # Device management + readings + commands
│   ├── locations.ts      # Location CRUD operations
│   ├── rules.ts          # Rules/alerts listing
│   └── users.ts          # User management + permissions
├── lib/                  # Shared libraries
│   ├── api.ts            # Axios HTTP client with auth interceptors
│   ├── auth.ts           # OAuth2 token management
│   ├── config.ts         # Config file storage (uses `conf` package)
│   └── output.ts         # Table/JSON formatters
└── types/
    └── index.ts          # TypeScript interfaces for API models
```

## Tech Stack

| Component | Library | Purpose |
|-----------|---------|---------|
| Runtime | [Bun](https://bun.sh) | Fast JS runtime with native TS support |
| CLI Framework | [Commander.js](https://github.com/tj/commander.js) | Command parsing and help generation |
| HTTP Client | [Axios](https://axios-http.com) | API requests with interceptors |
| Prompts | [@inquirer/prompts](https://github.com/SBoudrias/Inquirer.js) | Interactive user input |
| Config Storage | [conf](https://github.com/sindresorhus/conf) | Persistent config in user's home dir |
| Table Output | [cli-table3](https://github.com/cli-table/cli-table3) | Formatted table output |
| Colors | [chalk](https://github.com/chalk/chalk) | Terminal colors |
| Spinners | [ora](https://github.com/sindresorhus/ora) | Loading spinners |

## Key Concepts

### Authentication Flow

1. User runs `mydevices auth login`
2. CLI prompts for realm, client_id, client_secret (or reads from env/flags)
3. OAuth2 client_credentials grant request to auth server
4. Tokens stored in config file (`~/.config/mydevices-cli-nodejs/config.json`)
5. Subsequent API calls use stored access_token
6. Token auto-refreshes when expired (using refresh_token)

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   CLI       │────▶│  Auth Server │────▶│  API Server │
│  (login)    │     │  (OAuth2)    │     │  (REST)     │
└─────────────┘     └──────────────┘     └─────────────┘
      │                    │
      │  client_credentials│
      │◀───────────────────│
      │  access_token      │
      │  refresh_token     │
      ▼
┌─────────────┐
│ Config File │
│ (tokens)    │
└─────────────┘
```

### API Client

The API client (`src/lib/api.ts`) uses Axios interceptors to:
- Automatically inject Bearer token on every request
- Auto-refresh expired tokens before requests
- Handle common error responses (401, 403, 404)

### Output Formatting

All list commands support two output modes:
- **Table** (default): Human-readable formatted tables
- **JSON** (`--json` flag): Machine-readable for scripting

The `output()` helper in `src/lib/output.ts` handles this automatically.

## Adding a New Command

### 1. Create the command file

```typescript
// src/commands/widgets.ts
import { Command } from 'commander';
import ora from 'ora';
import { apiGet, apiPost } from '../lib/api.js';
import { output, success, error } from '../lib/output.js';
import type { GlobalOptions, ListOptions } from '../types/index.js';

// Define the type
interface Widget {
  id: string;
  name: string;
  // ...
}

export function createWidgetsCommands(): Command {
  const widgets = new Command('widgets').description('Manage widgets');

  widgets
    .command('list')
    .description('List all widgets')
    .option('--json', 'Output as JSON')
    .action(async (options: GlobalOptions) => {
      const spinner = ora('Fetching widgets...').start();
      try {
        const response = await apiGet<{ rows: Widget[] }>('/v1.0/admin/widgets');
        spinner.stop();

        output(response.rows, {
          json: options.json,
          tableHeaders: ['ID', 'Name'],
          tableMapper: (w: Widget) => [w.id, w.name],
        });
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to fetch widgets');
        process.exit(1);
      }
    });

  // Add more subcommands: get, create, update, delete...

  return widgets;
}
```

### 2. Register in index.ts

```typescript
// src/index.ts
import { createWidgetsCommands } from './commands/widgets.js';

// Add with other commands
program.addCommand(createWidgetsCommands());
```

### 3. Add types (if needed)

```typescript
// src/types/index.ts
export interface Widget {
  id: string;
  name: string;
  created_at?: string;
}
```

## Command Patterns

### Standard CRUD Command Set

Most resources follow this pattern:

| Command | Description | Example |
|---------|-------------|---------|
| `list` | List all with pagination | `mydevices widgets list --limit 10` |
| `get <id>` | Get single by ID | `mydevices widgets get abc123` |
| `create` | Create new | `mydevices widgets create --name "Foo"` |
| `update <id>` | Update existing | `mydevices widgets update abc123 --name "Bar"` |
| `delete <id>` | Delete by ID | `mydevices widgets delete abc123` |
| `count` | Get total count | `mydevices widgets count` |

### Common Options

```typescript
// Global options (available on all commands)
.option('--json', 'Output as JSON')

// List options
.option('-l, --limit <number>', 'Results per page', '20')
.option('-p, --page <number>', 'Page number', '0')

// Filter options (resource-specific)
.option('--user-id <id>', 'Filter by user ID')
.option('--location-id <id>', 'Filter by location ID')
```

## API Endpoints Reference

Base URL: `https://api.mydevices.com`

| Resource | Endpoint | Methods |
|----------|----------|---------|
| Companies | `/v1.0/admin/companies` | GET, POST, PUT, DELETE |
| Locations | `/v1.0/admin/locations` | GET, POST, PUT, DELETE |
| Users | `/v1.0/admin/users` | GET, POST, PUT, DELETE |
| Devices | `/v1.0/admin/things` | GET, POST, PUT, DELETE |
| Device Readings | `/v1.0/admin/things/{id}/readings` | GET |
| Device Commands | `/v1.0/admin/things/{id}/cmd` | POST |
| Rules | `/v1.0/admin/rules` | GET |

Auth URL: `https://auth.mydevices.com/auth/realms/{realm}/protocol/openid-connect/token`

## Local Development

```bash
# Install dependencies
bun install

# Run in development mode (with watch)
bun run dev

# Run directly
bun run src/index.ts devices list

# Type check
bun run typecheck

# Build binary
bun run build

# Test binary
./dist/mydevices --help
```

## Testing Commands Manually

```bash
# Set up test credentials
export MYDEVICES_REALM=your-test-realm
export MYDEVICES_CLIENT_ID=your-client-id
export MYDEVICES_CLIENT_SECRET=your-secret

# Login
bun run src/index.ts auth login

# Test various commands
bun run src/index.ts companies list
bun run src/index.ts devices list --json
bun run src/index.ts users count
```

## Release Process

1. Update version in `package.json`
2. Commit changes: `git commit -am "Release v1.x.x"`
3. Create tag: `git tag v1.x.x`
4. Push: `git push origin main --tags`

GitHub Actions will automatically:
- Build binaries for all platforms (macOS, Linux, Windows)
- Create a GitHub Release
- Attach binaries to the release

### Supported Platforms

| Platform | Target | Binary Name |
|----------|--------|-------------|
| macOS (Apple Silicon) | `darwin-arm64` | `mydevices-darwin-arm64` |
| macOS (Intel) | `darwin-x64` | `mydevices-darwin-x64` |
| Linux (x64) | `linux-x64` | `mydevices-linux-x64` |
| Linux (ARM64) | `linux-arm64` | `mydevices-linux-arm64` |
| Windows | `windows-x64` | `mydevices-windows-x64.exe` |

## Configuration

Config is stored at: `~/.config/mydevices-cli-nodejs/config.json`

```json
{
  "realm": "your-realm",
  "apiUrl": "https://api.mydevices.com",
  "authUrl": "https://auth.mydevices.com",
  "defaultOutput": "table",
  "clientId": "...",
  "clientSecret": "...",
  "accessToken": "...",
  "refreshToken": "...",
  "expiresAt": 1234567890000
}
```

**Security Note**: Credentials are stored in plain text in the config file. For production use, consider implementing OS keychain integration using the `keytar` package.

---

## Documentation

For detailed guides on specific features, see the `docs/` folder:

- [docs/README.md](./docs/README.md) - Documentation index
- [docs/device-templates.md](./docs/device-templates.md) - Device templates and capabilities
- [docs/codecs.md](./docs/codecs.md) - Codec development guide
- [docs/api-reference.md](./docs/api-reference.md) - API endpoints reference

---

## Future Improvements

- [ ] Add `--profile` support for multiple accounts
- [ ] Implement OS keychain storage for secrets
- [ ] Add shell completion scripts (bash, zsh, fish)
- [ ] Add `--watch` mode for device readings
- [ ] Add bulk operations (import/export)
- [ ] Add interactive mode with autocomplete
- [ ] Add unit tests with Bun's test runner
- [ ] Add template cloning (`templates clone <id>`)
- [ ] Add capability reordering (`capabilities reorder`)
- [ ] Add device_use management commands
