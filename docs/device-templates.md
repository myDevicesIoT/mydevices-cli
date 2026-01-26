# Device Templates Guide

Device templates define how devices are represented in the myDevices platform, including their metadata, sensor capabilities, and default alert configurations.

> **Official Documentation**: For comprehensive platform documentation, see [Device Templates Introduction](https://docs.mydevices.com/docs/device-templates/intro).

## Overview

A device integration consists of three main components:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Device Integration                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────────────┐   │
│  │   Codec     │────▶│  Template   │────▶│  Capabilities       │   │
│  │ (decoder.js)│     │  (profile)  │     │  (channels)         │   │
│  └─────────────┘     └─────────────┘     └─────────────────────┘   │
│                                                                      │
│  Decodes raw        Defines device        Defines sensor types,     │
│  LoRa/MQTT payload  metadata & settings   units, icons, alerts      │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

| Component | Purpose |
|-----------|---------|
| **Codec** | JavaScript that decodes/encodes device payloads |
| **Template** | Device profile with metadata (manufacturer, model, etc.) |
| **Capability** | Sensor/channel definition with datatype, icon, units |
| **Datatype** | Predefined sensor types with icons and units |

## Workflow

Creating a device integration is a multi-step process:

### Step 1: Create the Template

First, create the base template with device metadata:

```bash
mydevices templates create \
  -n "Acme TH Sensor" \
  --manufacturer "Acme Corp" \
  --model "TH-100" \
  --category module \
  --subcategory lora \
  --device-type "Environmental" \
  --broadcast-interval 60
```

**Required options:**
- `-n, --name` - Template display name
- `--manufacturer` - Manufacturer name
- `--model` - Model number/name
- `--category` - `module` (sensor/device) or `gateway`
- `--subcategory` - `lora`, `mqtt`, or `ble`

**Recommended options:**
- `--device-type` - Device category for UI (e.g., "Environmental", "Tracking")
- `--broadcast-interval` - Expected reporting interval in minutes
- `--codec` - Codec ID for payload decoding
- `--description` - Device description

**Output:**
```
Template created successfully
ID: abc-123-def
Name: Acme TH Sensor

Next step: Add capabilities using:
  mydevices templates capabilities create abc-123-def --name "Temperature" --channel 500 --datatype-id 27
```

### Step 2: Find Datatypes for Your Sensors

Datatypes define the sensor type and provide default icons, units, and alert templates:

```bash
# Search for temperature datatype
mydevices templates datatypes list --search temperature

# Output:
# ID  | Name        | Label       | Payload
# 27  | Temperature | Temperature | temp
```

Common datatypes:

| ID | Name | Use Case |
|----|------|----------|
| 27 | Temperature | Temperature sensors |
| 13 | Relative Humidity | Humidity sensors |
| 15 | Voltage | Battery/power monitoring |
| 21 | Low Battery | Battery status (OK/Low) |
| 22 | Carbon Dioxide | CO2 sensors |
| 29 | GPS | Location tracking |
| 35 | Digital Input | Door/window sensors |

### Step 3: View Datatype Properties

Each datatype has predefined icons, units, and alert templates:

```bash
mydevices templates datatypes get 27

# Output:
# Datatype 27 Properties
#
# Icons:
#   - Thermometer (dev-icon dev-thermometer)
#
# Units:
#   - Celsius: °C [c] (default)
#   - Fahrenheit: °F [f]
#   - Kelvin: °K [k]
#
# Rule Templates:
#   - Temperature (min_max)
```

### Step 4: Add Capabilities

Add sensor capabilities to your template. The CLI automatically populates icons, units, and alert templates from the datatype:

```bash
# Add temperature capability
mydevices templates capabilities create abc-123-def \
  -n "Temperature" \
  -c 500 \
  --datatype-id 27

# Add humidity capability
mydevices templates capabilities create abc-123-def \
  -n "Humidity" \
  -c 501 \
  --datatype-id 31

# Add battery voltage capability
mydevices templates capabilities create abc-123-def \
  -n "Battery" \
  -c 502 \
  --datatype-id 15
```

**Required options:**
- `-n, --name` - Capability display name
- `-c, --channel` - Channel number (start at 500)
- `--datatype-id` - Datatype ID from step 2

**Channel numbering:**
- Always start at **500**
- Increment by 1 for each capability
- Keep related sensors in sequence

### Step 5: Verify the Template

```bash
mydevices templates get abc-123-def --show-capabilities

# Output:
# Template: Acme TH Sensor
# ID: abc-123-def
# Manufacturer: Acme Corp
# Model: TH-100
# Category: module
# Subcategory: lora
# Codec: -
# ...
#
# Channels (3):
# Channel | Name        | Widget      | Template | Datatype ID
# 500     | Temperature | device-data | value    | 27
# 501     | Humidity    | device-data | value    | 31
# 502     | Battery     | device-data | value    | 15
```

## Template Commands

### List Templates

```bash
# List all templates
mydevices templates list

# Search by name
mydevices templates list --search "dragino"

# Filter by manufacturer
mydevices templates list --manufacturer "Dragino"

# Filter by category
mydevices templates list --category module --subcategory lora

# Raw filter expression
mydevices templates list --filter "name like %temperature%"

# Output as JSON
mydevices templates list --json
```

### Get Template

```bash
# Basic details
mydevices templates get <template-id>

# Show all channels
mydevices templates get <template-id> --show-capabilities

# Show all metadata
mydevices templates get <template-id> --show-meta

# JSON output
mydevices templates get <template-id> --json
```

### Create Template

```bash
# Minimal
mydevices templates create \
  -n "My Sensor" \
  --manufacturer "Acme" \
  --model "Pro v1" \
  --category module \
  --subcategory lora

# Full options
mydevices templates create \
  -n "My Sensor Pro" \
  --manufacturer "Acme Corp" \
  --model "Pro v2" \
  --category module \
  --subcategory lora \
  --description "Professional environmental sensor" \
  --codec "lorawan.acme.sensor" \
  --transport lorawan \
  --certifications "FCC;CE" \
  --ip-rating "IP65" \
  --device-type "Environmental" \
  --broadcast-interval 60 \
  --image-url "https://example.com/image.png" \
  --public

# From JSON file
mydevices templates create --from-file ./template.json
```

### Update Template

```bash
# Update name
mydevices templates update <template-id> --name "New Name"

# Update codec
mydevices templates update <template-id> --codec "new-codec-id"

# Make public/private
mydevices templates update <template-id> --public
mydevices templates update <template-id> --private

# From JSON file
mydevices templates update <template-id> --from-file ./updates.json
```

### Delete Template

```bash
mydevices templates delete <template-id>
```

### Assign Codec to Template

```bash
# Assign a codec to a template
mydevices templates assign-codec <template-id> <codec-id>

# Example
mydevices templates assign-codec abc-123-def lorawan.acme.sensor
```

This command fetches the current template and updates it with the specified codec ID.

## Capabilities Commands

### List Capabilities

```bash
mydevices templates capabilities list <template-id>
mydevices templates capabilities list <template-id> --json
```

### Create Capability

```bash
# Value type (numeric readings)
mydevices templates capabilities create <template-id> \
  -n "Temperature" \
  -c 500 \
  --datatype-id 27

# Status type (discrete states)
mydevices templates capabilities create <template-id> \
  -n "Door Status" \
  -c 501 \
  --datatype-id 35 \
  --template status

# Custom widget
mydevices templates capabilities create <template-id> \
  -n "Battery Level" \
  -c 502 \
  --datatype-id 21 \
  --widget battery

# From JSON file (for complex configurations)
mydevices templates capabilities create <template-id> --from-file ./capability.json
```

### Update Capability

```bash
mydevices templates capabilities update <template-id> <capability-id> --name "New Name"
mydevices templates capabilities update <template-id> <capability-id> --order 2
mydevices templates capabilities update <template-id> <capability-id> --from-file ./updates.json
```

### Delete Capability

```bash
mydevices templates capabilities delete <template-id> <capability-id>
```

## Capability Template Types

| Type | Use Case | Example |
|------|----------|---------|
| `value` | Numeric sensor readings | Temperature, Humidity, Voltage, CO2 |
| `status` | Discrete states | Door Open/Closed, Battery OK/Low, Motion Detected |

## Template Structure Reference

```json
{
  "name": "Device Name",
  "description": "Device description",
  "manufacturer": "Manufacturer Name",
  "model": "Model Number",
  "category": "module",
  "subcategory": "lora",
  "codec": "codec-id",
  "transport_protocol": "lorawan",
  "certifications": "FCC;CE",
  "ip_rating": "IP65",
  "is_public": false,
  "meta": [
    { "key": "device_type", "value": "Environmental" },
    { "key": "broadcast_interval", "value": "60" },
    { "key": "image_url", "value": "https://..." },
    { "key": "is_tracking_device", "value": "false" }
  ]
}
```

## Capability Structure Reference

```json
{
  "name": "Temperature",
  "channel": "500",
  "data_types_id": 27,
  "order": 0,
  "data": {
    "template": "value",
    "widget": "device-data",
    "icon": {
      "name": "Thermometer",
      "value": "dev-icon dev-thermometer",
      "color": "#000",
      "type": "css"
    },
    "chart": {
      "name": "line",
      "label": "Line Chart"
    },
    "units": [
      {
        "name": "celsius",
        "label": "Celsius",
        "display": "°C",
        "payload": "c",
        "default": true,
        "decimals": 1
      }
    ],
    "statuses": [],
    "rule_templates": [
      {
        "type": "min_max",
        "label": "Temperature",
        "enabled": true
      }
    ]
  }
}
```

## Complete Example

Here's a full example creating a temperature/humidity sensor integration:

```bash
#!/bin/bash

# Step 1: Create the template (without codec initially)
TEMPLATE_ID=$(mydevices templates create \
  -n "Acme TH Sensor" \
  --manufacturer "Acme Corp" \
  --model "TH-100" \
  --category module \
  --subcategory lora \
  --device-type "Environmental" \
  --broadcast-interval 15 \
  --description "Temperature and humidity sensor" \
  --json | jq -r '.id')

echo "Created template: $TEMPLATE_ID"

# Step 2: Add temperature capability (datatype 27)
mydevices templates capabilities create $TEMPLATE_ID \
  -n "Temperature" \
  -c 500 \
  --datatype-id 27

# Step 3: Add humidity capability (datatype 31)
mydevices templates capabilities create $TEMPLATE_ID \
  -n "Humidity" \
  -c 501 \
  --datatype-id 31

# Step 4: Add battery voltage capability (datatype 15)
mydevices templates capabilities create $TEMPLATE_ID \
  -n "Battery" \
  -c 502 \
  --datatype-id 15

# Step 5: Assign the codec to the template
mydevices templates assign-codec $TEMPLATE_ID lorawan.acme.th

# Step 6: Verify
mydevices templates get $TEMPLATE_ID --show-capabilities
```

## See Also

- [Codecs Guide](./codecs.md) - Writing payload decoders
- [API Reference](./api-reference.md) - REST API endpoints
- [Official Device Templates Docs](https://docs.mydevices.com/docs/device-templates/intro) - Platform documentation
