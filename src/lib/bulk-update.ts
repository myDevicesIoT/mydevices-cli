// Core logic for `bulk update` — CSV-driven device field/location updates.

export interface UpdateRow {
  rowNumber: number;
  lookupValue: string;
  newExternalId?: string;
  newName?: string;
  newRoom?: string;
}

export interface RowValidationError {
  rowNumber: number;
  error: string;
}

export interface LocationLite {
  id: number;
  name: string;
  parent_id: number | null;
}

export interface LocationIndex {
  byName: Map<string, LocationLite[]>;
  pathOf: (id: number) => string;
}

export interface DeviceLite {
  id: number | string;
  thing_name: string;
  external_id?: string;
  hardware_id?: string;
  // The admin things API types this as string while locations use numeric ids
  location_id?: number | string;
}

export interface DeviceChanges {
  thing_name?: string;
  external_id?: string;
  location_id?: number;
}

export interface PlanEntry {
  rowNumber: number;
  lookupValue: string;
  device?: DeviceLite;
  changes: DeviceChanges;
  targetRoomPath?: string;
  status: 'ready' | 'noop' | 'error';
  error?: string;
}

export function validateUpdateRows(
  rows: Record<string, string>[],
  lookupColumn: string
): { valid: UpdateRow[]; errors: RowValidationError[] } {
  const valid: UpdateRow[] = [];
  const errors: RowValidationError[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2; // 1-indexed plus header row
    const lookupValue = row[lookupColumn]?.trim();
    const newExternalId = row['new_external_id']?.trim();
    const newName = row['new_name']?.trim();
    const newRoom = row['new_room']?.trim();
    const hasChanges = !!(newExternalId || newName || newRoom);

    if (!lookupValue) {
      // Completely empty rows (e.g. trailing blank lines) are skipped silently
      if (hasChanges) {
        errors.push({ rowNumber, error: `Missing ${lookupColumn} value` });
      }
      return;
    }

    if (!hasChanges) {
      errors.push({
        rowNumber,
        error: 'Row has no update fields (new_external_id, new_name, new_room)',
      });
      return;
    }

    const parsed: UpdateRow = { rowNumber, lookupValue };
    if (newExternalId) parsed.newExternalId = newExternalId;
    if (newName) parsed.newName = newName;
    if (newRoom) parsed.newRoom = newRoom;
    valid.push(parsed);
  });

  return { valid, errors };
}

export function buildLocationIndex(locations: LocationLite[]): LocationIndex {
  const byId = new Map<number, LocationLite>();
  const byName = new Map<string, LocationLite[]>();

  for (const loc of locations) {
    byId.set(loc.id, loc);
    const list = byName.get(loc.name) || [];
    list.push(loc);
    byName.set(loc.name, list);
  }

  const pathCache = new Map<number, string>();
  function pathOf(id: number): string {
    const cached = pathCache.get(id);
    if (cached !== undefined) return cached;

    const loc = byId.get(id);
    if (!loc) return `<unknown location ${id}>`;

    const path =
      loc.parent_id !== null && byId.has(loc.parent_id)
        ? `${pathOf(loc.parent_id)}/${loc.name}`
        : loc.name;
    pathCache.set(id, path);
    return path;
  }

  return { byName, pathOf };
}

export function resolveRoom(
  name: string,
  index: LocationIndex
): { ok: true; location: LocationLite } | { ok: false; error: string } {
  const matches = index.byName.get(name) || [];

  if (matches.length === 0) {
    return { ok: false, error: `Room "${name}" not found` };
  }
  if (matches.length > 1) {
    const paths = matches.map((loc) => index.pathOf(loc.id)).join(', ');
    return {
      ok: false,
      error: `Room "${name}" is ambiguous (${matches.length} matches: ${paths})`,
    };
  }
  return { ok: true, location: matches[0] };
}

export function buildUpdatePlan(
  rows: UpdateRow[],
  devices: Map<string, DeviceLite[]>,
  index: LocationIndex
): PlanEntry[] {
  return rows.map((row) => {
    const matches = devices.get(row.lookupValue) || [];

    if (matches.length === 0) {
      return {
        rowNumber: row.rowNumber,
        lookupValue: row.lookupValue,
        changes: {},
        status: 'error' as const,
        error: `Device not found for "${row.lookupValue}"`,
      };
    }
    if (matches.length > 1) {
      return {
        rowNumber: row.rowNumber,
        lookupValue: row.lookupValue,
        changes: {},
        status: 'error' as const,
        error: `${matches.length} devices match "${row.lookupValue}" — refusing to guess`,
      };
    }

    const device = matches[0];
    const entry: PlanEntry = {
      rowNumber: row.rowNumber,
      lookupValue: row.lookupValue,
      device,
      changes: {},
      status: 'noop',
    };

    if (row.newName && row.newName !== device.thing_name) {
      entry.changes.thing_name = row.newName;
    }
    if (row.newExternalId && row.newExternalId !== device.external_id) {
      entry.changes.external_id = row.newExternalId;
    }
    if (row.newRoom) {
      const room = resolveRoom(row.newRoom, index);
      if (!room.ok) {
        entry.status = 'error';
        entry.error = room.error;
        entry.changes = {};
        return entry;
      }
      entry.targetRoomPath = index.pathOf(room.location.id);
      if (String(room.location.id) !== String(device.location_id ?? '')) {
        entry.changes.location_id = room.location.id;
      }
    }

    if (Object.keys(entry.changes).length > 0) {
      entry.status = 'ready';
    }
    return entry;
  });
}
