/** Dashboard de jobs: listar y reintentar (la suscripción SSE vive en services/sse.ts). */
import { api } from './api';
import type { Job, JobState } from '@click-on-the-go/shared';

export function listJobs(state?: JobState): Promise<{ jobs: Job[] }> {
  const q = state ? `?state=${encodeURIComponent(state)}` : '';
  return api<{ jobs: Job[] }>(`/api/jobs${q}`);
}

export function retryJob(id: string): Promise<{ job: Job }> {
  return api<{ job: Job }>(`/api/jobs/${id}/retry`, { method: 'POST' });
}
