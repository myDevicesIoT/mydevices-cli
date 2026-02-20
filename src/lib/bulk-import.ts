import ora from 'ora';
import chalk from 'chalk';
import { apiGet, apiPost, apiPut } from './api.js';
import { getConfig } from './config.js';
import type { ColumnMapping, HierarchyMapping, LocationDefaults } from './column-mapper.js';

// Types
interface Location {
  id: number;
  name: string;
  parent_id: number | null;
  external_id?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  timezone?: string;
  company_id?: number;
  user_id?: string;
  application_id?: string;
  locations?: Location[];
}

interface LocationsResponse {
  count: number;
  rows: Location[];
}

interface Device {
  id: number;
  hardware_id: string;
  thing_name: string;
  external_id?: string;
  sensor_use?: string;
  location_id?: number;
  properties?: string;
}

interface RegistryEntry {
  id: string;
  hardware_id: string;
  device_type_id?: string;
  status: string;
}

interface RegistryResponse {
  count: number;
  rows: RegistryEntry[];
}

interface TemplateMeta {
  key: string;
  value: string;
}

interface DeviceUse {
  name: string;
  default?: boolean;
}

export interface DeviceTemplate {
  id: string;
  name: string;
  category?: string;  // This becomes device_category
  meta?: TemplateMeta[];
  device_use?: DeviceUse[];
}

interface FormSettingsField {
  order: number;
  label: string;
  type: string;
  form: 'select' | 'input';
  key: string;
  default_value: string | number;
  required: boolean;
  values?: { value: string; label: string }[];
  help_texts?: { value: string; order: number }[];
}

interface FormSettingsGroup {
  order: number;
  label: string | null;
  variables: FormSettingsField[];
}

/**
 * Extracted template info for device creation
 */
interface TemplateInfo {
  device_category?: string;
  sensor_type?: string;
  sensor_use?: string;
}

interface ImportResult {
  success: boolean;
  row: number;
  type: 'location' | 'device';
  action: 'created' | 'matched' | 'updated' | 'failed';
  name: string;
  id?: number | string;
  error?: string;
}

interface ImportSummary {
  locationsCreated: number;
  locationsMatched: number;
  locationsFailed: number;
  devicesCreated: number;
  devicesMatched: number;
  devicesFailed: number;
  results: ImportResult[];
}

interface HierarchyLevel {
  columnName: string; // The CSV column name (e.g., "Building")
  value: string;      // The value from the row (e.g., "7")
}

interface ParsedRow {
  rowNumber: number;
  locationHierarchy: HierarchyLevel[]; // Ordered hierarchy levels
  locationMeta: {
    external_id?: string;
    address?: string;
    city?: string;
    state?: string;
    country?: string;
    zip?: string;
    timezone?: string;
    industry?: string;
  };
  device: {
    hardware_id?: string;
    name?: string;
    external_id?: string;
    device_type_id?: string;
    sensor_use?: string;
    sensor_type?: string;
    device_category?: string;
    metadata?: Record<string, string>;
  };
}

/**
 * Transform CSV rows using column mapping
 */
export function transformRows(
  rows: Record<string, string>[],
  mappings: ColumnMapping,
  hierarchy: HierarchyMapping
): ParsedRow[] {
  return rows.map((row, index) => {
    const parsed: ParsedRow = {
      rowNumber: index + 2, // +2 for 1-indexed and header row
      locationHierarchy: [],
      locationMeta: {},
      device: {},
    };

    // Build hierarchy from ordered columns
    for (const columnName of hierarchy.columns) {
      const value = row[columnName]?.trim();
      if (!value) break; // Stop at first empty level
      parsed.locationHierarchy.push({ columnName, value });
    }

    // Process other mappings
    for (const [csvColumn, rawTarget] of Object.entries(mappings)) {
      if (!rawTarget || rawTarget === 'location.hierarchy') continue;

      const value = row[csvColumn]?.trim();
      if (!value) continue;

      const targets = Array.isArray(rawTarget) ? rawTarget : [rawTarget];
      for (const target of targets) {
        if (target === 'location.hierarchy') continue;

        if (target.startsWith('location.')) {
          const field = target.replace('location.', '') as keyof ParsedRow['locationMeta'];
          (parsed.locationMeta as Record<string, string>)[field] = value;
        } else if (target.startsWith('device.metadata.')) {
          const metadataKey = target.replace('device.metadata.', '');
          if (!parsed.device.metadata) {
            parsed.device.metadata = {};
          }
          parsed.device.metadata[metadataKey] = value;
        } else if (target.startsWith('device.')) {
          const field = target.replace('device.', '') as keyof ParsedRow['device'];
          (parsed.device as Record<string, string>)[field] = value;
        }
      }
    }

    return parsed;
  });
}

