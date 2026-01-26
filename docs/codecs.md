# Codecs Guide

Codecs are JavaScript files that decode incoming device payloads and encode outgoing commands.

> **Official Documentation**: For comprehensive platform documentation, see [Codecs Guide](https://docs.mydevices.com/docs/device-templates/codecs).

## Overview

A codec consists of JavaScript files that run in a sandboxed environment:

| File | Purpose |
|------|---------|
| `decoder.js` | Decodes incoming payloads into sensor readings |
| `encoder.js` | Encodes commands into device payloads |
| `common.js` | Shared utility functions (optional) |

## Quick Start

### Create a Codec

```bash
# Create codec from files
mydevices codecs create \
  -n "my-sensor-codec" \
  --decoder ./decoder.js \
  --encoder ./encoder.js

# Test decode a payload
mydevices codecs decode my-sensor-codec -d "00fa320d48" -f hex

# Test encode a command
mydevices codecs encode my-sensor-codec -c 1 -v 25.5
```

## Writing a Decoder

### Basic Structure

```javascript
/* eslint-disable no-undef */
try {
  // Get the raw payload
  const buffer = Buffer.from(Decoder.payload.data, 'hex');
  const sensors = [];

  // Parse your data and create sensor objects
  sensors.push({
    channel: 500,        // Must match template capability channel
    type: 'temp',        // Sensor type
    unit: 'c',           // Unit code
    value: 25.5          // Sensor value
  });

  // Send the decoded sensors
  Decoder.send(sensors);
} catch (e) {
  Decoder.error(e.message);
}
```

### Decoder API

| Property/Method | Description |
|-----------------|-------------|
| `Decoder.payload.data` | Raw payload data (hex, base64, or text) |
| `Decoder.payload.fport` | LoRaWAN fport number |
| `Decoder.payload.timestamp` | Packet timestamp (ms) |
| `Decoder.payload.hardware_id` | Device hardware ID |
| `Decoder.send(sensors)` | Send decoded sensor array |
| `Decoder.error(message)` | Report an error |

### Sensor Object

```javascript
{
  channel: 500,           // Required: matches template capability
  type: 'temp',           // Required: sensor type
  unit: 'c',              // Required: unit payload code
  value: 25.5,            // Required: sensor value
  name: 'Temperature',    // Optional: for debugging
  timestamp: 1234567890   // Optional: for historical data
}
```

### Example: Temperature & Humidity Sensor

```javascript
/* eslint-disable no-undef */
try {
  const buffer = Buffer.from(Decoder.payload.data, 'hex');
  const sensors = [];

  // Temperature: bytes 0-1, signed int16, divide by 10
  const tempRaw = buffer.readInt16BE(0);
  sensors.push({
    channel: 500,
    type: 'temp',
    unit: 'c',
    value: tempRaw / 10,
    name: 'Temperature'
  });

  // Humidity: byte 2, unsigned int8, divide by 2
  const humidity = buffer.readUInt8(2) / 2;
  sensors.push({
    channel: 501,
    type: 'rel_hum',
    unit: 'p',
    value: humidity,
    name: 'Humidity'
  });

  // Battery voltage: bytes 3-4, unsigned int16, divide by 1000
  const battery = buffer.readUInt16BE(3) / 1000;
  sensors.push({
    channel: 502,
    type: 'voltage',
    unit: 'v',
    value: battery,
    name: 'Battery'
  });

  Decoder.send(sensors);
} catch (e) {
  Decoder.error(e.message);
}
```

### Example: Status Sensor (Door/Window)

```javascript
/* eslint-disable no-undef */
try {
  const buffer = Buffer.from(Decoder.payload.data, 'hex');
  const sensors = [];

  // Door status: byte 0, 0 = closed, 1 = open
  const doorOpen = buffer.readUInt8(0);
  sensors.push({
    channel: 500,
    type: 'digital',
    unit: 'd',
    value: doorOpen,  // 0 or 1
    name: 'Door'
  });

  Decoder.send(sensors);
} catch (e) {
  Decoder.error(e.message);
}
```

## Writing an Encoder

### Basic Structure

```javascript
/* eslint-disable no-undef */
try {
  const channel = Encoder.channel;
  const value = Encoder.value;

  // Build your payload
  const buffer = Buffer.alloc(3);
  buffer.writeUInt8(0x01, 0);           // Command type
  buffer.writeInt16BE(value * 10, 1);   // Value

  // Send the encoded payload
  Encoder.send({
    format: 'hex',
    data: buffer.toString('hex'),
    fport: 2
  });
} catch (e) {
  Encoder.error(e.message);
}
```

### Encoder API

| Property/Method | Description |
|-----------------|-------------|
| `Encoder.channel` | Target channel number |
| `Encoder.value` | Value to encode |
| `Encoder.send(payload)` | Send encoded payload |
| `Encoder.error(message)` | Report an error |

### Payload Object

```javascript
{
  format: 'hex',          // 'hex', 'text', or 'json'
  data: '01010064',       // Hex string (when format='hex')
  text: 'command',        // Text string (when format='text')
  json: '{"cmd": 1}',     // JSON string (when format='json')
  fport: 2                // LoRaWAN fport for downlink
}
```

### Example: Setpoint Command

```javascript
/* eslint-disable no-undef */
try {
  const channel = Encoder.channel;
  const value = Encoder.value;

  let payload;
  let fport = 2;

  switch (channel) {
    case 1: // Temperature setpoint
      const buffer = Buffer.alloc(3);
      buffer.writeUInt8(0x01, 0);           // Command: set temp
      buffer.writeInt16BE(value * 10, 1);   // Temperature * 10
      payload = buffer.toString('hex');
      break;

    case 2: // On/Off control
      payload = value ? '0201' : '0200';
      break;

    default:
      throw new Error(`Unknown channel: ${channel}`);
  }

  Encoder.send({
    format: 'hex',
    data: payload,
    fport: fport
  });
} catch (e) {
  Encoder.error(e.message);
}
```

## Codec Commands

### List Codecs

```bash
# List all codecs
mydevices codecs list

# Filter by type
mydevices codecs list --opensource
mydevices codecs list --public
mydevices codecs list --official

# JSON output
mydevices codecs list --json
```

### Get Codec

```bash
# Basic details
mydevices codecs get <codec-id>

# Show source code
mydevices codecs get <codec-id> --show-source

# JSON output
mydevices codecs get <codec-id> --json
```

### Create Codec

```bash
# Basic codec with decoder only
mydevices codecs create \
  -n "my-sensor-codec" \
  --decoder ./decoder.js

# Full codec
mydevices codecs create \
  -n "my-sensor-codec" \
  --decoder ./decoder.js \
  --encoder ./encoder.js \
  --timeout 100

# With additional files
mydevices codecs create \
  -n "my-sensor-codec" \
  --decoder ./decoder.js \
  --encoder ./encoder.js \
  --file ./common.js \
  --file ./utils.js

# With npm modules
mydevices codecs create \
  -n "my-sensor-codec" \
  --decoder ./decoder.js \
  --modules "lodash,moment"

# Make public/opensource
mydevices codecs create \
  -n "my-sensor-codec" \
  --decoder ./decoder.js \
  --public \
  --opensource
```

### Update Codec

```bash
# Update decoder
mydevices codecs update <codec-id> --decoder ./decoder.js

# Update encoder
mydevices codecs update <codec-id> --encoder ./encoder.js

# Update name
mydevices codecs update <codec-id> --name "new-name"

# Make public/private
mydevices codecs update <codec-id> --public
mydevices codecs update <codec-id> --private
```

### Delete Codec

```bash
mydevices codecs delete <codec-id>
```

### Test Decode

```bash
# Decode hex payload
mydevices codecs decode <codec-id> -d "00fa320d48" -f hex

# Decode base64 payload
mydevices codecs decode <codec-id> -d "APoyDUg=" -f base64

# With fport
mydevices codecs decode <codec-id> -d "00fa320d48" -f hex --fport 1

# With hardware ID
mydevices codecs decode <codec-id> -d "00fa320d48" -f hex --hardware-id "0011223344556677"

# With debug output (shows console.log)
mydevices codecs decode <codec-id> -d "00fa320d48" -f hex --debug

# JSON output
mydevices codecs decode <codec-id> -d "00fa320d48" -f hex --json
```

**Output:**
```
Decoded Sensors
Channel | Type    | Value | Unit | Name
500     | temp    | 25.0  | c    | Temperature
501     | rel_hum | 25    | p    | Humidity
502     | voltage | 3.4   | v    | Battery
```

### Test Encode

```bash
# Encode numeric value
mydevices codecs encode <codec-id> -c 1 -v 25.5

# Encode boolean
mydevices codecs encode <codec-id> -c 2 -v true

# Encode JSON value
mydevices codecs encode <codec-id> -c 1 -v '{"mode": "auto", "setpoint": 22}'

# With debug output
mydevices codecs encode <codec-id> -c 1 -v 25.5 --debug

# JSON output
mydevices codecs encode <codec-id> -c 1 -v 25.5 --json
```

**Output:**
```
Encoded Payload
Format: hex
Data (hex): 0100ff
FPort: 2
```

## Common Sensor Types

| Type | Description | Unit Examples |
|------|-------------|---------------|
| `temp` | Temperature | `c` (Celsius), `f` (Fahrenheit) |
| `rel_hum` | Relative Humidity | `p` (percent) |
| `voltage` | Voltage | `v` (volts), `mv` (millivolts) |
| `digital` | Digital Input | `d` (digital) |
| `gps` | GPS Location | `m` (meters) |
| `co2` | Carbon Dioxide | `ppm` (parts per million) |
| `pressure` | Pressure | `pa` (pascal), `hpa` (hectopascal) |
| `lux` | Light Level | `lux` |
| `distance` | Distance | `m` (meters), `cm` (centimeters) |

## Buffer Methods Reference

Node.js Buffer methods available in the sandbox:

| Method | Description |
|--------|-------------|
| `buffer.readInt8(offset)` | Read signed 8-bit integer |
| `buffer.readUInt8(offset)` | Read unsigned 8-bit integer |
| `buffer.readInt16BE(offset)` | Read signed 16-bit big-endian |
| `buffer.readInt16LE(offset)` | Read signed 16-bit little-endian |
| `buffer.readUInt16BE(offset)` | Read unsigned 16-bit big-endian |
| `buffer.readUInt16LE(offset)` | Read unsigned 16-bit little-endian |
| `buffer.readInt32BE(offset)` | Read signed 32-bit big-endian |
| `buffer.readInt32LE(offset)` | Read signed 32-bit little-endian |
| `buffer.readUInt32BE(offset)` | Read unsigned 32-bit big-endian |
| `buffer.readUInt32LE(offset)` | Read unsigned 32-bit little-endian |
| `buffer.readFloatBE(offset)` | Read 32-bit float big-endian |
| `buffer.readFloatLE(offset)` | Read 32-bit float little-endian |
| `buffer.slice(start, end)` | Extract buffer slice |
| `buffer.toString('hex')` | Convert to hex string |

## Debugging Tips

1. **Use debug mode** to see console.log output:
   ```bash
   mydevices codecs decode <id> -d "..." -f hex --debug
   ```

2. **Add logging** in your decoder:
   ```javascript
   console.log('Raw buffer:', buffer.toString('hex'));
   console.log('Parsed temperature:', tempRaw);
   ```

3. **Check byte order** - LoRaWAN devices often use big-endian

4. **Verify channel numbers** match your template capabilities

5. **Test with real payloads** from your device before deploying

## Codec Structure Reference

```json
{
  "id": "lorawan.acme.sensor",
  "name": "Acme Sensor Codec",
  "public": false,
  "opensource": false,
  "timeout": 100,
  "modules": ["lodash"],
  "files": [
    { "name": "decoder.js", "source": "..." },
    { "name": "encoder.js", "source": "..." }
  ]
}
```

## See Also

- [Device Templates Guide](./device-templates.md) - Creating templates
- [API Reference](./api-reference.md) - REST API endpoints
- [Official Codecs Docs](https://docs.mydevices.com/docs/device-templates/codecs) - Platform documentation
