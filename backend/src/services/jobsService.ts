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

/** Ventana de "recientes": jobs actualizados en los últimos 5 días (sin tope). */
const RECENT_WINDOW = `interval '5 days'`;
/** Tope de filas del dashboard (solo aplica al relleno con jobs antiguos). */
const MAX_VISIBLE_JOBS = 20;

export async function listJobs(state?: JobState | 'all'): Promise<Job[]> {
  // Regla del dashboard: se traen TODOS los jobs con updated_at < 5 días
  // (aunque sean más de 20) y se rellena hasta 20 con los más recientes de los
  // antiguos (>= 5 días). Así la lista no crece infinitamente en el payload.
  const stateWhere = state && state !== 'all' ? `j.state = $1 AND ` : '';
  const params: unknown[] = state && state !== 'all' ? [state] : [];
  const recentWhere = `${stateWhere}j.updated_at > now() - ${RECENT_WINDOW}`;
  const fillWhere = `${stateWhere}j.updated_at <= now() - ${RECENT_WINDOW}`;

  const { rows } = await query(
    `WITH recent AS (
       ${JOB_PRODUCT_SELECT}
       WHERE ${recentWhere}
     ),
     fill AS (
       ${JOB_PRODUCT_SELECT}
       WHERE ${fillWhere}
       ORDER BY j.created_at DESC
       LIMIT (SELECT GREATEST(0, ${MAX_VISIBLE_JOBS} - (SELECT count(*)::int FROM recent)))
     )
     SELECT * FROM recent
     UNION ALL
     SELECT * FROM fill
     ORDER BY job_created_at DESC`,
    params,
  );
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
