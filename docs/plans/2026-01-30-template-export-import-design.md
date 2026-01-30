# Template Export/Import Feature Design

## Overview

Add the ability to export a device template (with all related data) to a JSON file, and import it into a different environment.

## Requirements

- Export includes: Template + Capabilities + Device Uses + Alert Settings + Attributes
- Single JSON file format
- Import always creates a new template
- Commands as subcommands under `templates`

## Command Interface

### Export

```bash
mydevices templates export <template-id> [options]

Options:
  -o, --output <file>   Output file path (default: stdout)
  --json                Force JSON output (default for export)
```

### Import

```bash
mydevices templates import <file> [options]

Options:
  --dry-run             Validate file and show what would be created, without making changes
  --json                Output result as JSON
```

### Examples

```bash
# Export to file
mydevices templates export abc123 -o sensor-template.json

# Export to stdout (for piping)
mydevices templates export abc123 > sensor-template.json

# Import from file
mydevices templates import sensor-template.json

# Preview import without creating
mydevices templates import sensor-template.json --dry-run
```

## Export File Structure

```json
{
  "version": "1.0",
  "exportedAt": "2026-01-30T12:00:00Z",
  "source": {
    "templateId": "abc123",
    "apiUrl": "https://api.mydevices.com"
  },
  "template": {
    "name": "Temperature Sensor",
    "description": "Indoor temp sensor",
    "category": "module",
    "subcategory": "lora",
    "manufacturer": "Acme",
    "model": "TEMP-100",
    "codec": "codec-id-if-any",
    "transport_protocol": "lorawan",
    "certifications": "FCC;CE",
    "ip_rating": "IP65"
  },
  "capabilities": [
    {
      "name": "Temperature",
      "channel": "500",
      "data_types_id": 27,
      "data": { }
    }
  ],
  "deviceUses": [],
  "alertSettings": [],
  "attributes": []
}
```

- `version`: Allows future format changes
- `source`: Informational only, not used during import

## Import Workflow

1. **Validate the file** - Check JSON syntax, required fields, and version compatibility
2. **Create the template** - POST to `/things/types` with template data
3. **Create capabilities** - POST each capability to `/things/types/{newId}/channels`
4. **Create device uses** - POST each device use to the appropriate endpoint
5. **Create alert settings** - POST each alert/rule template
6. **Set attributes** - POST metadata key-value pairs

### Success Output

```
✓ Template created: "Temperature Sensor" (id: xyz789)
✓ Created 3 capabilities
✓ Created 2 device uses
✓ Created 1 alert setting
✓ Created 4 attributes

Template imported successfully.
```

## Error Handling

### File Validation Errors

- Missing required fields: Clear error message listing what's missing
- Invalid JSON: Parse error with line number if possible
- Unsupported version: Error suggesting CLI upgrade

### API Errors During Import

- Auth failure: Prompt to run `mydevices auth login`
- Permission denied: Show which operation failed
- Network error: Suggest retry

### Codec Handling

- If the exported template references a codec ID, the import includes the codec ID in the template data
- If that codec doesn't exist in the target environment, the API will either reject it or create the template without the codec link
- Codec source files are not exported/imported (separate feature if needed)

### Dry-Run Mode

- Validates file structure
- Shows summary of what would be created
- Does not make any API calls

## Implementation Notes

### Files to Modify

- `src/commands/templates.ts` - Add export and import subcommands
- `src/types/template.ts` - Add TypeScript interfaces for export format

### Dependencies

No new dependencies required. Uses existing:
- `fs` for file read/write
- Existing API client for all HTTP requests

### API Endpoints Used

Export:
- GET `/things/types/{id}` - Get template
- GET `/things/types/{id}/channels` - Get capabilities
- Additional endpoints for device uses, alerts, attributes

Import:
- POST `/things/types` - Create template
- POST `/things/types/{id}/channels` - Create capabilities
- Additional endpoints for device uses, alerts, attributes
