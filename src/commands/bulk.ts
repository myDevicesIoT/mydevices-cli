import { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import { parseCSV, getDelimiterName } from '../lib/csv-parser.js';
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
import { apiDelete } from '../lib/api.js';
import { getConfig } from '../lib/config.js';
import { error, success } from '../lib/output.js';

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
      // Validate CSV file exists
      if (!existsSync(csvFile)) {
        error(`CSV file not found: ${csvFile}`);
        process.exit(1);
      }

      // Parse CSV
      const spinner = ora('Parsing CSV file...').start();
      let headers: string[];
      let rows: Record<string, string>[];

      try {
        // Try parsing as CSV first
        const parsedCSV = parseCSV(csvFile, options.delimiter);
        headers = parsedCSV.headers;
        rows = parsedCSV.rows;
        spinner.succeed(
          `Parsed ${rows.length} rows with ${headers.length} columns ` +
          `(delimiter: ${getDelimiterName(parsedCSV.delimiter)})`
        );
      } catch {
        // Fall back to plain text (one EUI per line)
        try {
          const content = readFileSync(csvFile, 'utf-8');
          const lines = content.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');
          headers = ['hardware_id'];
          rows = lines.map((line) => ({ hardware_id: line }));
          spinner.succeed(`Parsed ${rows.length} hardware IDs from text file`);
        } catch (err) {
          spinner.fail('Failed to parse file');
          error(err instanceof Error ? err.message : 'Unknown error');
          process.exit(1);
        }
      }

      // Determine which column has the hardware IDs
      let euiColumn: string;
      if (options.column) {
        if (!headers.includes(options.column)) {
          error(`Column "${options.column}" not found. Available columns: ${headers.join(', ')}`);
          process.exit(1);
        }
        euiColumn = options.column;
      } else {
        // Auto-detect: look for common column names
        const candidates = ['hardware_id', 'eui', 'deveui', 'dev_eui', 'device_eui', 'hwid'];
        const match = headers.find((h) => candidates.includes(h.toLowerCase()));
        if (match) {
          euiColumn = match;
        } else if (headers.length === 1) {
          euiColumn = headers[0];
        } else {
          error(
            `Could not auto-detect hardware ID column. Available columns: ${headers.join(', ')}\n` +
            `Use --column <name> to specify which column contains hardware IDs.`
          );
          process.exit(1);
        }
      }

      // Extract and validate EUIs
      const euis = rows
        .map((row) => row[euiColumn]?.trim())
        .filter((eui) => eui && eui.length > 0);

      if (euis.length === 0) {
        error(`No hardware IDs found in column "${euiColumn}"`);
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

  return bulk;
}
