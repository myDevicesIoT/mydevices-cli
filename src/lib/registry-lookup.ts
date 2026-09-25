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
