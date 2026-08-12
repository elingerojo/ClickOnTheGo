/**
 * Cliente HTTP del frontend — exclusivamente `fetch` nativo (patrón del stack
 * genérico). Incluye el token de dispositivo (`X-Device-Token`).
 */
import { APP_CONFIG } from '../app.config';

const DEVICE_TOKEN_KEY = 'cog_device_token';

export function getDeviceToken(): string | null {
  try {
    return localStorage.getItem(DEVICE_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setDeviceToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(DEVICE_TOKEN_KEY, token);
    else localStorage.removeItem(DEVICE_TOKEN_KEY);
  } catch {
    // localStorage puede no estar disponible (modo incógnito)
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly fieldErrors?: Record<string, string>,
    /** Código de error legible devuelto por el backend (ej. INVALID_OR_USED_TOKEN). */
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
  adminToken?: string;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getDeviceToken();
  if (token) headers['X-Device-Token'] = token;
  if (options.adminToken) headers['X-Admin-Token'] = options.adminToken;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${APP_CONFIG.apiBaseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    let fieldErrors: Record<string, string> | undefined;
    let code: string | undefined;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
      if (data?.fieldErrors) fieldErrors = data.fieldErrors;
      if (data?.code) code = data.code;
    } catch {
      // cuerpo no JSON
    }
    throw new ApiError(message, res.status, fieldErrors, code);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
