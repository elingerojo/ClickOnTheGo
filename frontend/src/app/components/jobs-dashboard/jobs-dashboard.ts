import { Component, OnInit, computed, effect, signal, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { listJobs, retryJob } from '../../services/jobs';
import { listDevices, revokeDevice } from '../../services/settings';
import { listProducts, deleteProduct } from '../../services/products';
import {
  setPendingImages,
  setPendingAnalysis,
  setRecycleDraft,
  toRecycleAnalysis,
} from '../../services/capture-store';
import { deviceId, setCurrentDeviceId } from '../../services/session';
import { latestJob, sseConnected } from '../../services/sse';
import type { Device, Job, ProductCapture } from '@click-on-the-go/shared';

const STATE_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800',
  processing: 'bg-blue-100 text-blue-800',
  success: 'bg-emerald-100 text-emerald-800',
  error: 'bg-red-100 text-red-800',
};

/** Ventana de "recientes": jobs actualizados en los últimos 5 días (sin tope). */
const RECENT_MS = 5 * 24 * 60 * 60 * 1000;
/** Tope de filas del dashboard (solo aplica al relleno con jobs antiguos). */
const MAX_VISIBLE_JOBS = 20;

/**
 * Limita la lista de jobs para el dashboard sin cortar lo reciente:
 * - Todos los jobs con `updatedAt` de hace menos de 5 días se muestran SIEMPRE
 *   (sin límite, aunque sean más de 20).
 * - Si con esos no se llega a 20, se rellenan con los jobs antiguos más
 *   recientes (updatedAt >= 5 días) hasta completar 20.
 * La lista de entrada ya viene ordenada de más reciente a más antiguo.
 */
