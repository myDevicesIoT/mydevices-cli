import axios from 'axios';
import { getConfig, setAuthConfig, getAuthConfig } from './config.js';
import type { TokenResponse } from '../types/index.js';

export async function authenticate(
  realm: string,
  clientId: string,
  clientSecret: string
): Promise<TokenResponse> {
  const authUrl = getConfig('authUrl');
  const tokenUrl = `${authUrl}/auth/realms/${realm}/protocol/openid-connect/token`;

  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', clientId);
  params.append('client_secret', clientSecret);

  const response = await axios.post<TokenResponse>(tokenUrl, params, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  const tokenData = response.data;
  const expiresAt = Date.now() + tokenData.expires_in * 1000;

  // Store credentials and tokens
  setAuthConfig({
    realm,
    clientId,
    clientSecret,
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt,
  });

  return tokenData;
}

export async function refreshAccessToken(): Promise<TokenResponse> {
  const auth = getAuthConfig();
  const authUrl = getConfig('authUrl');
  const tokenUrl = `${authUrl}/auth/realms/${auth.realm}/protocol/openid-connect/token`;

  const params = new URLSearchParams();
  params.append('grant_type', 'refresh_token');
  params.append('client_id', auth.clientId);
  params.append('client_secret', auth.clientSecret);
  params.append('refresh_token', auth.refreshToken || '');

  const response = await axios.post<TokenResponse>(tokenUrl, params, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  const tokenData = response.data;
  const expiresAt = Date.now() + tokenData.expires_in * 1000;

  setAuthConfig({
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt,
  });

  return tokenData;
}

export async function getValidToken(): Promise<string> {
  const auth = getAuthConfig();

  if (!auth.accessToken) {
    throw new Error('Not authenticated. Run "mydevices auth login" first.');
  }

  // Check if token is expired or will expire in the next minute
  const bufferTime = 60 * 1000; // 1 minute buffer
  if (auth.expiresAt && auth.expiresAt < Date.now() + bufferTime) {
    // Try to refresh first
    if (auth.refreshToken) {
      try {
        const newTokens = await refreshAccessToken();
        return newTokens.access_token;
      } catch {
        // Refresh failed, fall through to re-authenticate
      }
    }

    // Re-authenticate using stored credentials
    if (auth.clientId && auth.clientSecret && auth.realm) {
      try {
        const newTokens = await authenticate(auth.realm, auth.clientId, auth.clientSecret);
        return newTokens.access_token;
      } catch {
        throw new Error('Session expired. Run "mydevices auth login" to re-authenticate.');
      }
    }

    throw new Error('Session expired. Run "mydevices auth login" to re-authenticate.');
  }

  return auth.accessToken;
}

export function getTokenExpiry(): { expiresAt: number; expiresIn: string } | null {
  const auth = getAuthConfig();
  if (!auth.expiresAt || !auth.accessToken) return null;

  const now = Date.now();
  const diff = auth.expiresAt - now;

  if (diff <= 0) {
    return { expiresAt: auth.expiresAt, expiresIn: 'expired' };
  }

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  return {
    expiresAt: auth.expiresAt,
    expiresIn: `${hours}h ${minutes}m`,
  };
}
