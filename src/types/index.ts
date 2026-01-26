// API Response types
export interface ApiResponse<T> {
  count?: number;
  limit?: number;
  page?: number;
  rows?: T[];
}

// Auth types
export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
  token_type: string;
}

export interface AuthConfig {
  realm: string;
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

// Company types
export interface Company {
  id: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  industry?: string;
  user_id?: string;
  application_id?: string;
  external_id?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
}

// Location types
export interface Location {
  id: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  industry?: string;
  user_id?: string;
  company_id?: string;
  application_id?: string;
  external_id?: string;
  parent_id?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
}

// User types
export interface User {
  id: string;
  email: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  enabled?: boolean;
  emailVerified?: boolean;
  createdTimestamp?: number;
  phone_number?: string;
  locale?: string;
  attributes?: Record<string, string[]>;
}

export interface UserPermission {
  location_id: string;
  permission: 'view' | 'edit';
}

// Device (Thing) types
export interface Device {
  id: string;
  cayenne_id?: string;
  hardware_id?: string;
  thing_name: string;
  thing_type?: string;
  sensor_type?: string;
  sensor_use?: string;
  location_id?: string;
  company_id?: string;
  application_id?: string;
  user_id?: string;
  device_type_id?: string;
  status?: number;
  enabled?: boolean;
  external_id?: string;
  properties?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface SensorReading {
  channel: number;
  v: number | string;
}

export interface DeviceReading {
  ts: number;
  correlation_id?: string;
  sensors: SensorReading[];
}

// Rule types
export interface Rule {
  id: string;
  name?: string;
  application_id?: string;
  status?: number;
  created_at?: string;
  updated_at?: string;
}

// Device Template types
export interface DeviceTemplate {
  id: string;
  name: string;
  description?: string;
  category?: string;
  subcategory?: string;
  parent_constraint?: string;
  codec?: string;
  child_constraint?: string;
  model?: string;
  version?: string;
  manufacturer?: string;
  transport_protocol?: string;
  protocol_version?: string;
  certifications?: string;
  ip_rating?: string;
  keywords?: string;
  data_type?: string;
  proxy_handler?: string;
  application_id?: string;
  organization_id?: string;
  is_public?: boolean;
  is_example?: boolean;
  is_approved?: boolean;
  status?: number;
  created_at?: string;
  updated_at?: string;
}

// Codec types
export interface CodecFile {
  name: string;
  source: string;
}

export interface Codec {
  id: string;
  name: string;
  organization?: string;
  application?: string;
  official?: boolean;
  public?: boolean;
  opensource?: boolean;
  timeout?: number;
  class?: string;
  modules?: string[];
  files?: CodecFile[];
  owner?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface CodecListResponse {
  codecs: Codec[];
  total: number;
  limit: number;
  offset: number;
}

export interface DecodeRequest {
  data: string;
  format: 'hex' | 'base64' | 'text' | 'json';
  fport?: number;
  timestamp?: number;
  hardware_id?: string;
  options?: Record<string, unknown>;
  session?: Record<string, unknown>;
}

export interface DecodeResponse {
  console?: string;
  error?: string;
  sensors?: Array<{
    channel: number;
    type: string;
    unit: string;
    value: unknown;
    name?: string;
    timestamp?: number;
    hardware_id?: string;
  }>;
  options?: Record<string, unknown>;
  session?: Record<string, unknown>;
}

export interface EncodeRequest {
  channel: number;
  value: unknown;
  options?: Record<string, unknown>;
  session?: Record<string, unknown>;
}

export interface EncodeResponse {
  console?: string;
  error?: string;
  payload?: {
    format: string;
    data?: string;
    text?: string;
    json?: string;
    fport?: number;
  };
  options?: Record<string, unknown>;
  session?: Record<string, unknown>;
}

// CLI options
export interface GlobalOptions {
  json?: boolean;
  verbose?: boolean;
  profile?: string;
}

export interface ListOptions extends GlobalOptions {
  limit?: number;
  page?: number;
}
