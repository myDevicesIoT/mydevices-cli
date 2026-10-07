import { Command } from 'commander';
import { randomBytes } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { v1 as uuidv1 } from 'uuid';
import chalk from 'chalk';
import ora from 'ora';
import { parseCSV, getDelimiterName } from '../lib/csv-parser.js';
import { readIdList } from '../lib/eui-list.js';
import { createBulkGatewaysCommand } from './bulk-gateways.js';
import {
  interactiveMapping,
  loadMapping,
  saveMapping,
  displayMappingSummary,
  validateMapping,
  promptSaveMapping,
  promptLocationDefaults,
  type ColumnMapping,
  type HierarchyMapping,
  type MappingResult,
  type LocationDefaults,
} from '../lib/column-mapper.js';
import {
  transformRows,
  bulkImport,
  displayImportSummary,
  fetchDeviceType,
  extractFormSettings,
  promptFormSettings,
} from '../lib/bulk-import.js';
import { apiDelete, apiGet, apiPut } from '../lib/api.js';
import { getConfig } from '../lib/config.js';
import { error, success } from '../lib/output.js';
import {
  validateUpdateRows,
  buildLocationIndex,
  buildUpdatePlan,
  type DeviceLite,
  type LocationLite,
  type PlanEntry,
} from '../lib/bulk-update.js';
import type { ApiResponse, Device } from '../types/index.js';

