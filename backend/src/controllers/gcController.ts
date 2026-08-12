/**
 * POST /api/gc/run — ejecuta el script GC bajo demanda (botón en Settings).
 */
import type { Request, Response } from 'express';
import { runGc } from '../services/gcService.js';
import { audit } from '../services/auditService.js';

export async function run(req: Request, res: Response): Promise<void> {
  const result = await runGc();
  await audit('gc:run', { by: req.device?.id, result: { scanned: result.scanned, deletedBlobs: result.deletedBlobs, deletedNeon: result.deletedNeon } });
  res.json(result);
}
