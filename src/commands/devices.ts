import { Command } from 'commander';
import ora from 'ora';
import { apiGet, apiPost, apiPut, apiDelete } from '../lib/api.js';
import { output, success, error, header, detail, outputTable } from '../lib/output.js';
import type { Device, DeviceReading, ApiResponse, GlobalOptions, ListOptions } from '../types/index.js';

export function createDevicesCommands(): Command {
  const devices = new Command('devices').description('Manage devices (things)');

  devices
    .command('list')
    .description('List all devices')
    .option('-l, --limit <number>', 'Results per page', '20')
    .option('-p, --page <number>', 'Page number', '0')
    .option('--location-id <id>', 'Filter by location ID')
    .option('--user-id <id>', 'Filter by user ID')
    .option('--hardware-id <id>', 'Filter by hardware ID (EUI)')
    .option('--status <status>', 'Filter by status (0=active, 1=deactivated)')
    .option('--type <type>', 'Filter by thing type (devices or gateways)')
    .option('--external-id <id>', 'Filter by external ID')
    .option('--json', 'Output as JSON')
    .action(async (options: ListOptions & {
      locationId?: string;
      userId?: string;
      hardwareId?: string;
      status?: string;
      type?: string;
      externalId?: string;
    }) => {
      const spinner = ora('Fetching devices...').start();
      try {
        const params: Record<string, unknown> = {
          limit: parseInt(options.limit as unknown as string, 10),
          page: parseInt(options.page as unknown as string, 10),
        };
        if (options.locationId) params.location_id = options.locationId;
        if (options.userId) params.user_id = options.userId;
        if (options.hardwareId) params.hardware_id = options.hardwareId;
        if (options.status) params.status = options.status;
        if (options.type) params.thing_type = options.type;
        if (options.externalId) params.external_id = options.externalId;

        const response = await apiGet<ApiResponse<Device>>('/v1.0/admin/things', params);
        spinner.stop();

        const devices = response.rows || [];
        output(devices, {
          json: options.json,
          tableHeaders: ['ID', 'Name', 'Type', 'Hardware ID', 'Status'],
          tableMapper: (d: Device) => [
            d.id,
            d.thing_name,
            d.thing_type || d.sensor_type,
            d.hardware_id,
            d.status === 0 ? 'active' : 'inactive',
          ],
          footer: `Total: ${response.count || devices.length} devices`,
        });
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to fetch devices');
        process.exit(1);
      }
    });

  devices
    .command('get')
    .description('Get a device by ID')
    .argument('<id>', 'Device ID')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: GlobalOptions) => {
      const spinner = ora('Fetching device...').start();
      try {
        const device = await apiGet<Device>(`/v1.0/admin/things/${id}`);
        spinner.stop();

        if (options.json) {
          output(device, { json: true });
        } else {
          header(`Device: ${device.thing_name}`);
          detail('ID', device.id);
          detail('Cayenne ID', device.cayenne_id);
          detail('Hardware ID', device.hardware_id);
          detail('Type', device.thing_type);
          detail('Sensor Type', device.sensor_type);
          detail('Sensor Use', device.sensor_use);
          detail('Location ID', device.location_id);
          detail('Status', device.status === 0 ? 'active' : 'inactive');
          detail('Enabled', device.enabled);
          detail('Created', device.created_at);
          detail('Updated', device.updated_at);
        }
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to fetch device');
        process.exit(1);
      }
    });

  devices
    .command('create')
    .description('Create a new device')
    .requiredOption('-n, --name <name>', 'Device name')
    .option('--hardware-id <id>', 'Hardware ID (EUI)')
    .option('--location-id <id>', 'Location ID')
    .option('--device-type-id <id>', 'Device type ID')
    .option('--external-id <id>', 'External ID')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const spinner = ora('Creating device...').start();
      try {
        const data: Record<string, unknown> = { thing_name: options.name };
        if (options.hardwareId) data.hardware_id = options.hardwareId;
        if (options.locationId) data.location_id = options.locationId;
        if (options.deviceTypeId) data.device_type_id = options.deviceTypeId;
        if (options.externalId) data.external_id = options.externalId;

        const device = await apiPost<Device>('/v1.0/admin/things', data);
        spinner.stop();

        if (options.json) {
          output(device, { json: true });
        } else {
          success('Device created successfully');
          detail('ID', device.id);
        }
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to create device');
        process.exit(1);
      }
    });

  devices
    .command('update')
    .description('Update a device')
    .argument('<id>', 'Device ID')
    .option('-n, --name <name>', 'Device name')
    .option('--external-id <id>', 'External ID')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options) => {
      const spinner = ora('Updating device...').start();
      try {
        const data: Record<string, unknown> = {};
        if (options.name) data.thing_name = options.name;
        if (options.externalId) data.external_id = options.externalId;

        const device = await apiPut<Device>(`/v1.0/admin/things/${id}`, data);
        spinner.stop();

        if (options.json) {
          output(device, { json: true });
        } else {
          success('Device updated successfully');
        }
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to update device');
        process.exit(1);
      }
    });

  devices
    .command('delete')
    .description('Delete a device')
    .argument('<id>', 'Device ID')
    .action(async (id: string) => {
      const spinner = ora('Deleting device...').start();
      try {
        await apiDelete(`/v1.0/admin/things/${id}`);
        spinner.stop();
        success('Device deleted successfully');
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to delete device');
        process.exit(1);
      }
    });

  devices
    .command('count')
    .description('Get total device count')
    .option('--location-id <id>', 'Filter by location ID')
    .action(async (options: { locationId?: string }) => {
      try {
        const params: Record<string, unknown> = {};
        if (options.locationId) params.location_id = options.locationId;

        const response = await apiGet<{ count: number }>('/v1.0/admin/things/count', params);
        console.log(response.count);
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to get count');
        process.exit(1);
      }
    });

  devices
    .command('latest')
    .description('Get latest sensor readings for a device')
    .argument('<id>', 'Device ID')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: GlobalOptions) => {
      const spinner = ora('Fetching latest readings...').start();
      try {
        const readings = await apiGet<DeviceReading>(`/v1.0/admin/things/${id}/latest`);
        spinner.stop();

        if (options.json) {
          output(readings, { json: true });
        } else {
          const timestamp = readings.ts ? new Date(readings.ts).toLocaleString() : 'Unknown';
          header(`Latest Readings`);
          detail('Last reading', timestamp);
          console.log('');

          if (readings.sensors && readings.sensors.length > 0) {
            outputTable(
              ['Channel', 'Value'],
              readings.sensors.map((s) => [s.channel, s.v])
            );
          } else {
            console.log('  No sensor data available');
          }
        }
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to fetch readings');
        process.exit(1);
      }
    });

  devices
    .command('readings')
    .description('Get historical sensor readings for a device')
    .argument('<id>', 'Device ID')
    .option('--from <date>', 'Start date (ISO format)')
    .option('--to <date>', 'End date (ISO format)')
    .option('-l, --limit <number>', 'Results limit', '100')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: GlobalOptions & { from?: string; to?: string; limit?: string }) => {
      const spinner = ora('Fetching readings...').start();
      try {
        const params: Record<string, unknown> = {
          limit: parseInt(options.limit || '100', 10),
        };
        if (options.from) params.from = new Date(options.from).getTime();
        if (options.to) params.to = new Date(options.to).getTime();

        const readings = await apiGet<DeviceReading[]>(`/v1.0/admin/things/${id}/readings`, params);
        spinner.stop();

        if (options.json) {
          output(readings, { json: true });
        } else {
          if (readings.length === 0) {
            console.log('No readings found for the specified period');
            return;
          }

          // Show readings as a table
          const rows = readings.map((r) => {
            const timestamp = new Date(r.ts).toLocaleString();
            const values = r.sensors?.map((s) => `ch${s.channel}:${s.v}`).join(', ') || '-';
            return [timestamp, values];
          });

          outputTable(['Timestamp', 'Sensor Values'], rows);
          console.log(`\nTotal: ${readings.length} readings`);
        }
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to fetch readings');
        process.exit(1);
      }
    });

  devices
    .command('cmd')
    .description('Send a command to a device')
    .argument('<id>', 'Device ID')
    .requiredOption('--channel <number>', 'Channel number')
    .requiredOption('--value <value>', 'Value to send')
    .action(async (id: string, options: { channel: string; value: string }) => {
      const spinner = ora('Sending command...').start();
      try {
        const data = {
          channel: parseInt(options.channel, 10),
          value: options.value,
        };

        await apiPost(`/v1.0/admin/things/${id}/cmd`, data);
        spinner.stop();
        success('Command sent successfully');
        detail('Channel', options.channel);
        detail('Value', options.value);
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to send command');
        process.exit(1);
      }
    });

  devices
    .command('status')
    .description('Lookup device by hardware ID')
    .argument('<hardware-id>', 'Hardware ID (EUI)')
    .option('--json', 'Output as JSON')
    .action(async (hardwareId: string, options: GlobalOptions) => {
      const spinner = ora('Looking up device...').start();
      try {
        const device = await apiGet<Device>(`/v1.0/admin/things/${hardwareId}/status`);
        spinner.stop();

        if (options.json) {
          output(device, { json: true });
        } else {
          header('Device Found');
          detail('ID', device.id);
          detail('Name', device.thing_name);
          detail('Hardware ID', device.hardware_id);
          detail('Status', device.status === 0 ? 'active' : 'inactive');
          detail('Location ID', device.location_id);
        }
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Device not found');
        process.exit(1);
      }
    });

  return devices;
}
