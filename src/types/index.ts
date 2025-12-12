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
