/**
 * Referencias de Wix (categorías y marcas) para el frontend.
 *  - GET /api/categories → sincroniza Wix → Neon (UPSERT en `categories`)
 *                          y devuelve `{ categories: CategoryOption[] }`.
 *  - GET /api/brands     → sincroniza Wix → Neon (UPSERT en `brands`)
 *                          y devuelve `{ brands: WixBrand[] }`.
 *
 * Sin caché en servidor más allá de las tablas; el frontend cachea en
 * `localStorage` y refresca en cada inicio de sesión / botón "Actualizar".
 */
import type { Request, Response } from 'express';
import { getWixClient } from '../config/wixClient.js';
import { query } from '../config/db.js';
import { audit } from '../services/auditService.js';
import type { CategoryOption, WixBrand } from '@click-on-the-go/shared';

/** Sincroniza el catálogo de categorías de Wix a Neon y devuelve la lista. */
export async function categories(_req: Request, res: Response): Promise<void> {
  const client = getWixClient();
  const wixCategories = await client.queryCategories();
  for (const c of wixCategories) {
    if (!c._id || !c.name) continue;
    await query(
      `INSERT INTO categories (wix_category_id, name, parent_id, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (wix_category_id)
       DO UPDATE SET name = EXCLUDED.name, parent_id = EXCLUDED.parent_id, updated_at = now()`,
      [c._id, c.name, c.parentCategory?.id ?? null],
    );
  }
  const { rows } = await query(
    'SELECT wix_category_id AS _id, name FROM categories ORDER BY name',
  );
  await audit('catalog:categories-synced', { count: wixCategories.length });
  res.json({ categories: rows as CategoryOption[] });
}

/** Sincroniza el catálogo de marcas de Wix a Neon y devuelve la lista. */
export async function brands(_req: Request, res: Response): Promise<void> {
  const client = getWixClient();
  const wixBrands = await client.queryBrands();
  for (const b of wixBrands) {
    if (!b._id || !b.name) continue;
    await query(
      `INSERT INTO brands (wix_brand_id, name, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (wix_brand_id)
       DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
      [b._id, b.name],
    );
  }
  const { rows } = await query(
    'SELECT wix_brand_id AS _id, name FROM brands ORDER BY name',
  );
  await audit('catalog:brands-synced', { count: wixBrands.length });
  res.json({ brands: rows as WixBrand[] });
}
