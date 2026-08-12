/** Dashboard de jobs + suscripción SSE. */
import { api, getDeviceToken } from './api';
import { APP_CONFIG } from '../app.config';
import type { Job, JobState, SseEvent } from '@click-on-the-go/shared';

export function listJobs(state?: JobState): Promise<{ jobs: Job[] }> {
  const q = state ? `?state=${encodeURIComponent(state)}` : '';
  return api<{ jobs: Job[] }>(`/api/jobs${q}`);
}

export function retryJob(id: string): Promise<{ job: Job }> {
  return api<{ job: Job }>(`/api/jobs/${id}/retry`, { method: 'POST' });
}

/**
 * Se conecta al endpoint SSE del backend. `EventSource` no puede mandar
 * cabeceras, por eso el device token viaja como query param.
 */
export function connectSse(onEvent: (event: SseEvent) => void): EventSource {
  const token = getDeviceToken() ?? '';
  const es = new EventSource(
    `${APP_CONFIG.apiBaseUrl}/api/events?token=${encodeURIComponent(token)}`,
  );

  const handler = (type: SseEvent['type']) => (e: MessageEvent) => {
    try {
      onEvent({ type, data: JSON.parse(e.data) });
    } catch {
      // evento malformado — se ignora
    }
  };

  es.addEventListener('job:state', handler('job:state'));
  es.addEventListener('product:updated', handler('product:updated'));
  es.addEventListener('gc:done', handler('gc:done'));
  return es;
}
