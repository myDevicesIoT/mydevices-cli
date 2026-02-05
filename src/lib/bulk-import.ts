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

interface DeviceTemplate {
  id: string;
  name: string;
  category?: string;  // This becomes device_category
  meta?: TemplateMeta[];
  device_use?: DeviceUse[];
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
    for (const [csvColumn, target] of Object.entries(mappings)) {
      if (!target || target === 'location.hierarchy') continue;

      const value = row[csvColumn]?.trim();
      if (!value) continue;

      if (target.startsWith('location.')) {
        const field = target.replace('location.', '') as keyof ParsedRow['locationMeta'];
        (parsed.locationMeta as Record<string, string>)[field] = value;
      } else if (target.startsWith('device.metadata.')) {
        // Handle device metadata fields
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

function buildLocationPaths(rows: ParsedRow[]): Map<string, LocationNode> {
  const locations = new Map<string, LocationNode>();

  for (const row of rows) {
    if (row.locationHierarchy.length === 0) continue;

    // Build each level of the hierarchy
    let currentPath = '';
    for (let i = 0; i < row.locationHierarchy.length; i++) {
      const level = row.locationHierarchy[i];
      const name = `${level.columnName} ${level.value}`;
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
 * Flatten nested locations from API response
 */
function flattenLocations(locations: Location[], result: Location[] = []): Location[] {
  for (const loc of locations) {
    result.push(loc);
    if (loc.locations && loc.locations.length > 0) {
      flattenLocations(loc.locations, result);
    }
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
 * Fetch existing locations for a user
 */
async function fetchExistingLocations(userId?: string): Promise<Map<string, Location>> {
  const locationMap = new Map<string, Location>();

  try {
    const params: Record<string, unknown> = { limit: 100 };
    if (userId) {
      params.user_id = userId;
    }
    const response = await apiGet<LocationsResponse>(getLocationsPath(), params);

    const flattened = flattenLocations(response.rows);
    for (const loc of flattened) {
      // Key by name (and parent for uniqueness)
      const key = loc.parent_id ? `${loc.name}::${loc.parent_id}` : loc.name;
      locationMap.set(key, loc);
      // Also map by just name for simpler lookups
      if (!locationMap.has(loc.name)) {
        locationMap.set(loc.name, loc);
      }
    }
  } catch {
    // No existing locations or error fetching
  }

  return locationMap;
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
 * Get the deepest location path for a row
 */
function getDeepestLocationPath(row: ParsedRow): string | undefined {
  if (row.locationHierarchy.length === 0) return undefined;

  let path = '';
  for (const level of row.locationHierarchy) {
    const name = `${level.columnName} ${level.value}`;
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
    onProgress?: (current: number, total: number, message: string) => void;
  }
): Promise<ImportSummary> {
  const { userId, companyId, dryRun = false, locationDefaults = {}, onProgress } = options;

  const summary: ImportSummary = {
    locationsCreated: 0,
    locationsMatched: 0,
    locationsFailed: 0,
    devicesCreated: 0,
    devicesMatched: 0,
    devicesFailed: 0,
    results: [],
  };

  // Step 1: Fetch existing locations
  onProgress?.(0, rows.length, 'Fetching existing locations...');
  const existingLocations = await fetchExistingLocations(userId);

  // Step 2: Build location paths from CSV
  const locationPaths = buildLocationPaths(rows);

  // Step 3: Sort locations by depth (parents first)
  const sortedPaths = sortLocationsByDepth(locationPaths);

  // Step 4: Create/match locations
  const locationIdMap = new Map<string, number>(); // path -> id

  // First, try to match existing locations by name
  for (const [name, loc] of existingLocations) {
    if (!name.includes('::')) {
      locationIdMap.set(name, loc.id);
    }
  }

  // Create new locations in order (parents before children)
  for (const path of sortedPaths) {
    const node = locationPaths.get(path)!;

    // Check if already exists by name (simple match)
    if (existingLocations.has(node.name)) {
      const existing = existingLocations.get(node.name)!;
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
    const locationPath = getDeepestLocationPath(row);
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
