import Conf from 'conf';
import type { AuthConfig } from '../types/index.js';

interface ConfigSchema {
  realm: string;
  apiUrl: string;
  authUrl: string;
  defaultOutput: 'table' | 'json';
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

const config = new Conf<ConfigSchema>({
  projectName: 'mydevices-cli',
  defaults: {
    realm: '',
    apiUrl: 'https://api.mydevices.com',
    authUrl: 'https://auth.mydevices.com',
    defaultOutput: 'table',
    clientId: '',
    clientSecret: '',
    accessToken: '',
    refreshToken: '',
    expiresAt: 0,
  },
});

export function getConfig<K extends keyof ConfigSchema>(key: K): ConfigSchema[K] {
  return config.get(key);
}

export function setConfig<K extends keyof ConfigSchema>(key: K, value: ConfigSchema[K]): void {
  config.set(key, value);
}

export function getAllConfig(): ConfigSchema {
  return config.store;
}

export function clearConfig(): void {
  config.clear();
}

export function getAuthConfig(): AuthConfig {
  return {
    realm: config.get('realm'),
    clientId: config.get('clientId'),
    clientSecret: config.get('clientSecret'),
    accessToken: config.get('accessToken'),
    refreshToken: config.get('refreshToken'),
    expiresAt: config.get('expiresAt'),
  };
}

export function setAuthConfig(auth: Partial<AuthConfig>): void {
  if (auth.realm !== undefined) config.set('realm', auth.realm);
  if (auth.clientId !== undefined) config.set('clientId', auth.clientId);
  if (auth.clientSecret !== undefined) config.set('clientSecret', auth.clientSecret);
  if (auth.accessToken !== undefined) config.set('accessToken', auth.accessToken);
  if (auth.refreshToken !== undefined) config.set('refreshToken', auth.refreshToken);
  if (auth.expiresAt !== undefined) config.set('expiresAt', auth.expiresAt);
}

export function clearAuthConfig(): void {
  config.set('clientId', '');
  config.set('clientSecret', '');
  config.set('accessToken', '');
  config.set('refreshToken', '');
  config.set('expiresAt', 0);
}

export function isAuthenticated(): boolean {
  const accessToken = config.get('accessToken');
  const expiresAt = config.get('expiresAt');
  return !!accessToken && expiresAt > Date.now();
}

export function getConfigPath(): string {
  return config.path;
}
