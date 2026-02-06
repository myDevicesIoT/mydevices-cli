# Bulk Import Guide

Import locations and devices from CSV files with automatic hierarchy support.

## Overview

The bulk import command allows you to:

- Import locations with multi-level hierarchies (e.g., Site → Building → Floor → Room)
- Create devices and assign them to locations
- Match existing locations to avoid duplicates
- Validate imports with dry-run mode
- Save and reuse column mappings

## Quick Start

```bash
# Interactive import with dry-run validation
mydevices bulk import ./data.csv --company <company-id> --dry-run

# Import with saved mapping
mydevices bulk import ./data.csv --company <company-id> --mapping ./my-mapping.json

# Import to a specific user (admin mode)
mydevices bulk import ./data.csv --company <company-id> --user <user-id>
```

## CSV Format

Your CSV file should contain columns for locations and devices. The CLI auto-detects the delimiter (comma, semicolon, tab, or pipe).

### Example CSV

```csv
Site,Building,Floor,Room,Serial Number,Device Name,Category
RX,7,0,41,SN-001,Temperature Sensor,Sensor
RX,7,0,41,SN-002,Humidity Sensor,Sensor
RX,8,0,68,SN-003,Door Sensor,Security
EMEA,Brussels,1,Reception,SN-004,Motion Detector,Security
```

## Column Mapping

### Interactive Mapping

When you run the import command without a mapping file, you'll be prompted to map each CSV column:

```
Column Mapping
Map each CSV column to a target field, or skip if not needed.
For location hierarchy, map columns in order (e.g., Site → Building → Floor → Room).
Press s to quickly skip a column.

? Map "Site" to: Location Hierarchy
? Map "Building" to: Location Hierarchy (Level 2)
? Map "Floor" to: Location Hierarchy (Level 3)
? Map "Room" to: Location Hierarchy (Level 4)
? Map "Serial Number" to: Device Hardware ID
? Map "Device Name" to: Device Name
? Map "Category" to: Device Sensor Use
```

**Keyboard shortcuts:**

| Key | Action |
|-----|--------|
| `s` | Skip the current column |
| `Esc` | Cancel the entire import |

### Available Target Fields

#### Location Fields

| Field | Description |
|-------|-------------|
| `Location Hierarchy` | Hierarchy level (can be mapped multiple times) |
| `Location External ID` | External reference ID (applied to deepest location) |
| `Location Address` | Street address |
| `Location City` | City name |
| `Location State` | State/Province |
| `Location Country` | Country code |
| `Location Timezone` | Timezone (e.g., America/New_York) |

#### Device Fields

| Field | Description |
|-------|-------------|
| `Device Hardware ID` | Hardware ID / DevEUI (required for devices) |
| `Device Name` | Display name |
| `Device External ID` | External reference ID |
| `Device Sensor Use` | Sensor use type |

### Location Hierarchy

The hierarchy feature allows you to create nested locations from multiple columns. Map columns in order from top to bottom:

```
Level 1: Site     → Creates "Site RX"
Level 2: Building → Creates "Building 7" under "Site RX"
Level 3: Floor    → Creates "Floor 0" under "Building 7"
Level 4: Room     → Creates "Room 41" under "Floor 0"
```

**Key behaviors:**
- Location names include the column name (e.g., "Building 7" not just "7")
- Locations are deduplicated automatically
- Parents are created before children
- Empty values stop the hierarchy at that level
- Devices are attached to the deepest location

### Saving Mappings

After interactive mapping, you'll be prompted to save the mapping for reuse:

```
? Save this mapping for reuse? Yes
? Save mapping to: my-mapping.json
✓ Mapping saved to my-mapping.json
```

Or use the `--save-mapping` flag:

```bash
mydevices bulk import ./data.csv --save-mapping my-mapping.json
```

### Mapping File Format

```json
{
  "version": "1.0",
  "mappings": {
    "Site": "location.hierarchy",
    "Building": "location.hierarchy",
    "Floor": "location.hierarchy",
    "Room": "location.hierarchy",
    "Serial Number": "device.hardware_id",
    "Device Name": "device.name",
    "Category": "device.sensor_use",
    "Notes": null
  },
  "hierarchy": {
    "columns": ["Site", "Building", "Floor", "Room"]
  },
  "createdAt": "2024-01-15T10:30:00.000Z"
}
```

## Command Options

```bash
mydevices bulk import <csv-file> --company <company-id> [options]
```

