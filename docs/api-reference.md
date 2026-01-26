# API Reference

This document describes the REST API endpoints used by the myDevices CLI.

## Base URLs

| Service | URL |
|---------|-----|
| API | `https://api.mydevices.com` |
| Auth | `https://auth.mydevices.com` |

## Authentication

All API requests require a Bearer token in the Authorization header:

```
Authorization: Bearer <access_token>
```

Tokens are obtained via OAuth2 client credentials flow:

```bash
POST https://auth.mydevices.com/auth/realms/{realm}/protocol/openid-connect/token
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
&client_id={clientId}
&client_secret={clientSecret}
```

---

## Core Resources

### Companies

Base: `/v1.0/admin/companies`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/companies` | List companies |
| GET | `/companies/{id}` | Get company |
| POST | `/companies` | Create company |
| PUT | `/companies/{id}` | Update company |
| DELETE | `/companies/{id}` | Delete company |
| GET | `/companies/count` | Get count |

### Locations

Base: `/v1.0/admin/locations`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/locations` | List locations |
| GET | `/locations/{id}` | Get location |
| POST | `/locations` | Create location |
| PUT | `/locations/{id}` | Update location |
| DELETE | `/locations/{id}` | Delete location |
| GET | `/locations/count` | Get count |

### Users

Base: `/v1.0/admin/users`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/users` | List users |
| GET | `/users/{id}` | Get user |
| POST | `/users` | Create user |
| PUT | `/users/{id}` | Update user |
| DELETE | `/users/{id}` | Delete user |
| GET | `/users/count` | Get count |
| GET | `/users/{id}/permissions` | Get user permissions |
| PUT | `/users/{id}/permissions` | Update permissions |

### Devices (Things)

Base: `/v1.0/admin/things`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/things` | List devices |
| GET | `/things/{id}` | Get device |
| POST | `/things` | Create device |
| PUT | `/things/{id}` | Update device |
| DELETE | `/things/{id}` | Delete device |
| GET | `/things/count` | Get count |
| GET | `/things/{id}/latest` | Get latest readings |
| GET | `/things/{id}/readings` | Get historical readings |
| POST | `/things/{id}/cmd` | Send command |
| GET | `/things/{hardwareId}/status` | Lookup by hardware ID |

### Rules

Base: `/v1.0/admin/rules`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/rules` | List rules |
| GET | `/rules/{id}` | Get rule |
| GET | `/rules/count` | Get count |

---

## Templates & Codecs

### Device Templates

Base: `/v1.1/organizations/{clientId}/applications/{clientId}/things/types`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/things/types` | List templates |
| GET | `/things/types/{id}` | Get template |
| POST | `/things/types` | Create template |
| PUT | `/things/types/{id}` | Update template |
| DELETE | `/things/types/{id}` | Delete template |

**Query Parameters (list):**

| Parameter | Description |
|-----------|-------------|
| `limit` | Results per page (default: 20) |
| `page` | Page number (default: 0) |
| `sort` | Sort order (e.g., "name asc") |
| `catalog` | Filter: "application" or "public" |
| `filter` | Filter expression (e.g., "name like %sensor%") |
| `manufacturer` | Filter by manufacturer |
| `category` | Filter by category |
| `subcategory` | Filter by subcategory |

**Template Object:**

```json
{
  "id": "uuid",
  "name": "Template Name",
  "description": "Description",
  "manufacturer": "Manufacturer",
  "model": "Model",
  "category": "module",
  "subcategory": "lora",
  "codec": "codec-id",
  "transport_protocol": "lorawan",
  "certifications": "FCC;CE",
  "ip_rating": "IP65",
  "is_public": false,
  "status": 0,
  "meta": [
    { "key": "device_type", "value": "Environmental" },
    { "key": "broadcast_interval", "value": "60" }
  ],
  "channels": [...],
  "device_use": [...]
}
```

### Capabilities (Channels)

