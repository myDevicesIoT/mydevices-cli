# Generate BLE Beacon UUIDs Guide

Generate v1 (timestamp-based) UUIDs for BLE beacons, with a 34-character truncated variant.

## Overview

The `bulk generate-uuids` command:

- Generates v1 UUIDs using timestamp-based generation
- Outputs a 34-character truncated UUID alongside the full 36-character UUID
- Produces a CSV ready for provisioning BLE beacons

## Quick Start

```bash
# Generate 10 UUIDs (default) and print to stdout
mydevices bulk generate-uuids

# Generate 100 UUIDs
mydevices bulk generate-uuids --count 100

# Save to a file
mydevices bulk generate-uuids --count 50 --output beacons.csv
```

## Output Format

The output is a CSV with two columns:

```csv
uuid-34,uuidv1
ea310140-2a26-11f1-8e12-23eb4effb2,ea310140-2a26-11f1-8e12-23eb4effb290
ea314f60-2a26-11f1-8e12-23eb4effb2,ea314f60-2a26-11f1-8e12-23eb4effb290
```

- **uuid-34** - The v1 UUID truncated to 34 characters (last 2 characters removed)
- **uuidv1** - The full 36-character v1 UUID

## Command Options

```bash
mydevices bulk generate-uuids [options]
```

| Option | Description |
|--------|-------------|
| `--count <number>` | Number of UUIDs to generate (default: `10`) |
| `--output <file>` | Save output CSV to file (prints to stdout by default) |

## Examples

### Generate and redirect to file

```bash
mydevices bulk generate-uuids --count 200 > beacons.csv
```

### Pipe to other tools

```bash
# Extract just the 34-char UUIDs
mydevices bulk generate-uuids --count 20 | cut -d, -f1 | tail -n +2

# Count generated UUIDs
mydevices bulk generate-uuids --count 50 | tail -n +2 | wc -l
```

## Notes

- UUIDs are generated using v1 (timestamp + node-based), ensuring natural ordering and uniqueness
- The 34-character variant removes the last 2 characters of the standard UUID format
- The command runs entirely offline — no authentication required

## See Also

- [Generate AppKeys Guide](./generate-appkeys.md) - Generating LoRaWAN AppKeys
- [Bulk Import Guide](./bulk-import.md) - Importing devices and locations from CSV
