/**
 * Auditoría de eventos en `audit_log` (best-effort, nunca rompe el flujo).
 */
import { query } from '../config/db.js';

export async function audit(event: string, data?: unknown): Promise<void> {
  try {
    await query('INSERT INTO audit_log (event, data) VALUES ($1, $2)', [
      event,
      JSON.stringify(data ?? {}),
    ]);
  } catch (err: any) {
    console.warn('[audit] no se pudo escribir el evento:', err.message);
  }
}
