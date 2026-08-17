/**
 * Lectura/escritura de la tabla `settings` (config central): moneda, idioma,
 * prefijo SKU, stock inicial / visibilidad / toggles de referencia a Gemini,
 * y límites del script GC. Las categorías y marcas de Wix viven en las tablas
 * `categories`/`brands` (ya NO en settings).
 */
import { query } from '../config/db.js';
import type { AppSettings, GcLimits, SettingsUpdate } from '@click-on-the-go/shared';

export const DEFAULT_SETTINGS: AppSettings = {
  defaultQuantity: 50,
  visible: true,
  sendCategoryToGemini: false,
  sendBrandToGemini: false,
  currency: 'USD',
  language: 'es-ES',
  skuPrefix: 'SKU-',
  gc: {
    blobOkDays: 7,
    neonOkDays: 15,
    blobNotOkDays: 14,
    neonNotOkDays: 21,
    allDays: 21,
    skipActiveJobs: true,
  },
};

export async function getSettings(): Promise<AppSettings> {
  const { rows } = await query('SELECT key, value FROM settings WHERE key = ANY($1)', [
    ['app', 'gc'],
  ]);
  const app = rows.find((r) => r.key === 'app')?.value ?? {};
  const gc = rows.find((r) => r.key === 'gc')?.value ?? {};
  return {
    // `categories` de BD viejas se ignora (sin migración): ya no existe en el contrato.
    defaultQuantity:
      typeof app.defaultQuantity === 'number' && app.defaultQuantity >= 0
        ? app.defaultQuantity
        : DEFAULT_SETTINGS.defaultQuantity,
    visible:
      typeof app.visible === 'boolean' ? app.visible : DEFAULT_SETTINGS.visible,
    sendCategoryToGemini:
      typeof app.sendCategoryToGemini === 'boolean'
        ? app.sendCategoryToGemini
        : DEFAULT_SETTINGS.sendCategoryToGemini,
    sendBrandToGemini:
      typeof app.sendBrandToGemini === 'boolean'
        ? app.sendBrandToGemini
        : DEFAULT_SETTINGS.sendBrandToGemini,
    currency: typeof app.currency === 'string' ? app.currency : DEFAULT_SETTINGS.currency,
    language: typeof app.language === 'string' ? app.language : DEFAULT_SETTINGS.language,
    skuPrefix: typeof app.skuPrefix === 'string' ? app.skuPrefix : DEFAULT_SETTINGS.skuPrefix,
    gc: { ...DEFAULT_SETTINGS.gc, ...(gc as Partial<GcLimits>) },
  };
}

export async function updateSettings(update: SettingsUpdate): Promise<AppSettings> {
  const current = await getSettings();
  const app = {
    defaultQuantity: update.defaultQuantity ?? current.defaultQuantity,
    visible: update.visible ?? current.visible,
    sendCategoryToGemini: update.sendCategoryToGemini ?? current.sendCategoryToGemini,
    sendBrandToGemini: update.sendBrandToGemini ?? current.sendBrandToGemini,
    currency: update.currency ?? current.currency,
    language: update.language ?? current.language,
    skuPrefix: update.skuPrefix ?? current.skuPrefix,
  };
  const gc: GcLimits = { ...current.gc, ...(update.gc ?? {}) };

  await query(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    ['app', JSON.stringify(app)],
  );
  await query(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    ['gc', JSON.stringify(gc)],
  );

  return { ...app, gc };
}
