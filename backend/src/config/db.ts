/**
 * Pool de conexiones PostgreSQL (Neon).
 * Las operaciones críticas (claim de jobs) usan transacciones con
 * `SELECT ... FOR UPDATE SKIP LOCKED` para evitar procesar dos veces.
 */
import pg from 'pg';
import { env } from './env.js';

const { Pool } = pg;

export const pool = new Pool(env.poolConfig);

pool.on('error', (err) => {
  console.error('[db] Error inesperado en el pool de conexiones:', err.message);
});

export type PoolClient = pg.PoolClient;

/** Ejecuta una consulta y devuelve `rows` tipados como `any` por fila. */
export function query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }> {
  return pool.query(text, params);
}

/** Ejecuta `fn` dentro de una transacción (BEGIN/COMMIT/ROLLBACK). */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // si el ROLLBACK falla, se libera igualmente
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Cierra el pool (para shutdown limpio). */
export async function closePool(): Promise<void> {
  await pool.end();
}
