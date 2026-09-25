# Gateway Fleet Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add non-interactive software updates, list-driven gateway commands (`bulk gateways …`), batch registry lookup with an input template, a working `registry get`, and config/actual backend fields to the `mydevices` CLI.

**Architecture:** Pure, unit-tested library modules (`gateway-commands`, `eui-list`, `results-file`, `registry-lookup`) hold every payload, parsing and formatting rule; the commander commands in `src/commands/` are thin wrappers that validate flags, call the libs and print. Single-gateway and bulk commands share one request builder so they cannot send different payloads.

**Tech Stack:** Bun 1.3 (runtime + `bun test`), TypeScript strict (`tsc --noEmit`), commander 12, axios, ora, chalk, @inquirer/prompts. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-25-gateway-fleet-commands-design.md` (read it before starting).

## Global Constraints

- Work in the worktree `/Users/asanchezdelc/myDevices/Projects/mydevices-cli/.worktrees/gateway-fleet-commands`, branch `feat/gateway-fleet-commands`. Never touch the main checkout (it is on `feat/bulk-update` with an uncommitted `src/lib/api.ts` change).
- **No remote-shell command in any form.** `reboot` sends exactly `{command:'reboot'}`.
- Request paths use the configured clientId: `/v1.1/organizations/<clientId>/applications/<clientId>/gateways/<eui>/…`. No hardcoded `iotinabox`.
- Payloads, verbatim: reboot `{command:'reboot'}`; update `{command:'update', options:{update_url, update_checksum}}`; migrate `POST …/<eui>/migrate-provider {provider}` with provider `azure|mydevices`.
- Update validation: `--url` must be `https:`; `--checksum` must be 32 hex characters (md5). Checksum is sent as given.
- Gateway EUI canonical form: `eui-` + 16 lowercase hex.
- Bulk defaults: `--delay` 500 ms; sequential; no retries. Registry lookup `--concurrency` default 5, max 20.
- Gateway results columns: `eui,command,status_code,ok,error,sent_at`. Lookup results columns: `hardware_id,status,device_type,paired_to_app_id,paired_at,network,error`.
- Unmatched registry IDs are labelled `NOT-FOUND` (never "not in registry").
- Template default filename: `registry-lookup-template.csv`; never overwrite an existing file.
- ESM imports use the `.js` suffix (`'../lib/api.js'`), matching the codebase.
- **Never send a real gateway command during development.** Live checks are read-only (`get`, `list`, `registry lookup`) or `--dry-run`, except the one stdin-refusal check in Task 6, which uses non-existent EUIs.
- Commit style: `feat: …`, `fix: …`, `refactor: …`, `docs: …`, `test: …`.

## Review Focus

1. **Case/prefix duplicates in an EUI list** (`EUI-647FDA…` and `647fda…` on two lines) — the gateway must be commanded once, not twice. Pinned in Task 1 (`normalizeEuiList`) and Task 2 (case-insensitive reader dedupe).
2. **A bad `--output` path discovered after the run** — an operator who typos `results.txt` must be stopped before anything is sent, not after 250 gateways. Pinned in Task 3 (`assertResultsPath`) and the ordering check in Task 6.
3. **Non-interactive invocation without `--yes`** (cron, pipe, CI) — must refuse and exit 1, never hang on a prompt or send. Pinned in Task 6 (stdin check).
4. **A plain-text EUI file with no header** — the first EUI must not be swallowed as a CSV header (the current `bulk deactivate` does this). Pinned in Task 2.
5. **Logged out / no clientId** — must fail with a clear message before any request, never call `/organizations//applications//…`. Pinned in Task 1 (`buildRequest` throws) and Task 6/8 (up-front check).

Also covered: Excel UTF-8 BOM on the header (Task 2), Ctrl-C mid-run keeps the partial results (Task 6).

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/lib/api.ts` | modify | `ApiError` (carries HTTP status), `apiPostWithStatus` |
| `src/lib/gateway-commands.ts` | create | EUI normalization, update/provider validation, request builder, sender, batch runner, attribute map |
| `src/lib/gateway-commands.test.ts` | create | tests for the above |
| `src/lib/csv-parser.ts` | modify | export `parseCSVContent` (string input) |
| `src/lib/eui-list.ts` | create | read an ID list from CSV or plain text |
| `src/lib/eui-list.test.ts` | create | |
| `src/lib/results-file.ts` | create | write results as CSV/JSON; validate `--output` path |
| `src/lib/results-file.test.ts` | create | |
| `src/lib/registry-lookup.ts` | create | registry types, filtered lookup, batch lookup, template |
| `src/lib/registry-lookup.test.ts` | create | |
| `src/commands/gateways.ts` | modify | shared sender for reboot/update/migrate; `--url/--checksum/--yes`; backend fields |
| `src/commands/bulk-gateways.ts` | create | `bulk gateways reboot|update|migrate-provider` |
| `src/commands/bulk.ts` | modify | `deactivate` uses `readIdList`; mount `bulk gateways` |
| `src/commands/registry.ts` | modify | `get` fix; `lookup` command |
| `src/commands/completion.ts`, `src/commands/describe.ts` | modify | list new subcommands |
| `docs/bulk-gateways.md`, `docs/registry-lookup.md`, `docs/README.md`, `README.md` | create/modify | docs |

---

### Task 1: API status errors and the gateway-commands library

**Files:**
- Modify: `src/lib/api.ts`
- Create: `src/lib/gateway-commands.ts`
- Test: `src/lib/gateway-commands.test.ts`

**Interfaces:**
- Consumes: `getConfig('clientId')` from `src/lib/config.ts`; axios client from `getApiClient()`.
- Produces:
  - `class ApiError extends Error { readonly status?: number }` and `apiPostWithStatus<T>(path: string, data?: Record<string, unknown>): Promise<{ status: number; data: T }>` in `api.ts`
  - `type Provider = 'azure' | 'mydevices'`
  - `type GatewayCommand = { kind: 'reboot' } | { kind: 'update'; url: string; checksum: string } | { kind: 'migrate-provider'; provider: Provider }`
  - `interface GatewayRequest { path: string; body: Record<string, unknown> }`
  - `interface SendResult { eui: string; command: string; ok: boolean; status_code?: number; error?: string; body?: unknown; sent_at: string }`
  - `RESULT_COLUMNS: string[]`
  - `normalizeEui(id: string): string` (throws)
  - `normalizeEuiList(ids: string[]): { euis: string[]; invalid: string[]; duplicates: number }`
  - `validateUpdate(url: string, checksum: string): void` (throws)
  - `parseProvider(value: string): Provider` (throws)
  - `commandLabel(cmd: GatewayCommand): string`
  - `buildRequest(clientId: string, eui: string, cmd: GatewayCommand): GatewayRequest` (throws)
  - `sendGatewayCommand(eui: string, cmd: GatewayCommand): Promise<SendResult>` (never throws)
  - `runBatch(euis: string[], send: (eui: string) => Promise<SendResult>, opts: BatchOptions): Promise<SendResult[]>`
  - `attributesToMap(attributes: unknown): Record<string, string>`

- [ ] **Step 1: Install and record the baseline**

```bash
cd /Users/asanchezdelc/myDevices/Projects/mydevices-cli/.worktrees/gateway-fleet-commands
bun install
bun test
bun run typecheck
```
Expected: `bun test` passes (`src/lib/auth.test.ts`). If `typecheck` reports errors, write them down — they are pre-existing and must not grow. Do not fix unrelated errors.

- [ ] **Step 2: Write the failing tests**

Create `src/lib/gateway-commands.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import {
  attributesToMap,
  buildRequest,
  commandLabel,
  normalizeEui,
  normalizeEuiList,
  parseProvider,
  runBatch,
  validateUpdate,
  type SendResult,
} from './gateway-commands.js';

const EUI = 'eui-647fdafffe02d34f';

describe('normalizeEui', () => {
  test('adds the eui- prefix to bare hex', () => {
    expect(normalizeEui('647fdafffe02d34f')).toBe(EUI);
  });
  test('keeps an existing prefix', () => {
    expect(normalizeEui(EUI)).toBe(EUI);
  });
  test('lowercases and trims', () => {
    expect(normalizeEui('  EUI-647FDAFFFE02D34F ')).toBe(EUI);
  });
  test('rejects the wrong length', () => {
    expect(() => normalizeEui('647fdafffe02d3')).toThrow(/Invalid gateway EUI/);
  });
  test('rejects non-hex characters', () => {
    expect(() => normalizeEui('647fdafffe02d34z')).toThrow(/Invalid gateway EUI/);
  });
  test('rejects an empty string', () => {
    expect(() => normalizeEui('')).toThrow(/Invalid gateway EUI/);
  });
});

describe('normalizeEuiList', () => {
  test('normalizes, keeps order and collects invalid entries', () => {
    const r = normalizeEuiList(['647fdafffe02d34f', 'bogus', 'eui-00800000d000f6e6']);
    expect(r.euis).toEqual([EUI, 'eui-00800000d000f6e6']);
    expect(r.invalid).toEqual(['bogus']);
    expect(r.duplicates).toBe(0);
  });
  test('treats case and prefix variants of one EUI as a duplicate', () => {
    const r = normalizeEuiList(['EUI-647FDAFFFE02D34F', '647fdafffe02d34f', EUI]);
    expect(r.euis).toEqual([EUI]);
    expect(r.duplicates).toBe(2);
  });
});

describe('validateUpdate', () => {
  const md5 = '2a3f7fe7ff4b34cf6870e47ae709937f';
  test('accepts an https URL and a 32-hex md5', () => {
    expect(() => validateUpdate('https://hwdartifacts.blob.core.windows.net/hwdassets/dps-client_1.5.0-r0_kona.ipk', md5)).not.toThrow();
  });
  test('accepts an uppercase md5', () => {
    expect(() => validateUpdate('https://example.com/a.ipk', md5.toUpperCase())).not.toThrow();
  });
  test('rejects http', () => {
    expect(() => validateUpdate('http://example.com/a.ipk', md5)).toThrow(/must be https/);
  });
  test('rejects a non-URL', () => {
    expect(() => validateUpdate('dps-client.ipk', md5)).toThrow(/not a URL/);
  });
  test('rejects a short checksum', () => {
    expect(() => validateUpdate('https://example.com/a.ipk', 'abc123')).toThrow(/--checksum/);
  });
  test('rejects a sha256-length checksum', () => {
    expect(() => validateUpdate('https://example.com/a.ipk', 'a'.repeat(64))).toThrow(/--checksum/);
  });
});

describe('parseProvider', () => {
  test('accepts azure and mydevices case-insensitively', () => {
    expect(parseProvider('azure')).toBe('azure');
    expect(parseProvider(' MyDevices ')).toBe('mydevices');
  });
  test('rejects anything else', () => {
    expect(() => parseProvider('emqx')).toThrow(/Must be "azure" or "mydevices"/);
  });
});

describe('buildRequest', () => {
  test('reboot', () => {
    expect(buildRequest('iotinabox', EUI, { kind: 'reboot' })).toEqual({
      path: `/v1.1/organizations/iotinabox/applications/iotinabox/gateways/${EUI}/commands`,
      body: { command: 'reboot' },
    });
  });
  test('update sends url and checksum unchanged', () => {
    expect(buildRequest('dsi', EUI, { kind: 'update', url: 'https://x/a.ipk', checksum: 'ABCDEF0123456789abcdef0123456789' })).toEqual({
      path: `/v1.1/organizations/dsi/applications/dsi/gateways/${EUI}/commands`,
      body: { command: 'update', options: { update_url: 'https://x/a.ipk', update_checksum: 'ABCDEF0123456789abcdef0123456789' } },
    });
  });
  test('migrate-provider uses its own endpoint', () => {
    expect(buildRequest('iotinabox', EUI, { kind: 'migrate-provider', provider: 'mydevices' })).toEqual({
      path: `/v1.1/organizations/iotinabox/applications/iotinabox/gateways/${EUI}/migrate-provider`,
      body: { provider: 'mydevices' },
    });
  });
  test('normalizes the EUI', () => {
    expect(buildRequest('dsi', '647FDAFFFE02D34F', { kind: 'reboot' }).path).toContain(`/gateways/${EUI}/commands`);
  });
  test('refuses an empty clientId', () => {
    expect(() => buildRequest('', EUI, { kind: 'reboot' })).toThrow(/No clientId configured/);
  });
});