/**
 * Build location hierarchy from parsed rows
 * Returns a map of path -> LocationNode where path is like "Site RX/Building 7/Floor 0"
 */
interface LocationNode {
  path: string;           // Full path (e.g., "Site RX/Building 7/Floor 0")
  name: string;           // Display name (e.g., "Floor 0")
  parentPath?: string;    // Parent's path
  meta?: ParsedRow['locationMeta']; // Only for deepest level
  existingId?: number;
}

function formatLocationName(level: HierarchyLevel, prefixColumnName: boolean): string {
  return prefixColumnName ? `${level.columnName} ${level.value}` : level.value;
}

function buildLocationPaths(rows: ParsedRow[], prefixColumnName: boolean = true): Map<string, LocationNode> {
  const locations = new Map<string, LocationNode>();

  for (const row of rows) {
    if (row.locationHierarchy.length === 0) continue;

    // Build each level of the hierarchy
    let currentPath = '';
    for (let i = 0; i < row.locationHierarchy.length; i++) {
      const level = row.locationHierarchy[i];
      const name = formatLocationName(level, prefixColumnName);
      const parentPath = currentPath || undefined;
      currentPath = currentPath ? `${currentPath}/${name}` : name;

      if (!locations.has(currentPath)) {
        const isDeepest = i === row.locationHierarchy.length - 1;
        locations.set(currentPath, {
          path: currentPath,
          name,
          parentPath,
          meta: isDeepest ? row.locationMeta : undefined,
        });
      }
    }
  }

  return locations;
}

/**
 * Sort locations by depth (parents before children)
 */
function sortLocationsByDepth(locations: Map<string, LocationNode>): string[] {
  const entries = Array.from(locations.entries());
  // Sort by number of path segments (fewer segments = higher in hierarchy)
  entries.sort((a, b) => {
    const depthA = a[0].split('/').length;
    const depthB = b[0].split('/').length;
    return depthA - depthB;
  });
  return entries.map(([path]) => path);
}

/**
 * Build a path map from a flat list of locations using parent_id to
 * reconstruct the hierarchy.  Returns "Parent/Child/Grandchild" -> Location.
 */
function buildPathsFromFlatLocations(
  locations: Location[]
): Map<string, Location> {
  const result = new Map<string, Location>();
  const idToLocation = new Map<number, Location>();
  const idToPath = new Map<number, string>();

  // Index locations by id
  for (const loc of locations) {
    idToLocation.set(loc.id, loc);
  }

  // Resolve full path for a location by walking up parent_id chain
  function resolvePath(loc: Location): string {
    const cached = idToPath.get(loc.id);
    if (cached !== undefined) return cached;

    let path: string;
    if (loc.parent_id && idToLocation.has(loc.parent_id)) {
      const parentPath = resolvePath(idToLocation.get(loc.parent_id)!);
      path = `${parentPath}/${loc.name}`;
    } else {
      path = loc.name;
    }

    idToPath.set(loc.id, path);
    return path;
  }

  for (const loc of locations) {
    const path = resolvePath(loc);
    result.set(path, loc);
  }

  return result;
}

/**
 * Get API base path for locations (admin endpoint)
 */
function getLocationsPath(): string {
  return '/v1.0/admin/locations';
}

/**
 * Get API base path for devices (admin endpoint)
 */
function getDevicesPath(): string {
  return '/v1.0/admin/things';
}

/**
 * Get API base path for registry
 */
function getRegistryPath(): string {
  const clientId = getConfig('clientId');
  return `/v1.1/organizations/${clientId}/applications/${clientId}/things/registry`;
}

/**
 * Get API base path for templates
 */
function getTemplatesPath(): string {
  const clientId = getConfig('clientId');
  return `/v1.1/organizations/${clientId}/applications/${clientId}/things/types`;
}

/**
 * Extract template info for device creation
 * - device_category = template.category
 * - sensor_use = device_use where default=true
 * - sensor_type = meta where key='device_type'
 */
