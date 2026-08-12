/**
 * Settings: pre-cargar categorías Wix, moneda e idioma; actualizar config.
 *  - GET  /api/settings          → leer settings
 *  - PUT  /api/settings          → actualizar settings
 *  - POST /api/settings/refresh  → refrescar moneda/idioma desde Wix
 *                                  (site-properties v4) y categorías
 */
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getSettings, updateSettings } from '../services/settingsService.js';
import { getWixClient } from '../config/wixClient.js';
import { audit } from '../services/auditService.js';
import type { SettingsUpdate } from '@click-on-the-go/shared';

const gcSchema = z
  .object({
    blobOkDays: z.number().int().min(0).optional(),
    neonOkDays: z.number().int().min(0).optional(),
    blobNotOkDays: z.number().int().min(0).optional(),
    neonNotOkDays: z.number().int().min(0).optional(),
    allDays: z.number().int().min(0).optional(),
    skipActiveJobs: z.boolean().optional(),
  })
  .optional();

const settingsUpdateSchema = z.object({
  categories: z.array(z.string().min(1)).optional(),
  currency: z.string().max(8).optional(),
  language: z.string().max(20).optional(),
  skuPrefix: z.string().max(20).optional(),
  gc: gcSchema,
});

export async function get(_req: Request, res: Response): Promise<void> {
  res.json(await getSettings());
}

export async function update(req: Request, res: Response): Promise<void> {
  const parsed = settingsUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Body inválido', issues: parsed.error.issues });
    return;
  }
  const update: SettingsUpdate = parsed.data;
  const settings = await updateSettings(update);
  await audit('settings:updated', { by: req.device?.id });
  res.json(settings);
}

/** Refresca moneda/idioma desde el sitio Wix (y conserva categorías). */
export async function refresh(req: Request, res: Response): Promise<void> {
  const site = await getWixClient().getSiteProperties();
  const updated = await updateSettings({
    currency: site.currency,
    language: site.language,
  });
  await audit('settings:refreshed', { by: req.device?.id, site });
  res.json({ ...updated, refreshedFrom: 'wix-site-properties' });
}
