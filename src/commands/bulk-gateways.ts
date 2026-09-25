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
  // A second Ctrl-C exits immediately.
  let interrupted = false;
  const onSigint = () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    warn('Interrupted: finishing the in-flight request, then stopping.');
  };
  process.on('SIGINT', onSigint);

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
    try {
      writeResults(options.output, rows, RESULT_COLUMNS, { clientId, command: label, request_body: body, file });
      success(`Results saved to ${options.output}`);
    } catch (err) {
      error(`Could not write ${options.output}: ${(err as Error).message}`);
      console.error(JSON.stringify(rows, null, 2));
      process.exit(interrupted ? 130 : 1);
    }
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