Base: `/v1.1/organizations/{clientId}/applications/{clientId}/things/types/{templateId}/channels`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/channels` | List capabilities |
| POST | `/channels` | Create capability |
| PUT | `/channels/{id}` | Update capability |
| DELETE | `/channels/{id}` | Delete capability |

**Capability Object:**

```json
{
  "id": 12345,
  "name": "Temperature",
  "channel": "500",
  "data_types_id": 27,
  "order": 0,
  "datatype": "DEPRECATED",
  "data": {
    "template": "value",
    "widget": "device-data",
    "icon": { ... },
    "chart": { ... },
    "units": [ ... ],
    "statuses": [],
    "rule_templates": [ ... ]
  }
}
```

### Datatypes

Base: `/v1.0/things/datatypes`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/datatypes` | List datatypes |
| GET | `/datatypes/{id}/properties` | Get datatype properties |

**Query Parameters (properties):**

| Parameter | Description |
|-----------|-------------|
| `type` | Filter by type: "icon", "unit", "rule_template", "template" |

**Datatype Object:**

```json
{
  "id": 27,
  "name": "Temperature",
  "label": "Temperature",
  "payload": "temp"
}
```

**Property Object:**

```json
{
  "id": 72,
  "type": "unit",
  "label": "Celsius",
  "data_types_id": 27,
  "data": {
    "name": "celsius",
    "display": "°C",
    "payload": "c",
    "default": true,
    "decimals": 1
  }
}
```

### Codecs

Base: `/v1.1/organizations/{clientId}/applications/{clientId}/codecs`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/codecs` | List codecs |
| GET | `/codecs/{id}` | Get codec |
| POST | `/codecs` | Create codec |
| PUT | `/codecs/{id}` | Update codec |
| DELETE | `/codecs/{id}` | Delete codec |
| POST | `/codecs/{id}/decode` | Decode payload |
| POST | `/codecs/{id}/encode` | Encode command |

**Query Parameters (list):**

| Parameter | Description |
|-----------|-------------|
| `limit` | Results limit |
| `offset` | Pagination offset |
| `opensource` | Filter opensource codecs |
| `public` | Filter public codecs |
| `official` | Filter official codecs |

**Codec Object:**

```json
{
  "id": "lorawan.acme.sensor",
  "name": "Acme Sensor",
  "public": false,
  "opensource": false,
  "official": false,
  "timeout": 100,
  "modules": ["lodash"],
  "files": [
    { "name": "decoder.js", "source": "..." },
    { "name": "encoder.js", "source": "..." }
  ]
}
```

**Decode Request:**

```json
{
  "data": "00fa320d48",
  "format": "hex",
  "fport": 1,
  "timestamp": 1234567890000,
  "hardware_id": "device-001"
}
```

**Decode Response:**

```json
{
  "sensors": [
    {
      "channel": 500,
      "type": "temp",
      "unit": "c",
      "value": 25.0
    }
  ],
  "console": "",
  "error": ""
}
```

**Encode Request:**

```json
{
  "channel": 1,
  "value": 25.5
}
```

**Encode Response:**

```json
{
  "payload": {
    "format": "hex",
    "data": "0100ff",
    "fport": 2
  },
  "console": "",
  "error": ""
}
```

---

## Common Response Formats

### List Response

```json
{
  "count": 100,
  "limit": 20,
  "page": 0,
  "rows": [...]
}
```

### Error Response

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "Description of the error"
}
```

### Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request |
| 401 | Unauthorized |
| 403 | Forbidden |
| 404 | Not Found |
| 500 | Internal Server Error |

---

## Resource Status Values

For resources with a `status` field:

| Value | Meaning |
|-------|---------|
| 0 | Active (exists) |
| 1 | Deactivated (deleted) |

---

## Pagination

All list endpoints support pagination:

| Parameter | Description | Default |
|-----------|-------------|---------|
| `limit` | Results per page | 20 |
| `page` | Page number (0-indexed) | 0 |

Example:
```
GET /v1.0/admin/things?limit=50&page=2
```

---

## Filtering

Many list endpoints support filtering via query parameters or filter expressions.

### Query Parameter Filters

```
GET /v1.0/admin/things?location_id=abc123&status=0
```

### Filter Expressions

Templates support filter expressions:

```
GET /things/types?filter=name+like+%25sensor%25
```

Filter operators:
- `eq` - Equal
- `like` - Pattern match (use `%` for wildcards)

---

## See Also

- [Device Templates Guide](./device-templates.md)
- [Codecs Guide](./codecs.md)
