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