describe('commandLabel', () => {
  test('labels each kind', () => {
    expect(commandLabel({ kind: 'reboot' })).toBe('reboot');
    expect(commandLabel({ kind: 'update', url: 'https://x', checksum: 'y' })).toBe('update');
    expect(commandLabel({ kind: 'migrate-provider', provider: 'azure' })).toBe('migrate-provider:azure');
  });
});

describe('attributesToMap', () => {
  test('maps name/value pairs', () => {
    const attrs = [
      { id: '1', name: 'actual_backend', value: 'azure' },
      { id: '2', name: 'config_backend', value: 'mqtt' },
      { id: '3', name: 'rssi', value: -76 },
    ];
    expect(attributesToMap(attrs)).toEqual({ actual_backend: 'azure', config_backend: 'mqtt', rssi: '-76' });
  });
  test('returns an empty map for missing or malformed input', () => {
    expect(attributesToMap(undefined)).toEqual({});
    expect(attributesToMap('nope')).toEqual({});
    expect(attributesToMap([null, { value: 'x' }, { name: 'a', value: null }])).toEqual({ a: '' });
  });
});

describe('runBatch', () => {
  const ok = (eui: string): SendResult => ({ eui, command: 'reboot', ok: true, status_code: 200, sent_at: 't' });

  test('sends in order and sleeps only between items', async () => {
    const calls: string[] = [];
    const sleeps: number[] = [];
    const results = await runBatch(['a', 'b', 'c'], async (eui) => { calls.push(eui); return ok(eui); }, {
      delayMs: 250,
      sleep: async (ms) => { sleeps.push(ms); },
    });
    expect(calls).toEqual(['a', 'b', 'c']);
    expect(sleeps).toEqual([250, 250]);
    expect(results.map((r) => r.eui)).toEqual(['a', 'b', 'c']);
  });

  test('records a failure and keeps going', async () => {
    const results = await runBatch(['a', 'b'], async (eui) =>
      eui === 'a' ? { eui, command: 'reboot', ok: false, status_code: 404, error: 'Resource not found.', sent_at: 't' } : ok(eui),
      { delayMs: 0 });
    expect(results.map((r) => r.ok)).toEqual([false, true]);
  });

  test('turns a throwing sender into a failed result', async () => {
    const results = await runBatch(['a'], async () => { throw new Error('boom'); }, { delayMs: 0 });
    expect(results[0]).toMatchObject({ eui: 'a', ok: false, error: 'boom' });
  });

  test('stops before the next item when shouldStop turns true', async () => {
    let stop = false;
    const results = await runBatch(['a', 'b', 'c'], async (eui) => { stop = true; return ok(eui); }, {
      delayMs: 0,
      shouldStop: () => stop,
    });
    expect(results.map((r) => r.eui)).toEqual(['a']);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bun test src/lib/gateway-commands.test.ts`
Expected: FAIL — `Cannot find module './gateway-commands.js'`.

- [ ] **Step 4: Add `ApiError` and `apiPostWithStatus` to `src/lib/api.ts`**

Add after the imports:

```ts
/** An API error that keeps the HTTP status, so bulk results can report it. */
export class ApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}
```

In the response interceptor, replace the `switch (status) { … }` block with (messages unchanged, now carrying the status):

```ts
          switch (status) {
            case 401:
              throw new ApiError('Authentication failed. Run "mydevices auth login" to re-authenticate.', status);
            case 403:
              throw new ApiError('Permission denied. You do not have access to this resource.', status);
            case 404:
              throw new ApiError('Resource not found.', status);
            default:
              throw new ApiError(
                (data?.message as string) ||
                (data?.error as string) ||
                `API error: ${status}`,
                status
              );
          }
```

Add after `apiPost`:

```ts
export async function apiPostWithStatus<T>(
  path: string,
  data?: Record<string, unknown>
): Promise<{ status: number; data: T }> {
  const client = getApiClient();
  const response = await client.post<T>(path, data);
  return { status: response.status, data: response.data };
}
```

- [ ] **Step 5: Create `src/lib/gateway-commands.ts`**

```ts
import { ApiError, apiPostWithStatus } from './api.js';
import { getConfig } from './config.js';

// ============================================================================
// Types
// ============================================================================

export type Provider = 'azure' | 'mydevices';

export type GatewayCommand =
  | { kind: 'reboot' }
  | { kind: 'update'; url: string; checksum: string }
  | { kind: 'migrate-provider'; provider: Provider };

export interface GatewayRequest {
  path: string;
  body: Record<string, unknown>;
}

export interface SendResult {
  eui: string;
  command: string;
  ok: boolean;
  status_code?: number;
  error?: string;
  body?: unknown;
  sent_at: string;
}

export interface BatchOptions {
  delayMs: number;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (index: number, total: number, eui: string) => void;
  shouldStop?: () => boolean;
}

/** Columns of a bulk results CSV. `eui` first so a failures file is a valid re-run input. */
export const RESULT_COLUMNS = ['eui', 'command', 'status_code', 'ok', 'error', 'sent_at'];

// ============================================================================
// Validation
// ============================================================================

const EUI_HEX = /^[0-9a-f]{16}$/;
const MD5 = /^[0-9a-f]{32}$/i;

/** Canonical gateway hardware ID: `eui-` + 16 lowercase hex. */
export function normalizeEui(id: string): string {
  const raw = id.trim().toLowerCase();
  const hex = raw.startsWith('eui-') ? raw.slice(4) : raw;
  if (!EUI_HEX.test(hex)) {
    throw new Error(`Invalid gateway EUI "${id}": expected 16 hex digits, optionally prefixed with eui-`);
  }
  return `eui-${hex}`;
}

/** Normalize a list, dropping duplicates that differ only in case or prefix. */
export function normalizeEuiList(ids: string[]): { euis: string[]; invalid: string[]; duplicates: number } {
  const euis: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  for (const id of ids) {
    let eui: string;
    try {
      eui = normalizeEui(id);
    } catch {
      invalid.push(id);
      continue;
    }
    if (seen.has(eui)) {
      duplicates++;
      continue;
    }
    seen.add(eui);
    euis.push(eui);
  }

  return { euis, invalid, duplicates };
}

export function validateUpdate(url: string, checksum: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid --url "${url}": not a URL`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`Invalid --url "${url}": must be https`);
  }
  if (!MD5.test(checksum)) {
    throw new Error(`Invalid --checksum "${checksum}": expected a 32-character hex MD5`);
  }
}

export function parseProvider(value: string): Provider {
  const provider = value.trim().toLowerCase();
  if (provider !== 'azure' && provider !== 'mydevices') {
    throw new Error(`Invalid provider "${value}". Must be "azure" or "mydevices".`);
  }
  return provider;
}

// ============================================================================
// Requests
// ============================================================================

export function commandLabel(cmd: GatewayCommand): string {
  return cmd.kind === 'migrate-provider' ? `migrate-provider:${cmd.provider}` : cmd.kind;
}

export function buildRequest(clientId: string, eui: string, cmd: GatewayCommand): GatewayRequest {
  if (!clientId) {
    throw new Error('No clientId configured. Run "mydevices auth login" first.');
  }
  const base = `/v1.1/organizations/${clientId}/applications/${clientId}/gateways/${normalizeEui(eui)}`;

  switch (cmd.kind) {
    case 'reboot':
      return { path: `${base}/commands`, body: { command: 'reboot' } };
    case 'update':
      return {
        path: `${base}/commands`,
        body: { command: 'update', options: { update_url: cmd.url, update_checksum: cmd.checksum } },
      };
    case 'migrate-provider':
      return { path: `${base}/migrate-provider`, body: { provider: cmd.provider } };
  }
}

/** Send one command. Never throws: failures come back as `ok: false`. */
export async function sendGatewayCommand(eui: string, cmd: GatewayCommand): Promise<SendResult> {
  const command = commandLabel(cmd);
  const sent_at = new Date().toISOString();
  try {
    const { path, body } = buildRequest(getConfig('clientId'), eui, cmd);
    const res = await apiPostWithStatus<unknown>(path, body);
    return { eui, command, ok: true, status_code: res.status, body: res.data, sent_at };
  } catch (err) {
    return {
      eui,
      command,
      ok: false,
      status_code: err instanceof ApiError ? err.status : undefined,
      error: err instanceof Error ? err.message : String(err),
      sent_at,
    };
  }
}

/** Send sequentially in list order, waiting `delayMs` between items. A failure never stops the run. */
export async function runBatch(
  euis: string[],
  send: (eui: string) => Promise<SendResult>,
  opts: BatchOptions
): Promise<SendResult[]> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const results: SendResult[] = [];

  for (let i = 0; i < euis.length; i++) {
    if (opts.shouldStop?.()) break;
    const eui = euis[i];
    opts.onProgress?.(i, euis.length, eui);
    try {
      results.push(await send(eui));
    } catch (err) {
      results.push({
        eui,
        command: 'unknown',
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        sent_at: new Date().toISOString(),
      });
    }
    if (i < euis.length - 1 && opts.delayMs > 0 && !opts.shouldStop?.()) {
      await sleep(opts.delayMs);
    }
  }

  return results;
}

// ============================================================================
// Attributes
// ============================================================================

/** Flatten a gateway list entry's `attributes: [{name, value}]` into `{name: value}`. */
export function attributesToMap(attributes: unknown): Record<string, string> {
  const map: Record<string, string> = {};
  if (!Array.isArray(attributes)) return map;
  for (const attr of attributes) {
    if (attr && typeof attr === 'object' && typeof (attr as { name?: unknown }).name === 'string') {
      const { name, value } = attr as { name: string; value?: unknown };
      map[name] = value === null || value === undefined ? '' : String(value);
    }
  }
  return map;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test src/lib/gateway-commands.test.ts`
Expected: PASS, all tests.

- [ ] **Step 7: Typecheck**

Run: `bun run typecheck`
Expected: no errors beyond the Step 1 baseline.

- [ ] **Step 8: Commit**

```bash
git add src/lib/api.ts src/lib/gateway-commands.ts src/lib/gateway-commands.test.ts
git commit -m "feat: add gateway-commands library and status-carrying ApiError"
```

---

### Task 2: ID list reader, used by `bulk deactivate`

**Files:**
- Modify: `src/lib/csv-parser.ts`
- Create: `src/lib/eui-list.ts`
- Test: `src/lib/eui-list.test.ts`
- Modify: `src/commands/bulk.ts` (the `deactivate` action)

**Interfaces:**
- Produces:
  - `parseCSVContent(content: string, forcedDelimiter?: string): ParsedCSV` in `csv-parser.ts` (`parseCSV(filePath, d)` becomes `parseCSVContent(readFileSync(filePath,'utf-8'), d)`)
  - `ID_COLUMN_CANDIDATES: string[]`
  - `interface IdList { ids: string[]; column: string; duplicates: number }`
  - `interface IdListOptions { column?: string; delimiter?: string }`
  - `parseIdList(content: string, opts?: IdListOptions): IdList` (throws)
  - `readIdList(file: string, opts?: IdListOptions): IdList` (throws)

- [ ] **Step 1: Write the failing tests**

Create `src/lib/eui-list.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseIdList, readIdList } from './eui-list.js';

describe('parseIdList — plain text', () => {
  test('keeps the first line (it is an ID, not a header)', () => {
    const r = parseIdList('eui-647fdafffe02d34f\neui-00800000d000f6e6\n');
    expect(r.ids).toEqual(['eui-647fdafffe02d34f', 'eui-00800000d000f6e6']);
    expect(r.column).toBe('hardware_id');
  });
  test('handles CRLF, blank lines and surrounding spaces', () => {
    expect(parseIdList('  a1 \r\n\r\nb2\r\n').ids).toEqual(['a1', 'b2']);
  });
});

describe('parseIdList — CSV', () => {
  test('auto-detects hardware_id', () => {
    const r = parseIdList('hardware_id,name\n24e124600e458870,Lobby\na84041ec4185c14c,Office\n');
    expect(r).toEqual({ ids: ['24e124600e458870', 'a84041ec4185c14c'], column: 'hardware_id', duplicates: 0 });
  });
  test('auto-detects a candidate column case-insensitively', () => {
    const r = parseIdList('site,DevEUI\nA,24e124600e458870\n');
    expect(r.column).toBe('DevEUI');
    expect(r.ids).toEqual(['24e124600e458870']);
  });
  test('recognises a single-column file whose header is a candidate', () => {
    expect(parseIdList('eui\neui-647fdafffe02d34f\n').ids).toEqual(['eui-647fdafffe02d34f']);
  });
  test('uses --column when given', () => {
    expect(parseIdList('gw,other\nx1,y1\n', { column: 'gw' }).ids).toEqual(['x1']);
  });
  test('reports a missing --column with the available ones', () => {
    expect(() => parseIdList('a,b\n1,2\n', { column: 'eui' })).toThrow(/Column "eui" not found. Available columns: a, b/);
  });
  test('refuses to guess when no column matches', () => {
    expect(() => parseIdList('a,b\n1,2\n')).toThrow(/Could not auto-detect/);
  });
  test('strips a UTF-8 BOM from the header', () => {
    expect(parseIdList('﻿hardware_id\nabc\n').ids).toEqual(['abc']);
  });
  test('reads the eui column of a bulk results CSV (re-run input)', () => {
    const csv = 'eui,command,status_code,ok,error,sent_at\neui-647fdafffe02d34f,reboot,404,false,Resource not found.,2026-09-25T00:00:00.000Z\n';
    expect(parseIdList(csv).ids).toEqual(['eui-647fdafffe02d34f']);
  });
});

describe('parseIdList — comments, duplicates, empties', () => {
  test('skips # comment lines', () => {
    expect(parseIdList('# note\nhardware_id\n# another\nabc\n').ids).toEqual(['abc']);
  });
  test('dedupes case-insensitively, first occurrence wins', () => {
    const r = parseIdList('ABC\nabc\ndef\nabc\n');
    expect(r.ids).toEqual(['ABC', 'def']);
    expect(r.duplicates).toBe(2);
  });
  test('throws on an empty or comment-only file', () => {
    expect(() => parseIdList('')).toThrow(/No hardware IDs found/);
    expect(() => parseIdList('# only a comment\n')).toThrow(/No hardware IDs found/);
  });
  test('throws on a header with no rows', () => {
    expect(() => parseIdList('hardware_id\n')).toThrow(/No hardware IDs found in column "hardware_id"/);
  });
});

describe('readIdList', () => {
  test('reads a file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eui-list-'));
    const file = join(dir, 'euis.txt');
    writeFileSync(file, 'eui-647fdafffe02d34f\n');
    expect(readIdList(file).ids).toEqual(['eui-647fdafffe02d34f']);
  });
  test('reports a missing file', () => {
    expect(() => readIdList('/nonexistent/euis.txt')).toThrow(/File not found: \/nonexistent\/euis.txt/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/lib/eui-list.test.ts`
Expected: FAIL — `Cannot find module './eui-list.js'`.

- [ ] **Step 3: Export `parseCSVContent` from `src/lib/csv-parser.ts`**

Replace the `parseCSV` function with:

```ts
/**
 * Parse CSV text and return structured data
 */
export function parseCSVContent(content: string, forcedDelimiter?: string): ParsedCSV {
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== '');

  if (lines.length === 0) {
    throw new Error('CSV file is empty');
  }

  const delimiter = forcedDelimiter || detectDelimiter(lines[0]);
  const headers = parseCSVLine(lines[0], delimiter);

  if (headers.length === 0) {
    throw new Error('No columns found in CSV header');
  }

  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i], delimiter);
    const row: Record<string, string> = {};

    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || '';
    }

    rows.push(row);
  }

  return { headers, rows, delimiter };
}

/**
 * Parse a CSV file and return structured data
 */
export function parseCSV(filePath: string, forcedDelimiter?: string): ParsedCSV {
  return parseCSVContent(readFileSync(filePath, 'utf-8'), forcedDelimiter);
}
```

- [ ] **Step 4: Create `src/lib/eui-list.ts`**

```ts
import { existsSync, readFileSync } from 'fs';
import { parseCSVContent } from './csv-parser.js';

/** Header names recognised as the ID column (compared case-insensitively). */
export const ID_COLUMN_CANDIDATES = ['hardware_id', 'eui', 'deveui', 'dev_eui', 'device_eui', 'hwid'];

const DELIMITERS = [',', ';', '\t', '|'];

export interface IdList {
  ids: string[];
  column: string;
  duplicates: number;
}

export interface IdListOptions {
  column?: string;
  delimiter?: string;
}

/**
 * Read hardware IDs from CSV or plain text (one ID per line).
 * `#` lines and blank lines are ignored. The input is treated as CSV only when
 * --column/--delimiter is given, the first line contains a delimiter, or the first
 * line is itself a known ID header — so a plain list never loses its first ID.
 */
export function parseIdList(content: string, opts: IdListOptions = {}): IdList {
  const lines = content
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));

  if (lines.length === 0) {
    throw new Error('No hardware IDs found (file is empty)');
  }

  const first = lines[0];
  const tabular =
    opts.column !== undefined ||
    opts.delimiter !== undefined ||
    DELIMITERS.some((d) => first.includes(d)) ||
    ID_COLUMN_CANDIDATES.includes(first.toLowerCase());

  let column: string;
  let values: string[];

  if (!tabular) {
    column = 'hardware_id';
    values = lines;
  } else {
    const { headers, rows } = parseCSVContent(lines.join('\n'), opts.delimiter);
    if (opts.column !== undefined) {
      if (!headers.includes(opts.column)) {
        throw new Error(`Column "${opts.column}" not found. Available columns: ${headers.join(', ')}`);
      }
      column = opts.column;
    } else {
      const match = headers.find((h) => ID_COLUMN_CANDIDATES.includes(h.toLowerCase()));
      if (!match) {
        throw new Error(
          `Could not auto-detect the ID column. Available columns: ${headers.join(', ')}\n` +
          'Use --column <name> to choose one.'
        );
      }
      column = match;
    }
    values = rows.map((row) => row[column] ?? '');
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  for (const raw of values) {
    const value = raw.trim();
    if (value === '') continue;
    const key = value.toLowerCase();
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    ids.push(value);
  }

  if (ids.length === 0) {
    throw new Error(`No hardware IDs found in column "${column}"`);
  }

  return { ids, column, duplicates };
}

export function readIdList(file: string, opts: IdListOptions = {}): IdList {
  if (!existsSync(file)) {
    throw new Error(`File not found: ${file}`);
  }
  return parseIdList(readFileSync(file, 'utf-8'), opts);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test src/lib/eui-list.test.ts`
Expected: PASS.

- [ ] **Step 6: Switch `bulk deactivate` to `readIdList`**

In `src/commands/bulk.ts`, add the import next to the other `../lib/` imports:

```ts
import { readIdList } from '../lib/eui-list.js';
```

In the `deactivate` action, replace everything from the line `// Validate CSV file exists` down to and including the closing `}` of the `if (euis.length === 0) { … }` block with:

```ts
      let euis: string[];
      let euiColumn: string;
      try {
        const list = readIdList(csvFile, { column: options.column, delimiter: options.delimiter });
        euis = list.ids;
        euiColumn = list.column;
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to read file');
        process.exit(1);
      }
```

The next line should be the existing `console.log(chalk.cyan(\`\nFound ${euis.length} hardware IDs in column "${euiColumn}"\`));`, which stays unchanged, as does everything after it.

- [ ] **Step 7: Check deactivate still parses, without sending**

```bash
printf 'eui-0000000000000001\neui-0000000000000002\n' > /tmp/gfc-deactivate.txt
bun run src/index.ts bulk deactivate /tmp/gfc-deactivate.txt --dry-run
```
Expected: `Found 2 hardware IDs in column "hardware_id"` listing **both** EUIs (on `main` the first line was lost as a header), then `Dry Run Complete`, `Deactivated: 2`. No API request is made in dry-run.

- [ ] **Step 8: Run all tests and typecheck**

Run: `bun test && bun run typecheck`
Expected: PASS; no new type errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/csv-parser.ts src/lib/eui-list.ts src/lib/eui-list.test.ts src/commands/bulk.ts
git commit -m "refactor: shared ID list reader; bulk deactivate no longer drops the first EUI of a text file"
```

---

### Task 3: Results file writer

**Files:**
- Create: `src/lib/results-file.ts`
- Test: `src/lib/results-file.test.ts`

**Interfaces:**
- Consumes: `parseIdList` (Task 2) in a test; `RESULT_COLUMNS` (Task 1).
- Produces:
  - `type ResultRow = Record<string, unknown>`
  - `assertResultsPath(path: string): void` (throws unless `.csv`/`.json`)
  - `toCsv(rows: ResultRow[], columns: string[]): string`
  - `writeResults(path: string, rows: ResultRow[], columns: string[], meta?: Record<string, unknown>): void`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/results-file.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { assertResultsPath, toCsv, writeResults } from './results-file.js';
import { parseIdList } from './eui-list.js';
import { RESULT_COLUMNS } from './gateway-commands.js';

describe('assertResultsPath', () => {
  test('accepts .csv and .json in any case', () => {
    expect(() => assertResultsPath('out.csv')).not.toThrow();
    expect(() => assertResultsPath('dir/out.JSON')).not.toThrow();
  });
  test('rejects other extensions before any work is done', () => {
    expect(() => assertResultsPath('results.txt')).toThrow(/--output must end in .csv or .json/);
    expect(() => assertResultsPath('results')).toThrow(/--output must end in .csv or .json/);
  });
});

describe('toCsv', () => {
  test('writes the header and rows in column order', () => {
    expect(toCsv([{ b: 2, a: 1 }], ['a', 'b'])).toBe('a,b\n1,2\n');
  });
  test('writes empty cells for missing values', () => {
    expect(toCsv([{ a: undefined, b: null }], ['a', 'b'])).toBe('a,b\n,\n');
  });
  test('quotes commas, quotes and newlines', () => {
    expect(toCsv([{ a: 'x,y', b: 'say "hi"', c: 'l1\nl2' }], ['a', 'b', 'c'])).toBe('a,b,c\n"x,y","say ""hi""","l1\nl2"\n');
  });
  test('writes booleans and numbers as text', () => {
    expect(toCsv([{ ok: false, status_code: 404 }], ['ok', 'status_code'])).toBe('ok,status_code\nfalse,404\n');
  });
  test('a results CSV is a valid re-run input', () => {
    const csv = toCsv(
      [{ eui: 'eui-647fdafffe02d34f', command: 'reboot', status_code: 404, ok: false, error: 'Resource not found.', sent_at: 't' }],
      RESULT_COLUMNS
    );
    expect(parseIdList(csv).ids).toEqual(['eui-647fdafffe02d34f']);
  });
});

describe('writeResults', () => {
  const dir = mkdtempSync(join(tmpdir(), 'results-file-'));

  test('writes CSV by extension', () => {
    const file = join(dir, 'r.csv');
    writeResults(file, [{ a: 1 }], ['a']);
    expect(readFileSync(file, 'utf-8')).toBe('a\n1\n');
  });
  test('writes JSON with meta, generated_at and results', () => {
    const file = join(dir, 'r.json');
    writeResults(file, [{ a: 1 }], ['a'], { clientId: 'iotinabox' });
    const parsed = JSON.parse(readFileSync(file, 'utf-8'));
    expect(parsed.clientId).toBe('iotinabox');
    expect(typeof parsed.generated_at).toBe('string');
    expect(parsed.results).toEqual([{ a: 1 }]);
  });
  test('refuses an unsupported extension', () => {
    expect(() => writeResults(join(dir, 'r.txt'), [], ['a'])).toThrow(/--output must end/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/lib/results-file.test.ts`
Expected: FAIL — `Cannot find module './results-file.js'`.

- [ ] **Step 3: Create `src/lib/results-file.ts`**

```ts
import { writeFileSync } from 'fs';
import { extname } from 'path';

export type ResultRow = Record<string, unknown>;

/** Validate an --output path up front, so a typo is caught before anything is sent. */
export function assertResultsPath(path: string): void {
  const ext = extname(path).toLowerCase();
  if (ext !== '.csv' && ext !== '.json') {
    throw new Error(`--output must end in .csv or .json (got "${path}")`);
  }
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: ResultRow[], columns: string[]): string {
  const lines = [columns.join(','), ...rows.map((row) => columns.map((c) => csvCell(row[c])).join(','))];
  return lines.join('\n') + '\n';
}

export function writeResults(
  path: string,
  rows: ResultRow[],
  columns: string[],
  meta: Record<string, unknown> = {}
): void {
  assertResultsPath(path);
  const content =
    extname(path).toLowerCase() === '.csv'
      ? toCsv(rows, columns)
      : JSON.stringify({ ...meta, generated_at: new Date().toISOString(), results: rows }, null, 2) + '\n';
  writeFileSync(path, content);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/lib/results-file.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/results-file.ts src/lib/results-file.test.ts
git commit -m "feat: add CSV/JSON results writer with up-front --output validation"
```

---

### Task 4: Single-gateway commands use the shared sender; `update-software --url/--checksum/--yes`

**Files:**
- Modify: `src/commands/gateways.ts` (imports, `normalizeHardwareId`, `reboot`, `update-software`, `migrate-provider`)

**Interfaces:**
- Consumes: `normalizeEui`, `validateUpdate`, `parseProvider`, `sendGatewayCommand`, `type GatewayCommand`, `type Provider` (Task 1).
- Produces: `euiOrExit(id: string): string` (file-local helper, also used by Task 5).

- [ ] **Step 1: Imports and the EUI helper**

At the top of `src/commands/gateways.ts` add:

```ts
import {
  normalizeEui,
  parseProvider,
  sendGatewayCommand,
  validateUpdate,
  type GatewayCommand,
  type Provider,
} from '../lib/gateway-commands.js';
```

Replace the `normalizeHardwareId` function with:

```ts
function euiOrExit(id: string): string {
  try {
    return normalizeEui(id);
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
```

Replace every call `normalizeHardwareId(` in the file with `euiOrExit(` (get, pings, stats, reboot, update-software, migrate-provider).

- [ ] **Step 2: `reboot` sends through `sendGatewayCommand`**

In the `reboot` action, replace the block from `const spinner = ora(\`Sending reboot command…` through the `if (options.json) { … } else { … }` with:

```ts
        const spinner = ora(`Sending reboot command to ${hardwareId}...`).start();
        const result = await sendGatewayCommand(hardwareId, { kind: 'reboot' });
        spinner.stop();

        if (!result.ok) {
          error(result.error ?? 'Failed to send reboot command');
          process.exit(1);
        }

        if (options.json) {
          output(result.body, { json: true });
        } else {
          success(`Reboot command sent to gateway ${hardwareId}`);
        }
```

- [ ] **Step 3: Replace the whole `update-software` command**

Replace the entire `gateways.command('update-software')…` chain (from `gateways` / `.command('update-software')` to its closing `});`) with:

```ts
  gateways
    .command('update-software')
    .description('Update software on a gateway')
    .argument('<hardware-id>', 'Gateway hardware ID (e.g., eui-647fdafffe01433c)')
    .option('--url <url>', 'https URL of the package to install (skips the manifest picker)')
    .option('--checksum <md5>', 'MD5 checksum of the package (required with --url)')
    .option('-y, --yes', 'Skip confirmation prompt')
    .option('--json', 'Output as JSON')
    .action(async (hardwareId: string, options: GlobalOptions & { url?: string; checksum?: string; yes?: boolean }) => {
      hardwareId = euiOrExit(hardwareId);

      if (options.checksum && !options.url) {
        error('--checksum requires --url');
        process.exit(1);
      }
      if (options.url && !options.checksum) {
        error('--url requires --checksum');
        process.exit(1);
      }

      try {
        let cmd: GatewayCommand;
        let summary: string;

        if (options.url && options.checksum) {
          validateUpdate(options.url, options.checksum);
          cmd = { kind: 'update', url: options.url, checksum: options.checksum };
          summary = `${options.url} (md5 ${options.checksum})`;
        } else {
          const spinner = ora('Fetching available updates...').start();
          const res = await fetch('https://docs.mydevices.com/artifacts/latest.json');
          if (!res.ok) {
            spinner.stop();
            error(`Failed to fetch update manifest: ${res.statusText}`);
            process.exit(1);
          }
          const manifest: ArtifactManifest = await res.json() as ArtifactManifest;
          spinner.stop();

          const choices: { name: string; value: { gateway: string; software: string; artifact: SoftwareArtifact } }[] = [];
          for (const [gateway, packages] of Object.entries(manifest)) {
            for (const [software, artifact] of Object.entries(packages)) {
              choices.push({
                name: `${gateway} - ${software} ${artifact.version}`,
                value: { gateway, software, artifact },
              });
            }
          }

          const selected = await select({
            message: 'Select software to install:',
            choices,
          });
          cmd = { kind: 'update', url: selected.artifact.url, checksum: selected.artifact.checksum };
          summary = `${selected.software} ${selected.artifact.version} (${selected.gateway})`;
        }

        if (!options.yes) {
          const confirmed = await confirm({
            message: `Update ${hardwareId} with ${summary}?`,
            default: false,
          });
          if (!confirmed) {
            console.log('Update cancelled.');
            return;
          }
        }

        const updateSpinner = ora(`Sending update command to ${hardwareId}...`).start();
        const result = await sendGatewayCommand(hardwareId, cmd);
        updateSpinner.stop();

        if (!result.ok) {
          error(result.error ?? 'Failed to send update command');
          process.exit(1);
        }

        if (options.json) {
          output(result.body, { json: true });
        } else {
          success(`Update command sent to gateway ${hardwareId}`);
          detail('Package', summary);
        }
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to send update command');
        process.exit(1);
      }
    });
```

- [ ] **Step 4: `migrate-provider` validates with `parseProvider` and sends through `sendGatewayCommand`**

In the `migrate-provider` action:

Replace

```ts
      let provider = options.provider;
      if (!provider) {
```
with
```ts
      let providerInput = options.provider;
      if (!providerInput) {
```
and the assignment inside that block `provider = (await select({` with `providerInput = (await select({`.

Replace the block

```ts
      if (provider !== 'azure' && provider !== 'mydevices') {
        error(`Invalid provider "${provider}". Must be "azure" or "mydevices".`);
        process.exit(1);
      }
```
with
```ts
      let provider: Provider;
      try {
        provider = parseProvider(providerInput);
      } catch (err) {
        error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
```

Replace the send block (from `const spinner = ora(\`Migrating…` through the `if (options.json) { … } else { … }`) with:

```ts
        const spinner = ora(`Migrating ${hardwareId} to provider "${provider}"...`).start();
        const result = await sendGatewayCommand(hardwareId, { kind: 'migrate-provider', provider });
        spinner.stop();

        if (!result.ok) {
          error(result.error ?? 'Failed to migrate gateway provider');
          process.exit(1);
        }

        if (options.json) {
          output(result.body, { json: true });
        } else {
          success(`Gateway ${hardwareId} migrated to provider "${provider}"`);
        }
```

If `apiPost` is no longer used in `gateways.ts`, remove it from the `../lib/api.js` import (keep `apiGet`).

- [ ] **Step 5: Typecheck and run tests**

Run: `bun run typecheck && bun test`
Expected: no new type errors; tests PASS.

- [ ] **Step 6: Check validation paths without sending**

Each of these exits 1 before any request:

```bash
bun run src/index.ts gateways reboot not-an-eui --yes
# ✗ Error: Invalid gateway EUI "not-an-eui": expected 16 hex digits, optionally prefixed with eui-
bun run src/index.ts gateways update-software eui-0000000000000001 --checksum 2a3f7fe7ff4b34cf6870e47ae709937f
# ✗ Error: --checksum requires --url
bun run src/index.ts gateways update-software eui-0000000000000001 --url https://example.com/a.ipk
# ✗ Error: --url requires --checksum
bun run src/index.ts gateways update-software eui-0000000000000001 --url http://example.com/a.ipk --checksum 2a3f7fe7ff4b34cf6870e47ae709937f --yes
# ✗ Error: Invalid --url "http://example.com/a.ipk": must be https
bun run src/index.ts gateways migrate-provider eui-0000000000000001 --provider emqx --yes
# ✗ Error: Invalid provider "emqx". Must be "azure" or "mydevices".
bun run src/index.ts gateways update-software --help
# shows --url, --checksum, -y/--yes
```

- [ ] **Step 7: Commit**

```bash
git add src/commands/gateways.ts
git commit -m "feat: update-software --url/--checksum/--yes; single gateway commands use the shared sender"
```

---

### Task 5: Backend fields on `gateways list` and `gateways get`

**Files:**
- Modify: `src/commands/gateways.ts` (`list` table, `get` action)

**Interfaces:**
- Consumes: `attributesToMap` (Task 1); `euiOrExit` (Task 4); existing `GatewayListEntry`, `GatewayResponse`, `getGatewaysPath`.

- [ ] **Step 1: Imports**

Add `attributesToMap` to the `../lib/gateway-commands.js` import, and add:

```ts
import chalk from 'chalk';
```

- [ ] **Step 2: `gateways list` columns**

In the `list` action, replace the `output(gatewayList, { … })` call with:

```ts
        output(gatewayList, {
          json: options.json,
          tableHeaders: ['Hardware ID', 'Status', 'Device Type', 'Network', 'Config Backend', 'Actual Backend', 'Created'],
          tableMapper: (g: GatewayListEntry) => {
            const attrs = attributesToMap(g.attributes);
            return [
              g.hardware_id,
              formatStatus(g.status),
              g.device_type?.name || '-',
              g.network || '-',
              attrs.config_backend || '-',
              attrs.actual_backend || '-',
              g.created_at ? new Date(g.created_at).toLocaleDateString() : '-',
            ];
          },
          footer: `Total: ${response.count || gatewayList.length} gateways`,
        });
```

- [ ] **Step 3: `gateways get` backend lookup**

In the `get` action, replace

```ts
        const response = await apiGet<GatewayResponse>(`${getGatewaysPath()}/${hardwareId}`);
        spinner.stop();

        const gateway = response.gateway;

        if (options.json) {
          output(response, { json: true });
        } else {
```
with
```ts
        const response = await apiGet<GatewayResponse>(`${getGatewaysPath()}/${hardwareId}`);

        // Backends live in the list entry's attributes; the single-gateway endpoint omits them.
        let attributes: Record<string, string> | null = null;
        let backendLookupFailed = false;
        try {
          const lookup = await apiGet<ApiResponse<GatewayListEntry>>(getGatewaysPath(), {
            filter: `hardware_id eq ${hardwareId}`,
            limit: 5,
          });
          const row = (lookup.rows || []).find((g) => g.hardware_id === hardwareId);
          attributes = row ? attributesToMap(row.attributes) : null;
        } catch {
          backendLookupFailed = true;
        }
        spinner.stop();

        const gateway = response.gateway;

        if (options.json) {
          output({ ...response, attributes }, { json: true });
        } else {
```

Then, at the end of the non-JSON branch (after the `if (gateway.metadata) { … }` block, still inside `else`), add:

```ts
          console.log('');
          header('Backend');
          if (attributes) {
            detail('Config Backend', attributes.config_backend);
            detail('Actual Backend', attributes.actual_backend);
            detail('Config Endpoint', attributes.config_endpoint);
          } else if (backendLookupFailed) {
            console.log(chalk.gray('  backend lookup failed'));
          } else {
            console.log(chalk.gray(`  not visible to ${getConfig('clientId')}`));
          }
```

- [ ] **Step 4: Typecheck and run tests**

Run: `bun run typecheck && bun test`
Expected: no new type errors; tests PASS.

- [ ] **Step 5: Live read-only check**

```bash
bun run src/index.ts gateways list --limit 3
# table has Config Backend / Actual Backend columns with values (e.g. mqtt / azure)
bun run src/index.ts gateways get eui-00800000d000f6e6
# Backend section: Config Backend mqtt, Actual Backend azure (as of 2026-09-25), Config Endpoint ssl://prod-mb-us-east.lns.mydevices.com:8883
bun run src/index.ts gateways get eui-647fdafffe02d34f
# as dsi: Backend section reads "not visible to dsi"; the rest prints as before
bun run src/index.ts gateways get eui-00800000d000f6e6 --json | grep -A3 '"attributes"'
# top-level "attributes": { … "config_backend": "mqtt" … }
```
If the session is not `dsi`, use any gateway from `gateways list` for the visible case.

- [ ] **Step 6: Commit**

```bash
git add src/commands/gateways.ts
git commit -m "feat: show config/actual backend on gateways list and get"
```

---

### Task 6: `bulk gateways reboot|update|migrate-provider`

**Files:**
- Create: `src/commands/bulk-gateways.ts`
- Modify: `src/commands/bulk.ts` (mount the group)

**Interfaces:**
- Consumes: `readIdList` (Task 2); `assertResultsPath`, `writeResults` (Task 3); `buildRequest`, `commandLabel`, `normalizeEuiList`, `parseProvider`, `runBatch`, `sendGatewayCommand`, `validateUpdate`, `RESULT_COLUMNS`, `type GatewayCommand`, `type Provider`, `type SendResult` (Task 1).
- Produces: `createBulkGatewaysCommand(): Command`.

- [ ] **Step 1: Create `src/commands/bulk-gateways.ts`**

```ts
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { getConfig } from '../lib/config.js';
import { error, success, warn } from '../lib/output.js';
import { readIdList } from '../lib/eui-list.js';
import { assertResultsPath, writeResults } from '../lib/results-file.js';
import {
  RESULT_COLUMNS,
  buildRequest,
  commandLabel,
  normalizeEuiList,
  parseProvider,
  runBatch,
  sendGatewayCommand,
  validateUpdate,
  type GatewayCommand,
  type Provider,
  type SendResult,
} from '../lib/gateway-commands.js';

interface BulkGatewayOptions {
  column?: string;
  delimiter?: string;
  dryRun?: boolean;
  limit?: string;
  delay: string;
  yes?: boolean;
  json?: boolean;
  output?: string;
}

function fail(message: string): never {
  error(message);
  process.exit(1);
}

function parseNonNegativeInt(value: string, flag: string): number {
  if (!/^\d+$/.test(value)) fail(`${flag} must be a non-negative integer (got "${value}")`);
  return parseInt(value, 10);
}

function withCommonOptions(cmd: Command): Command {
  return cmd
    .argument('<file>', 'CSV or text file of gateway EUIs')
    .option('--column <name>', 'CSV column containing gateway EUIs (auto-detected if not specified)')
    .option('--delimiter <char>', 'Force CSV delimiter (auto-detect by default)')
    .option('--dry-run', 'Show what would be sent without sending anything')
    .option('--limit <n>', 'Send to at most the first n gateways')
    .option('--delay <ms>', 'Milliseconds to wait between gateways', '500')
    .option('-y, --yes', 'Skip the confirmation prompt')
    .option('--json', 'Output results as JSON')
    .option('--output <file>', 'Save per-gateway results (.csv or .json)');
}

function withoutBody(result: SendResult): Omit<SendResult, 'body'> {
  const { body: _body, ...rest } = result;
  return rest;
}

async function runBulk(file: string, cmd: GatewayCommand, options: BulkGatewayOptions): Promise<void> {
  // Everything that can be wrong with the invocation is checked before the first request.
  const clientId = getConfig('clientId');
  if (!clientId) fail('No clientId configured. Run "mydevices auth login" first.');
  if (options.output) {
    try {
      assertResultsPath(options.output);
    } catch (err) {
      fail((err as Error).message);
    }
  }
  const delayMs = parseNonNegativeInt(options.delay, '--delay');
  const limit = options.limit !== undefined ? parseNonNegativeInt(options.limit, '--limit') : undefined;
  if (limit === 0) fail('--limit must be at least 1');

  let ids: string[];
  let readerDuplicates: number;
  try {
    const list = readIdList(file, { column: options.column, delimiter: options.delimiter });
    ids = list.ids;
    readerDuplicates = list.duplicates;
  } catch (err) {
    fail((err as Error).message);
  }

  const { euis: all, invalid, duplicates } = normalizeEuiList(ids);
  if (invalid.length > 0) {
    error(`${invalid.length} invalid gateway EUI(s) in ${file}; nothing was sent:`);
    for (const value of invalid.slice(0, 20)) console.error(`  ${value}`);
    if (invalid.length > 20) console.error(`  ... and ${invalid.length - 20} more`);
    process.exit(1);
  }

  const euis = limit !== undefined ? all.slice(0, limit) : all;
  const label = commandLabel(cmd);
  const { body } = buildRequest(clientId, euis[0], cmd);

  console.log(chalk.cyan(
    `\n${label} → ${euis.length}${euis.length < all.length ? ` of ${all.length}` : ''} gateways as clientId "${clientId}"`
  ));
  const removed = readerDuplicates + duplicates;
  if (removed > 0) console.log(chalk.gray(`  ${removed} duplicate EUI(s) removed`));
  console.log(chalk.gray(`  Body: ${JSON.stringify(body)}`));
  for (const eui of euis.slice(0, 5)) console.log(chalk.gray(`  ${eui}`));
  if (euis.length > 5) console.log(chalk.gray(`  ... and ${euis.length - 5} more`));

  if (options.dryRun) {
    console.log(chalk.yellow('\nDry run: nothing sent.'));
    return;
  }

  if (!options.yes) {
    if (!process.stdin.isTTY) fail('Refusing to send without confirmation: stdin is not a terminal. Pass --yes.');
    const { confirm } = await import('@inquirer/prompts');
    const proceed = await confirm({
      message: `Send ${label} to ${euis.length} gateways as "${clientId}"?`,
      default: false,
    });
    if (!proceed) {
      console.log(chalk.yellow('Cancelled'));
      return;
    }
  }

  // Ctrl-C finishes the in-flight request, then stops and still reports/writes what was sent.
  // A second Ctrl-C kills the process (the handler is registered once).
  let interrupted = false;
  const onSigint = () => {
    interrupted = true;
    warn('Interrupted: finishing the in-flight request, then stopping.');
  };
  process.once('SIGINT', onSigint);

  const spinner = ora(`Sending ${label}...`).start();
  const results = await runBatch(euis, (eui) => sendGatewayCommand(eui, cmd), {
    delayMs,
    shouldStop: () => interrupted,
    onProgress: (index, total, eui) => {
      spinner.text = `Sending ${label} ${index + 1}/${total} (${eui})`;
    },
  });
  spinner.stop();
  process.removeListener('SIGINT', onSigint);

  const rows = results.map(withoutBody);
  const sent = results.filter((r) => r.ok).length;
  const failed = results.length - sent;
  const notSent = euis.length - results.length;

  if (options.json) {
    console.log(JSON.stringify({ clientId, command: label, request_body: body, sent, failed, not_sent: notSent, results: rows }, null, 2));
  } else {
    console.log();
    console.log(chalk.cyan(interrupted ? 'Stopped' : 'Complete'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`Sent:     ${chalk.green(String(sent))}`);
    console.log(`Failed:   ${chalk.red(String(failed))}`);
    if (notSent > 0) console.log(`Not sent: ${chalk.yellow(String(notSent))}`);
    const failures = results.filter((r) => !r.ok);
    if (failures.length > 0) {
      console.log();
      console.log(chalk.red('Failed gateways:'));
      for (const f of failures) {
        console.log(`  ${f.eui}  ${f.status_code ?? '-'}  ${f.error ?? ''}`);
      }
    }
    console.log(chalk.gray('─'.repeat(40)));
  }

  if (options.output) {
    writeResults(options.output, rows, RESULT_COLUMNS, { clientId, command: label, request_body: body, file });
    success(`Results saved to ${options.output}`);
  }

  if (interrupted) process.exit(130);
  if (failed > 0) process.exit(1);
}

export function createBulkGatewaysCommand(): Command {
  const gateways = new Command('gateways').description('Send a command to every gateway in a file');

  withCommonOptions(gateways.command('reboot').description('Reboot every gateway in the file'))
    .action((file: string, options: BulkGatewayOptions) => runBulk(file, { kind: 'reboot' }, options));

  withCommonOptions(gateways.command('update').description('Install a software package on every gateway in the file'))
    .requiredOption('--url <url>', 'https URL of the package (.ipk)')
    .requiredOption('--checksum <md5>', 'MD5 checksum of the package')
    .action((file: string, options: BulkGatewayOptions & { url: string; checksum: string }) => {
      try {
        validateUpdate(options.url, options.checksum);
      } catch (err) {
        fail((err as Error).message);
      }
      return runBulk(file, { kind: 'update', url: options.url, checksum: options.checksum }, options);
    });

  withCommonOptions(gateways.command('migrate-provider').description('Migrate every gateway in the file to a provider'))
    .requiredOption('-p, --provider <provider>', 'Target provider (azure or mydevices)')
    .action((file: string, options: BulkGatewayOptions & { provider: string }) => {
      let provider: Provider;
      try {
        provider = parseProvider(options.provider);
      } catch (err) {
        fail((err as Error).message);
      }
      return runBulk(file, { kind: 'migrate-provider', provider }, options);
    });

  return gateways;
}
```

- [ ] **Step 2: Mount it under `bulk`**

In `src/commands/bulk.ts` add:

```ts
import { createBulkGatewaysCommand } from './bulk-gateways.js';
```

and immediately before the final `return bulk;` of `createBulkCommands`:

```ts
  bulk.addCommand(createBulkGatewaysCommand());
```

- [ ] **Step 3: Typecheck and run tests**

Run: `bun run typecheck && bun test`
Expected: no new type errors; tests PASS.

- [ ] **Step 4: Dry-run and validation checks (no requests)**

```bash
printf '# test list\neui-647fdafffe02d34f\n647FDAFFFE02D34F\neui-00800000d000f6e6\n' > /tmp/gfc-gws.txt
bun run src/index.ts bulk gateways reboot /tmp/gfc-gws.txt --dry-run
# reboot → 2 gateways as clientId "<yours>"; "1 duplicate EUI(s) removed"; Body: {"command":"reboot"}; "Dry run: nothing sent."
bun run src/index.ts bulk gateways update /tmp/gfc-gws.txt --url https://hwdartifacts.blob.core.windows.net/hwdassets/dps-client_1.5.0-r0_kona.ipk --checksum 2a3f7fe7ff4b34cf6870e47ae709937f --dry-run --limit 1
# update → 1 of 2 gateways; Body shows update_url / update_checksum
bun run src/index.ts bulk gateways migrate-provider /tmp/gfc-gws.txt --provider mydevices --dry-run
# Body: {"provider":"mydevices"}
bun run src/index.ts bulk gateways reboot /tmp/gfc-gws.txt --dry-run --output results.txt
# ✗ --output must end in .csv or .json — exit 1, before the preview
printf 'eui-647fdafffe02d34f\nnot-an-eui\n' > /tmp/gfc-bad.txt
bun run src/index.ts bulk gateways reboot /tmp/gfc-bad.txt --dry-run
# ✗ 1 invalid gateway EUI(s) … nothing was sent: not-an-eui — exit 1
bun run src/index.ts bulk gateways update /tmp/gfc-gws.txt --url http://x/a.ipk --checksum 2a3f7fe7ff4b34cf6870e47ae709937f --dry-run
# ✗ Invalid --url … must be https
bun run src/index.ts bulk gateways reboot /tmp/gfc-gws.txt --delay fast --dry-run
# ✗ --delay must be a non-negative integer
```
Check `echo $?` after each failure case: `1`.

- [ ] **Step 5: Non-interactive refusal check (uses non-existent EUIs)**

This is the only check that could reach the API if the guard were broken, so it uses EUIs that belong to no gateway:

```bash
printf 'eui-00000000000000f1\neui-00000000000000f2\n' > /tmp/gfc-fake.txt
echo | bun run src/index.ts bulk gateways reboot /tmp/gfc-fake.txt; echo "exit=$?"
# ✗ Refusing to send without confirmation: stdin is not a terminal. Pass --yes.   exit=1
```
If it prints anything other than the refusal, stop and fix before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/commands/bulk-gateways.ts src/commands/bulk.ts
git commit -m "feat: add bulk gateways reboot/update/migrate-provider"
```

---

### Task 7: Registry lookup library and the `registry get` fix

**Files:**
- Create: `src/lib/registry-lookup.ts`
- Test: `src/lib/registry-lookup.test.ts`
- Modify: `src/commands/registry.ts` (types, `getRegistryPath`, `get` action)

**Interfaces:**
- Consumes: `apiGet` (`api.ts`), `getConfig`, `ApiResponse` type; `parseIdList` (Task 2) in a test.
- Produces:
  - `interface RegistryDeviceType`, `interface RegistryEntry` (moved from `registry.ts`, unchanged fields)
  - `type LookupStatus = 'PAIRED' | 'PENDING' | 'DECOMMISSIONED' | 'NOT-FOUND' | 'ERROR'`, `LOOKUP_STATUSES: LookupStatus[]`
  - `interface LookupResult { hardware_id: string; status: string; device_type: string; paired_to_app_id: string; paired_at: string; network: string; error: string }`
  - `LOOKUP_COLUMNS: string[]`
  - `getRegistryPath(): string`
  - `registryFilter(id: string): string`
  - `findRegistryEntry(id: string): Promise<RegistryEntry | null>`
  - `toLookupResult(id: string, entry: RegistryEntry | null, err?: string): LookupResult`
  - `lookupMany(ids: string[], opts: { concurrency: number; lookup?: (id: string) => Promise<RegistryEntry | null>; onProgress?: (done: number, total: number) => void }): Promise<LookupResult[]>`
  - `countByStatus(results: LookupResult[]): Record<string, number>`
  - `REGISTRY_LOOKUP_TEMPLATE: string`, `DEFAULT_TEMPLATE_FILE = 'registry-lookup-template.csv'`, `writeLookupTemplate(path: string): void`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/registry-lookup.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  REGISTRY_LOOKUP_TEMPLATE,
  countByStatus,
  lookupMany,
  registryFilter,
  toLookupResult,
  writeLookupTemplate,
  type RegistryEntry,
} from './registry-lookup.js';
import { parseIdList } from './eui-list.js';

const entry = (hardware_id: string, status: RegistryEntry['status'] = 'PAIRED'): RegistryEntry => ({
  id: '9b72d8e0-39f2-11f1-8aba-f39b15bd015a',
  application_id: 'dsi',
  paired_to_app_id: 'dsi',
  hardware_id,
  network: 'iotinabox.chirpstackio',
  device_type_id: 'dt-1',
  status,
  paired_at: '2026-05-08T14:12:54.000Z',
  created_at: '2026-04-17T00:15:57.000Z',
  device_type: { id: 'dt-1', name: 'MultiTech Conduit MTCAP3 Cellular', category: 'gateway', subcategory: 'lora' },
});

describe('registryFilter', () => {
  test('uses id eq for a UUID', () => {
    expect(registryFilter('9B72D8E0-39F2-11F1-8ABA-F39B15BD015A')).toBe('id eq 9b72d8e0-39f2-11f1-8aba-f39b15bd015a');
  });
  test('uses hardware_id eq, lowercased and trimmed, otherwise', () => {
    expect(registryFilter(' 24E124600E458870 ')).toBe('hardware_id eq 24e124600e458870');
    expect(registryFilter('eui-00800000d000f6e6')).toBe('hardware_id eq eui-00800000d000f6e6');
  });
});

describe('toLookupResult', () => {
  test('flattens a found entry', () => {
    expect(toLookupResult('X', entry('eui-00800000d000f6e6'))).toEqual({
      hardware_id: 'eui-00800000d000f6e6',
      status: 'PAIRED',
      device_type: 'MultiTech Conduit MTCAP3 Cellular',
      paired_to_app_id: 'dsi',
      paired_at: '2026-05-08T14:12:54.000Z',
      network: 'iotinabox.chirpstackio',
      error: '',
    });
  });
  test('falls back to device_type_id when device_type is absent', () => {
    const e = entry('a');
    delete e.device_type;
    expect(toLookupResult('a', e).device_type).toBe('dt-1');
  });
  test('NOT-FOUND keeps the ID as given', () => {
    expect(toLookupResult('24E124600E458870', null)).toMatchObject({ hardware_id: '24E124600E458870', status: 'NOT-FOUND', error: '' });
  });
  test('ERROR carries the message', () => {
    expect(toLookupResult('a', null, 'Permission denied.')).toMatchObject({ status: 'ERROR', error: 'Permission denied.' });
  });
});

describe('lookupMany', () => {
  test('preserves input order under concurrency', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const delays: Record<string, number> = { a: 30, b: 5, c: 20, d: 1, e: 10 };
    const results = await lookupMany(ids, {
      concurrency: 3,
      lookup: async (id) => { await new Promise((r) => setTimeout(r, delays[id])); return entry(id); },
    });
    expect(results.map((r) => r.hardware_id)).toEqual(ids);
  });
  test('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let peak = 0;
    await lookupMany(Array.from({ length: 12 }, (_, i) => `id${i}`), {
      concurrency: 4,
      lookup: async (id) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return entry(id);
      },
    });
    expect(peak).toBe(4);
  });
  test('maps null to NOT-FOUND and a throw to ERROR without stopping', async () => {
    const results = await lookupMany(['found', 'missing', 'broken'], {
      concurrency: 2,
      lookup: async (id) => {
        if (id === 'broken') throw new Error('API error: 500');
        return id === 'found' ? entry(id) : null;
      },
    });
    expect(results.map((r) => r.status)).toEqual(['PAIRED', 'NOT-FOUND', 'ERROR']);
    expect(results[2].error).toBe('API error: 500');
  });
  test('reports progress up to the total', async () => {
    const seen: number[] = [];
    await lookupMany(['a', 'b'], { concurrency: 5, lookup: async (id) => entry(id), onProgress: (done) => seen.push(done) });
    expect(seen).toEqual([1, 2]);
  });
});

describe('countByStatus', () => {
  test('counts each status', () => {
    const rs = [toLookupResult('a', entry('a')), toLookupResult('b', null), toLookupResult('c', null)];
    expect(countByStatus(rs)).toEqual({ PAIRED: 1, 'NOT-FOUND': 2 });
  });
});

describe('template', () => {
  test('parses to zero IDs, so running it unedited fails loudly', () => {
    expect(() => parseIdList(REGISTRY_LOOKUP_TEMPLATE)).toThrow(/No hardware IDs found in column "hardware_id"/);
  });
  test('is ready to use once an ID is appended', () => {
    expect(parseIdList(REGISTRY_LOOKUP_TEMPLATE + '24e124600e458870\n').ids).toEqual(['24e124600e458870']);
  });
  test('writeLookupTemplate writes the file and refuses to overwrite', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lookup-template-'));
    const file = join(dir, 't.csv');
    writeLookupTemplate(file);
    expect(readFileSync(file, 'utf-8')).toBe(REGISTRY_LOOKUP_TEMPLATE);
    writeFileSync(file, 'mine');
    expect(() => writeLookupTemplate(file)).toThrow(/already exists/);
    expect(readFileSync(file, 'utf-8')).toBe('mine');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test src/lib/registry-lookup.test.ts`
Expected: FAIL — `Cannot find module './registry-lookup.js'`.

- [ ] **Step 3: Create `src/lib/registry-lookup.ts`**

```ts
import { existsSync, writeFileSync } from 'fs';
import { apiGet } from './api.js';
import { getConfig } from './config.js';
import type { ApiResponse } from '../types/index.js';

// ============================================================================
// Types
// ============================================================================

export interface RegistryDeviceType {
  id: string;
  name: string;
  description?: string;
  category: string;
  subcategory: string;
  codec?: string;
  model?: string;
  manufacturer?: string;
  transport_protocol?: string;
}

export interface RegistryEntry {
  id: string;
  application_id: string;
  paired_to_app_id?: string;
  hardware_id: string;
  network: string;
  device_type_id: string;
  sku?: string;
  status: 'PENDING' | 'PAIRED' | 'DECOMMISSIONED';
  paired_at?: string;
  created_at: string;
  device_type?: RegistryDeviceType;
  devices?: unknown[];
}

export type LookupStatus = 'PAIRED' | 'PENDING' | 'DECOMMISSIONED' | 'NOT-FOUND' | 'ERROR';

export const LOOKUP_STATUSES: LookupStatus[] = ['PAIRED', 'PENDING', 'DECOMMISSIONED', 'NOT-FOUND', 'ERROR'];

export interface LookupResult {
  hardware_id: string;
  status: string;
  device_type: string;
  paired_to_app_id: string;
  paired_at: string;
  network: string;
  error: string;
}

export const LOOKUP_COLUMNS = ['hardware_id', 'status', 'device_type', 'paired_to_app_id', 'paired_at', 'network', 'error'];

// ============================================================================
// Lookup
// ============================================================================

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function getRegistryPath(): string {
  const clientId = getConfig('clientId');
  return `/v1.1/organizations/${clientId}/applications/${clientId}/things/registry`;
}

export function registryFilter(id: string): string {
  const value = id.trim().toLowerCase();
  return UUID.test(value) ? `id eq ${value}` : `hardware_id eq ${value}`;
}

/**
 * Find one registry entry by registry UUID or hardware ID via the list endpoint.
 * `GET …/things/registry/<id>` answers "Resource not found" for both forms (verified 2026-09-25),
 * so the filtered list is the only working lookup. The exact-match check guards against a fuzzy `eq`.
 */
export async function findRegistryEntry(id: string): Promise<RegistryEntry | null> {
  const value = id.trim().toLowerCase();
  const response = await apiGet<ApiResponse<RegistryEntry>>(getRegistryPath(), {
    filter: registryFilter(value),
    limit: 5,
  });
  const rows = response.rows || [];
  return rows.find((e) => e.id === value || e.hardware_id?.toLowerCase() === value) ?? null;
}

export function toLookupResult(id: string, entry: RegistryEntry | null, err?: string): LookupResult {
  const empty = { device_type: '', paired_to_app_id: '', paired_at: '', network: '' };
  if (err !== undefined) return { hardware_id: id, status: 'ERROR', ...empty, error: err };
  if (!entry) return { hardware_id: id, status: 'NOT-FOUND', ...empty, error: '' };
  return {
    hardware_id: entry.hardware_id,
    status: entry.status,
    device_type: entry.device_type?.name ?? entry.device_type_id ?? '',
    paired_to_app_id: entry.paired_to_app_id ?? '',
    paired_at: entry.paired_at ?? '',
    network: entry.network ?? '',
    error: '',
  };
}

/** Look up every ID with at most `concurrency` requests in flight; results keep input order. */
export async function lookupMany(
  ids: string[],
  opts: {
    concurrency: number;
    lookup?: (id: string) => Promise<RegistryEntry | null>;
    onProgress?: (done: number, total: number) => void;
  }
): Promise<LookupResult[]> {
  const lookup = opts.lookup ?? findRegistryEntry;
  const results: LookupResult[] = new Array(ids.length);
  let next = 0;
  let done = 0;

  async function worker(): Promise<void> {
    while (next < ids.length) {
      const i = next++;
      try {
        results[i] = toLookupResult(ids[i], await lookup(ids[i]));
      } catch (err) {
        results[i] = toLookupResult(ids[i], null, err instanceof Error ? err.message : String(err));
      }
      done++;
      opts.onProgress?.(done, ids.length);
    }
  }

  const workers = Math.max(1, Math.min(opts.concurrency, ids.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}

export function countByStatus(results: LookupResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return counts;
}

// ============================================================================
// Template
// ============================================================================

export const DEFAULT_TEMPLATE_FILE = 'registry-lookup-template.csv';

export const REGISTRY_LOOKUP_TEMPLATE =
  '# mydevices registry lookup — one ID per row under hardware_id. Lines starting with # are ignored.\n' +
  '# Sensors: 16-hex devEUI, e.g. 24e124600e458870. Gateways: eui-<16 hex>, e.g. eui-647fdafffe02d34f.\n' +
  '# Run: mydevices registry lookup <this-file> [--only PAIRED] [--write paired.txt]\n' +
  'hardware_id\n';

export function writeLookupTemplate(path: string): void {
  if (existsSync(path)) {
    throw new Error(`${path} already exists; not overwriting`);
  }
  writeFileSync(path, REGISTRY_LOOKUP_TEMPLATE);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test src/lib/registry-lookup.test.ts`
Expected: PASS.

- [ ] **Step 5: `registry.ts` uses the lib; fix `registry get`**

In `src/commands/registry.ts`:

1. Delete the local `RegistryDeviceType` and `RegistryEntry` interfaces and the local `getRegistryPath` function.
2. Add:
   ```ts
   import { findRegistryEntry, getRegistryPath, type RegistryEntry } from '../lib/registry-lookup.js';
   ```
3. In the `get` action, replace
   ```ts
        const entry = await apiGet<RegistryEntry>(`${getRegistryPath()}/${id}`);
   ```
   with
   ```ts
        const entry = await findRegistryEntry(id);
        if (!entry) {
          throw new Error('Resource not found.');
        }
   ```

- [ ] **Step 6: Typecheck and run tests**

Run: `bun run typecheck && bun test`
Expected: no new type errors; tests PASS.

- [ ] **Step 7: Live read-only check**

```bash
bun run src/index.ts registry get eui-00800000d000f6e6
# Registry Entry: eui-00800000d000f6e6 … Status: paired (was "Resource not found." before)
bun run src/index.ts registry get 9b72d8e0-39f2-11f1-8aba-f39b15bd015a
# same entry by UUID
bun run src/index.ts registry get 0000000000000000
# ✗ Error: Resource not found.
```
Use IDs from `registry list --limit 1 --json` if the session is not `dsi`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/registry-lookup.ts src/lib/registry-lookup.test.ts src/commands/registry.ts
git commit -m "fix: registry get resolves by UUID or hardware ID through the filtered list"
```

---

### Task 8: `registry lookup` command with `--template`

**Files:**
- Modify: `src/commands/registry.ts`

**Interfaces:**
- Consumes: `readIdList` (Task 2); `assertResultsPath`, `writeResults` (Task 3); `lookupMany`, `countByStatus`, `writeLookupTemplate`, `DEFAULT_TEMPLATE_FILE`, `LOOKUP_STATUSES`, `LOOKUP_COLUMNS`, `type LookupStatus`, `type LookupResult` (Task 7).

- [ ] **Step 1: Imports**

In `src/commands/registry.ts` add:

```ts
import { writeFileSync } from 'fs';
import chalk from 'chalk';
import { readIdList } from '../lib/eui-list.js';
import { assertResultsPath, writeResults } from '../lib/results-file.js';
```

and extend the `registry-lookup.js` import to:

```ts
import {
  DEFAULT_TEMPLATE_FILE,
  LOOKUP_COLUMNS,
  LOOKUP_STATUSES,
  countByStatus,
  findRegistryEntry,
  getRegistryPath,
  lookupMany,
  writeLookupTemplate,
  type LookupResult,
  type LookupStatus,
  type RegistryEntry,
} from '../lib/registry-lookup.js';
```

- [ ] **Step 2: Add the command**

Insert after the `registry get` command (before `registry create`):

```ts
  // --------------------------------------------------------------------------
  // registry lookup
  // --------------------------------------------------------------------------
  registry
    .command('lookup')
    .description('Look up registry status for a file of hardware IDs (sensors or gateways)')
    .argument('[file]', 'CSV or text file of hardware IDs')
    .option('--template [file]', `Write a starter input file and exit (default: ${DEFAULT_TEMPLATE_FILE})`)
    .option('--column <name>', 'CSV column containing hardware IDs (auto-detected if not specified)')
    .option('--delimiter <char>', 'Force CSV delimiter (auto-detect by default)')
    .option('--only <status>', `Only show and write rows with this status (${LOOKUP_STATUSES.join(', ')})`)
    .option('--write <file>', 'Write the (filtered) hardware IDs to a file, one per line')
    .option('--concurrency <n>', 'Lookups in flight (1-20)', '5')
    .option('--json', 'Output as JSON')
    .option('--output <file>', 'Save results (.csv or .json)')
    .action(async (file: string | undefined, options: {
      template?: string | boolean;
      column?: string;
      delimiter?: string;
      only?: string;
      write?: string;
      concurrency: string;
      json?: boolean;
      output?: string;
    }) => {
      if (options.template !== undefined) {
        const path = typeof options.template === 'string' ? options.template : DEFAULT_TEMPLATE_FILE;
        try {
          writeLookupTemplate(path);
        } catch (err) {
          error(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
        success(`Template written to ${path}. Add one ID per line under hardware_id, then run: mydevices registry lookup ${path}`);
        return;
      }

      if (!file) {
        error('Missing <file>. Pass a file of hardware IDs, or use --template to create one.');
        process.exit(1);
      }

      const clientId = getConfig('clientId');
      if (!clientId) {
        error('No clientId configured. Run "mydevices auth login" first.');
        process.exit(1);
      }

      let only: LookupStatus | undefined;
      if (options.only) {
        const value = options.only.toUpperCase();
        if (!LOOKUP_STATUSES.includes(value as LookupStatus)) {
          error(`--only must be one of: ${LOOKUP_STATUSES.join(', ')}`);
          process.exit(1);
        }
        only = value as LookupStatus;
      }

      if (!/^\d+$/.test(options.concurrency) || +options.concurrency < 1 || +options.concurrency > 20) {
        error(`--concurrency must be an integer from 1 to 20 (got "${options.concurrency}")`);
        process.exit(1);
      }
      const concurrency = parseInt(options.concurrency, 10);

      if (options.output) {
        try {
          assertResultsPath(options.output);
        } catch (err) {
          error((err as Error).message);
          process.exit(1);
        }
      }

      let ids: string[];
      try {
        ids = readIdList(file, { column: options.column, delimiter: options.delimiter }).ids;
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to read file');
        process.exit(1);
      }

      if (!options.json) {
        console.log(chalk.cyan(`Looking up ${ids.length} IDs in the registry as clientId "${clientId}"`));
      }
      const spinner = ora('Looking up...').start();
      const results = await lookupMany(ids, {
        concurrency,
        onProgress: (done, total) => {
          spinner.text = `Looking up ${done}/${total}`;
        },
      });
      spinner.stop();

      const counts = countByStatus(results);
      const shown: LookupResult[] = only ? results.filter((r) => r.status === only) : results;

      if (options.json) {
        console.log(JSON.stringify({ clientId, counts, results: shown }, null, 2));
      } else {
        outputTable(
          ['Hardware ID', 'Status', 'Device Type', 'Paired To', 'Paired At', 'Network'],
          shown.map((r) => [
            r.hardware_id,
            r.status,
            r.device_type || '-',
            r.paired_to_app_id || '-',
            r.paired_at || '-',
            r.network || '-',
          ]),
          {
            footer:
              Object.entries(counts).map(([status, n]) => `${status}: ${n}`).join('  ') +
              (only ? `  (showing ${only})` : '') +
              (counts['NOT-FOUND'] ? `\nNOT-FOUND = not visible to clientId "${clientId}"` : ''),
          }
        );
        const errors = results.filter((r) => r.status === 'ERROR');
        for (const r of errors) {
          console.log(chalk.red(`  ${r.hardware_id}: ${r.error}`));
        }
      }

      if (options.write) {
        writeFileSync(options.write, shown.map((r) => r.hardware_id).join('\n') + (shown.length > 0 ? '\n' : ''));
        success(`Wrote ${shown.length} IDs to ${options.write}`);
      }

      if (options.output) {
        writeResults(options.output, shown, LOOKUP_COLUMNS, { clientId, file, only: only ?? null, counts });
        success(`Results saved to ${options.output}`);
      }

      if (counts['ERROR']) {
        process.exit(1);
      }
    });
```

(`ora`, `getConfig`, `error`, `success`, `outputTable` are already imported in `registry.ts`; confirm and add any that are missing.)

- [ ] **Step 3: Typecheck and run tests**

Run: `bun run typecheck && bun test`
Expected: no new type errors; tests PASS.

- [ ] **Step 4: Template checks (no network)**

```bash
cd /tmp && rm -f registry-lookup-template.csv
bun run /Users/asanchezdelc/myDevices/Projects/mydevices-cli/.worktrees/gateway-fleet-commands/src/index.ts registry lookup --template
# ✓ Template written to registry-lookup-template.csv …
cat registry-lookup-template.csv   # three # lines, then hardware_id
bun run /Users/asanchezdelc/myDevices/Projects/mydevices-cli/.worktrees/gateway-fleet-commands/src/index.ts registry lookup --template
# ✗ registry-lookup-template.csv already exists; not overwriting — exit 1
bun run /Users/asanchezdelc/myDevices/Projects/mydevices-cli/.worktrees/gateway-fleet-commands/src/index.ts registry lookup registry-lookup-template.csv
# ✗ No hardware IDs found in column "hardware_id" — exit 1
cd -
bun run src/index.ts registry lookup
# ✗ Missing <file>… — exit 1
bun run src/index.ts registry lookup /tmp/registry-lookup-template.csv --only paired-ish
# ✗ --only must be one of: …
```

- [ ] **Step 5: Live read-only lookup**

```bash
cp /tmp/registry-lookup-template.csv /tmp/gfc-lookup.csv
printf 'eui-00800000d000f6e6\na84041ec4185c14c\n24e124600e458870\nA84041EC4185C14C\n' >> /tmp/gfc-lookup.csv
bun run src/index.ts registry lookup /tmp/gfc-lookup.csv
# header "Looking up 3 IDs … as clientId "dsi"" (the uppercase duplicate is removed)
# as dsi: two PAIRED rows, 24e124600e458870 NOT-FOUND; footer "PAIRED: 2  NOT-FOUND: 1" + NOT-FOUND note
bun run src/index.ts registry lookup /tmp/gfc-lookup.csv --only PAIRED --write /tmp/gfc-paired.txt --output /tmp/gfc-lookup-out.csv
cat /tmp/gfc-paired.txt /tmp/gfc-lookup-out.csv   # 2 IDs; CSV with LOOKUP_COLUMNS header
bun run src/index.ts registry lookup /tmp/gfc-lookup.csv --json | head -20   # { clientId, counts, results }
```

- [ ] **Step 6: Commit**

```bash
git add src/commands/registry.ts
git commit -m "feat: add registry lookup with --template, --only, --write and --output"
```

---

### Task 9: Docs, completion and describe

**Files:**
- Create: `docs/bulk-gateways.md`, `docs/registry-lookup.md`
- Modify: `docs/README.md`, `README.md`, `src/commands/completion.ts`, `src/commands/describe.ts`

- [ ] **Step 1: Completion**

In `src/commands/completion.ts`, `SUBCOMMANDS`:

```ts
  registry: ['list', 'get', 'lookup', 'create', 'unpair', 'networks'],
  gateways: ['list', 'get', 'pings', 'stats', 'reboot', 'update-software', 'migrate-provider'],
```

- [ ] **Step 2: Describe**

In `src/commands/describe.ts`, in the `registry` command's `subcommands`, after the `get` entry add:

```ts
          {
            name: 'lookup',
            description: 'Look up registry status for a file of hardware IDs',
            arguments: [{ name: 'file', description: 'CSV or text file of hardware IDs', required: false }],
            options: [
              { name: 'template', flags: '--template [file]', description: 'Write a starter input file and exit', required: false },
              { name: 'only', flags: '--only <status>', description: 'PAIRED, PENDING, DECOMMISSIONED, NOT-FOUND or ERROR', required: false },
              { name: 'write', flags: '--write <file>', description: 'Write the filtered IDs, one per line', required: false },
              { name: 'concurrency', flags: '--concurrency <n>', description: 'Lookups in flight (1-20)', required: false, default: '5' },
              { name: 'output', flags: '--output <file>', description: 'Save results (.csv or .json)', required: false },
              { name: 'json', flags: '--json', description: 'Output as JSON', required: false },
            ],
            examples: ['mydevices registry lookup --template', 'mydevices registry lookup sensors.txt --only PAIRED --write paired.txt'],
          },
```

In the `gateways` command's `subcommands`, after `stats` add:

```ts
          {
            name: 'update-software',
            description: 'Update software on a gateway',
            arguments: [{ name: 'hardware-id', description: 'Gateway hardware ID', required: true }],
            options: [
              { name: 'url', flags: '--url <url>', description: 'https URL of the package (skips the manifest picker)', required: false },
              { name: 'checksum', flags: '--checksum <md5>', description: 'MD5 of the package (required with --url)', required: false },
              { name: 'yes', flags: '-y, --yes', description: 'Skip confirmation prompt', required: false },
              { name: 'json', flags: '--json', description: 'Output as JSON', required: false },
            ],
            examples: ['mydevices gateways update-software eui-647fdafffe01433c --url https://…/dps-client_1.5.0-r0_kona.ipk --checksum 2a3f7fe7ff4b34cf6870e47ae709937f --yes'],
          },
```

- [ ] **Step 3: Create `docs/bulk-gateways.md`**

````markdown
# Bulk gateway commands

Send one command to every gateway in a file.

```bash
mydevices bulk gateways reboot           <file>
mydevices bulk gateways update           <file> --url <https-url> --checksum <md5>
mydevices bulk gateways migrate-provider <file> --provider mydevices|azure
```

Common options:

| Option | Default | Meaning |
|---|---|---|
| `--column <name>` | auto | CSV column holding the EUIs (`hardware_id`, `eui`, `deveui`, `dev_eui`, `device_eui`, `hwid`) |
| `--delimiter <char>` | auto | force the CSV delimiter |
| `--dry-run` | | print the plan (count, first EUIs, exact request body, clientId) and send nothing |
| `--limit <n>` | all | send to the first n gateways only |
| `--delay <ms>` | 500 | wait between gateways |
| `-y, --yes` | | skip the confirmation prompt (required when not run from a terminal) |
| `--json` | | print results as JSON |
| `--output <file>` | | write per-gateway results, `.csv` or `.json` |

## Input file

A CSV with one of the column names above, or plain text with one EUI per line. Lines starting with `#`
are ignored. EUIs may be bare hex or `eui-` prefixed, any case; duplicates are removed. If any line is not a
valid gateway EUI, the command lists the bad lines and sends nothing.

## Behaviour

- Gateways are sent one at a time, in file order, with `--delay` between them.
- A failure is recorded and the run continues. There are no retries.
- `Ctrl-C` finishes the in-flight request, stops, prints the summary and writes `--output`; exit code 130.
- Exit code 1 if any gateway failed.

The results CSV has columns `eui,command,status_code,ok,error,sent_at`. Filter it to the failed rows and pass
it straight back in to retry just those:

```bash
mydevices bulk gateways reboot wave.txt --output wave-results.csv --yes
awk -F, 'NR==1 || $4=="false"' wave-results.csv > wave-retry.csv
mydevices bulk gateways reboot wave-retry.csv --dry-run
```

## Example: dps-client update

```bash
mydevices bulk gateways update dps-kona.txt \
  --url https://hwdartifacts.blob.core.windows.net/hwdassets/dps-client_1.5.0-r0_kona.ipk \
  --checksum 2a3f7fe7ff4b34cf6870e47ae709937f \
  --dry-run
```

## Which gateways you can reach

Commands go to `/v1.1/organizations/<clientId>/applications/<clientId>/gateways/<eui>/…`, using the clientId
you are logged in as, which is printed in every preview. To operate on the whole fleet, log in as the
`iotinabox` organization (`mydevices auth login`, or `mydevices auth set-token` with an iotinabox token).

The single-gateway commands send the same requests: `mydevices gateways reboot <eui>`,
`mydevices gateways update-software <eui> --url … --checksum … --yes`,
`mydevices gateways migrate-provider <eui> --provider …`.
````

- [ ] **Step 4: Create `docs/registry-lookup.md`**

````markdown
# Registry lookup

Check the registry status of many sensors or gateways at once.

```bash
mydevices registry lookup --template            # writes registry-lookup-template.csv
mydevices registry lookup sensors.csv
mydevices registry lookup sensors.csv --only PAIRED --write paired.txt --output lookup.csv
```

## Input

Start from the template (`--template [file]`, default `registry-lookup-template.csv`; an existing file is never
overwritten). It has instructions in `#` lines and a `hardware_id` header; add one ID per line under it.
Any CSV with a `hardware_id`/`eui`/`deveui`/`dev_eui`/`device_eui`/`hwid` column, or a plain list, also works.
Sensors are 16-hex devEUIs (`24e124600e458870`); gateways are `eui-<16 hex>`.

## Output

One row per ID: hardware ID, status, device type, paired-to app, paired-at, network.

| Status | Meaning |
|---|---|
| `PAIRED` | activated for a customer app |
| `PENDING` | registered, activation not completed |
| `DECOMMISSIONED` | retired |
| `NOT-FOUND` | not visible to the clientId you are logged in as — not necessarily unregistered |
| `ERROR` | the lookup failed; the message is shown; exit code 1 |

Options: `--only <status>` filters the table, `--write` and `--output`; `--write <file>` saves the filtered IDs
one per line; `--output <file.csv|file.json>` saves the rows; `--concurrency <n>` (1–20, default 5); `--json`.

## Scope

Lookups are limited to the clientId you are logged in as (printed in the header). For fleet-wide triage,
log in as the `iotinabox` organization.

`mydevices registry get <id>` accepts a registry UUID or a hardware ID.
````

- [ ] **Step 5: READMEs**

In `docs/README.md`, add links next to the existing guide links:

```markdown
- [Bulk gateway commands](./bulk-gateways.md)
- [Registry lookup](./registry-lookup.md)
```

In `README.md`:

1. After the `### Devices` section add:

   ````markdown
   ### Gateways

   ```bash
   mydevices gateways list [--network iotinabox.chirpstackio]   # includes config/actual backend
   mydevices gateways get <eui>                                 # includes a Backend section
   mydevices gateways pings <eui> | stats <eui>
   mydevices gateways reboot <eui> [--yes]
   mydevices gateways update-software <eui> [--url <https-url> --checksum <md5>] [--yes]
   mydevices gateways migrate-provider <eui> --provider mydevices|azure [--yes]
   ```
   ````

2. In `### Bulk Operations`, add under the `bulk deactivate` line:

   ```bash
   mydevices bulk gateways reboot <file> [--dry-run]      # Reboot a list of gateways
   mydevices bulk gateways update <file> --url <u> --checksum <md5>
   mydevices bulk gateways migrate-provider <file> --provider mydevices
   ```

   and add `[Bulk Gateway Commands](./docs/bulk-gateways.md)` to the "See …" line.

3. In the registry commands (or after `### Rules` if there is no registry section), add:

   ```bash
   mydevices registry get <uuid-or-hardware-id>
   mydevices registry lookup --template
   mydevices registry lookup <file> [--only PAIRED] [--write ids.txt] [--output lookup.csv]
   ```

   with a link to `./docs/registry-lookup.md`.

- [ ] **Step 6: Check**

Run: `bun run typecheck && bun test && bun run src/index.ts describe --help >/dev/null && bun run src/index.ts completion zsh | grep -c lookup`
Expected: PASS; the grep count is ≥ 1.

- [ ] **Step 7: Commit**

```bash
git add docs/bulk-gateways.md docs/registry-lookup.md docs/README.md README.md src/commands/completion.ts src/commands/describe.ts
git commit -m "docs: bulk gateway commands, registry lookup, gateway command reference"
```

---

### Task 10: Final verification

- [ ] **Step 1: Full suite, typecheck and build**

```bash
bun test
bun run typecheck
bun run build && ./dist/mydevices --version
```
Expected: all tests PASS; no type errors beyond the Task 1 baseline; the binary builds and prints the version.

- [ ] **Step 2: Built binary smoke test (read-only / dry-run)**

```bash
./dist/mydevices bulk gateways reboot /tmp/gfc-gws.txt --dry-run
./dist/mydevices registry lookup /tmp/gfc-lookup.csv
./dist/mydevices gateways get eui-00800000d000f6e6
```
Expected: same output as in Tasks 5, 6 and 8.

- [ ] **Step 3: Confirm no remote-shell anywhere**

Run: `grep -rn "remote-shell" src/ || echo none`
Expected: `none`.

- [ ] **Step 4: Clean up temp files**

```bash
rm -f /tmp/gfc-*.txt /tmp/gfc-*.csv /tmp/registry-lookup-template.csv
```

- [ ] **Step 5: Hand off**

Use superpowers:finishing-a-development-branch. Note for the merge: `feat/bulk-update` (unmerged) also edits `src/commands/bulk.ts`, and the main checkout has an uncommitted debug-header change in `src/lib/api.ts`; expect small conflicts in both.
