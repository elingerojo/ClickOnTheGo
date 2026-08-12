/**
 * Cargador de variables de entorno MÍNIMO (sin dependencia de dotenv).
 *
 * - En local: lee `backend/.env` (o la ruta indicada) y llena `process.env`
 *   SOLO para las claves que aún no estén definidas (no pisa las reales).
 * - En Railway / Vercel: las variables llegan ya inyectadas por la plataforma,
 *   así que esta función es un no-op (no existe el archivo `.env`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Quitar comentario inline (no aplica si el valor trae # dentro de un URL real
    // como connection strings; para simplificar solo se corta si hay espacio antes).
    const hashIdx = value.indexOf(' #');
    if (hashIdx !== -1) value = value.slice(0, hashIdx).trim();
    if (key) out[key] = value;
  }
  return out;
}

/** Carga `process.env` desde un archivo `.env` si existe. Idempotente. */
export function loadEnvFile(path = '.env'): void {
  const filePath = resolve(process.cwd(), path);
  if (!existsSync(filePath)) return;
  const parsed = parseEnvFile(readFileSync(filePath, 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
