import { Command } from 'commander';
import ora from 'ora';
import { readFileSync, existsSync } from 'fs';
import { basename } from 'path';
import { apiGet, apiPost, apiPut, apiDelete } from '../lib/api.js';
import { getConfig } from '../lib/config.js';
import { output, success, error, header, detail, outputTable } from '../lib/output.js';
import type {
  Codec,
  CodecFile,
  CodecListResponse,
  DecodeRequest,
  DecodeResponse,
  DecodeResponseSensor,
  EncodeRequest,
  EncodeResponse,
  DeviceTemplate,
  TemplateChannel,
  ApiResponse,
  GlobalOptions,
  ListOptions,
} from '../types/index.js';
import chalk from 'chalk';

/**
 * Get the base path for codecs API
 */
function getCodecsPath(): string {
  const clientId = getConfig('clientId');
  return `/v1.1/organizations/${clientId}/applications/${clientId}/codecs`;
}

/**
 * Get the base path for templates API
 */
function getTemplatesPath(): string {
  const clientId = getConfig('clientId');
  return `/v1.1/organizations/${clientId}/applications/${clientId}/things/types`;
}

/**
 * Validate decoded sensors against template capabilities
 */
interface ValidationResult {
  sensor: DecodeResponseSensor;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

async function validateAgainstTemplate(
  sensors: DecodeResponseSensor[],
  templateId: string
): Promise<{ results: ValidationResult[]; template: DeviceTemplate }> {
  // Fetch the template
  const template = await apiGet<DeviceTemplate>(`${getTemplatesPath()}/${templateId}`);
  const channels = template.channels || [];

  const results: ValidationResult[] = sensors.map((sensor) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Find matching channel in template
    const matchingChannel = channels.find(
      (ch: TemplateChannel) => String(ch.channel) === String(sensor.channel)
    );

    if (!matchingChannel) {
      errors.push(`Channel ${sensor.channel} not found in template`);
      return { sensor, valid: false, errors, warnings };
    }

    // Check if unit is valid for this channel
    if (matchingChannel.data?.units && matchingChannel.data.units.length > 0) {
      const validUnits = matchingChannel.data.units.map((u) => u.payload);
      if (!validUnits.includes(sensor.unit)) {
        errors.push(
          `Invalid unit '${sensor.unit}' for channel ${sensor.channel}. Valid units: ${validUnits.join(', ')}`
        );
      }
    }

    // Check value type
    if (sensor.value === null || sensor.value === undefined) {
      warnings.push(`Channel ${sensor.channel} has null/undefined value`);
    }

    return {
      sensor,
      valid: errors.length === 0,
      errors,
      warnings,
    };
  });

  // Check for missing channels (channels in template but not in decoded output)
  const decodedChannels = sensors.map((s) => String(s.channel));
  const missingChannels = channels.filter(
    (ch: TemplateChannel) => !decodedChannels.includes(String(ch.channel))
  );

  // Add missing channels as warnings (not errors, since partial decoding might be valid)
  if (missingChannels.length > 0) {
    const missingInfo = missingChannels.map((ch: TemplateChannel) => `${ch.channel} (${ch.name})`);
    // We'll report this separately, not as part of sensor results
  }

  return { results, template };
}

