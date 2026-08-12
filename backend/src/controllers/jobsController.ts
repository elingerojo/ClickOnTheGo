/**
 * Jobs: listar (dashboard) y reintentar un job en error.
 */
import type { Request, Response } from 'express';
import { listJobs, retryJob } from '../services/jobsService.js';
import { HttpError } from '../utils/httpError.js';

export async function list(req: Request, res: Response): Promise<void> {
  const state =
    typeof req.query.state === 'string' ? req.query.state : undefined;
  const jobs = await listJobs((state as any) ?? 'all');
  res.json({ jobs });
}

export async function retry(req: Request, res: Response): Promise<void> {
  const job = await retryJob(req.params.id);
  if (!job) throw new HttpError(404, 'Job no encontrado o no está en estado error');
  res.json({ job });
}
