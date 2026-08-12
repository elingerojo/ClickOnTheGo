/**
 * Punto de entrada del backend.
 *
 * IMPORTANTE (ESM): primero se carga el `.env` local (sin dotenv) y luego se
 * importa dinámicamente `app.ts`, para que TODOS los módulos (db, wixClient,
 * etc.) lean las variables de entorno ya cargadas.
 */
import { loadEnvFile } from './config/loadEnv.js';
import { assertRequiredEnv } from './config/env.js';

loadEnvFile();
assertRequiredEnv();

const { startServer } = await import('./app.js');

await startServer();
