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
import { getDeviceToken, setDeviceToken, api } from './api';
import type { AppSettings } from '@click-on-the-go/shared';

export const deviceToken = signal<string | null>(getDeviceToken());
export const isAuthenticated = computed(() => Boolean(deviceToken()));

/** Se reinicia a `false` en cada arranque de la app. */
export const autoApproved = signal<boolean>(false);

/** Categoría default de la sesión (se mantiene hasta que el usuario la cambie). */
export const defaultCategory = signal<string | null>(null);

export const settings = signal<AppSettings | null>(null);
export const settingsLoaded = signal(false);

export function initSession(): void {
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

export function setSession(token: string): void {
  deviceToken.set(token);
  setDeviceToken(token);
}

export function clearSession(): void {
  deviceToken.set(null);
  setDeviceToken(null);
  autoApproved.set(false);
  settings.set(null);
}
