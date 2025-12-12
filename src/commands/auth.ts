import { Command } from 'commander';
import { input, password } from '@inquirer/prompts';
import ora from 'ora';
import { authenticate, getTokenExpiry } from '../lib/auth.js';
import { getAuthConfig, clearAuthConfig, isAuthenticated, setConfig } from '../lib/config.js';
import { success, error, detail, header } from '../lib/output.js';

export function createAuthCommands(): Command {
  const auth = new Command('auth').description('Authentication commands');

  auth
    .command('login')
    .description('Authenticate with myDevices API')
    .option('-r, --realm <realm>', 'Your realm name')
    .option('-c, --client-id <clientId>', 'Your client ID')
    .option('-s, --client-secret <clientSecret>', 'Your client secret')
    .action(async (options) => {
      try {
        // Get credentials from flags, env vars, or prompts
        let realm = options.realm || process.env.MYDEVICES_REALM;
        let clientId = options.clientId || process.env.MYDEVICES_CLIENT_ID;
        let clientSecret = options.clientSecret || process.env.MYDEVICES_CLIENT_SECRET;

        // Interactive prompts if not provided
        if (!realm) {
          realm = await input({
            message: 'Enter your realm:',
            validate: (value) => (value.length > 0 ? true : 'Realm is required'),
          });
        }

        if (!clientId) {
          clientId = await input({
            message: 'Enter your Client ID:',
            validate: (value) => (value.length > 0 ? true : 'Client ID is required'),
          });
        }

        if (!clientSecret) {
          clientSecret = await password({
            message: 'Enter your Client Secret:',
            validate: (value) => (value.length > 0 ? true : 'Client Secret is required'),
          });
        }

        // Store realm in config
        setConfig('realm', realm);

        const spinner = ora('Authenticating...').start();

        try {
          const tokenData = await authenticate(realm, clientId, clientSecret);
          spinner.stop();

          success('Login successful!');
          const hours = Math.floor(tokenData.expires_in / 3600);
          detail('Token expires in', `${hours} hours`);
          detail('Credentials saved', 'yes');
        } catch (err) {
          spinner.stop();
          throw err;
        }
      } catch (err) {
        if (err instanceof Error) {
          error(err.message);
        } else {
          error('Authentication failed');
        }
        process.exit(1);
      }
    });

  auth
    .command('logout')
    .description('Clear stored credentials')
    .action(() => {
      clearAuthConfig();
      success('Logged out successfully. Credentials cleared.');
    });

  auth
    .command('whoami')
    .description('Show current authentication status')
    .action(() => {
      const authConfig = getAuthConfig();

      if (!authConfig.accessToken) {
        error('Not authenticated');
        console.log('  Run "mydevices auth login" to authenticate');
        process.exit(1);
      }

      header('Authentication Status');
      detail('Realm', authConfig.realm);
      detail('Client ID', authConfig.clientId);

      const expiry = getTokenExpiry();
      if (expiry) {
        const isExpired = expiry.expiresIn === 'expired';
        detail('Token', isExpired ? 'Expired' : `Valid (expires in ${expiry.expiresIn})`);
      }
    });

  auth
    .command('token')
    .description('Print current access token')
    .action(() => {
      const authConfig = getAuthConfig();

      if (!authConfig.accessToken) {
        error('Not authenticated');
        console.log('  Run "mydevices auth login" to authenticate');
        process.exit(1);
      }

      if (!isAuthenticated()) {
        error('Token expired');
        console.log('  Run "mydevices auth login" to re-authenticate');
        process.exit(1);
      }

      console.log(authConfig.accessToken);
    });

  return auth;
}
