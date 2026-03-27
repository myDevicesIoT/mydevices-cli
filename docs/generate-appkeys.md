# Generate AppKeys Guide

Generate unique LoRaWAN AppKeys for devices from a CSV file of DevEUIs.

## Overview

The `bulk generate-appkeys` command:

- Reads DevEUIs from a CSV or plain text file
- Generates a cryptographically random, unique 128-bit AppKey for each device
- Outputs a CSV with `deveui`, `appeui`, and `appkey` columns
- Supports custom AppEUI and auto-detection of the DevEUI column

## Quick Start

```bash
# Generate AppKeys and print to stdout
mydevices bulk generate-appkeys devices.csv

# Save to a file
mydevices bulk generate-appkeys devices.csv --output appkeys.csv

# Use shell redirection
mydevices bulk generate-appkeys devices.csv > appkeys.csv
```

## Input Format

### CSV with header

The command auto-detects the DevEUI column by looking for common names (`deveui`, `dev_eui`, `device_eui`, `eui`, `hardware_id`):

```csv
deveui,name,location
AA11BB22CC33DD44,Sensor 1,Building A
0011223344556677,Sensor 2,Building B
```

### Single-column CSV

```csv
deveui
AA11BB22CC33DD44
0011223344556677
FFEEDDCCBBAA9988
```

### Multi-column with explicit column

If your column name isn't auto-detected, specify it with `--column`:

```bash
mydevices bulk generate-appkeys devices.csv --column serial_number
```

## Output Format

The output is a CSV with three columns:

```csv
deveui,appeui,appkey
AA11BB22CC33DD44,8000000000000334,336D9AE8F86C7A0C7052CFF734982A8D
0011223344556677,8000000000000334,099C8B8DB7EBFD52B2CBE4FE2A119803
FFEEDDCCBBAA9988,8000000000000334,B3CC396B0F143AF68294B298CC33BD2E
```

- **deveui** - The DevEUI from the input file
- **appeui** - The AppEUI (default: `8000000000000334`, configurable via `--appeui`)
- **appkey** - A unique, randomly generated 32-character hex string (128-bit key)

## Command Options

```bash
mydevices bulk generate-appkeys <csv-file> [options]
```

| Option | Description |
|--------|-------------|
| `--appeui <eui>` | AppEUI to use for all devices (default: `8000000000000334`) |
| `--column <name>` | CSV column containing DevEUIs (auto-detected if not specified) |
| `--delimiter <char>` | Force CSV delimiter (auto-detect by default) |
| `--output <file>` | Save output CSV to file (prints to stdout by default) |

## Examples

### Generate with custom AppEUI

```bash
mydevices bulk generate-appkeys devices.csv --appeui 8000000000000500
```

### Specify delimiter for semicolon-separated files

```bash
mydevices bulk generate-appkeys devices.csv --delimiter ";"
```

### Pipe to other tools

```bash
# Count devices
mydevices bulk generate-appkeys devices.csv | wc -l

# Extract just the appkeys
mydevices bulk generate-appkeys devices.csv | cut -d, -f3 | tail -n +2
```

## Notes

- AppKeys are generated using Node.js `crypto.randomBytes()`, which provides cryptographically secure random values
- Each AppKey is guaranteed unique within a single run
- The command does not require authentication — it runs entirely offline
- Output goes to stdout by default, making it easy to pipe or redirect

## See Also

- [Bulk Import Guide](./bulk-import.md) - Importing devices and locations from CSV
