/**
 * Store de toasts por signals (nuevo en F7).
 *
 * - `toasts` — lista visible de notificaciones (host en `AppComponent`).
 * - `showToast(message, type)` agrega un toast con auto-dismiss (5 s).
 * - `dismiss(id)` lo quita manualmente (botón ×).
 * - `pendingJobId` — señal a nivel MÓDULO: guarda el `jobId` recién encolado
 *   ANTES de navegar. `AppComponent` (siempre montado) hace un `effect` sobre
 *   `latestJob` filtrando por ese id y emite el toast final del job
 *   (success/error); se pone a `null` tras emitir para deduplicar ante eventos
 *   duplicados del bus SSE global (todos los dispositivos comparten el bus).
 */
import { signal } from '@angular/core';

export type ToastType = 'info' | 'success' | 'error';

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

export const toasts = signal<Toast[]>([]);

/**
 * Job recién encolado cuyo resultado se espera vía SSE (toast final del job).
 * Se setea en `onApprove()` antes de `router.navigate(['/'])`.
 */
export const pendingJobId = signal<string | null>(null);

const AUTO_DISMISS_MS = 5_000;
let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export function showToast(message: string, type: ToastType = 'info'): void {
  const id = nextId++;
  toasts.update((list) => [...list, { id, message, type }]);
  timers.set(
    id,
    setTimeout(() => dismiss(id), AUTO_DISMISS_MS),
  );
}

export function dismiss(id: number): void {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  toasts.update((list) => list.filter((t) => t.id !== id));
}

export function setPendingJob(id: string | null): void {
  pendingJobId.set(id);
}