function extractTemplateInfo(template: DeviceTemplate): TemplateInfo {
  const info: TemplateInfo = {};

  // device_category from template.category
  if (template.category) {
    info.device_category = template.category;
  }

  // sensor_use from device_use where default=true
  if (template.device_use && template.device_use.length > 0) {
    const defaultUse = template.device_use.find((du) => du.default);
    if (defaultUse) {
      info.sensor_use = defaultUse.name;
    }
  }

  // sensor_type from meta where key='device_type'
  if (template.meta && template.meta.length > 0) {
    const deviceTypeMeta = template.meta.find((m) => m.key === 'device_type');
    if (deviceTypeMeta) {
      info.sensor_type = deviceTypeMeta.value;
    }
  }

  return info;
}

/**
 * Extract form_settings fields from a device type template's meta array.
 * Returns a flat array of fields sorted by group order then field order.
 * Returns empty array if no form_settings meta entry exists.
 */
export function extractFormSettings(template: DeviceTemplate): FormSettingsField[] {
  if (!template.meta || template.meta.length === 0) return [];

  const formSettingsMeta = template.meta.find((m) => m.key === 'form_settings');
  if (!formSettingsMeta) return [];

  try {
    const groups: FormSettingsGroup[] = JSON.parse(formSettingsMeta.value);
    return groups
      .sort((a, b) => a.order - b.order)
      .flatMap((group) =>
        (group.variables || []).sort((a, b) => a.order - b.order)
      );
  } catch {
    return [];
  }
}

/**
 * Validate that all rows with a device_type_id match the expected value.
 * Returns an object with valid flag and list of mismatched rows.
 */
function validateDeviceTypeConsistency(
  rows: ParsedRow[],
  expectedDeviceTypeId: string
): { valid: boolean; mismatches: { rowNumber: number; found: string }[] } {
  const mismatches: { rowNumber: number; found: string }[] = [];

  for (const row of rows) {
    if (row.device.device_type_id && row.device.device_type_id !== expectedDeviceTypeId) {
      mismatches.push({
        rowNumber: row.rowNumber,
        found: row.device.device_type_id,
      });
    }
  }

  return {
    valid: mismatches.length === 0,
    mismatches,
  };
}

/**
 * Prompt the user for form_settings values.
 * Fields already provided via cliOverrides are skipped.
 * Returns a Record<string, string> of key -> value.
 */
export async function promptFormSettings(
  fields: FormSettingsField[],
  cliOverrides: Record<string, string>
): Promise<Record<string, string>> {
  const { select, input } = await import('@inquirer/prompts');
  const values: Record<string, string> = {};

  console.log(chalk.cyan('\nDevice Settings'));
  console.log(chalk.gray('Configure settings that will be applied to all imported devices.\n'));

  for (const field of fields) {
    // If CLI override provided, use it
    if (cliOverrides[field.key] !== undefined) {
      values[field.key] = cliOverrides[field.key];
      console.log(chalk.gray(`  ${field.label}: ${cliOverrides[field.key]} (from --device-setting)`));
      continue;
    }

    // Show help text if available
    if (field.help_texts && field.help_texts.length > 0) {
      const sortedHelp = [...field.help_texts].sort((a, b) => a.order - b.order);
      for (const ht of sortedHelp) {
        console.log(chalk.gray(`  ℹ ${ht.value}`));
      }
    }

    if (field.form === 'select' && field.values && field.values.length > 0) {
      const answer = await select({
        message: field.label,
        choices: field.values.map((v) => ({
          name: v.label,
          value: v.value,
        })),
        default: String(field.default_value),
      });
      values[field.key] = answer;
    } else {
      const answer = await input({
        message: field.label,
        default: field.default_value !== undefined ? String(field.default_value) : undefined,
        validate: field.required ? (v: string) => (v.trim() ? true : `${field.label} is required`) : undefined,
      });
      values[field.key] = answer;
    }
  }

  return values;
}

/**
 * Fetch a single device type template by ID.
 * Exported for use by the CLI command to extract form_settings.
 */
export async function fetchDeviceType(deviceTypeId: string): Promise<DeviceTemplate> {
  return await apiGet<DeviceTemplate>(`${getTemplatesPath()}/${deviceTypeId}`);
}

/**
 * Fetch device templates by IDs
 */
async function fetchTemplates(templateIds: string[]): Promise<Map<string, TemplateInfo>> {
  const templateMap = new Map<string, TemplateInfo>();

  if (templateIds.length === 0) return templateMap;

  // Fetch each template (API doesn't support batch lookup)
  for (const templateId of templateIds) {
    try {
      const template = await apiGet<DeviceTemplate>(`${getTemplatesPath()}/${templateId}`);
      templateMap.set(templateId, extractTemplateInfo(template));
    } catch {
      // Template not found, will use fallback values
    }
  }

  return templateMap;
}

