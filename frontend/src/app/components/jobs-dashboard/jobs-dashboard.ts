import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { listJobs, retryJob, connectSse } from '../../services/jobs';
import { listDevices, revokeDevice } from '../../services/settings';
import { deviceId, setCurrentDeviceId } from '../../services/session';
import type { Device, Job, SseEvent } from '@click-on-the-go/shared';

const STATE_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  processing: 'bg-blue-100 text-blue-800',
  success: 'bg-emerald-100 text-emerald-800',
  error: 'bg-red-100 text-red-800',
};

@Component({
  selector: 'app-jobs-dashboard',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="space-y-8">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold">Dashboard de jobs</h1>
        <span class="text-xs text-slate-400">{{ sseConnected() ? '🔵 SSE conectado' : '⚪ SSE desconectado' }}</span>
      </div>

      <!-- Jobs -->
      <div class="bg-white rounded-2xl shadow overflow-hidden">
        <div class="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 class="font-semibold">Jobs de sincronización con Wix</h2>
          <button (click)="refresh()" class="text-sm text-brand-600 hover:underline">Refrescar</button>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 text-slate-500 text-left">
              <tr>
                <th class="px-5 py-3">Producto</th>
                <th class="px-5 py-3">SKU</th>
                <th class="px-5 py-3">Estado</th>
                <th class="px-5 py-3">Intentos</th>
                <th class="px-5 py-3">Error</th>
                <th class="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <tr *ngFor="let job of jobs()">
                <td class="px-5 py-3 font-medium">{{ job.product?.name ?? '—' }}</td>
                <td class="px-5 py-3 text-slate-500">{{ job.product?.sku ?? '—' }}</td>
                <td class="px-5 py-3">
                  <span class="px-2 py-0.5 rounded-full text-xs font-medium" [class]="stateStyle(job.state)">
                    {{ job.state }}
                  </span>
                </td>
                <td class="px-5 py-3 text-slate-500">{{ job.attempts }}/{{ job.maxAttempts }}</td>
                <td class="px-5 py-3 text-red-600 max-w-xs truncate" title="{{ job.lastError ?? '' }}">
                  {{ job.lastError ?? '—' }}
                </td>
                <td class="px-5 py-3">
                  <button
                    *ngIf="job.state === 'error'"
                    (click)="retry(job)"
                    class="px-3 py-1 rounded-lg bg-brand-600 text-white text-xs hover:bg-brand-700"
                  >Reintentar</button>
                </td>
              </tr>
              <tr *ngIf="jobs().length === 0">
                <td colspan="6" class="px-5 py-8 text-center text-slate-400">Sin jobs todavía</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Dispositivos -->
      <div class="bg-white rounded-2xl shadow overflow-hidden">
        <div class="px-5 py-4 border-b border-slate-100">
          <h2 class="font-semibold">Dispositivos autenticados</h2>
        </div>
        <div class="divide-y divide-slate-100">
          <div *ngFor="let d of otherDevices()" class="px-5 py-3 flex items-center justify-between">
            <div>
              <p class="font-medium">{{ d.name ?? 'Sin nombre' }}</p>
              <p class="text-xs text-slate-400">
                Última actividad: {{ d.lastSeenAt ? (d.lastSeenAt | date: 'short') : '—' }}
              </p>
            </div>
            <button
              (click)="revoke(d)"
              class="px-3 py-1 rounded-lg bg-red-50 text-red-600 text-xs hover:bg-red-100"
            >Invalidar</button>
          </div>
          <div *ngIf="otherDevices().length === 0" class="px-5 py-6 text-center text-slate-400">Sin otros dispositivos</div>
        </div>
      </div>
    </div>
  `,
})
export class JobsDashboardComponent implements OnInit, OnDestroy {
  jobs = signal<Job[]>([]);
  devices = signal<Device[]>([]);
  /**
   * Solo los OTROS dispositivos: se oculta el dispositivo actual (no puede
   * invalidarse a sí mismo) y se descartan los ya invalidados.
   */
  otherDevices = computed(() =>
    this.devices().filter((d) => d.id !== deviceId() && !d.revokedAt),
  );
  sseConnected = signal(false);
  private es: EventSource | null = null;

  ngOnInit(): void {
    void this.refresh();
    this.connect();
  }

  ngOnDestroy(): void {
    this.es?.close();
  }

  async refresh(): Promise<void> {
    try {
      const { jobs } = await listJobs();
      this.jobs.set(jobs);
      const { devices, selfId } = await listDevices();
      this.devices.set(devices);
      // Asegura saber cuál es nuestro propio id (sirve también para sesiones
      // previas al cambio, donde el deviceId no estaba en localStorage).
      if (selfId) setCurrentDeviceId(selfId);
    } catch (err) {
      console.error('Error cargando dashboard', err);
    }
  }

  connect(): void {
    this.es = connectSse((event: SseEvent) => this.onEvent(event));
    this.es.onopen = () => this.sseConnected.set(true);
    this.es.onerror = () => this.sseConnected.set(false);
  }

  onEvent(event: SseEvent): void {
    if (event.type === 'job:state') {
      this.jobs.update((jobs) => {
        const idx = jobs.findIndex((j) => j.id === event.data.id);
        if (idx === -1) return [event.data, ...jobs];
        const copy = [...jobs];
        copy[idx] = event.data;
        return copy;
      });
    } else if (event.type === 'gc:done') {
      // no hace falta accion aquí
    }
  }

  stateStyle(state: string): string {
    return STATE_STYLES[state] ?? 'bg-slate-100 text-slate-700';
  }

  async retry(job: Job): Promise<void> {
    try {
      const { job: updated } = await retryJob(job.id);
      this.jobs.update((jobs) => jobs.map((j) => (j.id === updated.id ? updated : j)));
    } catch (err) {
      console.error('Error reintentando job', err);
    }
  }

  async revoke(device: Device): Promise<void> {
    if (!confirm(`¿Invalidar el dispositivo "${device.name ?? ''}"?`)) return;
    try {
      await revokeDevice(device.id);
      await this.refresh();
    } catch (err) {
      console.error('Error revocando dispositivo', err);
    }
  }
}
