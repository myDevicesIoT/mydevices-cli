import { select, confirm, input } from '@inquirer/prompts';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import chalk from 'chalk';

export interface ColumnMapping {
  [csvColumn: string]: string | null; // null means skip
}

export interface HierarchyMapping {
  columns: string[]; // CSV columns in hierarchy order (level 1, level 2, etc.)
}

export interface MappingConfig {
  version: string;
  mappings: ColumnMapping;
  hierarchy?: HierarchyMapping;
  createdAt: string;
}

/**
 * Target fields available for mapping
 */
export const TARGET_FIELDS = {
  location: [
    { value: 'location.hierarchy', label: 'Location Hierarchy', description: 'Hierarchy level (map multiple columns in order: Site → Building → Floor → Room)' },
    { value: 'location.external_id', label: 'Location External ID', description: 'External reference ID (applied to deepest location)' },
    { value: 'location.address', label: 'Location Address', description: 'Street address (applied to deepest location)' },
    { value: 'location.city', label: 'Location City', description: 'City name (applied to deepest location)' },
    { value: 'location.state', label: 'Location State', description: 'State/Province (applied to deepest location)' },
    { value: 'location.country', label: 'Location Country', description: 'Country code (applied to deepest location)' },
    { value: 'location.timezone', label: 'Location Timezone', description: 'Timezone (applied to deepest location)' },
    { value: 'location.industry', label: 'Location Industry', description: 'Industry type (required, applied to deepest location)' },
  ],
  device: [
    { value: 'device.hardware_id', label: 'Device Hardware ID', description: 'Hardware ID / DevEUI (required)' },
    { value: 'device.name', label: 'Device Name', description: 'Display name' },
    { value: 'device.external_id', label: 'Device External ID', description: 'External reference ID' },
    { value: 'device.sensor_use', label: 'Device Sensor Use', description: 'Sensor use type' },
  ],
};

/**
 * Common column name patterns for auto-suggestion
 */
const COLUMN_PATTERNS: Record<string, string[]> = {
  'location.hierarchy': ['location', 'site', 'building', 'floor', 'room', 'area', 'zone', 'facility', 'region', 'campus', 'wing'],
  'location.external_id': ['location external id', 'location ext id', 'site id', 'site external id'],
  'location.address': ['address', 'street', 'street address'],
  'location.city': ['city', 'town'],
  'location.state': ['state', 'province', 'region'],
  'location.country': ['country', 'country code'],
  'location.timezone': ['timezone', 'time zone', 'tz'],
  'location.industry': ['industry', 'sector', 'vertical', 'business type'],
  'device.hardware_id': ['hardware id', 'hardware_id', 'device id', 'device_id', 'deveui', 'dev eui', 'eui', 'serial number', 'serial'],
  'device.name': ['device name', 'name', 'sensor name', 'thing name', 'equipment description'],
  'device.external_id': ['external id', 'external_id', 'ext id', 'reference', 'ref', 'id equipment'],
  'device.sensor_use': ['sensor use', 'use', 'device use', 'type', 'sensor type', 'category'],
};

/**
 * Suggest a target field based on column name
 */
function suggestMapping(columnName: string): string | null {
  const normalized = columnName.toLowerCase().trim();

  for (const [field, patterns] of Object.entries(COLUMN_PATTERNS)) {
    if (patterns.some((p) => normalized === p || normalized.includes(p))) {
      return field;
    }
  }

  return null;
}

export interface MappingResult {
  mappings: ColumnMapping;
  hierarchy: HierarchyMapping;
}

/**
 * Load a saved mapping from a JSON file
 */
export function loadMapping(filePath: string): MappingResult {
  if (!existsSync(filePath)) {
    throw new Error(`Mapping file not found: ${filePath}`);
  }

  const content = readFileSync(filePath, 'utf-8');
  const config: MappingConfig = JSON.parse(content);

  return {
    mappings: config.mappings,
    hierarchy: config.hierarchy || { columns: [] },
  };
}

/**
 * Save a mapping to a JSON file
 */
export function saveMapping(filePath: string, mappings: ColumnMapping, hierarchy: HierarchyMapping): void {
  const config: MappingConfig = {
    version: '1.0',
    mappings,
    hierarchy,
    createdAt: new Date().toISOString(),
  };

  writeFileSync(filePath, JSON.stringify(config, null, 2));
}

/**
 * Build the choices list for column mapping
 */
function buildMappingChoices(alreadyMapped: Set<string>, hierarchyCount: number) {
  const choices: Array<{ name: string; value: string | null; description?: string }> = [];

  // Add location fields
  choices.push({ name: chalk.gray('── Location Fields ──'), value: '__separator_loc__', description: '' });
  for (const field of TARGET_FIELDS.location) {
    // location.hierarchy can be mapped multiple times
    if (field.value === 'location.hierarchy') {
      const levelLabel = hierarchyCount > 0
        ? `${field.label} (Level ${hierarchyCount + 1})`
        : field.label;
      choices.push({
        name: levelLabel,
        value: field.value,
        description: field.description,
      });
    } else {
      const disabled = alreadyMapped.has(field.value);
      choices.push({
        name: disabled ? chalk.gray(`${field.label} (already mapped)`) : field.label,
        value: disabled ? `__disabled_${field.value}__` : field.value,
        description: field.description,
      });
    }
  }

  // Add device fields
  choices.push({ name: chalk.gray('── Device Fields ──'), value: '__separator_dev__', description: '' });
  for (const field of TARGET_FIELDS.device) {
    const disabled = alreadyMapped.has(field.value);
    choices.push({
      name: disabled ? chalk.gray(`${field.label} (already mapped)`) : field.label,
      value: disabled ? `__disabled_${field.value}__` : field.value,
      description: field.description,
    });
  }

  // Add skip option
  choices.push({ name: chalk.yellow('(skip this column)'), value: null });

  return choices;
}

