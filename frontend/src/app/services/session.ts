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
import type { AppSettings, CategoryOption, WixBrand } from '@click-on-the-go/shared';

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

/* ---------------------------------------------------------------------------
 * Referencias de Wix (categorías y marcas) — caché de UX en localStorage,
 * refrescada en cada inicio de sesión (initSession) y con "Actualizar" en
 * Settings. Si el fetch falla se conserva el caché previo.
 * ------------------------------------------------------------------------- */
const WIX_CATEGORIES_KEY = 'cog_wix_categories';
const WIX_BRANDS_KEY = 'cog_wix_brands';

function readStoredList<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as T[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage inaccesible (modo incógnito): solo caché en memoria
  }
}

export const wixCategories = signal<CategoryOption[]>(
  readStoredList<CategoryOption>(WIX_CATEGORIES_KEY),
);
export const wixBrands = signal<WixBrand[]>(readStoredList<WixBrand>(WIX_BRANDS_KEY));

/** Re-ejecuta GET /api/categories y GET /api/brands (sync Wix → Neon) y refresca signals + caché. */
export async function refreshWixReferences(): Promise<void> {
  const [catRes, brandRes] = await Promise.all([
    api<{ categories: CategoryOption[] }>('/api/categories'),
    api<{ brands: WixBrand[] }>('/api/brands'),
  ]);
  wixCategories.set(catRes.categories);
  writeStored(WIX_CATEGORIES_KEY, catRes.categories);
  wixBrands.set(brandRes.brands);
  writeStored(WIX_BRANDS_KEY, brandRes.brands);
}

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

    // Referencias de Wix (categorías/marcas): sync Wix → Neon + caché en localStorage.
    // Si fallan se conserva el caché previo.
    api<{ categories: CategoryOption[] }>('/api/categories')
      .then((res) => {
        wixCategories.set(res.categories);
        writeStored(WIX_CATEGORIES_KEY, res.categories);
      })
      .catch(() => {
        /* conservar caché previo */
      });
    api<{ brands: WixBrand[] }>('/api/brands')
      .then((res) => {
        wixBrands.set(res.brands);
        writeStored(WIX_BRANDS_KEY, res.brands);
      })
      .catch(() => {
        /* conservar caché previo */
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
