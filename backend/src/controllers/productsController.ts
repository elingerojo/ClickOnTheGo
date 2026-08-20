/**
 * CRUD de productos/capturas + confirmar y encolar.
 *  - POST   /api/products          → guardar captura como borrador (genera SKU y JSON-LD)
 *  - GET    /api/products          → listar capturas (opcional ?status=)
 *  - PUT    /api/products/:id      → actualizar un borrador EN SITIO (conserva status='draft')
 *  - DELETE /api/products/:id      → descartar un borrador (solo status='draft')
 *  - POST   /api/products/:id/approve → aprobar y crear job (pending) en la cola
 */
import type { Request, Response } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../config/db.js';
import { sseBus } from '../config/sse.js';
import { HttpError } from '../utils/httpError.js';
import { rowToProduct } from '../services/mappers.js';
import { buildSku, sanitizeBarcode, sanitizeId } from '../services/skuService.js';
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
  brand: z.string().max(100).optional().nullable(),
  barcode: z.string().max(60).optional().nullable(),
  skuSuggestion: z.string().max(40).optional().nullable(),
  sku: z.string().max(40).optional().nullable(),
  imageUrls: z.array(z.string()).optional(),
  variants: z.any().optional(),
  jsonLd: z.any().optional(),
});

type DraftBody = z.infer<typeof draftSchema>;

function parseDraft(req: Request, res: Response): DraftBody | null {
  const parsed = draftSchema.safeParse(req.body);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path.join('.') || '_root';
      if (!fieldErrors[field]) fieldErrors[field] = issue.message;
    }
    res.status(400).json({ error: 'Body inválido', fieldErrors });
    return null;
  }
  return parsed.data;
}

/** Error de SKU duplicado (UNIQUE products_sku_key) → mensaje amigable por campo. */
function sendSkuConflict(res: Response): void {
  res.status(400).json({
    error: 'Ya existe un producto con ese SKU.',
    fieldErrors: { sku: 'El SKU ya existe; cámbialo o déjalo vacío para autogenerarlo.' },
  });
}

/**
 * Construcción compartida de los campos derivados del borrador (misma regla en
 * create y update): SKU final, barcode saneado, JSON-LD y variantes en forma Wix.
 */
function buildDraftFields(
  body: DraftBody,
  settings: { skuPrefix: string; currency: string; language: string },
): { sku: string; barcode: string | null; jsonLd: unknown; wixVariants: unknown } {
  // (C) SKU final: el usuario puede enviar uno explícito (editable en el
  // formulario); si viene vacío se genera `SKU-` + sugerencia de Gemini, con el
  // barcode como respaldo y, en última instancia, un código aleatorio.
  const submittedSku = body.sku?.trim() ?? '';
  const sku = submittedSku
    ? sanitizeId(submittedSku)
    : buildSku(body.skuSuggestion, body.barcode, { prefix: settings.skuPrefix });
  // (B) Código de barras ÚNICO: se resuelve con prioridad GTIN > UPC > ASIN.
  // Un valor alucinado (inválido/vacío) se descarta → null.
  const barcode = sanitizeBarcode(body.barcode);
  const jsonLd =
    body.jsonLd ??
    buildJsonLd(
      {
        name: body.name,
        description: body.description ?? undefined,
        price: body.price ?? null,
        currency: body.currency ?? settings.currency,
        category: body.category ?? null,
        skuSuggestion: body.skuSuggestion ?? null,
        barcode: body.barcode ?? null,
      },
      { sku, currency: settings.currency, language: settings.language },
    );

  // Acepta variantes en forma Wix (productOptions/variantsInfo) o variantes
  // crudas de Gemini (arreglo {name,value}) → se convierten aquí.
  const rawVariants: any = body.variants ?? null;
  const wixVariants =
    Array.isArray(rawVariants) ? geminiVariantsToWix(rawVariants) : rawVariants;

  return { sku, barcode, jsonLd, wixVariants };
}

export async function create(req: Request, res: Response): Promise<void> {
  const body = parseDraft(req, res);
  if (!body) return;
  const settings = await getSettings();
  const { sku, barcode, jsonLd, wixVariants } = buildDraftFields(body, settings);

  let rows: any[];
  try {
    ({ rows } = await query(
      `INSERT INTO products (sku, name, description, price, currency, category, brand, barcode, variants, json_ld, image_urls, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'draft')
       RETURNING *`,
      [
        sku,
        body.name,
        body.description ?? null,
        body.price ?? null,
        body.currency ?? settings.currency,
        body.category ?? null,
        body.brand ?? null,
        barcode,
        JSON.stringify(wixVariants),
        JSON.stringify(jsonLd),
        // image_urls es text[]: pg serializa el arreglo a {} (JSON.stringify
        // produciría un string inválido → "malformed array literal").
        body.imageUrls ?? [],
      ],
    ));
  } catch (err: any) {
    if (err?.code === '23505' && err?.constraint === 'products_sku_key') {
      sendSkuConflict(res);
      return;
    }
    throw err;
  }

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

/**
 * PUT /api/products/:id — actualiza un borrador EN SITIO (sin duplicar).
 * Solo permite editar productos cuyo status sigue siendo 'draft'; se conserva
 * el status (el cambio a 'approved' lo hace el endpoint de approve).
 */
export async function update(req: Request, res: Response): Promise<void> {
  const id = req.params.id;
  const body = parseDraft(req, res);
  if (!body) return;
  const settings = await getSettings();
  const { sku, barcode, jsonLd, wixVariants } = buildDraftFields(body, settings);

  let rows: any[];
  try {
    ({ rows } = await query(
      `UPDATE products SET
         sku = $2,
         name = $3,
         description = $4,
         price = $5,
         currency = $6,
         category = $7,
         brand = $8,
         barcode = $9,
         variants = $10,
         json_ld = $11,
         image_urls = $12,
         updated_at = now()
       WHERE id = $1 AND status = 'draft'
       RETURNING *`,
      [
        id,
        sku,
        body.name,
        body.description ?? null,
        body.price ?? null,
        body.currency ?? settings.currency,
        body.category ?? null,
        body.brand ?? null,
        barcode,
        JSON.stringify(wixVariants),
        JSON.stringify(jsonLd),
        body.imageUrls ?? [],
      ],
    ));
  } catch (err: any) {
    if (err?.code === '23505' && err?.constraint === 'products_sku_key') {
      sendSkuConflict(res);
      return;
    }
    throw err;
  }

  if (rows.length === 0) {
    const found = await query('SELECT status FROM products WHERE id = $1', [id]);
    if (found.rows.length === 0) throw new HttpError(404, 'Producto no encontrado');
    throw new HttpError(409, 'El producto ya no es un borrador');
  }

  const product = rowToProduct(rows[0]);
  await audit('product:updated', { productId: product.id, sku, name: product.name });
  res.json({ product });
}

/**
 * DELETE /api/products/:id — descarta un borrador (solo status='draft').
 */
export async function remove(req: Request, res: Response): Promise<void> {
  const id = req.params.id;
  const { rows } = await query(
    `DELETE FROM products WHERE id = $1 AND status = 'draft' RETURNING id, sku, name`,
    [id],
  );
  if (rows.length === 0) {
    const found = await query('SELECT status FROM products WHERE id = $1', [id]);
    if (found.rows.length === 0) throw new HttpError(404, 'Producto no encontrado');
    throw new HttpError(409, 'El producto ya no es un borrador');
  }
  await audit('product:deleted', {
    productId: rows[0].id,
    sku: rows[0].sku,
    name: rows[0].name,
  });
  res.status(204).end();
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