function limitJobs(jobs: Job[]): Job[] {
  const cutoff = Date.now() - RECENT_MS;
  const recent = jobs.filter((j) => Date.parse(j.updatedAt) >= cutoff);
  if (recent.length >= MAX_VISIBLE_JOBS) return recent;
  const older = jobs.filter((j) => Date.parse(j.updatedAt) < cutoff);
  return [...recent, ...older.slice(0, MAX_VISIBLE_JOBS - recent.length)];
}

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
              <tr *ngFor="let job of visibleJobs()">
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
              <tr *ngIf="visibleJobs().length === 0">
                <td colspan="6" class="px-5 py-8 text-center text-slate-400">Sin jobs todavía</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Borradores (después de jobs; inicio de la lista = #borradores) -->
      <div #draftsSection class="bg-white rounded-2xl shadow overflow-hidden">
        <div class="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 class="font-semibold">Borradores de captura</h2>
          <button (click)="refreshDrafts()" class="text-sm text-brand-600 hover:underline">Refrescar</button>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="bg-slate-50 text-slate-500 text-left">
              <tr>
                <th class="px-5 py-3">Producto</th>
                <th class="px-5 py-3">SKU</th>
                <th class="px-5 py-3">Precio</th>
                <th class="px-5 py-3">Categoría</th>
                <th class="px-5 py-3">Actualizado</th>
                <th class="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <tr *ngFor="let d of drafts()">
                <td class="px-5 py-3">
                  <div class="flex items-center gap-3">
                    <img *ngIf="d.imageUrls.length" [src]="d.imageUrls[0]"
                         class="h-10 w-10 rounded-lg object-cover border border-slate-200" />
                    <span class="font-medium">{{ d.name }}</span>
                  </div>
                </td>
                <td class="px-5 py-3 text-slate-500">{{ d.sku }}</td>
                <td class="px-5 py-3 text-slate-500">{{ formatPrice(d) }}</td>
                <td class="px-5 py-3 text-slate-500">{{ d.category ?? '—' }}</td>
                <td class="px-5 py-3 text-slate-400 text-xs">{{ d.updatedAt | date: 'short' }}</td>
                <td class="px-5 py-3">
                  <div class="flex items-center gap-2">
                    <button
                      (click)="recycle(d)"
                      class="px-3 py-1 rounded-lg bg-brand-600 text-white text-xs hover:bg-brand-700"
                    >Reciclar</button>
                    <button
                      (click)="removeDraft(d)"
                      class="px-3 py-1 rounded-lg bg-red-50 text-red-600 text-xs hover:bg-red-100"
                    >Eliminar</button>
                  </div>
                </td>
              </tr>
              <tr *ngIf="drafts().length === 0">
                <td colspan="6" class="px-5 py-8 text-center text-slate-400">Sin borradores todavía</td>
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
export class JobsDashboardComponent implements OnInit {
  @ViewChild('draftsSection', { static: false }) draftsSection?: ElementRef<HTMLElement>;

  jobs = signal<Job[]>([]);
  /**
   * Vista limitada del listado para que no crezca infinitamente: todos los
   * jobs con updatedAt < 5 días (sin tope) + relleno con antiguos hasta 20.
   */
  visibleJobs = computed(() => limitJobs(this.jobs()));
  /** Productos en estado draft (capturas guardadas sin aprobar). */
  drafts = signal<ProductCapture[]>([]);
  devices = signal<Device[]>([]);
  /**
   * Solo los OTROS dispositivos: se oculta el dispositivo actual (no puede
   * invalidarse a sí mismo) y se descartan los ya invalidados.
   */
  otherDevices = computed(() =>
    this.devices().filter((d) => d.id !== deviceId() && !d.revokedAt),
  );
  /** Estado de la conexión SSE (store compartido a nivel app-root). */
  sseConnected = sseConnected;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
  ) {
    // Actualizaciones en vivo de jobs vía SSE: hace upsert del último job
    // notificado sobre la lista local. La conexión la gestiona AppComponent.
    effect(() => {
      const job = latestJob();
      if (!job) return;
      this.jobs.update((jobs) => {
        const idx = jobs.findIndex((j) => j.id === job.id);
        if (idx === -1) return [job, ...jobs];
        const copy = [...jobs];
        copy[idx] = job;
        return copy;
      });
    });
  }

  ngOnInit(): void {
    void this.refresh();
    // Al llegar con #borradores (p. ej. tras "Guardar borrador") desplaza al
    // inicio de la lista de borradores, justo debajo de los jobs.
    this.route.fragment.subscribe((f) => {
      if (f === 'borradores') {
        setTimeout(() => {
          this.draftsSection?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 80);
      }
    });
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
    await this.refreshDrafts();
  }

  async refreshDrafts(): Promise<void> {
    try {
      const { products } = await listProducts('draft');
      this.drafts.set(products);
    } catch (err) {
      console.error('Error cargando borradores', err);
    }
  }

  stateStyle(state: string): string {
    return STATE_STYLES[state] ?? 'bg-slate-100 text-slate-700';
  }

  formatPrice(product: ProductCapture): string {
    return product.price != null ? `${product.price} ${product.currency}` : '—';
  }

  /**
   * Recicla un borrador: rehidrata el análisis (como si Gemini acabara de
   * responder) con los datos y fotos del MISMO producto y abre el formulario
   * de revisión. Al guardar/aprobar se actualiza ese registro (sin duplicar).
   */
  recycle(product: ProductCapture): void {
    setPendingImages(product.imageUrls ?? []);
    setPendingAnalysis(toRecycleAnalysis(product));
    setRecycleDraft(product);
    void this.router.navigate(['/producto']);
  }

  async removeDraft(product: ProductCapture): Promise<void> {
    if (!confirm(`¿Eliminar el borrador "${product.name}" (${product.sku})?`)) return;
    try {
      await deleteProduct(product.id);
      await this.refreshDrafts();
    } catch (err) {
      console.error('Error eliminando borrador', err);
      alert('No se pudo eliminar el borrador.');
    }
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
