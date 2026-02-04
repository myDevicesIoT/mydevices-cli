import { Command } from 'commander';
import ora from 'ora';
import { apiGet, apiPost, apiPut, apiDelete } from '../lib/api.js';
import { output, success, error, header, detail } from '../lib/output.js';
import type { User, ApiResponse, GlobalOptions, ListOptions } from '../types/index.js';

export function createUsersCommands(): Command {
  const users = new Command('users').description('Manage users');

  users
    .command('list')
    .description('List all users')
    .option('-l, --limit <number>', 'Results per page', '20')
    .option('-p, --page <number>', 'Page number', '0')
    .option('--email <email>', 'Filter by email')
    .option('--first-name <name>', 'Filter by first name')
    .option('--last-name <name>', 'Filter by last name')
    .option('--json', 'Output as JSON')
    .action(async (options: ListOptions & { email?: string; firstName?: string; lastName?: string }) => {
      const spinner = ora('Fetching users...').start();
      try {
        const params: Record<string, unknown> = {
          limit: parseInt(options.limit as unknown as string, 10),
          page: parseInt(options.page as unknown as string, 10),
        };
        if (options.email) params.email = options.email;
        if (options.firstName) params.firstName = options.firstName;
        if (options.lastName) params.lastName = options.lastName;

        const response = await apiGet<ApiResponse<User> | User[]>('/v1.0/admin/users', params);
        spinner.stop();

        const users = Array.isArray(response) ? response : response.rows || [];
        output(users, {
          json: options.json,
          tableHeaders: ['ID', 'Email', 'Name', 'Enabled'],
          tableMapper: (u: User) => [
            u.id,
            u.email,
            [u.firstName, u.lastName].filter(Boolean).join(' ') || '-',
            u.enabled,
          ],
          footer: `Total: ${Array.isArray(response) ? users.length : response.count || users.length} users`,
        });
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to fetch users');
        process.exit(1);
      }
    });

  users
    .command('get')
    .description('Get a user by ID')
    .argument('<id>', 'User ID')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: GlobalOptions) => {
      const spinner = ora('Fetching user...').start();
      try {
        const user = await apiGet<User>(`/v1.0/admin/users/${id}`);
        spinner.stop();

        if (options.json) {
          output(user, { json: true });
        } else {
          header(`User: ${user.email}`);
          detail('ID', user.id);
          detail('Email', user.email);
          detail('Username', user.username);
          detail('First Name', user.firstName);
          detail('Last Name', user.lastName);
          detail('Phone', user.phone_number);
          detail('Locale', user.locale);
          detail('Enabled', user.enabled);
          detail('Email Verified', user.emailVerified);
          if (user.createdTimestamp) {
            detail('Created', new Date(user.createdTimestamp).toISOString());
          }
        }
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to fetch user');
        process.exit(1);
      }
    });

  users
    .command('create')
    .description('Create a new user')
    .option('-e, --email <email>', 'User email (required unless using --data)')
    .option('--password <password>', 'User password')
    .option('--first-name <name>', 'First name')
    .option('--last-name <name>', 'Last name')
    .option('--phone <phone>', 'Phone number')
    .option('--locale <locale>', 'Locale')
    .option('--notify', 'Send notification email')
    .option('-d, --data <json>', 'JSON body (individual options override)')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        // Parse JSON data if provided
        let data: Record<string, unknown> = {};
        if (options.data) {
          try {
            data = JSON.parse(options.data);
          } catch {
            error('Invalid JSON in --data option');
            process.exit(1);
          }
        }

        // Individual options override JSON data
        if (options.email) data.email = options.email;
        if (options.password) data.password = options.password;
        if (options.firstName) data.first_name = options.firstName;
        if (options.lastName) data.last_name = options.lastName;
        if (options.phone) data.phone_number = options.phone;
        if (options.locale) data.locale = options.locale;

        // Validate required fields
        if (!data.email) {
          error('--email is required (or provide in --data)');
          process.exit(1);
        }

        const spinner = ora('Creating user...').start();
        const queryString = options.notify ? '?notify=true' : '';
        const user = await apiPost<User>(`/v1.0/admin/users${queryString}`, data);
        spinner.stop();

        if (options.json) {
          output(user, { json: true });
        } else {
          success('User created successfully');
          detail('ID', user.id);
          if (options.notify) {
            detail('Invitation email', 'sent');
          }
        }
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to create user');
        process.exit(1);
      }
    });

  users
    .command('update')
    .description('Update a user')
    .argument('<id>', 'User ID')
    .option('--first-name <name>', 'First name')
    .option('--last-name <name>', 'Last name')
    .option('--phone <phone>', 'Phone number')
    .option('--locale <locale>', 'Locale')
    .option('-d, --data <json>', 'JSON body (individual options override)')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options) => {
      try {
        // Parse JSON data if provided
        let data: Record<string, unknown> = {};
        if (options.data) {
          try {
            data = JSON.parse(options.data);
          } catch {
            error('Invalid JSON in --data option');
            process.exit(1);
          }
        }

        // Individual options override JSON data
        if (options.firstName) data.first_name = options.firstName;
        if (options.lastName) data.last_name = options.lastName;
        if (options.phone) data.phone_number = options.phone;
        if (options.locale) data.locale = options.locale;

        if (Object.keys(data).length === 0) {
          error('No fields to update. Provide --data or individual options.');
          process.exit(1);
        }

        const spinner = ora('Updating user...').start();
        const user = await apiPut<User>(`/v1.0/admin/users/${id}`, data);
        spinner.stop();

        if (options.json) {
          output(user, { json: true });
        } else {
          success('User updated successfully');
        }
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to update user');
        process.exit(1);
      }
    });

  users
    .command('delete')
    .description('Delete a user')
    .argument('<id>', 'User ID')
    .action(async (id: string) => {
      const spinner = ora('Deleting user...').start();
      try {
        await apiDelete(`/v1.0/admin/users/${id}`);
        spinner.stop();
        success('User deleted successfully');
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to delete user');
        process.exit(1);
      }
    });

  users
    .command('count')
    .description('Get total user count')
    .action(async () => {
      try {
        const response = await apiGet<{ count: number }>('/v1.0/admin/users/count');
        console.log(response.count);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to get count');
        process.exit(1);
      }
    });

  // Permissions subcommand
  const permissions = users.command('permissions').description('Manage user permissions');

  permissions
    .command('set')
    .description('Set user permissions for a location')
    .argument('<user-id>', 'User ID')
    .requiredOption('--location-id <id>', 'Location ID')
    .requiredOption('--permission <level>', 'Permission level (view or edit)')
    .action(async (userId: string, options: { locationId: string; permission: string }) => {
      const spinner = ora('Setting permissions...').start();
      try {
        const data = [
          {
            location_id: options.locationId,
            permission: options.permission,
          },
        ];

        await apiPut(`/v1.0/admin/users/${userId}/permissions`, data as unknown as Record<string, unknown>);
        spinner.stop();
        success('Permission granted');
        detail('User', userId);
        detail('Location', options.locationId);
        detail('Permission', options.permission);
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to set permissions');
        process.exit(1);
      }
    });

  permissions
    .command('delete')
    .description('Remove user permissions for a location')
    .argument('<user-id>', 'User ID')
    .requiredOption('--location-id <id>', 'Location ID')
    .action(async (userId: string, options: { locationId: string }) => {
      const spinner = ora('Removing permissions...').start();
      try {
        const data = [{ location_id: options.locationId }];

        await apiDelete(`/v1.0/admin/users/${userId}/permissions`, data as unknown as Record<string, unknown>);
        spinner.stop();
        success('Permission removed');
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to remove permissions');
        process.exit(1);
      }
    });

  return users;
}