/**
 * Interactive column mapping
 */
export async function interactiveMapping(csvColumns: string[]): Promise<MappingResult> {
  const mappings: ColumnMapping = {};
  const hierarchy: HierarchyMapping = { columns: [] };
  const alreadyMapped = new Set<string>();

  console.log(chalk.cyan('\nColumn Mapping'));
  console.log(chalk.gray('Map each CSV column to a target field, or skip if not needed.'));
  console.log(chalk.gray('For location hierarchy, map columns in order (e.g., Site → Building → Floor → Room).\n'));

  for (const column of csvColumns) {
    const suggestion = suggestMapping(column);

    // Build choices, marking already-mapped fields
    const choices = buildMappingChoices(alreadyMapped, hierarchy.columns.length);

    // Find default choice index
    let defaultValue: string | null = null;
    if (suggestion && (suggestion === 'location.hierarchy' || !alreadyMapped.has(suggestion))) {
      defaultValue = suggestion;
    }

    const answer = await select({
      message: `Map "${chalk.bold(column)}" to:`,
      choices: choices.filter((c) => !c.value?.startsWith('__separator_') && !c.value?.startsWith('__disabled_')),
      default: defaultValue || undefined,
    });

    mappings[column] = answer;

    if (answer === 'location.hierarchy') {
      // Track hierarchy columns in order
      hierarchy.columns.push(column);
    } else if (answer) {
      alreadyMapped.add(answer);
    }
  }

  return { mappings, hierarchy };
}

/**
 * Display mapping summary
 */
export function displayMappingSummary(mappings: ColumnMapping, hierarchy: HierarchyMapping): void {
  console.log(chalk.cyan('\nMapping Summary:'));
  console.log(chalk.gray('─'.repeat(50)));

  const maxColLen = Math.max(...Object.keys(mappings).map((k) => k.length));

  // Display hierarchy columns first with level indicators
  if (hierarchy.columns.length > 0) {
    console.log(chalk.cyan('  Location Hierarchy:'));
    hierarchy.columns.forEach((col, index) => {
      const paddedCol = col.padEnd(maxColLen);
      console.log(`    ${paddedCol} → ${chalk.green(`Level ${index + 1}`)}`);
    });
    console.log();
  }

  // Display other mappings
  for (const [column, target] of Object.entries(mappings)) {
    if (target === 'location.hierarchy') continue; // Already shown above
    const paddedCol = column.padEnd(maxColLen);
    if (target) {
      console.log(`  ${paddedCol} → ${chalk.green(target)}`);
    } else {
      console.log(`  ${paddedCol} → ${chalk.yellow('(skipped)')}`);
    }
  }

  console.log(chalk.gray('─'.repeat(50)));
}

/**
 * Validate that required fields are mapped
 */
export function validateMapping(mappings: ColumnMapping, hierarchy: HierarchyMapping): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const mappedFields = new Set(Object.values(mappings).filter(Boolean));

  // Check for required device field
  if (!mappedFields.has('device.hardware_id')) {
    errors.push('Missing required mapping: device.hardware_id');
  }

  // Check that if any device field is mapped, hardware_id is too
  const hasDeviceFields = [...mappedFields].some((f) => f?.startsWith('device.'));
  if (hasDeviceFields && !mappedFields.has('device.hardware_id')) {
    errors.push('device.hardware_id is required when mapping device fields');
  }

  // Check that at least one hierarchy level is mapped for locations
  if (hierarchy.columns.length === 0) {
    errors.push('At least one location hierarchy level is required');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Prompt to save mapping
 */
export async function promptSaveMapping(mappings: ColumnMapping, hierarchy: HierarchyMapping): Promise<void> {
  const shouldSave = await confirm({
    message: 'Save this mapping for reuse?',
    default: false,
  });

  if (shouldSave) {
    const filePath = await input({
      message: 'Save mapping to:',
      default: 'column-mapping.json',
    });
    saveMapping(filePath, mappings, hierarchy);
    console.log(chalk.green(`✓ Mapping saved to ${filePath}`));
  }
}

export interface LocationDefaults {
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  timezone?: string;
  industry?: string;
}

/**
 * Prompt for location default values (for fields not mapped from CSV)
 */
export async function promptLocationDefaults(mappings: ColumnMapping): Promise<LocationDefaults> {
  const mappedFields = new Set(Object.values(mappings).filter(Boolean));
  const defaults: LocationDefaults = {};

  console.log(chalk.cyan('\nLocation Defaults'));
  console.log(chalk.gray('Provide default values for location fields not mapped from CSV.\n'));

  // Only prompt for fields that weren't mapped
  if (!mappedFields.has('location.address')) {
    defaults.address = await input({
      message: 'Default address (required):',
    });
  }

  if (!mappedFields.has('location.city')) {
    defaults.city = await input({
      message: 'Default city (required):',
    });
  }

  if (!mappedFields.has('location.state')) {
    defaults.state = await input({
      message: 'Default state (required):',
    });
  }

  if (!mappedFields.has('location.country')) {
    defaults.country = await input({
      message: 'Default country (required):',
    });
  }

  if (!mappedFields.has('location.timezone')) {
    defaults.timezone = await input({
      message: 'Default timezone (optional):',
      default: '',
    });
    if (!defaults.timezone) delete defaults.timezone;
  }

  if (!mappedFields.has('location.industry')) {
    defaults.industry = await input({
      message: 'Default industry (required):',
    });
  }

  return defaults;
}
