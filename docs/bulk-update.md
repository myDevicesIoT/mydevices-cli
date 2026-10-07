# Bulk Update Guide

`mydevices bulk update` applies device field updates from a CSV file: renaming devices, changing their external ID, and/or moving them to a different room (location).

```bash
mydevices bulk update updates.csv --dry-run    # preview the plan
mydevices bulk update updates.csv              # apply (asks for confirmation)
```

## CSV Format

One lookup column plus any of the three update columns:

| Column | Purpose |
|--------|---------|
| `external_id` (or `hardware_id` with `--lookup-by hardware_id`) | Identifies the device to update |
| `new_external_id` | New external ID |
| `new_name` | New device name (`thing_name`) |
| `new_room` | Name of the location to move the device to (e.g. `4F-L432`) |

Example — swap an asset ID (name + external ID) and move another device:

```csv
external_id,new_external_id,new_name,new_room
B144468,B146817,B146817,
B144106,,,5F-L520
```

Empty cells are skipped; each row must have at least one update column filled.

## Behavior

- **Lookup**: each device is fetched by the lookup field. Zero matches or multiple matches mark the row as an error — the row is never guessed.
- **Rooms**: `new_room` is resolved against the realm's location tree by exact name. A name matching more than one location is an error (the plan shows the conflicting paths).
- **No-ops**: rows whose requested values already match the device are reported as "already up to date" and skipped.
- **Plan first**: the command always prints a full old → new plan with a summary (to update / up to date / errors) before anything is written. `--dry-run` stops there.
- **Strict validation**: malformed rows (missing lookup value, no update fields) abort the run before any API call.
- **Apply**: only rows marked ready are written, via `PUT /v1.0/admin/things/:id`. Confirmation is required (default No).

## Options

| Option | Description |
|--------|-------------|
| `--lookup-by <field>` | `external_id` (default) or `hardware_id` |
| `--dry-run` | Print the plan, change nothing |
| `--delimiter <char>` | Force CSV delimiter |
| `--json` | Machine-readable output |
| `--output <file>` | Save plan + results JSON to a file |

Exit code is non-zero if any row errored or any update failed.
