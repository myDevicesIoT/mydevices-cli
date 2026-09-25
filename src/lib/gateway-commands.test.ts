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
