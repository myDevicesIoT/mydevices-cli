import { describe, expect, test } from 'bun:test';
import {
  validateUpdateRows,
  buildLocationIndex,
  resolveRoom,
  buildUpdatePlan,
  type LocationLite,
  type DeviceLite,
} from './bulk-update.js';

describe('validateUpdateRows', () => {
  test('parses a row with lookup value and new fields, trimming whitespace', () => {
    const { valid, errors } = validateUpdateRows(
      [{ external_id: ' B144468 ', new_external_id: 'B146817 ', new_name: 'B146817', new_room: '' }],
      'external_id'
    );
    expect(errors).toEqual([]);
    expect(valid).toEqual([
      {
        rowNumber: 2,
        lookupValue: 'B144468',
        newExternalId: 'B146817',
        newName: 'B146817',
      },
    ]);
  });

  test('reports an error for a row missing the lookup value', () => {
    const { valid, errors } = validateUpdateRows(
      [{ external_id: '', new_name: 'X' }],
      'external_id'
    );
    expect(valid).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].rowNumber).toBe(2);
    expect(errors[0].error).toContain('external_id');
  });

  test('reports an error for a row with no update fields', () => {
    const { valid, errors } = validateUpdateRows(
      [{ external_id: 'B144468' }],
      'external_id'
    );
    expect(valid).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].error).toContain('no update');
  });

  test('skips completely empty rows silently', () => {
    const { valid, errors } = validateUpdateRows(
      [{ external_id: '', new_name: '', new_room: ' ' }],
      'external_id'
    );
    expect(valid).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('supports hardware_id as the lookup column', () => {
    const { valid, errors } = validateUpdateRows(
      [{ hardware_id: '24E124148056EEEA', new_room: '4F-L432' }],
      'hardware_id'
    );
    expect(errors).toEqual([]);
    expect(valid[0].lookupValue).toBe('24E124148056EEEA');
    expect(valid[0].newRoom).toBe('4F-L432');
  });
});

const LOCATIONS: LocationLite[] = [
  { id: 1, name: 'GSK Cambridge Park Drive', parent_id: null },
  { id: 2, name: 'Main Building', parent_id: 1 },
  { id: 3, name: 'Floor 04', parent_id: 2 },
  { id: 4, name: '4F-L432', parent_id: 3 },
  { id: 5, name: 'Floor 05', parent_id: 2 },
  { id: 6, name: '5F-L520', parent_id: 5 },
  // Deliberate duplicate room name on two floors
  { id: 7, name: 'L100', parent_id: 3 },
  { id: 8, name: 'L100', parent_id: 5 },
];

describe('buildLocationIndex / resolveRoom', () => {
  const index = buildLocationIndex(LOCATIONS);

  test('pathOf reconstructs the full hierarchy path', () => {
    expect(index.pathOf(4)).toBe('GSK Cambridge Park Drive/Main Building/Floor 04/4F-L432');
  });

  test('resolves a uniquely named room', () => {
    const result = resolveRoom('4F-L432', index);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.location.id).toBe(4);
  });

  test('fails with the room name when the room does not exist', () => {
    const result = resolveRoom('9F-L999', index);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('9F-L999');
  });

  test('fails as ambiguous when two locations share the name, listing paths', () => {
    const result = resolveRoom('L100', index);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('ambiguous');
      expect(result.error).toContain('Floor 04/L100');
      expect(result.error).toContain('Floor 05/L100');
    }
  });
});

function deviceMap(entries: [string, DeviceLite[]][]): Map<string, DeviceLite[]> {
  return new Map(entries);
}

describe('buildUpdatePlan', () => {
  const index = buildLocationIndex(LOCATIONS);
  const dev = (over: Partial<DeviceLite> = {}): DeviceLite => ({
    id: 100,
    thing_name: 'B144468',
    external_id: 'B144468',
    hardware_id: '24E124148056EEEA',
    location_id: 4,
    ...over,
  });

  test('plans a rename when name and external_id change', () => {
    const [entry] = buildUpdatePlan(
      [{ rowNumber: 2, lookupValue: 'B144468', newExternalId: 'B146817', newName: 'B146817' }],
      deviceMap([['B144468', [dev()]]]),
      index
    );
    expect(entry.status).toBe('ready');
    expect(entry.changes).toEqual({ thing_name: 'B146817', external_id: 'B146817' });
    expect(entry.device?.id).toBe(100);
  });

  test('is a noop when requested values already match the device', () => {
    const [entry] = buildUpdatePlan(
      [{ rowNumber: 2, lookupValue: 'B144468', newExternalId: 'B144468', newName: 'B144468' }],
      deviceMap([['B144468', [dev()]]]),
      index
    );
    expect(entry.status).toBe('noop');
    expect(entry.changes).toEqual({});
  });

  test('only includes the fields that actually change', () => {
    const [entry] = buildUpdatePlan(
      [{ rowNumber: 2, lookupValue: 'B144468', newExternalId: 'B146817', newName: 'B144468' }],
      deviceMap([['B144468', [dev()]]]),
      index
    );
    expect(entry.status).toBe('ready');
    expect(entry.changes).toEqual({ external_id: 'B146817' });
  });

  test('errors when the device is not found', () => {
    const [entry] = buildUpdatePlan(
      [{ rowNumber: 2, lookupValue: 'B999999', newName: 'X' }],
      deviceMap([]),
      index
    );
    expect(entry.status).toBe('error');
    expect(entry.error).toContain('not found');
  });

  test('errors when multiple devices match the lookup value', () => {
    const [entry] = buildUpdatePlan(
      [{ rowNumber: 2, lookupValue: 'B144468', newName: 'X' }],
      deviceMap([['B144468', [dev(), dev({ id: 101 })]]]),
      index
    );
    expect(entry.status).toBe('error');
    expect(entry.error).toContain('2 devices');
  });

  test('plans a room move with resolved location id and path', () => {
    const [entry] = buildUpdatePlan(
      [{ rowNumber: 2, lookupValue: 'B144468', newRoom: '5F-L520' }],
      deviceMap([['B144468', [dev()]]]),
      index
    );
    expect(entry.status).toBe('ready');
    expect(entry.changes).toEqual({ location_id: 6 });
    expect(entry.targetRoomPath).toBe('GSK Cambridge Park Drive/Main Building/Floor 05/5F-L520');
  });

  test('is a noop when the device is already in the target room', () => {
    const [entry] = buildUpdatePlan(
      [{ rowNumber: 2, lookupValue: 'B144468', newRoom: '4F-L432' }],
      deviceMap([['B144468', [dev()]]]),
      index
    );
    expect(entry.status).toBe('noop');
    expect(entry.changes).toEqual({});
  });

  test('treats string vs numeric location ids as the same room', () => {
    const [entry] = buildUpdatePlan(
      [{ rowNumber: 2, lookupValue: 'B144468', newRoom: '4F-L432' }],
      deviceMap([['B144468', [dev({ location_id: '4' })]]]),
      index
    );
    expect(entry.status).toBe('noop');
  });

  test('errors when the target room cannot be resolved', () => {
    const [entry] = buildUpdatePlan(
      [{ rowNumber: 2, lookupValue: 'B144468', newRoom: '9F-L999' }],
      deviceMap([['B144468', [dev()]]]),
      index
    );
    expect(entry.status).toBe('error');
    expect(entry.error).toContain('9F-L999');
  });
});