export function createBulkCommands(): Command {
  const bulk = new Command('bulk').description('Bulk operations for importing and managing data');

  bulk
    .command('import')
    .description('Import locations and devices from a CSV file')
    .argument('<csv-file>', 'Path to CSV file')
    .option('--user <user-id>', 'Target user ID (admin mode)')
    .option('--company <company-id>', 'Target company ID')
    .option('--dry-run', 'Validate without making changes')
    .option('--mapping <file>', 'Use saved column mapping file')
    .option('--save-mapping <file>', 'Save mapping to file after import')
    .option('--delimiter <char>', 'Force CSV delimiter (auto-detect by default)')
    .option('--location-address <address>', 'Default address for all locations')
    .option('--location-city <city>', 'Default city for all locations')
    .option('--location-state <state>', 'Default state for all locations')
    .option('--location-country <country>', 'Default country for all locations')
    .option('--location-zip <zip>', 'Default ZIP code for all locations')
    .option('--location-industry <industry>', 'Default industry for all locations')
    .option('--no-location-prefix', 'Use raw row values as location names instead of "ColumnName Value"')
    .option('--device-type-id <id>', 'Default device type/template ID for all devices')
    .option('--sensor-use <use>', 'Default sensor use for all devices')
    .option('--device-setting <key=value>', 'Device settings from form_settings (repeatable, e.g. --device-setting codec.timezone=UTC --device-setting codec.cost=1)', (val: string, prev: string[]) => { prev.push(val); return prev; }, [] as string[])
    .option('--json', 'Output results as JSON')
    .option('--output <file>', 'Save detailed results to file')
    .action(async (csvFile: string, options) => {
      // Validate CSV file exists
      if (!existsSync(csvFile)) {
        error(`CSV file not found: ${csvFile}`);
        process.exit(1);
      }

      // Parse CSV
      const spinner = ora('Parsing CSV file...').start();
      let parsedCSV;
      try {
        parsedCSV = parseCSV(csvFile, options.delimiter);
        spinner.succeed(
          `Parsed ${parsedCSV.rows.length} rows with ${parsedCSV.headers.length} columns ` +
          `(delimiter: ${getDelimiterName(parsedCSV.delimiter)})`
        );
      } catch (err) {
        spinner.fail('Failed to parse CSV');
        error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }

      // Display columns found
      console.log(chalk.cyan('\nColumns found:'));
      parsedCSV.headers.forEach((col, i) => {
        console.log(chalk.gray(`  ${i + 1}. ${col}`));
      });

      // Get column mapping
      let mappings: ColumnMapping;
      let hierarchy: HierarchyMapping;

      if (options.mapping) {
        // Load from file
        try {
          const result = loadMapping(options.mapping);
          mappings = result.mappings;
          hierarchy = result.hierarchy;
          console.log(chalk.green(`\n✓ Loaded mapping from ${options.mapping}`));
          displayMappingSummary(mappings, hierarchy);
        } catch (err) {
          error(err instanceof Error ? err.message : 'Failed to load mapping');
          process.exit(1);
        }
      } else {
        // Interactive mapping
        const result = await interactiveMapping(parsedCSV.headers);
        mappings = result.mappings;
        hierarchy = result.hierarchy;
        displayMappingSummary(mappings, hierarchy);
      }

      // Validate mapping
      const validation = validateMapping(mappings, hierarchy);
      if (!validation.valid) {
        console.log();
        for (const err of validation.errors) {
          error(err);
        }
        process.exit(1);
      }

      // Validate required options
      if (!options.company) {
        error('--company <company-id> is required when creating locations');
        process.exit(1);
      }

      // Optionally save mapping
      if (options.saveMapping) {
        saveMapping(options.saveMapping, mappings, hierarchy);
        console.log(chalk.green(`\n✓ Mapping saved to ${options.saveMapping}`));
      } else if (!options.mapping) {
        // Prompt to save if not loaded from file
        await promptSaveMapping(mappings, hierarchy);
      }

      // Get location defaults - use CLI flags or prompt interactively
      let locationDefaults: LocationDefaults = {};
      const hasCliDefaults = options.locationAddress || options.locationCity ||
                             options.locationState || options.locationCountry ||
                             options.locationZip || options.locationIndustry;

      if (hasCliDefaults) {
        // Use CLI-provided defaults
        locationDefaults = {
          address: options.locationAddress,
          city: options.locationCity,
          state: options.locationState,
          country: options.locationCountry,
          zip: options.locationZip,
          industry: options.locationIndustry,
        };
      } else {
        // Prompt for defaults interactively
        locationDefaults = await promptLocationDefaults(mappings);
      }

      // Transform rows
      const transformedRows = transformRows(parsedCSV.rows, mappings, hierarchy);

      // Apply device defaults (CLI flags fill in when CSV doesn't provide a value)
      if (options.deviceTypeId || options.sensorUse) {
        for (const row of transformedRows) {
          if (!row.device.hardware_id) continue;
          if (options.deviceTypeId && !row.device.device_type_id) {
            row.device.device_type_id = options.deviceTypeId;
          }
          if (options.sensorUse && !row.device.sensor_use) {
            row.device.sensor_use = options.sensorUse;
          }
        }
      }

      // Fetch device type and handle form_settings
      let deviceSettings: Record<string, string> = {};

      if (options.deviceTypeId) {
        // Parse --device-setting flags into a Record
        const cliSettings: Record<string, string> = {};
        if (options.deviceSetting && options.deviceSetting.length > 0) {
          for (const setting of options.deviceSetting) {
            const eqIndex = setting.indexOf('=');
            if (eqIndex > 0) {
              const key = setting.substring(0, eqIndex);
              const value = setting.substring(eqIndex + 1);
              cliSettings[key] = value;
            } else {
              error(`Invalid --device-setting format: "${setting}". Expected key=value`);
              process.exit(1);
            }
          }
        }

        // Fetch device type template
        const templateSpinner = ora('Fetching device type template...').start();
        try {
          const template = await fetchDeviceType(options.deviceTypeId);
          templateSpinner.succeed(`Device type: ${template.name}`);

          // Extract and prompt for form_settings
          const formFields = extractFormSettings(template);
          if (formFields.length > 0) {
            deviceSettings = await promptFormSettings(formFields, cliSettings);
            console.log(chalk.green(`\n✓ ${Object.keys(deviceSettings).length} device settings configured`));
          }
        } catch (err) {
          templateSpinner.fail('Failed to fetch device type template');
          error(err instanceof Error ? err.message : 'Unknown error');
          process.exit(1);
        }
      }

      // Confirm import
      if (!options.dryRun) {
        const { confirm } = await import('@inquirer/prompts');
        const proceed = await confirm({
          message: `Import ${transformedRows.length} rows${options.user ? ` to user ${options.user}` : ''}?`,
          default: true,
        });

        if (!proceed) {
          console.log(chalk.yellow('Import cancelled'));
          process.exit(0);
        }
      }

      // Run import
      console.log();
      const importSpinner = ora(
        options.dryRun ? 'Running dry-run validation...' : 'Importing data...'
      ).start();

      try {
        const summary = await bulkImport(transformedRows, {
          userId: options.user,
          companyId: options.company ? parseInt(options.company, 10) : undefined,
          dryRun: options.dryRun,
          locationDefaults,
          deviceTypeId: options.deviceTypeId,
          deviceSettings,
          prefixLocationName: options.locationPrefix !== false,
          onProgress: (current, total, message) => {
            importSpinner.text = `${message} (${current}/${total})`;
          },
        });

        importSpinner.stop();

        // Output results
        if (options.json) {
          console.log(JSON.stringify(summary, null, 2));
        } else {
          displayImportSummary(summary, options.dryRun || false);
        }

        // Save results to file
        if (options.output) {
          const outputData = {
            timestamp: new Date().toISOString(),
            csvFile,
            dryRun: options.dryRun || false,
            summary: {
              locationsCreated: summary.locationsCreated,
              locationsMatched: summary.locationsMatched,
              locationsFailed: summary.locationsFailed,
              devicesCreated: summary.devicesCreated,
              devicesMatched: summary.devicesMatched,
              devicesFailed: summary.devicesFailed,
            },
            results: summary.results,
          };

          writeFileSync(options.output, JSON.stringify(outputData, null, 2));
          console.log(chalk.green(`\n✓ Results saved to ${options.output}`));
        }

        // Exit with error code if there were failures
        if (summary.locationsFailed > 0 || summary.devicesFailed > 0) {
          process.exit(1);
        }
      } catch (err) {
        importSpinner.fail('Import failed');
        error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
    });

  bulk
    .command('update')
    .description('Update devices (name, external ID, room) from a CSV file')
    .argument('<csv-file>', 'CSV with a lookup column plus new_external_id / new_name / new_room columns')
    .option('--lookup-by <field>', 'Device field to match rows on: external_id or hardware_id', 'external_id')
    .option('--delimiter <char>', 'Force CSV delimiter (auto-detect by default)')
    .option('--dry-run', 'Show the update plan without making changes')
    .option('--json', 'Output results as JSON')
    .option('--output <file>', 'Save detailed results to file')
    .action(async (csvFile: string, options: {
      lookupBy: string;
      delimiter?: string;
      dryRun?: boolean;
      json?: boolean;
      output?: string;
    }) => {
      if (!existsSync(csvFile)) {
        error(`CSV file not found: ${csvFile}`);
        process.exit(1);
      }
      if (options.lookupBy !== 'external_id' && options.lookupBy !== 'hardware_id') {
        error(`Invalid --lookup-by "${options.lookupBy}". Use external_id or hardware_id.`);
        process.exit(1);
      }

      // Parse CSV
      const spinner = ora('Parsing CSV file...').start();
      let parsedCSV;
      try {
        parsedCSV = parseCSV(csvFile, options.delimiter);
        spinner.succeed(
          `Parsed ${parsedCSV.rows.length} rows with ${parsedCSV.headers.length} columns ` +
          `(delimiter: ${getDelimiterName(parsedCSV.delimiter)})`
        );
      } catch (err) {
        spinner.fail('Failed to parse CSV');
        error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }

      if (!parsedCSV.headers.includes(options.lookupBy)) {
        error(
          `Lookup column "${options.lookupBy}" not found in CSV. ` +
          `Available columns: ${parsedCSV.headers.join(', ')}`
        );
        process.exit(1);
      }

      // Validate rows — strict: any bad row aborts before we touch the API
      const { valid: rows, errors: rowErrors } = validateUpdateRows(parsedCSV.rows, options.lookupBy);
      if (rowErrors.length > 0) {
        console.log();
        for (const e of rowErrors) {
          error(`Row ${e.rowNumber}: ${e.error}`);
        }
        process.exit(1);
      }
      if (rows.length === 0) {
        error('No update rows found in CSV');
        process.exit(1);
      }

      // Fetch all locations (only needed if any row moves rooms, but cheap enough to always index)
      const locSpinner = ora('Fetching locations...').start();
      const allLocations: LocationLite[] = [];
      try {
        let page = 0;
        const limit = 100;
        while (true) {
          const response = await apiGet<{ count: number; rows: LocationLite[] }>(
            '/v1.0/admin/locations',
            { limit, page }
          );
          allLocations.push(...response.rows);
          if (allLocations.length >= response.count || response.rows.length < limit) break;
          page++;
        }
        locSpinner.succeed(`Fetched ${allLocations.length} locations`);
      } catch (err) {
        locSpinner.fail('Failed to fetch locations');
        error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }
      const locationIndex = buildLocationIndex(allLocations);

      // Look up each device by the lookup field
      const deviceMap = new Map<string, DeviceLite[]>();
      const lookupValues = [...new Set(rows.map((r) => r.lookupValue))];
      const devSpinner = ora('Looking up devices...').start();
      try {
        for (let i = 0; i < lookupValues.length; i++) {
          const value = lookupValues[i];
          devSpinner.text = `Looking up devices ${i + 1}/${lookupValues.length} (${value})`;
          const response = await apiGet<ApiResponse<Device>>('/v1.0/admin/things', {
            [options.lookupBy]: value,
            limit: 5,
          });
          deviceMap.set(value, (response.rows || []) as unknown as DeviceLite[]);
        }
        devSpinner.succeed(`Looked up ${lookupValues.length} devices`);
      } catch (err) {
        devSpinner.fail('Device lookup failed');
        error(err instanceof Error ? err.message : 'Unknown error');
        process.exit(1);
      }

      // Build and display the plan
      const plan = buildUpdatePlan(rows, deviceMap, locationIndex);
      const ready = plan.filter((p) => p.status === 'ready');
      const noops = plan.filter((p) => p.status === 'noop');
      const planErrors = plan.filter((p) => p.status === 'error');

      const describeChanges = (entry: PlanEntry): string => {
        const parts: string[] = [];
        if (entry.changes.thing_name !== undefined) {
          parts.push(`name: ${entry.device?.thing_name} → ${entry.changes.thing_name}`);
        }
        if (entry.changes.external_id !== undefined) {
          parts.push(`external_id: ${entry.device?.external_id ?? '(none)'} → ${entry.changes.external_id}`);
        }
        if (entry.changes.location_id !== undefined) {
          const from = entry.device?.location_id
            ? locationIndex.pathOf(Number(entry.device.location_id))
            : '(none)';
          parts.push(`room: ${from} → ${entry.targetRoomPath}`);
        }
        return parts.join(', ');
      };

      if (!options.json) {
        console.log();
        for (const entry of plan) {
          if (entry.status === 'ready') {
            console.log(`  ${chalk.green('✓')} Row ${entry.rowNumber} ${entry.lookupValue}: ${describeChanges(entry)}`);
          } else if (entry.status === 'noop') {
            console.log(chalk.gray(`  - Row ${entry.rowNumber} ${entry.lookupValue}: already up to date`));
          } else {
            console.log(`  ${chalk.red('✗')} Row ${entry.rowNumber} ${entry.lookupValue}: ${entry.error}`);
          }
        }
        console.log();
        console.log(chalk.cyan('Plan Summary'));
        console.log(chalk.gray('─'.repeat(40)));
        console.log(`To update:   ${chalk.green(String(ready.length))}`);
        console.log(`Up to date:  ${chalk.blue(String(noops.length))}`);
        console.log(`Errors:      ${chalk.red(String(planErrors.length))}`);
        console.log(chalk.gray('─'.repeat(40)));
      }

      // Apply (unless dry run)
      const results: { lookupValue: string; deviceId?: number | string; success: boolean; error?: string }[] = [];
      let updated = 0;
      let failed = 0;

      if (!options.dryRun && ready.length > 0) {
        const { confirm } = await import('@inquirer/prompts');
        const proceed = await confirm({
          message: `Apply ${ready.length} device updates?${planErrors.length > 0 ? ` (${planErrors.length} error rows will be skipped)` : ''}`,
          default: false,
        });
        if (!proceed) {
          console.log(chalk.yellow('Update cancelled'));
          process.exit(0);
        }

        const applySpinner = ora('Applying updates...').start();
        for (let i = 0; i < ready.length; i++) {
          const entry = ready[i];
          applySpinner.text = `Updating ${i + 1}/${ready.length} (${entry.lookupValue})`;
          try {
            await apiPut(`/v1.0/admin/things/${entry.device!.id}`, { ...entry.changes });
            results.push({ lookupValue: entry.lookupValue, deviceId: entry.device!.id, success: true });
            updated++;
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            results.push({ lookupValue: entry.lookupValue, deviceId: entry.device!.id, success: false, error: message });
            failed++;
          }
        }
        applySpinner.stop();

        if (!options.json) {
          console.log();
          console.log(chalk.cyan('Update Complete'));
          console.log(chalk.gray('─'.repeat(40)));
          console.log(`Updated: ${chalk.green(String(updated))}`);
          console.log(`Failed:  ${chalk.red(String(failed))}`);
          const failures = results.filter((r) => !r.success);
          if (failures.length > 0) {
            console.log();
            console.log(chalk.red('Failed updates:'));
            for (const f of failures) {
              console.log(`  ${f.lookupValue} - ${f.error}`);
            }
          }
          console.log(chalk.gray('─'.repeat(40)));
        }
      } else if (!options.json && options.dryRun) {
        console.log(chalk.yellow('\nDry run — no changes applied'));
      }

      const outputData = {
        timestamp: new Date().toISOString(),
        csvFile,
        dryRun: options.dryRun || false,
        lookupBy: options.lookupBy,
        summary: {
          ready: ready.length,
          upToDate: noops.length,
          planErrors: planErrors.length,
          updated,
          failed,
        },
        plan,
        results,
      };

      if (options.json) {
        console.log(JSON.stringify(outputData, null, 2));
      }
      if (options.output) {
        writeFileSync(options.output, JSON.stringify(outputData, null, 2));
        success(`Results saved to ${options.output}`);
      }

      if (planErrors.length > 0 || failed > 0) {
        process.exit(1);
      }
    });

  bulk
    .command('deactivate')
    .description('Deactivate (unpair) devices from a CSV file of hardware IDs (EUIs)')
    .argument('<csv-file>', 'Path to CSV file containing hardware IDs')
    .option('--column <name>', 'CSV column containing hardware IDs (auto-detected if not specified)')
    .option('--delimiter <char>', 'Force CSV delimiter (auto-detect by default)')
    .option('--dry-run', 'Show what would be deactivated without making changes')
    .option('--json', 'Output results as JSON')
    .option('--output <file>', 'Save detailed results to file')
    .action(async (csvFile: string, options: {
      column?: string;
      delimiter?: string;
      dryRun?: boolean;
      json?: boolean;
      output?: string;
    }) => {
      let euis: string[];
      let euiColumn: string;
      try {
        const list = readIdList(csvFile, { column: options.column, delimiter: options.delimiter });
        euis = list.ids;
        euiColumn = list.column;
      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to read file');
        process.exit(1);
      }

      console.log(chalk.cyan(`\nFound ${euis.length} hardware IDs in column "${euiColumn}"`));

      // Show preview
      const preview = euis.slice(0, 5);
      for (const eui of preview) {
        console.log(chalk.gray(`  ${eui}`));
      }
      if (euis.length > 5) {
        console.log(chalk.gray(`  ... and ${euis.length - 5} more`));
      }

      // Confirm
      if (!options.dryRun) {
        const { confirm } = await import('@inquirer/prompts');
        const proceed = await confirm({
          message: `Deactivate ${euis.length} devices?`,
          default: false,
        });

        if (!proceed) {
          console.log(chalk.yellow('Deactivation cancelled'));
          process.exit(0);
        }
      }

      // Deactivate devices
      const clientId = getConfig('clientId');
      const results: { eui: string; success: boolean; error?: string }[] = [];
      let deactivated = 0;
      let failed = 0;

      const deactivateSpinner = ora(
        options.dryRun ? 'Running dry-run validation...' : 'Deactivating devices...'
      ).start();

      for (let i = 0; i < euis.length; i++) {
        const eui = euis[i];
        deactivateSpinner.text = options.dryRun
          ? `Dry run: ${i + 1}/${euis.length}`
          : `Deactivating ${i + 1}/${euis.length} (${eui})`;

        if (options.dryRun) {
          results.push({ eui, success: true });
          deactivated++;
          continue;
        }

        try {
          await apiDelete(
            `/v1.1/organizations/${clientId}/applications/${clientId}/things/${eui}/unpair`
          );
          results.push({ eui, success: true });
          deactivated++;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          results.push({ eui, success: false, error: message });
          failed++;
        }
      }

      deactivateSpinner.stop();

      // Display summary
      if (options.json) {
        console.log(JSON.stringify({ deactivated, failed, results }, null, 2));
      } else {
        console.log();
        console.log(chalk.cyan(options.dryRun ? 'Dry Run Complete' : 'Deactivation Complete'));
        console.log(chalk.gray('─'.repeat(40)));
        console.log(`Deactivated: ${chalk.green(String(deactivated))}`);
        console.log(`Failed:      ${chalk.red(String(failed))}`);

        // Show failures
        const failures = results.filter((r) => !r.success);
        if (failures.length > 0) {
          console.log();
          console.log(chalk.red('Failed devices:'));
          for (const f of failures) {
            console.log(`  ${f.eui} - ${f.error}`);
          }
        }

        console.log(chalk.gray('─'.repeat(40)));
      }

      // Save results to file
      if (options.output) {
        const outputData = {
          timestamp: new Date().toISOString(),
          csvFile,
          dryRun: options.dryRun || false,
          summary: { deactivated, failed },
          results,
        };

        writeFileSync(options.output, JSON.stringify(outputData, null, 2));
        success(`Results saved to ${options.output}`);
      }

      // Exit with error code if there were failures
      if (failed > 0) {
        process.exit(1);
      }
    });

  bulk
    .command('generate-appkeys')
    .description('Generate unique AppKeys for devices from a CSV file of DevEUIs')
    .argument('<csv-file>', 'Path to CSV file containing DevEUIs')
    .option('--appeui <eui>', 'AppEUI to use for all devices', '8000000000000334')
    .option('--column <name>', 'CSV column containing DevEUIs (auto-detected if not specified)')
    .option('--delimiter <char>', 'Force CSV delimiter (auto-detect by default)')
    .option('--output <file>', 'Save output CSV to file (prints to stdout by default)')
    .action(async (csvFile: string, options: {
      appeui: string;
      column?: string;
      delimiter?: string;
      output?: string;
    }) => {
      if (!existsSync(csvFile)) {
        error(`CSV file not found: ${csvFile}`);
        process.exit(1);
      }

      // Parse input file
      let headers: string[];
      let rows: Record<string, string>[];

      try {
        const parsedCSV = parseCSV(csvFile, options.delimiter);
        headers = parsedCSV.headers;
        rows = parsedCSV.rows;
      } catch {
        // Fall back to plain text (one EUI per line)
        try {
          const content = readFileSync(csvFile, 'utf-8');
          const lines = content.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
          headers = ['deveui'];
          rows = lines.map((line) => ({ deveui: line }));
        } catch (err) {
          error(err instanceof Error ? err.message : 'Failed to parse file');
          process.exit(1);
        }
      }

      // Determine which column has the DevEUIs
      let euiColumn: string;
      if (options.column) {
        if (!headers.includes(options.column)) {
          error(`Column "${options.column}" not found. Available columns: ${headers.join(', ')}`);
          process.exit(1);
        }
        euiColumn = options.column;
      } else {
        const candidates = ['deveui', 'dev_eui', 'device_eui', 'eui', 'hardware_id'];
        const match = headers.find((h) => candidates.includes(h.toLowerCase()));
        if (match) {
          euiColumn = match;
        } else if (headers.length === 1) {
          euiColumn = headers[0];
        } else {
          error(
            `Could not auto-detect DevEUI column. Available columns: ${headers.join(', ')}\n` +
            `Use --column <name> to specify which column contains DevEUIs.`
          );
          process.exit(1);
        }
      }

      // Extract DevEUIs
      const euis = rows
        .map((row) => row[euiColumn]?.trim())
        .filter((eui): eui is string => !!eui && eui.length > 0);

      if (euis.length === 0) {
        error(`No DevEUIs found in column "${euiColumn}"`);
        process.exit(1);
      }

      // Generate unique AppKeys
      const seenKeys = new Set<string>();
      const outputLines: string[] = ['deveui,appeui,appkey'];

      for (const deveui of euis) {
        let appkey: string;
        do {
          appkey = randomBytes(16).toString('hex').toUpperCase();
        } while (seenKeys.has(appkey));
        seenKeys.add(appkey);
        outputLines.push(`${deveui},${options.appeui},${appkey}`);
      }

      const outputCSV = outputLines.join('\n') + '\n';

      if (options.output) {
        writeFileSync(options.output, outputCSV);
        success(`Generated AppKeys for ${euis.length} devices → ${options.output}`);
      } else {
        process.stdout.write(outputCSV);
      }
    });

  bulk
    .command('generate-uuids')
    .description('Generate BLE beacon UUIDs (v1, 34-character truncated)')
    .option('--count <number>', 'Number of UUIDs to generate', '10')
    .option('--output <file>', 'Save output CSV to file (prints to stdout by default)')
    .action(async (options: {
      count: string;
      output?: string;
    }) => {
      const count = parseInt(options.count, 10);
      if (isNaN(count) || count < 1) {
        error('Count must be a positive number');
        process.exit(1);
      }

      const outputLines: string[] = ['uuid-34,uuidv1'];

      for (let i = 0; i < count; i++) {
        const guid = uuidv1();
        const uuid34 = guid.substring(0, guid.length - 2);
        outputLines.push(`${uuid34},${guid}`);
      }

      const outputCSV = outputLines.join('\n') + '\n';

      if (options.output) {
        writeFileSync(options.output, outputCSV);
        success(`Generated ${count} UUIDs → ${options.output}`);
      } else {
        process.stdout.write(outputCSV);
      }
    });

  bulk.addCommand(createBulkGatewaysCommand());

  return bulk;
}
