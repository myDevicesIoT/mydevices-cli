import { Command } from 'commander';
import ora from 'ora';
import { confirm, select } from '@inquirer/prompts';
import { apiGet, apiPost } from '../lib/api.js';
import { getConfig } from '../lib/config.js';
import { output, header, detail, success } from '../lib/output.js';
import { error } from '../lib/output.js';
import type { ApiResponse, GlobalOptions, ListOptions } from '../types/index.js';

// ============================================================================
// Types
// ============================================================================

interface GatewayMetadata {
  cert_expiration?: string;
  chirpstack_version?: string;
  dps_client_version?: string;
  eth_ip?: string;
  firmware_version?: string;
  imsi?: string;
  wwan_ip?: string;
  apn?: string;
  eui?: string;
  imei?: string;
  mac?: string;
  rssi?: string;
  serial?: string;
}

interface GatewayLocation {
  latitude: number;
  longitude: number;
}

interface GatewayDeviceType {
  id: string;
  name: string;
  manufacturer?: string;
  model?: string;
  category?: string;
}

// Gateway entry from list endpoint
interface GatewayListEntry {
  id: string;
  application_id?: string;
  paired_to_app_id?: string;
  hardware_id: string;
  network?: string;
  device_type_id?: string;
  sku?: string;
  status: string;
  paired_at?: string;
  created_at?: string;
  device_type?: GatewayDeviceType;
  attributes?: unknown[];
}

// Gateway from get endpoint (more detailed)
interface Gateway {
  id: string;
  application_id: string;
  user_id?: string;
  client_id?: string;
  hardware_id: string;
  registry_id?: string;
  device_type_id?: string;
  status: string;
  manufacturer?: string;
  model?: string;
  last_seen?: string;
  network?: string;
  location?: GatewayLocation;
  metadata?: GatewayMetadata;
}

interface GatewayResponse {
  gateway: Gateway;
  lastSeenAt?: string;
}

// Pings histogram
interface PingHistogramEntry {
  timestamp: number;
  count: number;
}

interface PingHistogramResponse {
  histogram: PingHistogramEntry[];
}

// Gateway stats
interface GatewayStatsEntry {
  timestamp: string;
  rxPacketsReceived: number;
  rxPacketsReceivedOK: number;
  txPacketsReceived: number;
  txPacketsEmitted: number;
  txPacketsPerFrequency?: Record<string, number>;
  rxPacketsPerFrequency?: Record<string, number>;
  txPacketsPerDr?: Record<string, number>;
  rxPacketsPerDr?: Record<string, number>;
  txPacketsPerStatus?: Record<string, number>;
}

interface GatewayStatsResponse {
  result: GatewayStatsEntry[];
}

// Software update artifact from latest.json
interface SoftwareArtifact {
  url: string;
  checksum: string;
  version: string;
}

type ArtifactManifest = Record<string, Record<string, SoftwareArtifact>>;

// ============================================================================
// Helper Functions
// ============================================================================

function getGatewaysPath(): string {
  const clientId = getConfig('clientId');
  return `/v1.1/organizations/${clientId}/applications/${clientId}/gateways`;
}

function normalizeHardwareId(id: string): string {
  return id.startsWith('eui-') ? id : `eui-${id}`;
}

function formatStatus(status: string): string {
  switch (status?.toUpperCase()) {
    case 'ACTIVATED':
      return 'activated';
    case 'PENDING':
      return 'pending';
    case 'OFFLINE':
      return 'offline';
    default:
      return status?.toLowerCase() || '-';
  }
}

function formatLastSeen(lastSeen?: string, lastSeenAt?: string): string {
  if (lastSeenAt) {
    return new Date(lastSeenAt).toLocaleString();
  }
  if (lastSeen) {
    // Unix timestamp in seconds
    const ts = parseInt(lastSeen, 10);
    if (!isNaN(ts)) {
      return new Date(ts * 1000).toLocaleString();
    }
  }
  return '-';
}

// ============================================================================
// Main Gateways Command
// ============================================================================

