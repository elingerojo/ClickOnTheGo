/**
 * Mappers de filas SQL → contratos compartidos (`shared`).
 * El join jobs+products usa alias para evitar colisión de columnas.
 */
import type { Job, JobState, ProductCapture } from '@click-on-the-go/shared';

export const JOB_PRODUCT_SELECT = `
  SELECT
    j.id AS job_id,
    j.product_id,
    j.state,
    j.attempts,
    j.max_attempts,
    j.next_attempt_at,
    j.last_error,
    j.created_at AS job_created_at,
    j.updated_at AS job_updated_at,
    p.id,
    p.sku,
    p.name,
    p.description,
    p.price,
    p.currency,
    p.category,
    p.variants,
    p.json_ld,
    p.image_urls,
    p.status,
    p.wix_product_id,
    p.wix_revision,
    p.created_at,
    p.updated_at
  FROM jobs j
  JOIN products p ON p.id = j.product_id
`;

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return String(value ?? '');
}

export function rowToProduct(row: any): ProductCapture {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    description: row.description ?? null,
    price: row.price != null ? Number(row.price) : null,
    currency: row.currency ?? 'USD',
    category: row.category ?? null,
    variants: row.variants ?? null,
    jsonLd: row.json_ld ?? null,
    imageUrls: Array.isArray(row.image_urls) ? row.image_urls : [],
    status: row.status,
    wixProductId: row.wix_product_id ?? null,
    wixRevision: row.wix_revision != null ? Number(row.wix_revision) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

/** Convierte una fila del JOIN (con alias `job_*`). */
export function rowToJobWithProduct(row: any): Job {
  return {
    id: row.job_id ?? row.id,
    productId: row.product_id,
    product: row.id ? rowToProduct(row) : null,
    state: row.state as JobState,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    nextAttemptAt: toIso(row.next_attempt_at),
    lastError: row.last_error ?? null,
    createdAt: toIso(row.job_created_at ?? row.created_at),
    updatedAt: toIso(row.job_updated_at ?? row.updated_at),
  };
}
