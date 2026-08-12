/**
 * Aplica el esquema SQL a Neon. Uso:
 *   npm run db:schema -w @click-on-the-go/backend
 *
 * Lee `backend/db/schema.sql` y lo ejecuta (idempotente).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from '../config/loadEnv.js';

loadEnvFile();

const { pool } = await import('../config/db.js');

async function main(): Promise<void> {
  const filePath = resolve(process.cwd(), 'db/schema.sql');
  const sql = readFileSync(filePath, 'utf8');
  console.log('[schema] Aplicando', filePath, '...');
  await pool.query(sql);
  console.log('[schema] Esquema aplicado correctamente.');
  await pool.end();
}

main().catch((err) => {
  console.error('[schema] Error aplicando el esquema:', err.message);
  process.exit(1);
});
