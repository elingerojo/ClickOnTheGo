/**
 * Genera un token de un solo uso desde la terminal y devuelve el link de
 * invitación para autenticar un dispositivo. Uso:
 *   npm run db:token -w @click-on-the-go/backend
 */
import { randomBytes } from 'node:crypto';
import { loadEnvFile } from '../config/loadEnv.js';

loadEnvFile();

const { query } = await import('../config/db.js');
const { env } = await import('../config/env.js');

async function main(): Promise<void> {
  const token = randomBytes(32).toString('hex');
  await query('INSERT INTO one_time_tokens (token) VALUES ($1)', [token]);
  const link = `${env.appBaseUrl}/auth?token=${token}`;
  console.log('\n=== Token de un solo uso (una sola vez) ===');
  console.log('Token:', token);
  console.log('Link de invitación:', link);
  console.log('Abre el link en el dispositivo nuevo para canjearlo.\n');
  const { pool } = await import('../config/db.js');
  await pool.end();
}

main().catch((err) => {
  console.error('[token] Error:', err.message);
  process.exit(1);
});
