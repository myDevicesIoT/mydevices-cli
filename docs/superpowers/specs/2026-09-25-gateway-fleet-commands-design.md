# Gateway fleet commands — design

Date: 2026-09-25
Branch: `feat/gateway-fleet-commands` (from `main`)

## Goal

Make the gateway operations used during fleet campaigns (Project Helix: dps-client updates, provider
migrations, sensor registry triage) first-class, non-interactive `mydevices` commands, so they can be run
without gwm or its local SQLite state. The CLI sends and reports; it keeps no campaign state and has no
skip/idempotency logic (that stays in gwm).

## Scope

In:

1. `gateways update-software` non-interactive: `--url`, `--checksum`, `--yes`.
2. `bulk gateways reboot|update|migrate-provider <file>` — list-driven gateway commands.
3. `registry lookup <file>` — batch registry status for sensor/gateway IDs, plus `--template`.
4. `registry get` fix (currently returns "Resource not found" for any ID).
5. Config/actual backend on `gateways list` and `gateways get`.

Out:

- **No remote-shell command** in any form (no `gateways shell`, no `--remote-shell` reboot). `reboot`
  sends `{command:'reboot'}` only. Stuck-switching gateways (config mqtt / actual azure) keep going through
  `gwm reboot`, which uses remote-shell.
- No retries, no resume state, no rate-limit detection beyond a fixed `--delay`.
- No `--backend` filter on `gateways list` (the API cannot filter on attributes; a client-side filter would
  only see the current page).
- Region handling: the CLI already targets whatever `apiUrl`/clientId is configured; nothing region-specific
  is added.

## Scope of credentials

The list endpoints are scoped to the configured clientId: as `dsi`, `gateways list` returns 82 gateways and
a sensor from another customer is not found in `registry list`. `gateways get` does return other customers'
gateways. Fleet operators therefore run these commands as the **`iotinabox`** org (the scope gwm uses:
`/v1.1/organizations/iotinabox/applications/iotinabox/...`), set up with `auth login` or `auth set-token`.
The commands stay generic — they use `getConfig('clientId')` — and every bulk/lookup command prints the
clientId it is acting as, so a customer-scoped session is not mistaken for a fleet-wide one.

## Components

### `src/lib/gateway-commands.ts` (new, pure + one sender)

```ts
type GatewayCommand =
  | { kind: 'reboot' }                                        // POST …/gateways/<eui>/commands {command:'reboot'}
  | { kind: 'update'; url: string; checksum: string }         // POST …/gateways/<eui>/commands {command:'update', options:{update_url, update_checksum}}
  | { kind: 'migrate-provider'; provider: 'azure' | 'mydevices' }; // POST …/gateways/<eui>/migrate-provider {provider}

buildRequest(clientId: string, eui: string, cmd: GatewayCommand): { path: string; body: object }
normalizeEui(id: string): string        // -> 'eui-' + 16 lowercase hex; throws on anything else
validateUpdate(url: string, checksum: string): void  // https URL; checksum is 32 hex (md5); throws with a message
sendGatewayCommand(eui, cmd): Promise<{ ok: boolean; status?: number; body?: unknown; error?: string }>
```

`normalizeHardwareId` in `gateways.ts` is replaced by `normalizeEui`; malformed IDs are now rejected
instead of being interpolated into the URL. The single-gateway `reboot`, `update-software` and
`migrate-provider` send through `sendGatewayCommand`, so single and bulk paths cannot diverge.

### `src/lib/eui-list.ts` (new, extracted from `bulk deactivate`)

`readIdList(file, { column?, delimiter? }) -> { ids: string[]; column: string; invalid: {line, value}[] }`

- Lines starting with `#` are skipped before parsing (the CSV parser has no comment support).
- CSV with an ID column (auto-detected from `hardware_id, eui, deveui, dev_eui, device_eui, hwid`, or the
  only column, or `--column`), else plain text, one ID per line — same rules as `bulk deactivate` today.
- Values are trimmed and de-duplicated (first occurrence wins).
- Validation is the caller's: gateway commands map through `normalizeEui`; registry lookup lowercases.

`bulk deactivate` is refactored to use it. Two behavior changes: `#` lines are ignored, and a plain-text
file is no longer parsed as CSV — today its first EUI is taken as the header and silently skipped. A file is
read as CSV only when `--column`/`--delimiter` is given, the first line contains a delimiter, or the first
line is a known ID header; otherwise every line is an ID. Dedupe is case-insensitive.

### `src/lib/results-file.ts` (new)

`writeResults(path, rows)` — `.csv` or `.json` by extension. CSV columns for gateway commands:
`eui,command,status_code,ok,error,sent_at`; the `eui` column makes a failures CSV a valid re-run input.

## Commands

### `gateways update-software <eui> [--url <ipk> --checksum <md5>] [--yes] [--json]`

- With `--url`: `--checksum` is required; `validateUpdate` runs; the manifest picker is skipped. The
  confirmation shows EUI, URL and md5; `--yes` skips it.
- Without `--url`: current interactive manifest flow, unchanged. `--checksum` without `--url` is an error.

### `bulk gateways` (new group under `bulk`)

```
mydevices bulk gateways reboot           <file>
mydevices bulk gateways update           <file> --url <ipk> --checksum <md5>
mydevices bulk gateways migrate-provider <file> --provider mydevices|azure
  common: --column <name>  --delimiter <char>  --dry-run  --limit <n>  --delay <ms> (default 500)
          --yes  --json  --output <file.csv|file.json>
```

