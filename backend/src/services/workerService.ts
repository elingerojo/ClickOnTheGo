/**
 * Worker productor-consumidor (sección 5.1 del plan).
 *
 * - Bucle `setInterval` dentro del proceso del backend.
 * - Claim: transacción que toma el job `pending` más antiguo con
 *   `next_attempt_at <= now()` usando `SELECT ... FOR UPDATE SKIP LOCKED`,
 *   lo pasa a `processing` y emite evento SSE.
 * - Carga multimedia: copia cada imagen desde Vercel Blob a
 *   `wix-media-backend` y guarda la URL de Wix Media en `products.image_urls`.
 * - Ejecución: ALTA (create-only) en Wix Catalog V3 (`wixCatalogService`).
 * - Éxito: `state = success` + `wix_product_id`/`revision` + SSE.
 * - Fallo: reintentos con backoff (re-encolar al final); si agota,
 *   `state = error` con `last_error`. Un SKU duplicado (HTTP 409) también
 *   falla visiblemente (ya no hay skip silencioso de upsert).
 */
import { pool } from '../config/db.js';
import { sseBus } from '../config/sse.js';
import { getWixClient } from '../config/wixClient.js';
import { createProductV3 } from './wixCatalogService.js';
import { getSettings } from './settingsService.js';
import { audit } from './auditService.js';
import { JOB_PRODUCT_SELECT, rowToJobWithProduct } from './mappers.js';
import type { Job, ProductCapture } from '@click-on-the-go/shared';

export const DEFAULT_POLL_INTERVAL_MS = 2_000;
export const DEFAULT_MAX_ATTEMPTS = 3;
/** Backoff base: 5s, 10s, ... por intento. */
const BACKOFF_BASE_MS = 5_000;

let running = false;
let timer: NodeJS.Timeout | null = null;

export function startWorker(intervalMs: number = DEFAULT_POLL_INTERVAL_MS): void {
  if (running) return;
  running = true;
  console.log(`[worker] Iniciado. Polling cada ${intervalMs}ms (Wix: ${getWixClient().mode}).`);
  timer = setInterval(() => {
    tick().catch((err: any) => console.error('[worker] Error en tick:', err.message));
  }, intervalMs);
}

export function stopWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
  running = false;
}

async function tick(): Promise<void> {
  const jobId = await claimJob();
  if (!jobId) return;
  try {
    await processJob(jobId);
  } catch (err: any) {
    console.error(`[worker] Error crítico procesando job ${jobId}:`, err.message);
  }
}

