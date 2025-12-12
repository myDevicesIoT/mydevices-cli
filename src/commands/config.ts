import { Command } from 'commander';
import { input, select } from '@inquirer/prompts';
import { getConfig, setConfig, getAllConfig, getConfigPath } from '../lib/config.js';
import { success, error, info, outputJson } from '../lib/output.js';

const ALLOWED_KEYS = ['realm', 'apiUrl', 'authUrl', 'defaultOutput'] as const;
type AllowedKey = typeof ALLOWED_KEYS[number];

export function createConfigCommands(): Command {
  const config = new Command('config').description('Manage CLI configuration');

  config
    .command('get')
    .description('Get a config value')
    .argument('<key>', 'Config key')
    .action((key: string) => {
      if (!ALLOWED_KEYS.includes(key as AllowedKey)) {
        error(`Unknown config key: ${key}`);
        console.log(`  Available keys: ${ALLOWED_KEYS.join(', ')}`);
        process.exit(1);
      }

      const value = getConfig(key as AllowedKey);
      console.log(value || '');
    });

  config
    .command('set')
    .description('Set a config value')
    .argument('<key>', 'Config key')
    .argument('<value>', 'Config value')
    .action((key: string, value: string) => {
      if (!ALLOWED_KEYS.includes(key as AllowedKey)) {
        error(`Unknown config key: ${key}`);
        console.log(`  Available keys: ${ALLOWED_KEYS.join(', ')}`);
        process.exit(1);
      }

      if (key === 'defaultOutput' && !['table', 'json'].includes(value)) {
        error('defaultOutput must be "table" or "json"');
        process.exit(1);
      }

      setConfig(key as AllowedKey, value as 'table' | 'json');
      success(`Set ${key} = ${value}`);
    });

  config
    .command('list')
    .description('List all config values')
    .option('--json', 'Output as JSON')
    .action((options: { json?: boolean }) => {
      const allConfig = getAllConfig();

      // Filter out sensitive values
      const safeConfig = {
        realm: allConfig.realm,
        apiUrl: allConfig.apiUrl,
        authUrl: allConfig.authUrl,
        defaultOutput: allConfig.defaultOutput,
      };

      if (options.json) {
        outputJson(safeConfig);
      } else {
        console.log('Configuration:');
        console.log(`  realm: ${safeConfig.realm || '(not set)'}`);
        console.log(`  apiUrl: ${safeConfig.apiUrl}`);
        console.log(`  authUrl: ${safeConfig.authUrl}`);
        console.log(`  defaultOutput: ${safeConfig.defaultOutput}`);
        console.log('');
        console.log(`Config file: ${getConfigPath()}`);
      }
    });

  config
    .command('path')
    .description('Show config file path')
    .action(() => {
      console.log(getConfigPath());
    });

  config
    .command('init')
    .description('Interactive configuration setup')
    .action(async () => {
      try {
        info('myDevices CLI Configuration Setup');
        console.log('');

        const realm = await input({
          message: 'Enter your realm name:',
          default: getConfig('realm') || undefined,
        });

        const apiUrl = await input({
          message: 'API URL:',
          default: getConfig('apiUrl'),
        });

        const authUrl = await input({
          message: 'Auth URL:',
          default: getConfig('authUrl'),
        });

        const defaultOutput = await select({
          message: 'Default output format:',
          choices: [
            { name: 'Table (human-readable)', value: 'table' },
            { name: 'JSON (machine-readable)', value: 'json' },
          ],
          default: getConfig('defaultOutput'),
        });

        if (realm) setConfig('realm', realm);
        setConfig('apiUrl', apiUrl);
        setConfig('authUrl', authUrl);
        setConfig('defaultOutput', defaultOutput as 'table' | 'json');

        console.log('');
        success('Configuration saved!');
        console.log(`  Config file: ${getConfigPath()}`);
        console.log('');
        console.log('Next step: Run "mydevices auth login" to authenticate');
      } catch (err) {
        if (err instanceof Error && err.message.includes('User force closed')) {
          console.log('\nSetup cancelled');
          process.exit(0);
        }
        throw err;
      }
    });

  return config;
}
