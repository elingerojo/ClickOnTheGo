/**
 * Script GC — limpieza por antigüedad (sección 5.6 del plan).
 *
 * Se ejecuta SOLO bajo demanda (POST /api/gc/run desde Settings), nunca
 * automático dentro del worker. Criterio: antigüedad por `products.created_at`.
 * Límites configurables en `settings` (claves `gc_*`):
 *   - Guardado OK en Wix (job success + wix_product_id): Blob 7d / Neon 15d
 *   - No sincronizado (draft/error sin wix_product_id): Blob 14d / Neon 21d
 *   - Catch-all / seguridad: 21d para cualquier registro
 *   - Jobs pending/processing: excluidos si `skipActiveJobs`
 */
import { del } from '@vercel/blob';
import { query, withTransaction } from '../config/db.js';
import { sseBus } from '../config/sse.js';
import { env } from '../config/env.js';
import { getSettings } from './settingsService.js';
import type { GcResult } from '@click-on-the-go/shared';

const DAY_MS = 86_400_000;

interface ProductRow {
  id: string;
  sku: string;
  image_urls: string[] | null;
  created_at: Date;
  status: string;
  wix_product_id: string | null;
  last_job_state: string | null;
}

export async function runGc(): Promise<GcResult> {
  const gc = (await getSettings()).gc;
  const now = Date.now();

  const { rows } = await query(
    `SELECT p.id, p.sku, p.image_urls, p.created_at, p.status, p.wix_product_id,
            (SELECT state FROM jobs WHERE product_id = p.id ORDER BY created_at DESC LIMIT 1) AS last_job_state
       FROM products p`,
  );

  const result: GcResult = {
    scanned: rows.length,
    deletedBlobs: 0,
    deletedNeon: 0,
    skippedActive: 0,
    details: [],
  };
  const blobUrlsToDelete: string[] = [];
  const neonIdsToDelete: string[] = [];

  for (const row of rows as ProductRow[]) {
    const ageDays = (now - new Date(row.created_at).getTime()) / DAY_MS;
    const active = row.last_job_state === 'pending' || row.last_job_state === 'processing';
    const syncedOk = row.last_job_state === 'success' && Boolean(row.wix_product_id);

    const blobDays = syncedOk ? gc.blobOkDays : gc.blobNotOkDays;
    const neonDays = syncedOk ? gc.neonOkDays : gc.neonNotOkDays;

    let blobDeleted = false;
    let neonDeleted = false;
    let reason = '';

    if (active && gc.skipActiveJobs) {
      result.skippedActive += 1;
      reason = 'job activo (skipActiveJobs)';
    } else {
      if (ageDays >= blobDays) {
        blobDeleted = true;
        blobUrlsToDelete.push(...(row.image_urls ?? []));
      }
      if (ageDays >= neonDays) {
        neonDeleted = true;
        neonIdsToDelete.push(row.id);
      }
      reason = `blob≥${blobDays}d / neon≥${neonDays}d`;
    }

    // Catch-all de seguridad
    if (ageDays >= gc.allDays) {
      if (!blobDeleted && row.image_urls?.length) {
        blobDeleted = true;
        blobUrlsToDelete.push(...row.image_urls);
      }
      if (!neonDeleted) {
        neonDeleted = true;
        neonIdsToDelete.push(row.id);
      }
      reason = 'catch-all (seguridad)';
    }

    result.details.push({ productId: row.id, sku: row.sku, blobDeleted, neonDeleted, reason });
    if (blobDeleted) result.deletedBlobs += 1;
    if (neonDeleted) result.deletedNeon += 1;
  }

  // Borrar blobs de Vercel (solo si hay token)
  if (blobUrlsToDelete.length > 0 && env.blobReadWriteToken) {
    try {
      await del(blobUrlsToDelete, { token: env.blobReadWriteToken });
    } catch (err: any) {
      console.warn('[gc] No se pudieron borrar algunos blobs:', err.message);
    }
  } else if (blobUrlsToDelete.length > 0) {
    console.warn('[gc] No hay BLOB_READ_WRITE_TOKEN; se omitió el borrado de blobs.');
  }

  // Borrar registros de Neon (jobs en cascada)
  if (neonIdsToDelete.length > 0) {
    await withTransaction(async (client) => {
      await client.query('DELETE FROM jobs WHERE product_id = ANY($1)', [neonIdsToDelete]);
      await client.query('DELETE FROM products WHERE id = ANY($1)', [neonIdsToDelete]);
    });
  }

  sseBus.emit({ type: 'gc:done', data: result });
  console.log(
    `[gc] Escaneados ${result.scanned}: blobs=${result.deletedBlobs}, neon=${result.deletedNeon}, activos=${result.skippedActive}.`,
  );
  return result;
}
