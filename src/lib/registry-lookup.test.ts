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