| Option | Description |
|--------|-------------|
| `--company <company-id>` | **Required.** Target company ID for locations |
| `--dry-run` | Validate without making changes |
| `--mapping <file>` | Use saved column mapping file |
| `--save-mapping <file>` | Save mapping to file after import |
| `--user <user-id>` | Target user ID (admin mode) |
| `--delimiter <char>` | Force CSV delimiter (auto-detect by default) |
| `--json` | Output results as JSON |
| `--output <file>` | Save detailed results to file |

## Examples

### Dry Run Validation

Always run a dry-run first to validate your data:

```bash
mydevices bulk import ./equipment.csv --company <company-id> --dry-run
```

Output:
```
✔ Parsed 1038 rows with 16 columns (delimiter: comma)

Mapping Summary:
──────────────────────────────────────────────────
  Location Hierarchy:
    Site     → Level 1
    Building → Level 2
    Floor    → Level 3
    Room     → Level 4

  Serial Number → device.hardware_id
  Device Name   → device.name
  Category      → device.sensor_use
──────────────────────────────────────────────────

Dry Run Complete
────────────────────────────────────────
Locations:  686 created, 0 matched, 0 failed
Devices:    1016 created, 0 matched, 0 failed
────────────────────────────────────────
```

### Import with Saved Mapping

```bash
mydevices bulk import ./equipment.csv --company <company-id> --mapping ./equipment-mapping.json
```

### Admin Mode Import

Import data to a specific user's account:

```bash
mydevices bulk import ./customer-data.csv --company 456 --user abc123-user-id
```

### Save Results

Save detailed import results to a JSON file:

```bash
mydevices bulk import ./data.csv --company <company-id> --output import-results.json
```

Results file format:
```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "csvFile": "./data.csv",
  "dryRun": false,
  "summary": {
    "locationsCreated": 50,
    "locationsMatched": 10,
    "locationsFailed": 0,
    "devicesCreated": 200,
    "devicesMatched": 5,
    "devicesFailed": 2
  },
  "results": [
    {
      "success": true,
      "row": 0,
      "type": "location",
      "action": "created",
      "name": "Site RX",
      "id": 12345
    },
    {
      "success": false,
      "row": 15,
      "type": "device",
      "action": "failed",
      "name": "SN-ERROR",
      "error": "Hardware ID not found in registry"
    }
  ]
}
```

## Import Behavior

### Partial Imports (Locations-Only)

You can import in two passes — first create the location hierarchy, then add devices later:

**Pass 1: Import locations only**

```bash
mydevices bulk import ./sites.csv --company <company-id> --user <user-id>
```

During column mapping, press `s` to skip all device columns. When no device fields are mapped, the import creates only the location hierarchy.

**Pass 2: Import devices into existing locations**

```bash
mydevices bulk import ./devices.csv --company <company-id> --user <user-id>
```

Map both hierarchy and device columns. Existing locations are matched by their full hierarchy path and devices are created under them.

### Location Matching

The import matches existing locations by their full hierarchy path:

- Locations are matched using the complete path (e.g., `Site RX/Building 7/Floor 0`), not just the name
- This means identically-named locations at different levels are correctly distinguished (e.g., "Floor 1" under "Building A" vs "Floor 1" under "Building B")
- If a location at the same path exists, it's reused (matched)
- If no match is found, a new location is created
- Parent locations are always created/matched before children

### Device Creation

For each row with a hardware ID:

1. The device is assigned to the deepest location in the hierarchy
2. If the hardware ID already exists, the row is skipped
3. Location metadata (address, city, etc.) is applied to the deepest location
4. Rows without a `hardware_id` are skipped (enabling locations-only imports)

### Error Handling

The import continues processing rows even if some fail. Failed rows are reported in the summary:

```
Failed rows:
  Row 15: device "SN-ERROR" - Hardware ID not found in registry
  Row 23: location "Invalid Site" - Parent location not found
```

## Tips

1. **Always dry-run first** - Validate your data before making changes
2. **Save your mappings** - Reuse mappings for similar CSV files
3. **Check for duplicates** - The import deduplicates locations but not devices
4. **Verify hierarchy order** - Map columns from top level to deepest level
5. **Use external IDs** - Map external IDs for easier cross-referencing

## See Also

- [Device Templates Guide](./device-templates.md) - Creating device templates
- [API Reference](./api-reference.md) - REST API endpoints
