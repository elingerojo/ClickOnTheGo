/**
 * TEMP F6a — Script CLI del spike de validación de ESCRITURA en Wix
 * (primera alta real con inventario).
 *
 * Uso: npm run db:spike-create -w @click-on-the-go/backend
 * (o: cd backend && npm run db:spike-create)
 *
 * Ejecuta `runSpikeCreate()` (alta real con `stores/v3/products-with-inventory`
 * + read-back con `readProductV3`) e imprime el reporte (permisos 401/403,
 * shape, inventoryOptions, brand). Requiere `WIX_API_KEY` / `WIX_SITE_ID`
 * (reales) en el entorno.
 *
 * SE ELIMINA al terminar F6.
 */
import { loadEnvFile } from '../config/loadEnv.js';

loadEnvFile('.env');

async function main(): Promise<void> {
  try {
    const { runSpikeCreate } = await import('../services/spikeCreateService.js');
    await runSpikeCreate();
  } catch (err: any) {
    console.error('[F6a spike] Error ejecutando el spike:', err?.message ?? err);
    process.exitCode = 1;
  }
}

void main();