export function createGatewaysCommands(): Command {
  const gateways = new Command('gateways').description('View gateway information');

  // --------------------------------------------------------------------------
  // gateways list
  // --------------------------------------------------------------------------
  gateways
    .command('list')
    .description('List gateways')
    .option('-l, --limit <number>', 'Results per page', '20')
    .option('-p, --page <number>', 'Page number', '0')
    .option('--status <status>', 'Filter by status')
    .option('--network <network>', 'Filter by network')
    .option('--filter <expression>', 'Raw filter expression')
    .option('--json', 'Output as JSON')
    .action(async (options: ListOptions & {
      status?: string;
      network?: string;
      filter?: string;
    }) => {
      const spinner = ora('Fetching gateways...').start();
      try {
        const params: Record<string, unknown> = {
          limit: parseInt(options.limit as unknown as string, 10),
          page: parseInt(options.page as unknown as string, 10),
        };

        // Build filter expression
        const filters: string[] = [];
        if (options.status) filters.push(`status eq ${options.status.toUpperCase()}`);
        if (options.network) filters.push(`network eq ${options.network}`);
        if (options.filter) filters.push(options.filter);

        if (filters.length > 0) {
          params.filter = filters.join(',');
        }

        const response = await apiGet<ApiResponse<GatewayListEntry>>(getGatewaysPath(), params);
        spinner.stop();

        const gatewayList = response.rows || [];
        output(gatewayList, {
          json: options.json,
          tableHeaders: ['Hardware ID', 'Status', 'Device Type', 'Network', 'Created'],
          tableMapper: (g: GatewayListEntry) => [
            g.hardware_id,
            formatStatus(g.status),
            g.device_type?.name || '-',
            g.network || '-',
            g.created_at ? new Date(g.created_at).toLocaleDateString() : '-',
          ],
          footer: `Total: ${response.count || gatewayList.length} gateways`,
        });
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to fetch gateways');
        process.exit(1);
      }
    });

  // --------------------------------------------------------------------------
  // gateways get
  // --------------------------------------------------------------------------
  gateways
    .command('get')
    .description('Get gateway details by hardware ID')
    .argument('<hardware-id>', 'Gateway hardware ID (e.g., eui-647fdafffe01433c)')
    .option('--json', 'Output as JSON')
    .action(async (hardwareId: string, options: GlobalOptions) => {
      hardwareId = normalizeHardwareId(hardwareId);
      const spinner = ora('Fetching gateway...').start();
      try {
        const response = await apiGet<GatewayResponse>(`${getGatewaysPath()}/${hardwareId}`);
        spinner.stop();

        const gateway = response.gateway;

        if (options.json) {
          output(response, { json: true });
        } else {
          header(`Gateway: ${gateway.hardware_id}`);
          detail('ID', gateway.id);
          detail('Hardware ID', gateway.hardware_id);
          detail('Status', formatStatus(gateway.status));
          detail('Network', gateway.network);
          detail('Last Seen', formatLastSeen(gateway.last_seen, response.lastSeenAt));
          detail('Registry ID', gateway.registry_id);
          detail('Application ID', gateway.application_id);

          if (gateway.location && (gateway.location.latitude !== 0 || gateway.location.longitude !== 0)) {
            detail('Location', `${gateway.location.latitude}, ${gateway.location.longitude}`);
          }

          if (gateway.metadata) {
            console.log('');
            header('Metadata');
            const meta = gateway.metadata;
            detail('EUI', meta.eui);
            detail('MAC', meta.mac);
            detail('Serial', meta.serial);
            detail('Firmware', meta.firmware_version?.trim());
            detail('Ethernet IP', meta.eth_ip);
            detail('Cellular IP', meta.wwan_ip || undefined);
            detail('IMEI', meta.imei);
            detail('IMSI', meta.imsi !== 'UNAVAILABLE' ? meta.imsi : undefined);
            detail('APN', meta.apn || undefined);
            detail('RSSI', meta.rssi ? `${meta.rssi} dBm` : undefined);
            detail('ChirpStack Version', meta.chirpstack_version);
            detail('DPS Client Version', meta.dps_client_version);
            detail('Cert Expiration', meta.cert_expiration);
          }
        }
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to fetch gateway');
        process.exit(1);
      }
    });

  // --------------------------------------------------------------------------
  // gateways pings
  // --------------------------------------------------------------------------
  gateways
    .command('pings')
    .description('Show gateway keepalive ping histogram')
    .argument('<hardware-id>', 'Gateway hardware ID')
    .option('--start <timestamp>', 'Start time (Unix timestamp or ISO date)')
    .option('--end <timestamp>', 'End time (Unix timestamp or ISO date)')
    .option('--hours <hours>', 'Show last N hours (default: 24)', '24')
    .option('--timezone <tz>', 'Timezone (e.g., America/Los_Angeles)', Intl.DateTimeFormat().resolvedOptions().timeZone)
    .option('--json', 'Output as JSON')
    .action(async (hardwareId: string, options: GlobalOptions & {
      start?: string;
      end?: string;
      hours?: string;
      timezone?: string;
    }) => {
      hardwareId = normalizeHardwareId(hardwareId);
      const spinner = ora('Fetching ping histogram...').start();
      try {
        let startTime: number;
        let endTime: number;

        if (options.start && options.end) {
          // Parse provided times
          startTime = isNaN(Number(options.start))
            ? Math.floor(new Date(options.start).getTime() / 1000)
            : Number(options.start);
          endTime = isNaN(Number(options.end))
            ? Math.floor(new Date(options.end).getTime() / 1000)
            : Number(options.end);
        } else {
          // Default to last N hours
          const hours = parseInt(options.hours || '24', 10);
          endTime = Math.floor(Date.now() / 1000);
          startTime = endTime - (hours * 60 * 60);
        }

        const params: Record<string, unknown> = {
          startTime,
          endTime,
          timezone: options.timezone,
        };

        const response = await apiGet<PingHistogramResponse>(
          `${getGatewaysPath()}/${hardwareId}/pings/histogram`,
          params
        );
        spinner.stop();

        const histogram = response.histogram || [];

        if (options.json) {
          output(response, { json: true });
        } else {
          header(`Ping Histogram: ${hardwareId}`);
          console.log(`Period: ${new Date(startTime * 1000).toLocaleString()} - ${new Date(endTime * 1000).toLocaleString()}`);
          console.log(`Timezone: ${options.timezone}`);
          console.log('');

          if (histogram.length === 0) {
            console.log('No ping data available for this period.');
          } else {
            // Find max count for scaling
            const maxCount = Math.max(...histogram.map(h => h.count));
            const barWidth = 40;

            histogram.forEach((entry) => {
              const date = new Date(entry.timestamp * 1000);
              const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              const barLength = Math.round((entry.count / maxCount) * barWidth);
              const bar = '█'.repeat(barLength) + '░'.repeat(barWidth - barLength);
              console.log(`${timeStr} │${bar}│ ${entry.count}`);
            });

            console.log('');
            const totalPings = histogram.reduce((sum, h) => sum + h.count, 0);
            const avgPings = Math.round(totalPings / histogram.length);
            detail('Total Pings', totalPings);
            detail('Average per Period', avgPings);
          }
        }
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to fetch ping histogram');
        process.exit(1);
      }
    });

  // --------------------------------------------------------------------------
  // gateways stats
  // --------------------------------------------------------------------------
  gateways
    .command('stats')
    .description('Show gateway packet statistics')
    .argument('<hardware-id>', 'Gateway hardware ID')
    .option('--json', 'Output as JSON')
    .action(async (hardwareId: string, options: GlobalOptions) => {
      hardwareId = normalizeHardwareId(hardwareId);
      const spinner = ora('Fetching gateway stats...').start();
      try {
        const response = await apiGet<GatewayStatsResponse>(
          `${getGatewaysPath()}/${hardwareId}/stats`
        );
        spinner.stop();

        const stats = response.result || [];

        if (options.json) {
          output(response, { json: true });
        } else {
          header(`Gateway Stats: ${hardwareId}`);

          if (stats.length === 0) {
            console.log('No statistics available.');
          } else {
            // Show summary table
            console.log('');
            console.log('Daily Packet Summary:');
            console.log('─'.repeat(80));
            console.log(
              'Date'.padEnd(12) +
              'RX Received'.padStart(14) +
              'RX OK'.padStart(12) +
              'TX Received'.padStart(14) +
              'TX Emitted'.padStart(14) +
              'Success %'.padStart(12)
            );
            console.log('─'.repeat(80));

            stats.forEach((day) => {
              const date = new Date(day.timestamp).toLocaleDateString();
              const successRate = day.rxPacketsReceived > 0
                ? ((day.rxPacketsReceivedOK / day.rxPacketsReceived) * 100).toFixed(1)
                : '0.0';

              console.log(
                date.padEnd(12) +
                day.rxPacketsReceived.toLocaleString().padStart(14) +
                day.rxPacketsReceivedOK.toLocaleString().padStart(12) +
                day.txPacketsReceived.toLocaleString().padStart(14) +
                day.txPacketsEmitted.toLocaleString().padStart(14) +
                `${successRate}%`.padStart(12)
              );
            });

            console.log('─'.repeat(80));

            // Totals
            const totals = stats.reduce(
              (acc, day) => ({
                rxReceived: acc.rxReceived + day.rxPacketsReceived,
                rxOK: acc.rxOK + day.rxPacketsReceivedOK,
                txReceived: acc.txReceived + day.txPacketsReceived,
                txEmitted: acc.txEmitted + day.txPacketsEmitted,
              }),
              { rxReceived: 0, rxOK: 0, txReceived: 0, txEmitted: 0 }
            );

            const totalSuccessRate = totals.rxReceived > 0
              ? ((totals.rxOK / totals.rxReceived) * 100).toFixed(1)
              : '0.0';

            console.log(
              'TOTAL'.padEnd(12) +
              totals.rxReceived.toLocaleString().padStart(14) +
              totals.rxOK.toLocaleString().padStart(12) +
              totals.txReceived.toLocaleString().padStart(14) +
              totals.txEmitted.toLocaleString().padStart(14) +
              `${totalSuccessRate}%`.padStart(12)
            );

            // Show frequency distribution for last day if available
            const lastDay = stats[stats.length - 1];
            if (lastDay.rxPacketsPerFrequency && Object.keys(lastDay.rxPacketsPerFrequency).length > 0) {
              console.log('');
              header('RX Packets by Frequency (Latest Day)');
              Object.entries(lastDay.rxPacketsPerFrequency)
                .sort(([a], [b]) => Number(a) - Number(b))
                .forEach(([freq, count]) => {
                  const freqMHz = (Number(freq) / 1000000).toFixed(1);
                  console.log(`  ${freqMHz} MHz: ${count.toLocaleString()}`);
                });
            }

            if (lastDay.rxPacketsPerDr && Object.keys(lastDay.rxPacketsPerDr).length > 0) {
              console.log('');
              header('RX Packets by Data Rate (Latest Day)');
              Object.entries(lastDay.rxPacketsPerDr)
                .sort(([a], [b]) => Number(a) - Number(b))
                .forEach(([dr, count]) => {
                  console.log(`  DR${dr}: ${count.toLocaleString()}`);
                });
            }
          }
        }
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to fetch gateway stats');
        process.exit(1);
      }
    });

  // --------------------------------------------------------------------------
  // gateways reboot
  // --------------------------------------------------------------------------
  gateways
    .command('reboot')
    .description('Reboot a gateway')
    .argument('<hardware-id>', 'Gateway hardware ID (e.g., eui-647fdafffe01433c)')
    .option('-y, --yes', 'Skip confirmation prompt')
    .option('--json', 'Output as JSON')
    .action(async (hardwareId: string, options: GlobalOptions & { yes?: boolean }) => {
      hardwareId = normalizeHardwareId(hardwareId);
      try {
        if (!options.yes) {
          const confirmed = await confirm({
            message: `Are you sure you want to reboot gateway ${hardwareId}?`,
            default: false,
          });
          if (!confirmed) {
            console.log('Reboot cancelled.');
            return;
          }
        }

        const spinner = ora(`Sending reboot command to ${hardwareId}...`).start();
        const response = await apiPost<Record<string, unknown>>(
          `${getGatewaysPath()}/${hardwareId}/commands`,
          { command: 'reboot' }
        );
        spinner.stop();

        if (options.json) {
          output(response, { json: true });
        } else {
          success(`Reboot command sent to gateway ${hardwareId}`);
        }
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to send reboot command');
        process.exit(1);
      }
    });

  // --------------------------------------------------------------------------
  // gateways update-software
  // --------------------------------------------------------------------------
  gateways
    .command('update-software')
    .description('Update software on a gateway')
    .argument('<hardware-id>', 'Gateway hardware ID (e.g., eui-647fdafffe01433c)')
    .option('--json', 'Output as JSON')
    .action(async (hardwareId: string, options: GlobalOptions) => {
      hardwareId = normalizeHardwareId(hardwareId);
      try {
        const spinner = ora('Fetching available updates...').start();
        const res = await fetch('https://docs.mydevices.com/artifacts/latest.json');
        if (!res.ok) {
          spinner.stop();
          error(`Failed to fetch update manifest: ${res.statusText}`);
          process.exit(1);
        }
        const manifest: ArtifactManifest = await res.json() as ArtifactManifest;
        spinner.stop();

        // Build choices from manifest
        const choices: { name: string; value: { gateway: string; software: string; artifact: SoftwareArtifact } }[] = [];
        for (const [gateway, packages] of Object.entries(manifest)) {
          for (const [software, artifact] of Object.entries(packages)) {
            choices.push({
              name: `${gateway} - ${software} ${artifact.version}`,
              value: { gateway, software, artifact },
            });
          }
        }

        const selected = await select({
          message: 'Select software to install:',
          choices,
        });

        const confirmed = await confirm({
          message: `Update ${selected.software} ${selected.artifact.version} (${selected.gateway}) on ${hardwareId}?`,
          default: false,
        });

        if (!confirmed) {
          console.log('Update cancelled.');
          return;
        }

        const updateSpinner = ora(`Sending update command to ${hardwareId}...`).start();
        const response = await apiPost<Record<string, unknown>>(
          `${getGatewaysPath()}/${hardwareId}/commands`,
          {
            command: 'update',
            options: {
              update_url: selected.artifact.url,
              update_checksum: selected.artifact.checksum,
            },
          }
        );
        updateSpinner.stop();

        if (options.json) {
          output(response, { json: true });
        } else {
          success(`Update command sent to gateway ${hardwareId}`);
          detail('Software', `${selected.software} ${selected.artifact.version}`);
          detail('Gateway Type', selected.gateway);
        }
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to send update command');
        process.exit(1);
      }
    });

  // --------------------------------------------------------------------------
  // gateways migrate-provider
  // --------------------------------------------------------------------------
  gateways
    .command('migrate-provider')
    .description('Migrate a gateway to a different provider')
    .argument('<hardware-id>', 'Gateway hardware ID (e.g., eui-647fdafffe01433c)')
    .option('-p, --provider <provider>', 'Target provider (azure or mydevices)')
    .option('-y, --yes', 'Skip confirmation prompt')
    .option('--json', 'Output as JSON')
    .action(async (hardwareId: string, options: GlobalOptions & { provider?: string; yes?: boolean }) => {
      hardwareId = normalizeHardwareId(hardwareId);

      let provider = options.provider;
      if (!provider) {
        provider = (await select({
          message: 'Select target provider:',
          choices: [
            { name: 'azure', value: 'azure' },
            { name: 'mydevices', value: 'mydevices' },
          ],
        })) as string;
      }

      if (provider !== 'azure' && provider !== 'mydevices') {
        error(`Invalid provider "${provider}". Must be "azure" or "mydevices".`);
        process.exit(1);
      }

      try {
        if (!options.yes) {
          const confirmed = await confirm({
            message: `Are you sure you want to migrate gateway ${hardwareId} to provider "${provider}"?`,
            default: false,
          });
          if (!confirmed) {
            console.log('Migration cancelled.');
            return;
          }
        }

        const spinner = ora(`Migrating ${hardwareId} to provider "${provider}"...`).start();
        const response = await apiPost<Record<string, unknown>>(
          `${getGatewaysPath()}/${hardwareId}/migrate-provider`,
          { provider }
        );
        spinner.stop();

        if (options.json) {
          output(response, { json: true });
        } else {
          success(`Gateway ${hardwareId} migrated to provider "${provider}"`);
        }
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to migrate gateway provider');
        process.exit(1);
      }
    });

  return gateways;
}
