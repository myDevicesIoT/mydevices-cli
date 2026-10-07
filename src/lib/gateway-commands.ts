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
  onResult?: (result: SendResult) => void;
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
      const result = await send(eui);
      results.push(result);
      opts.onResult?.(result);
    } catch (err) {
      const result: SendResult = {
        eui,
        command: 'unknown',
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        sent_at: new Date().toISOString(),
      };
      results.push(result);
      opts.onResult?.(result);
    }
    if (i < euis.length - 1 && opts.delayMs > 0 && !opts.shouldStop?.()) {
      await sleep(opts.delayMs);
    }
  }

  return results;
}

/**
 * Rows for the EUIs a run never attempted (e.g. stopped early by Ctrl-C), so `--output`
 * and `--json` account for every EUI in the plan, not just the ones actually sent.
 */
export function notSentRows(euis: string[], attempted: number, command: string): SendResult[] {
  return euis.slice(attempted).map((eui) => ({
    eui,
    command,
    ok: false,
    error: 'not sent (interrupted)',
    sent_at: '',
  }));
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
