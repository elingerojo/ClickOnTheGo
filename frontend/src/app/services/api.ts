/**
 * Cliente HTTP del frontend — exclusivamente `fetch` nativo (patrón del stack
 * genérico). Incluye el token de dispositivo (`X-Device-Token`).
 */
import { APP_CONFIG } from '../app.config';

const DEVICE_TOKEN_KEY = 'cog_device_token';
const DEVICE_ID_KEY = 'cog_device_id';
const DEVICE_TOKEN_COOKIE = 'cog_device_token';
const TOKEN_COOKIE_MAX_AGE_DAYS = 30;

/**
 * Persistencia DUAL del token de dispositivo (localStorage + cookie del origen
 * del frontend). La cookie es un respaldo: sobrevive a particionados/evicciones
 * de localStorage (p. ej. iOS/webview/PWA) y se lee igual desde JS para enviarla
 * como cabecera `X-Device-Token`. En modo privado ambas se limpian al cerrar la
 * sesión privada (comportamiento esperado del navegador).
 */

/** Lee una cookie del origen de la SPA. */
function readCookie(name: string): string | null {
  try {
    const prefix = `${name}=`;
    const entry = document.cookie
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(prefix));
    return entry ? decodeURIComponent(entry.slice(prefix.length)) : null;
  } catch {
    return null;
  }
}

/** Escribe una cookie en el origen de la SPA (SameSite=Lax, Secure en HTTPS). */
function writeCookie(name: string, value: string, days: number): void {
  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${days * 86400}; SameSite=Lax${secure}`;
  } catch {
    /* cookie no disponible */
  }
}

/** Borra una cookie del origen de la SPA. */
function clearCookie(name: string): void {
  try {
    document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
  } catch {
    /* cookie no disponible */
  }
}

export function getDeviceToken(): string | null {
  try {
    const token = localStorage.getItem(DEVICE_TOKEN_KEY) ?? readCookie(DEVICE_TOKEN_COOKIE);
    // TEMP-DEBUG (quitar antes del release): muestra el token (truncado) de localStorage/cookie.
    console.warn('[TEMP-DEBUG] getDeviceToken() →', token ? `${token.slice(0, 8)}…` : null);
    return token;
  } catch (err) {
    console.warn('[TEMP-DEBUG] getDeviceToken() → localStorage inaccesible; uso cookie', err);
    return readCookie(DEVICE_TOKEN_COOKIE);
  }
}

export function setDeviceToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(DEVICE_TOKEN_KEY, token);
      // [DEBUG] Diagnóstico persistencia iOS (quitar antes del release): escritura OK.
      console.warn('[DEBUG auth] setDeviceToken → ESCRITO en localStorage', {
        len: token.length,
        prefix: token.slice(0, 8),
      });
    } else {
      localStorage.removeItem(DEVICE_TOKEN_KEY);
      // [DEBUG] Diagnóstico persistencia iOS (quitar antes del release): borrado.
      console.warn('[DEBUG auth] setDeviceToken → REMOVIDO de localStorage (token null)');
    }
  } catch (err) {
    // Si falla, la sesión solo vive en memoria y se pierde al recargar.
    console.warn('[DEBUG auth] setDeviceToken → FALLO localStorage', err);
  }
  // Respaldo en cookie (independiente de localStorage): se escribe/borra siempre.
  if (token) writeCookie(DEVICE_TOKEN_COOKIE, token, TOKEN_COOKIE_MAX_AGE_DAYS);
  else clearCookie(DEVICE_TOKEN_COOKIE);
}

/** Id del dispositivo actual (se guarda al canjear el token de un solo uso). */
export function getDeviceId(): string | null {
  try {
    return localStorage.getItem(DEVICE_ID_KEY);
  } catch {
    return null;
  }
}

export function setDeviceId(id: string | null): void {
  try {
    if (id) localStorage.setItem(DEVICE_ID_KEY, id);
    else localStorage.removeItem(DEVICE_ID_KEY);
  } catch (err) {
    console.warn('[api] No se pudo guardar el device id en localStorage', err);
  }
}

/** Indica si el navegador permite escribir en localStorage (modo incógnito/privado puede no permitirlo). */
export function storageAvailable(): boolean {
  try {
    const probe = '__cog_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/** Sesión de dispositivo ausente: no hay token ni en localStorage ni en cookie. */
export class SessionMissingError extends Error {
  constructor(message = 'No hay una sesión de dispositivo válida.') {
    super(message);
    this.name = 'SessionMissingError';
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
