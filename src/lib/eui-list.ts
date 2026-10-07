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