/** Claim transaccional con `FOR UPDATE SKIP LOCKED`. Devuelve el id o null. */
async function claimJob(): Promise<string | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT j.id
         FROM jobs j
        WHERE j.state = 'pending' AND j.next_attempt_at <= now()
        ORDER BY j.created_at ASC
        LIMIT 1
          FOR UPDATE SKIP LOCKED`,
    );
    if (rows.length === 0) {
      await client.query('COMMIT');
      return null;
    }
    await client.query(
      `UPDATE jobs SET state = 'processing', updated_at = now() WHERE id = $1`,
      [rows[0].id],
    );
    await client.query('COMMIT');
    return rows[0].id as string;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function loadJobWithProduct(jobId: string): Promise<Job | null> {
  const { rows } = await pool.query(`${JOB_PRODUCT_SELECT} WHERE j.id = $1`, [jobId]);
  return rows.length ? rowToJobWithProduct(rows[0]) : null;
}

async function processJob(jobId: string): Promise<void> {
  const job = await loadJobWithProduct(jobId);
  if (!job?.product) return;
  const product = job.product;

  console.log(
    `[worker][DIAG] Procesando job ${jobId} (sku=${product.sku}, Wix mode=${getWixClient().mode}, ` +
      `imagenes=${product.imageUrls.length}).`,
  );
  sseBus.emit({ type: 'job:state', data: job });
  await audit('job:start', { jobId, productId: product.id, sku: product.sku });

  try {
    // 1) Carga multimedia: Blob staging → wix-media-backend (URL Wix Media)
    const client = getWixClient();
    if (product.imageUrls.length > 0) {
      const wixMediaUrls = await Promise.all(
        product.imageUrls.map((url, i) =>
          client.uploadImageToMedia(url, `${product.sku}-${i + 1}`),
        ),
      );
      await pool.query(
        `UPDATE products SET image_urls = $1, updated_at = now() WHERE id = $2`,
        [wixMediaUrls, product.id],
      );
      product.imageUrls = wixMediaUrls;
      sseBus.emit({ type: 'product:updated', data: product });
    }

    // 2) Alta en Wix Catalog V3 con inventario (F6): settings + marca resuelta
    const settings = await getSettings();
    const quantity = settings.defaultQuantity ?? 50;
    const visible = settings.visible ?? true;

    // Resolver la marca elegida (nombre) → id de Wix vía la tabla `brands`
    let brandId: string | undefined;
    if (product.brand) {
      const { rows } = await pool.query(
        'SELECT wix_brand_id FROM brands WHERE name = $1 LIMIT 1',
        [product.brand],
      );
      brandId = rows[0]?.wix_brand_id;
      if (!brandId) {
        console.warn(
          `[worker] Marca "${product.brand}" no encontrada en brands; alta sin marca.`,
        );
      }
    }

    const result = await createProductV3(product, { quantity, visible, brandId });

    // 3) Éxito: el producto se creó en Wix (create-only, sin ruta de update).
    await pool.query(
      `UPDATE jobs SET state = 'success', attempts = attempts + 1, last_error = NULL, updated_at = now() WHERE id = $1`,
      [jobId],
    );
    // El alta siempre devuelve `wix_product_id` (create-only); ya no existe el
    // caso de SKU duplicado que conservaba el id previo (el upsert se eliminó).
    await pool.query(
      `UPDATE products
          SET status = 'synced', wix_product_id = $1, wix_revision = $2, updated_at = now()
        WHERE id = $3`,
      [result.productId, Number(result.revision ?? 0), product.id],
    );
    const done = await loadJobWithProduct(jobId);
    if (done) sseBus.emit({ type: 'job:state', data: done });
    await audit('job:success', {
      jobId,
      productId: product.id,
      sku: product.sku,
      wixProductId: result.productId,
      inventoryQuantity: result.inventoryQuantity,
    });
  } catch (err: any) {
    await handleJobError(jobId, product, err);
  }
}

async function handleJobError(jobId: string, product: ProductCapture, err: Error): Promise<void> {
  console.error(`[worker] Job ${jobId} (${product.sku}) falló:`, err.message);
  await pool.query(`UPDATE jobs SET attempts = attempts + 1, updated_at = now() WHERE id = $1`, [
    jobId,
  ]);

  const { rows } = await pool.query(
    `SELECT attempts, max_attempts FROM jobs WHERE id = $1`,
    [jobId],
  );
  const attempts = Number(rows[0]?.attempts ?? 0);
  const maxAttempts = Number(rows[0]?.max_attempts ?? DEFAULT_MAX_ATTEMPTS);

  if (attempts < maxAttempts) {
    // Re-encolar al final con backoff
    const backoffMs = BACKOFF_BASE_MS * 2 ** (attempts - 1);
    await pool.query(
      `UPDATE jobs
          SET state = 'pending', last_error = $1, next_attempt_at = now() + make_interval(secs => $2), updated_at = now()
        WHERE id = $3`,
      [err.message, backoffMs / 1000, jobId],
    );
    console.warn(`[worker] Job ${jobId} re-encolado (intento ${attempts}/${maxAttempts}) con backoff ${backoffMs}ms.`);
  } else {
    // Agotó intentos → error visible en el dashboard (botón reintentar)
    await pool.query(
      `UPDATE jobs SET state = 'error', last_error = $1, updated_at = now() WHERE id = $2`,
      [err.message, jobId],
    );
    await pool.query(`UPDATE products SET status = 'error', updated_at = now() WHERE id = $1`, [
      product.id,
    ]);
  }

  const updated = await loadJobWithProduct(jobId);
  if (updated) sseBus.emit({ type: 'job:state', data: updated });
  await audit('job:error', { jobId, productId: product.id, sku: product.sku, error: err.message });
}

export function isWorkerRunning(): boolean {
  return running;
}
