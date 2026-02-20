#!/usr/bin/env bun
import { Command } from 'commander';
import { createAuthCommands } from './commands/auth.js';
import { createCompaniesCommands } from './commands/companies.js';
import { createLocationsCommands } from './commands/locations.js';
import { createUsersCommands } from './commands/users.js';
import { createDevicesCommands } from './commands/devices.js';
import { createRulesCommands } from './commands/rules.js';
import { createConfigCommands } from './commands/config.js';
import { createTemplatesCommands } from './commands/templates.js';
import { createCodecsCommands } from './commands/codecs.js';
import { createRegistryCommands } from './commands/registry.js';
import { createGatewaysCommands } from './commands/gateways.js';
import { createCompletionCommands } from './commands/completion.js';
import { createDescribeCommands } from './commands/describe.js';
import { createVersionCommands } from './commands/version.js';
import { createBulkCommands } from './commands/bulk.js';
import { getCurrentVersion } from './lib/version.js';

const program = new Command();

program
  .name('mydevices')
  .description('CLI tool for managing myDevices IoT platform')
  .version(getCurrentVersion());

// Register all command groups
program.addCommand(createAuthCommands());
program.addCommand(createCompaniesCommands());
program.addCommand(createLocationsCommands());
program.addCommand(createUsersCommands());
program.addCommand(createDevicesCommands());
program.addCommand(createRulesCommands());
program.addCommand(createConfigCommands());
program.addCommand(createTemplatesCommands());
program.addCommand(createCodecsCommands());
program.addCommand(createRegistryCommands());
program.addCommand(createGatewaysCommands());
program.addCommand(createCompletionCommands());
program.addCommand(createDescribeCommands());
program.addCommand(createVersionCommands());
program.addCommand(createBulkCommands());

// Parse and execute
program.parse();
