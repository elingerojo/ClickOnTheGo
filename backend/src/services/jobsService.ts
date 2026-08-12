/**
 * Acceso a la cola de jobs (listar, cargar, reintentar).
 * El claim productor-consumidor vive en `workerService.ts`.
 */
import { query } from '../config/db.js';
import { JOB_PRODUCT_SELECT, rowToJobWithProduct } from './mappers.js';
import type { Job, JobState } from '@click-on-the-go/shared';

export async function loadJob(id: string): Promise<Job | null> {
  const { rows } = await query(`${JOB_PRODUCT_SELECT} WHERE j.id = $1`, [id]);
  return rows.length ? rowToJobWithProduct(rows[0]) : null;
}

export async function listJobs(state?: JobState | 'all'): Promise<Job[]> {
  if (state && state !== 'all') {
    const { rows } = await query(
      `${JOB_PRODUCT_SELECT} WHERE j.state = $1 ORDER BY j.created_at DESC`,
      [state],
    );
    return rows.map(rowToJobWithProduct);
  }
  const { rows } = await query(`${JOB_PRODUCT_SELECT} ORDER BY j.created_at DESC`);
  return rows.map(rowToJobWithProduct);
}

/**
 * Reintenta un job en estado `error`: lo re-encola como `pending` al final de
 * la cola, reiniciando intentos (botón del dashboard).
 */
export async function retryJob(id: string): Promise<Job | null> {
  const { rows } = await query(
    `UPDATE jobs
       SET state = 'pending', attempts = 0, last_error = NULL,
           next_attempt_at = now(), updated_at = now()
     WHERE id = $1 AND state = 'error'
     RETURNING id`,
    [id],
  );
  if (rows.length === 0) return null;
  return loadJob(rows[0].id);
}