export function createCodecsCommands(): Command {
  const codecs = new Command('codecs').description('Manage codecs for device payload encoding/decoding');

  codecs
    .command('list')
    .description('List codecs')
    .option('-l, --limit <number>', 'Results limit', '20')
    .option('--offset <number>', 'Pagination offset', '0')
    .option('--opensource', 'Filter opensource codecs')
    .option('--public', 'Filter public codecs')
    .option('--official', 'Filter official codecs')
    .option('--json', 'Output as JSON')
    .action(async (options: ListOptions & {
      offset?: string;
      opensource?: boolean;
      public?: boolean;
      official?: boolean;
    }) => {
      const spinner = ora('Fetching codecs...').start();
      try {
        const params: Record<string, unknown> = {
          limit: parseInt(options.limit as unknown as string, 10),
          offset: parseInt(options.offset || '0', 10),
        };
        if (options.opensource) params.opensource = true;
        if (options.public) params.public = true;
        if (options.official) params.official = true;

        const response = await apiGet<Codec[] | CodecListResponse>(getCodecsPath(), params);
        spinner.stop();

        // Handle both array response and wrapped response
        const codecList = Array.isArray(response) ? response : response.codecs || [];
        const total = Array.isArray(response) ? codecList.length : response.total;

        output(codecList, {
          json: options.json,
          tableHeaders: ['ID', 'Name', 'Public', 'Opensource', 'Official'],
          tableMapper: (c: Codec) => [
            c.id,
            c.name,
            c.public ? 'yes' : 'no',
            c.opensource ? 'yes' : 'no',
            c.official ? 'yes' : 'no',
          ],
          footer: `Total: ${total} codecs`,
        });
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to fetch codecs');
        process.exit(1);
      }
    });

  codecs
    .command('get')
    .description('Get a codec by ID')
    .argument('<id>', 'Codec ID')
    .option('--json', 'Output as JSON')
    .option('--show-source', 'Show source code of files')
    .action(async (id: string, options: GlobalOptions & { showSource?: boolean }) => {
      const spinner = ora('Fetching codec...').start();
      try {
        const codec = await apiGet<Codec>(`${getCodecsPath()}/${id}`);
        spinner.stop();

        if (options.json) {
          output(codec, { json: true });
        } else {
          header(`Codec: ${codec.name}`);
          detail('ID', codec.id);
          detail('Name', codec.name);
          detail('Organization', codec.organization);
          detail('Application', codec.application);
          detail('Public', codec.public);
          detail('Opensource', codec.opensource);
          detail('Official', codec.official);
          detail('Timeout', codec.timeout ? `${codec.timeout}ms` : undefined);
          detail('Modules', codec.modules?.join(', ') || 'none');
          detail('Created', codec.createdAt);
          detail('Updated', codec.updatedAt);

          if (codec.files && codec.files.length > 0) {
            console.log('\nFiles:');
            codec.files.forEach((f: CodecFile) => {
              console.log(`  - ${f.name}`);
              if (options.showSource) {
                console.log('    ```javascript');
                console.log(f.source.split('\n').map(line => `    ${line}`).join('\n'));
                console.log('    ```');
              }
            });
          }
        }
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to fetch codec');
        process.exit(1);
      }
    });

  codecs
    .command('create')
    .description('Create a new codec')
    .requiredOption('-n, --name <name>', 'Codec name')
    .option('--decoder <file>', 'Path to decoder.js file')
    .option('--encoder <file>', 'Path to encoder.js file')
    .option('--file <files...>', 'Additional source files (can specify multiple)')
    .option('--timeout <ms>', 'Execution timeout in milliseconds', '100')
    .option('--modules <modules>', 'Comma-separated list of npm modules')
    .option('--public', 'Make codec public')
    .option('--opensource', 'Make codec opensource')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const spinner = ora('Creating codec...').start();
      try {
        const files: CodecFile[] = [];

        // Add decoder file
        if (options.decoder) {
          if (!existsSync(options.decoder)) {
            throw new Error(`Decoder file not found: ${options.decoder}`);
          }
          files.push({
            name: 'decoder.js',
            source: readFileSync(options.decoder, 'utf-8'),
          });
        }

        // Add encoder file
        if (options.encoder) {
          if (!existsSync(options.encoder)) {
            throw new Error(`Encoder file not found: ${options.encoder}`);
          }
          files.push({
            name: 'encoder.js',
            source: readFileSync(options.encoder, 'utf-8'),
          });
        }

        // Add additional files
        if (options.file) {
          for (const filePath of options.file) {
            if (!existsSync(filePath)) {
              throw new Error(`File not found: ${filePath}`);
            }
            files.push({
              name: basename(filePath),
              source: readFileSync(filePath, 'utf-8'),
            });
          }
        }

        const data: Record<string, unknown> = {
          name: options.name,
          timeout: parseInt(options.timeout, 10),
          files,
        };
        if (options.modules) data.modules = options.modules.split(',').map((m: string) => m.trim());
        if (options.public) data.public = true;
        if (options.opensource) data.opensource = true;

        const codec = await apiPost<Codec>(getCodecsPath(), data);
        spinner.stop();

        if (options.json) {
          output(codec, { json: true });
        } else {
          success('Codec created successfully');
          detail('ID', codec.id);
          detail('Name', codec.name);
        }
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to create codec');
        process.exit(1);
      }
    });

  codecs
    .command('update')
    .description('Update a codec')
    .argument('<id>', 'Codec ID')
    .option('-n, --name <name>', 'Codec name')
    .option('--decoder <file>', 'Path to decoder.js file')
    .option('--encoder <file>', 'Path to encoder.js file')
    .option('--file <files...>', 'Additional source files (can specify multiple)')
    .option('--timeout <ms>', 'Execution timeout in milliseconds')
    .option('--modules <modules>', 'Comma-separated list of npm modules')
    .option('--public', 'Make codec public')
    .option('--private', 'Make codec private')
    .option('--opensource', 'Make codec opensource')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options) => {
      const spinner = ora('Updating codec...').start();
      try {
        const data: Record<string, unknown> = {};

        if (options.name) data.name = options.name;
        if (options.timeout) data.timeout = parseInt(options.timeout, 10);
        if (options.modules) data.modules = options.modules.split(',').map((m: string) => m.trim());
        if (options.public) data.public = true;
        if (options.private) data.public = false;
        if (options.opensource) data.opensource = true;

        // Handle file updates
        if (options.decoder || options.encoder || options.file) {
          const files: CodecFile[] = [];

          if (options.decoder) {
            if (!existsSync(options.decoder)) {
              throw new Error(`Decoder file not found: ${options.decoder}`);
            }
            files.push({
              name: 'decoder.js',
              source: readFileSync(options.decoder, 'utf-8'),
            });
          }

          if (options.encoder) {
            if (!existsSync(options.encoder)) {
              throw new Error(`Encoder file not found: ${options.encoder}`);
            }
            files.push({
              name: 'encoder.js',
              source: readFileSync(options.encoder, 'utf-8'),
            });
          }

          if (options.file) {
            for (const filePath of options.file) {
              if (!existsSync(filePath)) {
                throw new Error(`File not found: ${filePath}`);
              }
              files.push({
                name: basename(filePath),
                source: readFileSync(filePath, 'utf-8'),
              });
            }
          }

          data.files = files;
        }

        const codec = await apiPut<Codec>(`${getCodecsPath()}/${id}`, data);
        spinner.stop();

        if (options.json) {
          output(codec, { json: true });
        } else {
          success('Codec updated successfully');
        }
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to update codec');
        process.exit(1);
      }
    });

  codecs
    .command('delete')
    .description('Delete a codec')
    .argument('<id>', 'Codec ID')
    .action(async (id: string) => {
      const spinner = ora('Deleting codec...').start();
      try {
        await apiDelete(`${getCodecsPath()}/${id}`);
        spinner.stop();
        success('Codec deleted successfully');
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to delete codec');
        process.exit(1);
      }
    });

  codecs
    .command('decode')
    .description('Test decoding a payload with a codec')
    .argument('<id>', 'Codec ID')
    .requiredOption('-d, --data <data>', 'Payload data to decode')
    .option('-f, --format <format>', 'Data format (hex, base64, text, json)', 'hex')
    .option('--fport <number>', 'LoRaWAN fport number')
    .option('--hardware-id <id>', 'Device hardware ID')
    .option('--validate-template <templateId>', 'Validate output against a template')
    .option('--debug', 'Include console output')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: GlobalOptions & {
      data: string;
      format: string;
      fport?: string;
      hardwareId?: string;
      validateTemplate?: string;
      debug?: boolean;
    }) => {
      const spinner = ora('Decoding payload...').start();
      try {
        const params: Record<string, unknown> = {};
        if (options.debug) params.debug = true;

        const body: DecodeRequest = {
          data: options.data,
          format: options.format as DecodeRequest['format'],
        };
        if (options.fport) body.fport = parseInt(options.fport, 10);
        if (options.hardwareId) body.hardware_id = options.hardwareId;

        const response = await apiPost<DecodeResponse>(
          `${getCodecsPath()}/${id}/decode`,
          body as unknown as Record<string, unknown>
        );

        // Validate against template if requested
        let validationResults: ValidationResult[] | null = null;
        let validationTemplate: DeviceTemplate | null = null;
        let missingChannels: TemplateChannel[] = [];

        if (options.validateTemplate && response.sensors && response.sensors.length > 0) {
          spinner.text = 'Validating against template...';
          const validation = await validateAgainstTemplate(response.sensors, options.validateTemplate);
          validationResults = validation.results;
          validationTemplate = validation.template;

          // Find missing channels
          const decodedChannels = response.sensors.map((s) => String(s.channel));
          missingChannels = (validationTemplate.channels || []).filter(
            (ch: TemplateChannel) => !decodedChannels.includes(String(ch.channel))
          );
        }

        spinner.stop();

        if (options.json) {
          const jsonOutput: Record<string, unknown> = { ...response };
          if (validationResults) {
            jsonOutput.validation = {
              results: validationResults,
              templateId: options.validateTemplate,
              templateName: validationTemplate?.name,
              missingChannels: missingChannels.map((ch) => ({
                channel: ch.channel,
                name: ch.name,
              })),
            };
          }
          output(jsonOutput, { json: true });
        } else {
          if (response.error) {
            error(`Decode error: ${response.error}`);
            process.exit(1);
          }

          if (response.console && options.debug) {
            header('Console Output');
            console.log(response.console);
            console.log('');
          }

          if (response.sensors && response.sensors.length > 0) {
            header('Decoded Sensors');
            outputTable(
              ['Channel', 'Type', 'Value', 'Unit', 'Name'],
              response.sensors.map((s) => [
                s.channel,
                s.type,
                JSON.stringify(s.value),
                s.unit,
                s.name || '-',
              ])
            );

            // Show validation results
            if (validationResults && validationTemplate) {
              console.log('');
              header(`Validation Against: ${validationTemplate.name}`);

              const allValid = validationResults.every((r) => r.valid);
              const hasWarnings = validationResults.some((r) => r.warnings.length > 0);

              if (allValid && !hasWarnings && missingChannels.length === 0) {
                console.log(chalk.green('✓ All sensors validated successfully'));
              } else {
                // Show errors
                validationResults.forEach((result) => {
                  if (!result.valid) {
                    console.log(chalk.red(`✗ Channel ${result.sensor.channel}:`));
                    result.errors.forEach((err) => console.log(chalk.red(`    ${err}`)));
                  }
                });

                // Show warnings
                validationResults.forEach((result) => {
                  if (result.warnings.length > 0) {
                    console.log(chalk.yellow(`⚠ Channel ${result.sensor.channel}:`));
                    result.warnings.forEach((warn) => console.log(chalk.yellow(`    ${warn}`)));
                  }
                });

                // Show missing channels
                if (missingChannels.length > 0) {
                  console.log(chalk.yellow('\n⚠ Missing channels (not decoded):'));
                  missingChannels.forEach((ch) => {
                    console.log(chalk.yellow(`    - ${ch.channel}: ${ch.name}`));
                  });
                }

                // Summary
                const validCount = validationResults.filter((r) => r.valid).length;
                console.log('');
                console.log(`Validation: ${validCount}/${validationResults.length} sensors valid`);

                if (!allValid) {
                  process.exit(1);
                }
              }
            }
          } else {
            console.log('No sensor data decoded');
          }
        }
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to decode payload');
        process.exit(1);
      }
    });

  codecs
    .command('encode')
    .description('Test encoding a command with a codec')
    .argument('<id>', 'Codec ID')
    .requiredOption('-c, --channel <number>', 'Target channel number')
    .requiredOption('-v, --value <value>', 'Value to encode')
    .option('--debug', 'Include console output')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options: GlobalOptions & {
      channel: string;
      value: string;
      debug?: boolean;
    }) => {
      const spinner = ora('Encoding command...').start();
      try {
        const params: Record<string, unknown> = {};
        if (options.debug) params.debug = true;

        // Try to parse value as JSON, fallback to string/number
        let value: unknown = options.value;
        try {
          value = JSON.parse(options.value);
        } catch {
          // If not valid JSON, try as number, otherwise keep as string
          const num = parseFloat(options.value);
          if (!isNaN(num)) value = num;
        }

        const body: EncodeRequest = {
          channel: parseInt(options.channel, 10),
          value,
        };

        const response = await apiPost<EncodeResponse>(
          `${getCodecsPath()}/${id}/encode`,
          body as unknown as Record<string, unknown>
        );
        spinner.stop();

        if (options.json) {
          output(response, { json: true });
        } else {
          if (response.error) {
            error(`Encode error: ${response.error}`);
            process.exit(1);
          }

          if (response.console && options.debug) {
            header('Console Output');
            console.log(response.console);
            console.log('');
          }

          if (response.payload) {
            header('Encoded Payload');
            detail('Format', response.payload.format);
            if (response.payload.data) detail('Data (hex)', response.payload.data);
            if (response.payload.text) detail('Data (text)', response.payload.text);
            if (response.payload.json) detail('Data (json)', response.payload.json);
            if (response.payload.fport) detail('FPort', response.payload.fport);
          } else {
            console.log('No payload generated');
          }
        }
      } catch (err) {
        spinner.stop();
        error(err instanceof Error ? err.message : 'Failed to encode command');
        process.exit(1);
      }
    });

  return codecs;
}