Flow:

1. `readIdList`, map through `normalizeEui`. Any invalid line → list them and exit 1 before sending anything.
2. Preview: count, first 5 EUIs, the exact request body, and the acting clientId. `--limit` truncates the list
   (preview shows "n of total").
3. `--dry-run`: print the plan, send nothing, exit 0. Otherwise confirm unless `--yes`.
4. Send sequentially in file order, sleeping `--delay` ms between sends. A failure is recorded and the run
   continues. No retries (repeating an update or migrate is not free; the results file drives the re-run).
5. Summary: sent / failed, failures table. `--json` prints `{ clientId, command, sent, failed, results }`.
   `--output` writes per-gateway rows. Exit 1 if any failed.

### `registry lookup <file>` (new)

```
mydevices registry lookup <file> [--column <name>] [--delimiter <char>]
                                 [--only PAIRED|PENDING|DECOMMISSIONED|NOT-FOUND]
                                 [--write <ids.txt>] [--concurrency <n>] (default 5)
                                 [--json] [--output <file.csv|file.json>]
mydevices registry lookup --template [file]      # default file: registry-lookup-template.csv
```

- Each ID (trimmed, lowercased, otherwise as given — sensors have no `eui-` prefix, gateways do) is looked up
  with `GET …/things/registry?filter=hardware_id eq <id>&limit=1`. Read-only, `--concurrency` in flight.
- Row: `hardware_id, status, device_type, paired_to_app_id, paired_at, network`. No match →
  `NOT-FOUND` ("not visible to this clientId", not a claim that the device does not exist). A request error
  → `ERROR` with the message; errors make the exit code 1.
- Header line prints the acting clientId. Summary counts per status.
- `--only` filters the displayed/written rows; `--write` saves the filtered IDs one per line (feeds the next
  step, e.g. PAIRED sensors to LNS triage).
- `--template` writes the starter file and exits (no auth needed, refuses to overwrite an existing file):

  ```
  # mydevices registry lookup — one ID per row under hardware_id. Lines starting with # are ignored.
  # Sensors: 16-hex devEUI, e.g. 24e124600e458870. Gateways: eui-<16 hex>, e.g. eui-647fdafffe02d34f.
  # Run: mydevices registry lookup <this-file> [--only PAIRED] [--write paired.txt]
  hardware_id
  ```

  It has no data rows, so running it unedited fails with "No hardware IDs found".

### `registry get <id>` fix

`GET …/things/registry/<id>` returns "Resource not found" for **both** a hardware ID and the registry UUID
(verified 2026-09-25 as `dsi` against `eui-00800000d000f6e6` / `9b72d8e0-…`, which `registry list` returns).
The list endpoint filters on either field, and its row carries everything `get` renders (device_type,
devices, sku, paired_to_app_id). So `registry get` switches to
`GET …/things/registry?filter=<id eq X | hardware_id eq X>&limit=1` — `id eq` when `<id>` is a UUID,
`hardware_id eq` (lowercased) otherwise — and renders that row with the existing formatter. No row → the
existing "Resource not found" error. `registry lookup` shares the same lookup function.

### Backend fields

- `gateways list`: add `Config Backend` and `Actual Backend` columns from the list entry's `attributes`
  (`config_backend`, `actual_backend`; `-` when absent). `--json` unchanged (attributes are already there).
- `gateways get`: one extra `GET …/gateways?filter=hardware_id eq <eui>&limit=1` after the main fetch. Adds a
  `Backend` section: Config Backend, Actual Backend, Config Endpoint. If the gateway is not visible to the
  list endpoint (another customer's gateway under a customer clientId), the section reads
  `not visible to <clientId>` and nothing else changes. If the extra call fails, the rest of the output
  still prints. `--json` adds a top-level `attributes` object (`{name: value}`); existing keys unchanged.
- `attributesToMap(attributes)` in `src/lib/gateway-commands.ts`, shared by list and get (and unit-tested there).

## Error handling

- Input problems (missing file, no IDs, invalid EUIs, bad `--url`/`--checksum`, `--provider` not
  azure|mydevices) exit 1 before any request.
- Per-item API errors in bulk/lookup are recorded, never abort the run; exit code 1 at the end.
- Auth errors surface through the existing axios error handling.

## Testing

`bun test`, following `src/lib/bulk-update.test.ts`:

- `gateway-commands.test.ts`: `buildRequest` path + body per command kind; `normalizeEui` (bare hex, `eui-`
  prefix, uppercase, wrong length, non-hex); `validateUpdate` (http rejected, bad md5).
- `eui-list.test.ts`: CSV auto-detect, `--column`, plain text, `#` comment lines, dedupe, empty file, the
  generated template parses to zero IDs.
- `results-file.test.ts`: CSV header/escaping, JSON shape, extension dispatch.
- attribute mapping: backends present / absent.

Live checks (read-only only): `registry lookup` on a small list, `registry get <hardware-id>`,
`gateways get`/`list` backend columns, and `bulk gateways … --dry-run`. No real gateway command is sent
during development.

## Docs

`docs/bulk-gateways.md`, `docs/registry-lookup.md`, README sections for both, and a note on running as the
`iotinabox` org via `auth set-token`.
