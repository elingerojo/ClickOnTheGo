/**
 * CRUD de productos/capturas + confirmar y encolar.
 *  - POST /api/products        → guardar captura como borrador (genera SKU y JSON-LD)
 *  - GET  /api/products        → listar capturas
 *  - POST /api/products/:id/approve → aprobar y crear job (pending) en la cola
 */
import type { Request, Response } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../config/db.js';
import { sseBus } from '../config/sse.js';
import { HttpError } from '../utils/httpError.js';
import { rowToProduct } from '../services/mappers.js';
import { buildSku } from '../services/skuService.js';
import { buildJsonLd, geminiVariantsToWix } from '../services/mapService.js';
import { getSettings } from '../services/settingsService.js';
import { loadJob } from '../services/jobsService.js';
import { audit } from '../services/auditService.js';

const draftSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio').max(300),
  description: z.string().max(5000).optional().nullable(),
  price: z.number().nonnegative().optional().nullable(),
  currency: z.string().max(8).optional(),
  category: z.string().max(100).optional().nullable(),
  commercialId: z.string().max(60).optional().nullable(),
  imageUrls: z.array(z.string()).optional(),
  variants: z.any().optional(),
  jsonLd: z.any().optional(),
});

export async function create(req: Request, res: Response): Promise<void> {
  const parsed = draftSchema.safeParse(req.body);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path.join('.') || '_root';
      if (!fieldErrors[field]) fieldErrors[field] = issue.message;
    }
    res.status(400).json({ error: 'Body inválido', fieldErrors });
    return;
  }
  const body = parsed.data;
  const settings = await getSettings();

  const sku = buildSku(body.commercialId, { prefix: settings.skuPrefix });
  const jsonLd =
    body.jsonLd ??
    buildJsonLd(
      {
        name: body.name,
        description: body.description ?? undefined,
        price: body.price ?? null,
        currency: body.currency ?? settings.currency,
        category: body.category ?? null,
        commercialId: body.commercialId ?? null,
      },
      { sku, currency: settings.currency, language: settings.language },
    );

  // Acepta variantes en forma Wix (productOptions/variantsInfo) o variantes
  // crudas de Gemini (arreglo {name,value}) → se convierten aquí.
  const rawVariants: any = body.variants ?? null;
  const wixVariants =
    Array.isArray(rawVariants) ? geminiVariantsToWix(rawVariants) : rawVariants;

  const { rows } = await query(
    `INSERT INTO products (sku, name, description, price, currency, category, variants, json_ld, image_urls, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft')
     RETURNING *`,
    [
      sku,
      body.name,
      body.description ?? null,
      body.price ?? null,
      body.currency ?? settings.currency,
      body.category ?? null,
      JSON.stringify(wixVariants),
      JSON.stringify(jsonLd),
      // image_urls es text[]: pg serializa el arreglo a {} (JSON.stringify
      // produciría un string inválido → "malformed array literal").
      body.imageUrls ?? [],
    ],
  );

  const product = rowToProduct(rows[0]);
  await audit('product:created', { productId: product.id, sku, name: product.name });
  res.status(201).json({ product });
}

export async function list(req: Request, res: Response): Promise<void> {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const { rows } = status
    ? await query(
        'SELECT * FROM products WHERE status = $1 ORDER BY created_at DESC',
        [status],
      )
    : await query('SELECT * FROM products ORDER BY created_at DESC');
  res.json({ products: rows.map(rowToProduct) });
}

export async function approve(req: Request, res: Response): Promise<void> {
  const id = req.params.id;
  const { jobId } = await withTransaction(async (client) => {
    const found = await client.query('SELECT * FROM products WHERE id = $1', [id]);
    if (found.rows.length === 0) throw new HttpError(404, 'Producto no encontrado');
    const existingJob = await client.query(
      `SELECT id FROM jobs WHERE product_id = $1 AND state IN ('pending','processing') LIMIT 1`,
      [id],
    );
    if (existingJob.rows.length > 0) {
      throw new HttpError(409, 'El producto ya tiene un job en curso');
    }
    await client.query(
      `UPDATE products SET status = 'approved', updated_at = now() WHERE id = $1`,
      [id],
    );
    const inserted = await client.query(
      `INSERT INTO jobs (product_id, state, attempts, max_attempts)
       VALUES ($1, 'pending', 0, 3)
       RETURNING id`,
      [id],
    );
    return { jobId: inserted.rows[0].id as string };
  });

  const job = await loadJob(jobId);
  if (job) sseBus.emit({ type: 'job:state', data: job });
  await audit('product:approved', { productId: id, jobId });
  res.status(201).json({ job });
}
