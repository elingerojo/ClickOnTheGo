import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  getSettings,
  putSettings,
  refreshSettings,
  runGc,
  getMyInvitation,
} from '../../services/settings';
import { settings } from '../../services/session';
import type { AppSettings, GcResult, InvitationResponse } from '@click-on-the-go/shared';
import QRCode from 'qrcode';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-6">
      <h1 class="text-2xl font-bold">Settings</h1>

      <form *ngIf="form" (ngSubmit)="save()" class="bg-white rounded-2xl shadow p-6 space-y-4">
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">Categorías (separadas por coma)</label>
          <input [(ngModel)]="form.categoriesText" name="categories"
                 class="w-full rounded-lg border border-slate-300 px-3 py-2" />
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">Moneda</label>
            <input [(ngModel)]="form.currency" name="currency" maxlength="8"
                   class="w-full rounded-lg border border-slate-300 px-3 py-2 uppercase" />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">Idioma</label>
            <input [(ngModel)]="form.language" name="language" maxlength="20"
                   class="w-full rounded-lg border border-slate-300 px-3 py-2" />
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">Prefijo SKU</label>
          <input [(ngModel)]="form.skuPrefix" name="skuPrefix" maxlength="20"
                 class="w-full rounded-lg border border-slate-300 px-3 py-2" />
        </div>

        <fieldset class="border border-slate-200 rounded-xl p-4 space-y-2">
          <legend class="text-sm font-semibold text-slate-600 px-2">Límites del script GC (días)</legend>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <label class="text-xs text-slate-500">Blob OK
              <input type="number" [(ngModel)]="form.gc.blobOkDays" name="blobOkDays" min="0"
                     class="w-full rounded-lg border border-slate-300 px-2 py-1 mt-1" />
            </label>
            <label class="text-xs text-slate-500">Neon OK
              <input type="number" [(ngModel)]="form.gc.neonOkDays" name="neonOkDays" min="0"
                     class="w-full rounded-lg border border-slate-300 px-2 py-1 mt-1" />
            </label>
            <label class="text-xs text-slate-500">Blob no OK
              <input type="number" [(ngModel)]="form.gc.blobNotOkDays" name="blobNotOkDays" min="0"
                     class="w-full rounded-lg border border-slate-300 px-2 py-1 mt-1" />
            </label>
            <label class="text-xs text-slate-500">Neon no OK
              <input type="number" [(ngModel)]="form.gc.neonNotOkDays" name="neonNotOkDays" min="0"
                     class="w-full rounded-lg border border-slate-300 px-2 py-1 mt-1" />
            </label>
            <label class="text-xs text-slate-500">Catch-all
              <input type="number" [(ngModel)]="form.gc.allDays" name="allDays" min="0"
                     class="w-full rounded-lg border border-slate-300 px-2 py-1 mt-1" />
            </label>
            <label class="text-xs text-slate-500 flex items-end gap-2 pb-1">
              <input type="checkbox" [(ngModel)]="form.gc.skipActiveJobs" name="skipActiveJobs"
                     class="h-4 w-4 accent-brand-600" />
              Saltar jobs activos
            </label>
          </div>
        </fieldset>

        <div class="flex items-center gap-3 flex-wrap">
          <button type="submit" class="px-5 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700">
            Guardar settings
          </button>
          <button type="button" (click)="refreshFromWix()"
                  class="px-4 py-2.5 rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300">
            Refrescar moneda/idioma desde Wix
          </button>
        </div>

        <p *ngIf="message()" class="text-sm text-emerald-700 bg-emerald-50 rounded-lg p-3">{{ message() }}</p>
        <p *ngIf="error()" class="text-sm text-red-600 bg-red-50 rounded-lg p-3">{{ error() }}</p>
      </form>

      <!-- Invitación QR -->
      <div class="bg-white rounded-2xl shadow p-6 space-y-3">
        <h2 class="font-semibold">Invitación (QR)</h2>
        <p class="text-sm text-slate-500">
          Muestra este QR para vincular otro dispositivo. La invitación es de un solo uso y
          caduca a los 7 días.
        </p>

        <div class="flex flex-col sm:flex-row items-center gap-6">
          <div class="flex flex-col items-center gap-2">
            <img *ngIf="invitationQr()" [src]="invitationQr()" alt="QR de invitación"
                 class="w-56 h-56 rounded-lg border border-slate-200" />
            <div *ngIf="invitationLoading() && !invitationQr()"
                 class="w-56 h-56 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-400 text-sm">
              Generando…
            </div>
            <div *ngIf="invitation() as inv" class="flex items-center gap-2 text-2xl font-bold capitalize">
              <span aria-hidden="true">{{ inv.emoji }}</span><span>{{ inv.word }}</span>
            </div>
          </div>

          <div class="text-sm text-slate-600 space-y-2 max-w-sm">
            <p>1. Muestra el QR a la persona que va a autenticar su dispositivo.</p>
            <p>2. Confirma por teléfono/chat la <strong>palabra y el icono</strong> para asegurar
              que ambos ven la misma invitación.</p>
            <p>3. Es de <strong>un solo uso</strong> y <strong>caduca a los 7 días</strong>.</p>
            <p>4. Si presionas <strong>Regenerar</strong>, la invitación anterior deja de servir
              y se crea una nueva.</p>
            <a *ngIf="invitation()?.link" [href]="invitation()?.link" target="_blank" rel="noopener"
               class="inline-block text-brand-600 underline break-all text-xs">{{ invitation()?.link }}</a>
          </div>
        </div>

        <div class="flex items-center gap-3 flex-wrap">
          <button (click)="loadInvitation(true)" [disabled]="invitationLoading()"
                  class="px-4 py-2.5 rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300 disabled:opacity-50">
            {{ invitationLoading() ? 'Generando…' : 'Regenerar invitación' }}
          </button>
          <p *ngIf="invitationError()" class="text-sm text-red-600">{{ invitationError() }}</p>
        </div>
      </div>

      <!-- GC -->
      <div class="bg-white rounded-2xl shadow p-6 space-y-3">
        <h2 class="font-semibold">Limpieza (GC) — bajo demanda</h2>
        <p class="text-sm text-slate-500">
          Borra por antigüedad las imágenes staging del Blob y los registros de Neon
          según los límites de arriba. Nunca se ejecuta automáticamente.
        </p>
        <button
          (click)="onRunGc()"
          [disabled]="gcRunning()"
          class="px-5 py-2.5 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50"
        >{{ gcRunning() ? 'Ejecutando…' : 'Ejecutar GC' }}</button>

        <div *ngIf="gcResult() as r" class="text-sm text-slate-600 bg-slate-50 rounded-lg p-3">
          Escaneados: <strong>{{ r.scanned }}</strong> ·
          Blobs borrados: <strong>{{ r.deletedBlobs }}</strong> ·
          Registros Neon borrados: <strong>{{ r.deletedNeon }}</strong> ·
          Jobs activos omitidos: <strong>{{ r.skippedActive }}</strong>
        </div>
      </div>
    </div>
  `,
})
export class SettingsComponent implements OnInit {
  form: {
    categoriesText: string;
    currency: string;
    language: string;
    skuPrefix: string;
    gc: AppSettings['gc'];
  } | null = null;

  message = signal('');
  error = signal('');
  gcRunning = signal(false);
  gcResult = signal<GcResult | null>(null);

  invitation = signal<InvitationResponse | null>(null);
  invitationQr = signal<string | null>(null);
  invitationLoading = signal(false);
  invitationError = signal('');

  ngOnInit(): void {
    void this.load();
    void this.loadInvitation();
  }

  /** Obtiene la invitación activa y renderiza el QR con el emoji superpuesto. */
  async loadInvitation(regenerate = false): Promise<void> {
    this.invitationLoading.set(true);
    this.invitationError.set('');
    try {
      const inv = await getMyInvitation(regenerate);
      this.invitation.set(inv);
      this.invitationQr.set(await makeInvitationQrDataUrl(inv.link, inv.emoji));
    } catch (err) {
      this.invitationError.set(
        err instanceof Error ? err.message : 'Error al generar la invitación',
      );
    } finally {
      this.invitationLoading.set(false);
    }
  }

  async load(): Promise<void> {
    try {
      const s = await getSettings();
      settings.set(s);
      this.form = {
        categoriesText: s.categories.join(', '),
        currency: s.currency,
        language: s.language,
        skuPrefix: s.skuPrefix,
        gc: { ...s.gc },
      };
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Error cargando settings');
    }
  }

  async save(): Promise<void> {
    if (!this.form) return;
    this.message.set('');
    this.error.set('');
    try {
      const updated = await putSettings({
        categories: this.form.categoriesText
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean),
        currency: this.form.currency.toUpperCase(),
        language: this.form.language,
        skuPrefix: this.form.skuPrefix,
        gc: this.form.gc,
      });
      settings.set(updated);
      this.message.set('Settings guardados ✔');
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Error guardando settings');
    }
  }

  async refreshFromWix(): Promise<void> {
    this.message.set('');
    this.error.set('');
    try {
      const updated = await refreshSettings();
      settings.set(updated);
      this.message.set('Moneda e idioma refrescados desde Wix ✔');
      await this.load();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Error refrescando');
    }
  }

  async onRunGc(): Promise<void> {
    this.gcRunning.set(true);
    this.gcResult.set(null);
    this.error.set('');
    try {
      this.gcResult.set(await runGc());
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Error ejecutando GC');
    } finally {
      this.gcRunning.set(false);
    }
  }
}

/**
 * Renderiza el QR como data URL con el emoji superpuesto en el centro.
 * Se usa `errorCorrectionLevel: 'H'` para que el overlay no rompa el escaneo.
 */
async function makeInvitationQrDataUrl(link: string, emoji: string): Promise<string> {
  const canvas = document.createElement('canvas');
  await QRCode.toCanvas(canvas, link, { width: 240, margin: 1, errorCorrectionLevel: 'H' });
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const size = canvas.width;
    const overlay = Math.round(size * 0.18);
    const x = (size - overlay) / 2;
    const y = (size - overlay) / 2;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 2, y - 2, overlay + 4, overlay + 4);
    ctx.font = `${overlay}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, size / 2, size / 2 + 2);
  }
  return canvas.toDataURL('image/png');
}
