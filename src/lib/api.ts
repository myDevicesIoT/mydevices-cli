import axios, { AxiosInstance, AxiosError } from 'axios';
import { getConfig } from './config.js';
import { getValidToken } from './auth.js';

let apiClient: AxiosInstance | null = null;

export function getApiClient(): AxiosInstance {
  if (!apiClient) {
    apiClient = axios.create({
      baseURL: getConfig('apiUrl'),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor to add auth token
    apiClient.interceptors.request.use(async (config) => {
      const token = await getValidToken();
      config.headers.Authorization = `Bearer ${token}`;
      return config;
    });

    // Response interceptor for error handling
    apiClient.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        if (error.response) {
          const status = error.response.status;
          const data = error.response.data as Record<string, unknown>;

          switch (status) {
            case 401:
              throw new Error('Authentication failed. Run "mydevices auth login" to re-authenticate.');
            case 403:
              throw new Error('Permission denied. You do not have access to this resource.');
            case 404:
              throw new Error('Resource not found.');
            default:
              throw new Error(
                (data?.message as string) ||
                (data?.error as string) ||
                `API error: ${status}`
              );
          }
        }
        throw error;
      }
    );
  }

  return apiClient;
}

// Generic API methods
export async function apiGet<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  const client = getApiClient();
  const response = await client.get<T>(path, { params });
  return response.data;
}

export async function apiPost<T>(path: string, data?: Record<string, unknown>): Promise<T> {
  const client = getApiClient();
  const response = await client.post<T>(path, data);
  return response.data;
}

export async function apiPut<T>(path: string, data?: Record<string, unknown>): Promise<T> {
  const client = getApiClient();
  const response = await client.put<T>(path, data);
  return response.data;
}

export async function apiDelete<T>(path: string, data?: Record<string, unknown>): Promise<T> {
  const client = getApiClient();
  const response = await client.delete<T>(path, { data });
  return response.data;
}
