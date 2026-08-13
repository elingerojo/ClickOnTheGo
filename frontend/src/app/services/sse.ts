/**
 * Store SSE (Server-Sent Events) por signals — conexión única a nivel app-root.
 *
 * - `startSse()` abre el `EventSource` hacia `/api/events` y distribuye cada
 *   evento a su signal correspondiente.
 * - `stopSse()` cierra la conexión (logout).
 * - Los componentes (Dashboard, Settings) consumen las signals en vez de poseer
 *   su propia conexión, evitando `EventSource` duplicados.
 *
 * La conexión se gestiona en `AppComponent` (siempre montado) vía un `effect`
 * sobre `isAuthenticated`: se abre al autenticar y se cierra al cerrar sesión.
 */
import { signal } from '@angular/core';
import { APP_CONFIG } from '../app.config';
import { getDeviceToken } from './api';
import type {
  GcResult,
  InvitationUsedEvent,
  Job,
  ProductCapture,
  SseEvent,
} from '@click-on-the-go/shared';

/** Último estado de job notificado por el worker (dashboard). */
export const latestJob = signal<Job | null>(null);
/** Último producto actualizado por el worker (sincronizado con Wix). */
export const latestProduct = signal<ProductCapture | null>(null);
/** Resultado de la limpieza GC notificado por el backend. */
export const gcDone = signal<GcResult | null>(null);
/** Evento de invitación usada por otro dispositivo (regeneración automática del QR). */
export const invitationUsed = signal<InvitationUsedEvent | null>(null);
/** Estado de la conexión SSE (abierta / cerrada). */
export const sseConnected = signal(false);

let es: EventSource | null = null;

/**
 * Conecta al endpoint SSE del backend. `EventSource` no puede mandar cabeceras
 * personalizadas, por eso el device token viaja como query param.
 */
function connectSse(onEvent: (event: SseEvent) => void): EventSource {
  const token = getDeviceToken() ?? '';
  const source = new EventSource(
    `${APP_CONFIG.apiBaseUrl}/api/events?token=${encodeURIComponent(token)}`,
  );

  const handler = (type: SseEvent['type']) => (e: MessageEvent) => {
    try {
      onEvent({ type, data: JSON.parse(e.data) });
    } catch {
      // evento malformado — se ignora
    }
  };

  source.addEventListener('job:state', handler('job:state'));
  source.addEventListener('product:updated', handler('product:updated'));
  source.addEventListener('gc:done', handler('gc:done'));
  source.addEventListener('invitation:used', handler('invitation:used'));
  return source;
}

/** Abre la conexión SSE única (idempotente) y distribuye eventos a los signals. */
export function startSse(): void {
  if (es) return;
  es = connectSse((event) => {
    switch (event.type) {
      case 'job:state':
        latestJob.set(event.data);
        break;
      case 'product:updated':
        latestProduct.set(event.data);
        break;
      case 'gc:done':
        gcDone.set(event.data);
        break;
      case 'invitation:used':
        invitationUsed.set(event.data);
        break;
    }
  });
  es.onopen = () => sseConnected.set(true);
  es.onerror = () => sseConnected.set(false);
}

/** Cierra la conexión SSE (logout). Idempotente. */
export function stopSse(): void {
  es?.close();
  es = null;
  sseConnected.set(false);
}
