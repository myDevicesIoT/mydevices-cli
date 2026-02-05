import { Command } from 'commander';
import { existsSync, writeFileSync } from 'fs';
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
} from '../lib/bulk-import.js';
import { error, success } from '../lib/output.js';

export function createBulkCommands(): Command {
  const bulk = new Command('bulk').description('Bulk operations for importing data');

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
    .option('--location-industry <industry>', 'Default industry for all locations')
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
                             options.locationIndustry;

      if (hasCliDefaults) {
        // Use CLI-provided defaults
        locationDefaults = {
          address: options.locationAddress,
          city: options.locationCity,
          state: options.locationState,
          country: options.locationCountry,
          industry: options.locationIndustry,
        };
      } else {
        // Prompt for defaults interactively
        locationDefaults = await promptLocationDefaults(mappings);
      }

      // Transform rows
      const transformedRows = transformRows(parsedCSV.rows, mappings, hierarchy);

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

  return bulk;
}
