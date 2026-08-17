/**
 * TEMP F6a — POST /api/spike/wix-create (requireAdmin).
 * Ejecuta la validación de escritura real (alta mínima con inventario) contra
 * `stores/v3/products-with-inventory` y devuelve el reporte (permisos, shape,
 * read-back). SE ELIMINA al terminar F6.
 */
import type { Request, Response } from 'express';
import { runSpikeCreate } from '../services/spikeCreateService.js';

export async function spikeWixCreate(_req: Request, res: Response): Promise<void> {
  try {
    const report = await runSpikeCreate();
    res.json({ report });
  } catch (err: any) {
    res.status(502).json({ error: `Spike Wix create falló: ${err?.message ?? err}` });
  }
}