/**
 * Fetch existing locations for a user, paginating through all results
 */
async function fetchExistingLocations(userId?: string): Promise<Map<string, Location>> {
  try {
    const allLocations: Location[] = [];
    let page = 0;
    const limit = 100;

    // Paginate through all locations
    while (true) {
      const params: Record<string, unknown> = { limit, page };
      if (userId) {
        params.user_id = userId;
      }
      const response = await apiGet<LocationsResponse>(getLocationsPath(), params);
      allLocations.push(...response.rows);

      // Stop when we've fetched all locations
      if (allLocations.length >= response.count || response.rows.length < limit) {
        break;
      }
      page++;
    }

    return buildPathsFromFlatLocations(allLocations);
  } catch {
    // No existing locations or error fetching
  }

  return new Map<string, Location>();
}

/**
 * Validate hardware IDs against registry
 */
async function validateHardwareIds(hardwareIds: string[]): Promise<Map<string, RegistryEntry>> {
  const registry = new Map<string, RegistryEntry>();

  if (hardwareIds.length === 0) return registry;

  try {
    // Batch lookup - API supports filter
    const filter = `hardware_id in ${hardwareIds.join(' ')}`;
    const response = await apiGet<RegistryResponse>(getRegistryPath(), {
      filter,
      limit: hardwareIds.length,
    });

    for (const entry of response.rows) {
      registry.set(entry.hardware_id, entry);
    }
  } catch {
    // Registry lookup failed, continue without validation
  }

  return registry;
}

interface LocationCreateData {
  name: string;
  external_id?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  zip?: string;
  timezone?: string;
  industry?: string;
}

/**
 * Create a new location
 */
async function createLocation(
  locationData: LocationCreateData,
  parentId: number | null,
  userId?: string,
  companyId?: number
): Promise<Location> {
  const payload: Record<string, unknown> = {
    name: locationData.name,
  };

  if (parentId) payload.parent_id = parentId;
  if (userId) payload.user_id = userId;
  if (companyId) payload.company_id = companyId;
  if (locationData.external_id) payload.external_id = locationData.external_id;
  if (locationData.address) payload.address = locationData.address;
  if (locationData.city) payload.city = locationData.city;
  if (locationData.state) payload.state = locationData.state;
  if (locationData.country) payload.country = locationData.country;
  if (locationData.zip) payload.zip = locationData.zip;
  if (locationData.timezone) payload.timezone = locationData.timezone;
  if (locationData.industry) payload.industry = locationData.industry;

  return await apiPost<Location>(getLocationsPath(), payload);
}

/**
 * Create a new device
 */
async function createDevice(
  deviceData: ParsedRow['device'],
  locationId: number,
  userId?: string,
  companyId?: number,
  templateInfo?: TemplateInfo
): Promise<Device> {
  const clientId = getConfig('clientId');

  // Use template values as fallbacks for device fields
  const sensorUse = deviceData.sensor_use || templateInfo?.sensor_use;
  const sensorType = deviceData.sensor_type || templateInfo?.sensor_type;
  const deviceCategory = deviceData.device_category || templateInfo?.device_category;

  const payload: Record<string, unknown> = {
    user_id: userId || clientId,
    application_id: clientId,
    company_id: companyId,
    location_id: locationId,
    device: {
      hardware_id: deviceData.hardware_id,
      name: deviceData.name || deviceData.hardware_id,
      sensor_use: sensorUse,
      sensor_type: sensorType,
      device_category: deviceCategory,
      external_id: deviceData.external_id,
    },
  };

  // Add metadata if provided
  if (deviceData.metadata && Object.keys(deviceData.metadata).length > 0) {
    payload.metadata = deviceData.metadata;
  }

  return await apiPost<Device>(getDevicesPath(), payload);
}

/**
 * Update a device's properties by merging new values into existing ones.
 * The device's properties field is a stringified JSON object.
 * New values override existing keys; existing keys not in newProperties are preserved.
 */
