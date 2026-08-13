/**
 * Estado de sesión por dispositivo (Angular Signals).
 *
 * - `deviceToken` / `isAuthenticated`: token de dispositivo persistido en
 *   localStorage.
 * - `autoApproved`: selector que se reinicia a `false` al iniciar la app.
 * - `defaultCategory`: categoría que se mantiene al cambiar de producto.
 * - `settings`: configuración global (categorías, moneda, idioma, SKU, GC).
 */
import { computed, signal } from '@angular/core';
import { getDeviceToken, setDeviceToken, getDeviceId, setDeviceId, api, storageAvailable } from './api';
import type { AppSettings } from '@click-on-the-go/shared';

export const deviceToken = signal<string | null>(getDeviceToken());
/** Id del dispositivo actual, usado para no mostrarse a sí mismo en la UI. */
export const deviceId = signal<string | null>(getDeviceId());
export const isAuthenticated = computed(() => Boolean(deviceToken()));

// TEMP-DEBUG (quitar antes del release): estado inicial de la sesión al arrancar.
console.warn('[TEMP-DEBUG] session.ts init →', {
  deviceToken: deviceToken(),
  deviceId: deviceId(),
  isAuthenticated: isAuthenticated(),
  storageAvailable: storageAvailable(),
});

/** Se reinicia a `false` en cada arranque de la app. */
export const autoApproved = signal<boolean>(false);

/** Categoría default de la sesión (se mantiene hasta que el usuario la cambie). */
export const defaultCategory = signal<string | null>(null);

export const settings = signal<AppSettings | null>(null);
export const settingsLoaded = signal(false);

export function initSession(): void {
  // Re-sincroniza el signal desde localStorage: en la segunda visita (tras
  // reiniciar el navegador) el snapshot inicial del módulo puede ser null
  // aunque el token ya esté en localStorage (desfase de restauración de
  // almacenamiento de Chrome). Se corrige aquí antes de tomar decisiones.
  const stored = getDeviceToken();
  if (stored !== deviceToken()) {
    console.warn('[session] deviceToken re-sincronizado desde localStorage', {
      prev: deviceToken(),
      stored,
    });
    deviceToken.set(stored);
  }
  const storedId = getDeviceId();
  if (storedId !== deviceId()) deviceId.set(storedId);

  // Regla del plan: auto-approved regresa a false al iniciar la app
  autoApproved.set(false);
  if (deviceToken()) {
    api<AppSettings>('/api/settings')
      .then((s) => {
        settings.set(s);
        settingsLoaded.set(true);
      })
      .catch(() => {
        settings.set(null);
        settingsLoaded.set(true);
      });
  }
}

export function setSession(token: string, id?: string): void {
  deviceToken.set(token);
  setDeviceToken(token);
  if (id) {
    deviceId.set(id);
    setDeviceId(id);
  }
}

/** Registra el id del dispositivo actual (p.ej. el `selfId` de GET /api/devices). */
export function setCurrentDeviceId(id: string): void {
  deviceId.set(id);
  setDeviceId(id);
}

export function clearSession(): void {
  deviceToken.set(null);
  setDeviceToken(null);
  deviceId.set(null);
  setDeviceId(null);
  autoApproved.set(false);
  settings.set(null);
}
