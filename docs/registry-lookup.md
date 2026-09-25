# Registry lookup

Check the registry status of many sensors or gateways at once.

```bash
mydevices registry lookup --template            # writes registry-lookup-template.csv
mydevices registry lookup sensors.csv
mydevices registry lookup sensors.csv --only PAIRED --write paired.txt --output lookup.csv
```

## Input

Start from the template (`--template [file]`, default `registry-lookup-template.csv`; an existing file is never
overwritten). It has instructions in `#` lines and a `hardware_id` header; add one ID per line under it.
Any CSV with a `hardware_id`/`eui`/`deveui`/`dev_eui`/`device_eui`/`hwid` column, or a plain list, also works.
Sensors are 16-hex devEUIs (`24e124600e458870`); gateways are `eui-<16 hex>`.

## Output

One row per ID: hardware ID, status, device type, paired-to app, paired-at, network.

| Status | Meaning |
|---|---|
| `PAIRED` | activated for a customer app |
| `PENDING` | registered, activation not completed |
| `DECOMMISSIONED` | retired |
| `NOT-FOUND` | not visible to the clientId you are logged in as — not necessarily unregistered |
| `ERROR` | the lookup failed; the message is shown; exit code 1 |

Options: `--only <status>` filters the table, `--write` and `--output`; `--write <file>` saves the filtered IDs
one per line; `--output <file.csv|file.json>` saves the rows; `--concurrency <n>` (1–20, default 5); `--json`.
With `--json`, stdout is the JSON document only; the `--write`/`--output` confirmation lines go to stderr.

## Scope

Lookups are limited to the clientId you are logged in as (printed in the header). For fleet-wide triage,
log in as the `iotinabox` organization.

`mydevices registry get <id>` accepts a registry UUID or a hardware ID.
