import axios, { AxiosInstance, AxiosError } from 'axios';
import { getConfig } from './config.js';
import { getValidToken } from './auth.js';
import chalk from 'chalk';

/** An API error that keeps the HTTP status, so bulk results can report it. */
export class ApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const isDebug = process.env.DEBUG === '1' || process.env.MYDEVICES_DEBUG === '1';

let apiClient: AxiosInstance | null = null;

export function getApiClient(): AxiosInstance {
  if (!apiClient) {
    apiClient = axios.create({
      baseURL: getConfig('apiUrl'),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Request interceptor to add auth token and debug logging
    apiClient.interceptors.request.use(async (config) => {
      const token = await getValidToken();
      config.headers.Authorization = `Bearer ${token}`;

      if (isDebug) {
        console.log(chalk.cyan('\n[DEBUG] Request:'));
        console.log(chalk.gray(`  ${config.method?.toUpperCase()} ${config.baseURL}${config.url}`));
        if (config.params) {
          console.log(chalk.gray(`  Params: ${JSON.stringify(config.params)}`));
        }
        if (config.data) {
          console.log(chalk.gray(`  Body: ${JSON.stringify(config.data, null, 2)}`));
        }
      }

      return config;
    });

    // Response interceptor for error handling and debug logging
    apiClient.interceptors.response.use(
      (response) => {
        if (isDebug) {
          console.log(chalk.green('\n[DEBUG] Response:'));
          console.log(chalk.gray(`  Status: ${response.status}`));
          console.log(chalk.gray(`  Data: ${JSON.stringify(response.data, null, 2)}`));
        }
        return response;
      },
      (error: AxiosError) => {
        if (isDebug && error.response) {
          console.log(chalk.red('\n[DEBUG] Error Response:'));
          console.log(chalk.gray(`  Status: ${error.response.status}`));
          console.log(chalk.gray(`  Data: ${JSON.stringify(error.response.data, null, 2)}`));
        }

        if (error.response) {
          const status = error.response.status;
          const data = error.response.data as Record<string, unknown>;

          switch (status) {
            case 401:
              throw new ApiError('Authentication failed. Run "mydevices auth login" to re-authenticate.', status);
            case 403:
              throw new ApiError('Permission denied. You do not have access to this resource.', status);
            case 404:
              throw new ApiError('Resource not found.', status);
            default:
              throw new ApiError(
                (data?.message as string) ||
                (data?.error as string) ||
                `API error: ${status}`,
                status
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

export async function apiPostWithStatus<T>(
  path: string,
  data?: Record<string, unknown>
): Promise<{ status: number; data: T }> {
  const client = getApiClient();
  const response = await client.post<T>(path, data);
  return { status: response.status, data: response.data };
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
