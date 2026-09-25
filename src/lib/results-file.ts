import { existsSync, statSync, writeFileSync } from 'fs';
import { dirname, extname } from 'path';

export type ResultRow = Record<string, unknown>;

/** Validate an --output path up front, so a typo is caught before anything is sent. */
export function assertResultsPath(path: string): void {
  const ext = extname(path).toLowerCase();
  if (ext !== '.csv' && ext !== '.json') {
    throw new Error(`--output must end in .csv or .json (got "${path}")`);
  }
  const dir = dirname(path);
  if (dir !== '.' && (!existsSync(dir) || !statSync(dir).isDirectory())) {
    throw new Error(`--output directory does not exist: ${dir}`);
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
