import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { assertResultsPath, toCsv, writeResults } from './results-file.js';
import { parseIdList } from './eui-list.js';
import { RESULT_COLUMNS } from './gateway-commands.js';

describe('assertResultsPath', () => {
  test('accepts .csv and .json in any case', () => {
    const dir = mkdtempSync(join(tmpdir(), 'results-file-ext-'));
    expect(() => assertResultsPath('out.csv')).not.toThrow();
    expect(() => assertResultsPath(join(dir, 'out.JSON'))).not.toThrow();
  });
  test('rejects other extensions before any work is done', () => {
    expect(() => assertResultsPath('results.txt')).toThrow(/--output must end in .csv or .json/);
    expect(() => assertResultsPath('results')).toThrow(/--output must end in .csv or .json/);
  });
  test('rejects a path whose parent directory does not exist', () => {
    expect(() => assertResultsPath('/tmp/no-such-dir/r.csv')).toThrow(/--output directory does not exist/);
  });
  test('accepts a path in an existing directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'results-file-path-'));
    expect(() => assertResultsPath(join(dir, 'r.csv'))).not.toThrow();
  });
  test('accepts a bare filename (dirname ".")', () => {
    expect(() => assertResultsPath('out.csv')).not.toThrow();
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
  test('refuses a missing parent directory', () => {
    expect(() => writeResults('/tmp/no-such-dir/r.csv', [], ['a'])).toThrow(/--output directory does not exist/);
  });
});
