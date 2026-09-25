# Bulk gateway commands

Send one command to every gateway in a file.

```bash
mydevices bulk gateways reboot           <file>
mydevices bulk gateways update           <file> --url <https-url> --checksum <md5>
mydevices bulk gateways migrate-provider <file> --provider mydevices|azure
```

Common options:

| Option | Default | Meaning |
|---|---|---|
| `--column <name>` | auto | CSV column holding the EUIs (`hardware_id`, `eui`, `deveui`, `dev_eui`, `device_eui`, `hwid`) |
| `--delimiter <char>` | auto | force the CSV delimiter |
| `--dry-run` | | print the plan (count, first EUIs, exact request body, clientId) and send nothing |
| `--limit <n>` | all | send to the first n gateways only |
| `--delay <ms>` | 500 | wait between gateways |
| `-y, --yes` | | skip the confirmation prompt (required when not run from a terminal) |
| `--json` | | print results as JSON |
| `--output <file>` | | write per-gateway results, `.csv` or `.json` |

## Input file

A CSV with one of the column names above, or plain text with one EUI per line. Lines starting with `#`
are ignored. EUIs may be bare hex or `eui-` prefixed, any case; duplicates are removed. If any line is not a
valid gateway EUI, the command lists the bad lines and sends nothing.

## Behaviour

- Gateways are sent one at a time, in file order, with `--delay` between them.
- A failure is recorded and the run continues. There are no retries.
- `Ctrl-C` finishes the in-flight request, stops, prints the summary and writes `--output`; exit code 130. A second `Ctrl-C` exits immediately.
- `--output` is checked before anything is sent: it must end in `.csv` or `.json` and its directory must exist. If writing the file still fails at the end, the per-gateway results are printed to stderr as JSON so the record is not lost.
- Exit code 1 if any gateway failed.

The results CSV has columns `eui,command,status_code,ok,error,sent_at`. Filter it to the failed rows and pass
it straight back in to retry just those:

```bash
mydevices bulk gateways reboot wave.txt --output wave-results.csv --yes
awk -F, 'NR==1 || $4=="false"' wave-results.csv > wave-retry.csv
mydevices bulk gateways reboot wave-retry.csv --dry-run
```

## Example: dps-client update

```bash
mydevices bulk gateways update dps-kona.txt \
  --url https://hwdartifacts.blob.core.windows.net/hwdassets/dps-client_1.5.0-r0_kona.ipk \
  --checksum 2a3f7fe7ff4b34cf6870e47ae709937f \
  --dry-run
```

## Which gateways you can reach

Commands go to `/v1.1/organizations/<clientId>/applications/<clientId>/gateways/<eui>/…`, using the clientId
you are logged in as, which is printed in every preview. To operate on the whole fleet, log in as the
`iotinabox` organization (`mydevices auth login`, or `mydevices auth set-token` with an iotinabox token).

The single-gateway commands send the same requests: `mydevices gateways reboot <eui>`,
`mydevices gateways update-software <eui> --url … --checksum … --yes`,
`mydevices gateways migrate-provider <eui> --provider …`.
