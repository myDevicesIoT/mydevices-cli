import Table from 'cli-table3';
import chalk from 'chalk';
import { getConfig } from './config.js';

export function outputJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function outputTable(
  headers: string[],
  rows: (string | number | boolean | null | undefined)[][],
  options?: { footer?: string }
): void {
  const table = new Table({
    head: headers.map((h) => chalk.cyan.bold(h)),
    style: {
      head: [],
      border: [],
    },
  });

  rows.forEach((row) => {
    table.push(row.map((cell) => formatCell(cell)));
  });

  console.log(table.toString());

  if (options?.footer) {
    console.log(chalk.gray(options.footer));
  }
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) {
    return chalk.gray('-');
  }
  if (typeof value === 'boolean') {
    return value ? chalk.green('yes') : chalk.red('no');
  }
  if (typeof value === 'number') {
    return value.toString();
  }
  // Status formatting
  if (value === 'active' || value === 0) {
    return chalk.green(String(value));
  }
  if (value === 'inactive' || value === 'deactivated' || value === 1) {
    return chalk.yellow(String(value));
  }
  return String(value);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function output(
  data: unknown,
  options: {
    json?: boolean;
    tableHeaders?: string[];
    tableMapper?: (item: any) => (string | number | boolean | null | undefined)[];
    footer?: string;
  }
): void {
  const useJson = options.json ?? getConfig('defaultOutput') === 'json';

  if (useJson) {
    outputJson(data);
    return;
  }

  if (options.tableHeaders && options.tableMapper) {
    const items = Array.isArray(data) ? data : [data];
    const rows = items.map(options.tableMapper);
    outputTable(options.tableHeaders, rows, { footer: options.footer });
  } else {
    outputJson(data);
  }
}

export function success(message: string): void {
  console.log(chalk.green('✓'), message);
}

export function error(message: string): void {
  console.error(chalk.red('✗'), chalk.red('Error:'), message);
}

export function warn(message: string): void {
  console.log(chalk.yellow('⚠'), message);
}

export function info(message: string): void {
  console.log(chalk.blue('ℹ'), message);
}

export function detail(label: string, value: string | number | boolean | null | undefined): void {
  const formattedValue = value === null || value === undefined ? chalk.gray('-') : String(value);
  console.log(`  ${chalk.gray(label + ':')} ${formattedValue}`);
}

export function header(title: string): void {
  console.log(chalk.bold(title));
  console.log(chalk.gray('─'.repeat(title.length + 10)));
}