async function updateDeviceProperties(
  deviceId: number | string,
  existingProperties: string | undefined,
  newProperties: Record<string, string>,
  userId?: string
): Promise<void> {
  const clientId = getConfig('clientId');

  let properties: Record<string, unknown> = {};
  if (existingProperties) {
    try {
      properties = typeof existingProperties === 'string'
        ? JSON.parse(existingProperties)
        : (existingProperties as unknown as Record<string, unknown>);
    } catch {
      properties = {};
    }
  }

  for (const [key, value] of Object.entries(newProperties)) {
    properties[key] = value;
  }

  await apiPut(`${getDevicesPath()}/${deviceId}`, {
    user_id: userId || clientId,
    application_id: clientId,
    properties,
  });
}

/**
 * Get the deepest location path for a row
 */
function getDeepestLocationPath(row: ParsedRow, prefixColumnName: boolean = true): string | undefined {
  if (row.locationHierarchy.length === 0) return undefined;

  let path = '';
  for (const level of row.locationHierarchy) {
    const name = formatLocationName(level, prefixColumnName);
    path = path ? `${path}/${name}` : name;
  }
  return path;
}

/**
 * Main bulk import function
 */
export async function bulkImport(
  rows: ParsedRow[],
  options: {
    userId?: string;
    companyId?: number;
    dryRun?: boolean;
    locationDefaults?: LocationDefaults;
    deviceTypeId?: string;
    deviceSettings?: Record<string, string>;
    prefixLocationName?: boolean;
    onProgress?: (current: number, total: number, message: string) => void;
  }
): Promise<ImportSummary> {
  const { userId, companyId, dryRun = false, locationDefaults = {}, deviceTypeId, deviceSettings, prefixLocationName = true, onProgress } = options;

  const summary: ImportSummary = {
    locationsCreated: 0,
    locationsMatched: 0,
    locationsFailed: 0,
    devicesCreated: 0,
    devicesMatched: 0,
    devicesFailed: 0,
    results: [],
  };

  // Step 0: Validate device type consistency if deviceTypeId is specified
  if (deviceTypeId) {
    const consistency = validateDeviceTypeConsistency(rows, deviceTypeId);
    if (!consistency.valid) {
      const mismatchDetails = consistency.mismatches
        .map((m) => `  Row ${m.rowNumber}: found "${m.found}"`)
        .join('\n');
      throw new Error(
        `Device type ID mismatch. All rows must use device type "${deviceTypeId}":\n${mismatchDetails}`
      );
    }
  }

  // Step 1: Fetch existing locations
  onProgress?.(0, rows.length, 'Fetching existing locations...');
  const existingLocations = await fetchExistingLocations(userId);

  // Step 2: Build location paths from CSV
  const locationPaths = buildLocationPaths(rows, prefixLocationName);

  // Step 3: Sort locations by depth (parents first)
  const sortedPaths = sortLocationsByDepth(locationPaths);

  // Step 4: Create/match locations
  const locationIdMap = new Map<string, number>(); // path -> id

  // Create new locations in order (parents before children)
  for (const path of sortedPaths) {
    const node = locationPaths.get(path)!;

    // Check if already exists by full hierarchy path
    if (existingLocations.has(path)) {
      const existing = existingLocations.get(path)!;
      locationIdMap.set(path, existing.id);
      summary.locationsMatched++;
      summary.results.push({
        success: true,
        row: 0,
        type: 'location',
        action: 'matched',
        name: node.name,
        id: existing.id,
      });
      continue;
    }

    // Get parent ID from the path map
    let parentId: number | null = null;
    if (node.parentPath) {
      parentId = locationIdMap.get(node.parentPath) || null;
      if (!parentId) {
        summary.locationsFailed++;
        summary.results.push({
          success: false,
          row: 0,
          type: 'location',
          action: 'failed',
          name: node.name,
          error: `Parent location not found for path: ${node.parentPath}`,
        });
        continue;
      }
    }

    if (dryRun) {
      summary.locationsCreated++;
      summary.results.push({
        success: true,
        row: 0,
        type: 'location',
        action: 'created',
        name: node.name,
        id: undefined,
      });
      locationIdMap.set(path, -1); // Placeholder for dry run
      continue;
    }

    // Create location
    try {
      const locationData = {
        name: node.name,
        ...locationDefaults,  // Apply defaults first
        ...node.meta,         // CSV values override defaults
      };
      const newLoc = await createLocation(locationData, parentId, userId, companyId);
      locationIdMap.set(path, newLoc.id);
      summary.locationsCreated++;
      summary.results.push({
        success: true,
        row: 0,
        type: 'location',
        action: 'created',
        name: node.name,
        id: newLoc.id,
      });
    } catch (err) {
      summary.locationsFailed++;
      summary.results.push({
        success: false,
        row: 0,
        type: 'location',
        action: 'failed',
        name: node.name,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  // Step 5: Fetch device templates
  const templateIds = [...new Set(
    rows
      .filter((r) => r.device.device_type_id)
      .map((r) => r.device.device_type_id!)
  )];

  let templateMap = new Map<string, TemplateInfo>();
  if (templateIds.length > 0) {
    onProgress?.(0, rows.length, 'Fetching device templates...');
    templateMap = await fetchTemplates(templateIds);
  }

  // Step 6: Validate hardware IDs
  const hardwareIds = rows
    .filter((r) => r.device.hardware_id)
    .map((r) => r.device.hardware_id!);

  onProgress?.(0, rows.length, 'Validating hardware IDs...');
  await validateHardwareIds(hardwareIds);

  // Step 7: Create devices
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    onProgress?.(i + 1, rows.length, `Processing row ${row.rowNumber}...`);

    if (!row.device.hardware_id) {
      continue; // No device in this row
    }

    // Get location ID for the deepest level
    const locationPath = getDeepestLocationPath(row, prefixLocationName);
    let locationId: number | undefined;

    if (locationPath) {
      locationId = locationIdMap.get(locationPath);
      if (!locationId && !dryRun) {
        summary.devicesFailed++;
        summary.results.push({
          success: false,
          row: row.rowNumber,
          type: 'device',
          action: 'failed',
          name: row.device.name || row.device.hardware_id,
          error: `Location not found for path: ${locationPath}`,
        });
        continue;
      }
    }

    if (dryRun) {
      summary.devicesCreated++;
      summary.results.push({
        success: true,
        row: row.rowNumber,
        type: 'device',
        action: 'created',
        name: row.device.name || row.device.hardware_id,
      });
      continue;
    }

    // Create device
    try {
      // Get template info if device_type_id is provided
      const templateInfo = row.device.device_type_id
        ? templateMap.get(row.device.device_type_id)
        : undefined;

      const device = await createDevice(row.device, locationId!, userId, companyId, templateInfo);

      // Apply form_settings as device properties if provided
      if (deviceSettings && Object.keys(deviceSettings).length > 0) {
        try {
          await updateDeviceProperties(device.id, device.properties, deviceSettings, userId);
        } catch (err) {
          // Warn but don't fail the device - it was created successfully
          summary.results.push({
            success: true,
            row: row.rowNumber,
            type: 'device',
            action: 'created',
            name: row.device.name || row.device.hardware_id,
            id: device.id,
            error: `Device created but settings failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          });
          summary.devicesCreated++;
          continue;
        }
      }

      summary.devicesCreated++;
      summary.results.push({
        success: true,
        row: row.rowNumber,
        type: 'device',
        action: 'created',
        name: row.device.name || row.device.hardware_id,
        id: device.id,
      });
    } catch (err) {
      summary.devicesFailed++;
      summary.results.push({
        success: false,
        row: row.rowNumber,
        type: 'device',
        action: 'failed',
        name: row.device.name || row.device.hardware_id,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return summary;
}

/**
 * Display import summary
 */
export function displayImportSummary(summary: ImportSummary, dryRun: boolean): void {
  console.log();
  console.log(chalk.cyan(dryRun ? 'Dry Run Complete' : 'Import Complete'));
  console.log(chalk.gray('─'.repeat(40)));

  console.log(
    `Locations:  ${chalk.green(summary.locationsCreated + ' created')}, ` +
    `${chalk.blue(summary.locationsMatched + ' matched')}, ` +
    `${chalk.red(summary.locationsFailed + ' failed')}`
  );

  console.log(
    `Devices:    ${chalk.green(summary.devicesCreated + ' created')}, ` +
    `${chalk.blue(summary.devicesMatched + ' matched')}, ` +
    `${chalk.red(summary.devicesFailed + ' failed')}`
  );

  // Show failures
  const failures = summary.results.filter((r) => !r.success);
  if (failures.length > 0) {
    console.log();
    console.log(chalk.red('Failed rows:'));
    for (const failure of failures) {
      const rowInfo = failure.row > 0 ? `Row ${failure.row}: ` : '';
      console.log(
        `  ${rowInfo}${failure.type} "${failure.name}" - ${failure.error}`
      );
    }
  }

  console.log(chalk.gray('─'.repeat(40)));
}
