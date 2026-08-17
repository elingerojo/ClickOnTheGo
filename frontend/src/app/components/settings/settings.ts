import { Component, OnInit, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  getSettings,
  putSettings,
  refreshSettings,
  runGc,
  getMyInvitation,
} from '../../services/settings';
import {
  settings,
  wixBrands,
  wixCategories,
  refreshWixReferences,
} from '../../services/session';
import { invitationUsed } from '../../services/sse';
import type { AppSettings, GcResult, InvitationResponse } from '@click-on-the-go/shared';
import QRCode from 'qrcode';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-6">
      <h1 class="text-2xl font-bold">Settings</h1>

      <!-- Categorías -->
      <form *ngIf="appForm" (ngSubmit)="saveApp()" class="bg-white rounded-2xl shadow p-6 space-y-4">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">Moneda</label>
            <input [(ngModel)]="appForm.currency" name="currency" maxlength="8"
                   class="w-full rounded-lg border border-slate-300 px-3 py-2 uppercase" />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">Idioma</label>
            <input [(ngModel)]="appForm.language" name="language" maxlength="20"
                   class="w-full rounded-lg border border-slate-300 px-3 py-2" />
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">Prefijo SKU</label>
            <input [(ngModel)]="appForm.skuPrefix" name="skuPrefix" maxlength="20"
                   class="w-full rounded-lg border border-slate-300 px-3 py-2" />
          </div>
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">Stock inicial</label>
            <input [(ngModel)]="appForm.defaultQuantity" name="defaultQuantity" type="number" min="0" step="1"
                   class="w-full rounded-lg border border-slate-300 px-3 py-2" />
            <p class="text-xs text-slate-400 mt-1">
              Inventario con el que se da de alta el producto en Wix.
            </p>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label class="flex items-center gap-2 text-sm font-medium text-slate-700 bg-slate-50 rounded-lg p-3">
            <input type="checkbox" [(ngModel)]="appForm.visible" name="visible"
                   class="h-4 w-4 accent-brand-600" />
            Publicar producto (visible)
          </label>
          <label class="flex items-center gap-2 text-sm font-medium text-slate-700 bg-slate-50 rounded-lg p-3">
            <input type="checkbox" [(ngModel)]="appForm.sendCategoryToGemini" name="sendCategoryToGemini"
                   class="h-4 w-4 accent-brand-600" />
            Enviar categoría a Gemini
          </label>
          <label class="flex items-center gap-2 text-sm font-medium text-slate-700 bg-slate-50 rounded-lg p-3">
            <input type="checkbox" [(ngModel)]="appForm.sendBrandToGemini" name="sendBrandToGemini"
                   class="h-4 w-4 accent-brand-600" />
            Enviar marca a Gemini
          </label>
        </div>

        <div class="flex items-center gap-3 flex-wrap">
          <button type="submit" class="px-5 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700">
            Guardar settings
          </button>
          <button type="button" (click)="refreshFromWix()"
                  class="px-4 py-2.5 rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300">
            Refrescar moneda/idioma desde Wix
          </button>
        </div>

        <p *ngIf="appMessage()" class="text-sm text-emerald-700 bg-emerald-50 rounded-lg p-3">{{ appMessage() }}</p>
        <p *ngIf="appError()" class="text-sm text-red-600 bg-red-50 rounded-lg p-3">{{ appError() }}</p>
      </form>

      <!-- Referencias Wix (categorías y marcas, solo lectura desde los signals) -->
      <div class="bg-white rounded-2xl shadow p-6 space-y-3">
        <div class="flex items-center justify-between gap-3">
          <h2 class="font-semibold">Referencias Wix</h2>
          <button (click)="refreshWix()" [disabled]="refreshingRefs()"
                  class="px-4 py-2 rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300 disabled:opacity-50">
            {{ refreshingRefs() ? 'Actualizando…' : 'Actualizar' }}
          </button>
        </div>
        <p class="text-sm text-slate-500">
          Categorías y marcas sincronizadas desde tu tienda Wix. Se refrescan en cada inicio de sesión.
        </p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <h3 class="text-sm font-medium text-slate-600 mb-1">Categorías ({{ wixCategories().length }})</h3>
            <div *ngIf="wixCategories().length" class="flex flex-wrap gap-1.5">
              <span *ngFor="let c of wixCategories()"
                    class="text-xs bg-slate-100 text-slate-700 rounded-full px-2 py-1">{{ c.name }}</span>
            </div>
            <p *ngIf="!wixCategories().length" class="text-xs text-slate-400">Sin categorías sincronizadas.</p>
          </div>
          <div>
            <h3 class="text-sm font-medium text-slate-600 mb-1">Marcas ({{ wixBrands().length }})</h3>
            <div *ngIf="wixBrands().length" class="flex flex-wrap gap-1.5">
              <span *ngFor="let b of wixBrands()"
                    class="text-xs bg-slate-100 text-slate-700 rounded-full px-2 py-1">{{ b.name }}</span>
            </div>
            <p *ngIf="!wixBrands().length" class="text-xs text-slate-400">Sin marcas sincronizadas.</p>
          </div>
        </div>
        <p *ngIf="refsError()" class="text-sm text-red-600 bg-red-50 rounded-lg p-3">{{ refsError() }}</p>
      </div>

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
            <a *ngIf="invitationLink()" [href]="invitationLink()" target="_blank" rel="noopener"
               class="inline-block text-brand-600 underline break-all text-xs">{{ invitationLink() }}</a>
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

      <!-- Límites GC -->
      <form *ngIf="gcForm" (ngSubmit)="saveGc()" class="bg-white rounded-2xl shadow p-6 space-y-4">
        <fieldset class="border border-slate-200 rounded-xl p-4 space-y-2">
          <legend class="text-sm font-semibold text-slate-600 px-2">Límites del script GC (días)</legend>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <label class="text-xs text-slate-500">Blob OK
              <input type="number" [(ngModel)]="gcForm.gc.blobOkDays" name="blobOkDays" min="0"
                     class="w-full rounded-lg border border-slate-300 px-2 py-1 mt-1" />
            </label>
            <label class="text-xs text-slate-500">Neon OK
              <input type="number" [(ngModel)]="gcForm.gc.neonOkDays" name="neonOkDays" min="0"
                     class="w-full rounded-lg border border-slate-300 px-2 py-1 mt-1" />
            </label>
            <label class="text-xs text-slate-500">Blob no OK
              <input type="number" [(ngModel)]="gcForm.gc.blobNotOkDays" name="blobNotOkDays" min="0"
                     class="w-full rounded-lg border border-slate-300 px-2 py-1 mt-1" />
            </label>
            <label class="text-xs text-slate-500">Neon no OK
              <input type="number" [(ngModel)]="gcForm.gc.neonNotOkDays" name="neonNotOkDays" min="0"
                     class="w-full rounded-lg border border-slate-300 px-2 py-1 mt-1" />
            </label>
            <label class="text-xs text-slate-500">Catch-all
              <input type="number" [(ngModel)]="gcForm.gc.allDays" name="allDays" min="0"
                     class="w-full rounded-lg border border-slate-300 px-2 py-1 mt-1" />
            </label>
            <label class="text-xs text-slate-500 flex items-end gap-2 pb-1">
              <input type="checkbox" [(ngModel)]="gcForm.gc.skipActiveJobs" name="skipActiveJobs"
                     class="h-4 w-4 accent-brand-600" />
              Saltar jobs activos
            </label>
          </div>
        </fieldset>

        <div class="flex items-center gap-3 flex-wrap">
          <button type="submit" class="px-5 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700">
            Guardar límites
          </button>
        </div>

        <p *ngIf="gcMessage()" class="text-sm text-emerald-700 bg-emerald-50 rounded-lg p-3">{{ gcMessage() }}</p>
        <p *ngIf="gcError()" class="text-sm text-red-600 bg-red-50 rounded-lg p-3">{{ gcError() }}</p>
      </form>

      <!-- Limpieza GC -->
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
        <p *ngIf="gcRunError()" class="text-sm text-red-600 bg-red-50 rounded-lg p-3">{{ gcRunError() }}</p>
      </div>
    </div>
  `,
})
export class SettingsComponent implements OnInit {
  /** Config de la app: moneda, idioma, prefijo SKU, stock inicial, visibilidad y toggles. */
  appForm: {
    defaultQuantity: number;
    visible: boolean;
    sendCategoryToGemini: boolean;
    sendBrandToGemini: boolean;
    currency: string;
    language: string;
    skuPrefix: string;
  } | null = null;

  wixCategories = wixCategories;
  wixBrands = wixBrands;
  refreshingRefs = signal(false);
  refsError = signal('');

  /** Límites del script GC (campo `gc` de la config). */
  gcForm: { gc: AppSettings['gc'] } | null = null;

  appMessage = signal('');
  appError = signal('');
  gcMessage = signal('');
  gcError = signal('');
  gcRunning = signal(false);
  gcRunError = signal('');
  gcResult = signal<GcResult | null>(null);

  invitation = signal<InvitationResponse | null>(null);
  invitationQr = signal<string | null>(null);
  invitationLink = signal<string | null>(null);
  invitationLoading = signal(false);
  invitationError = signal('');
  constructor() {
    // Reacción a `invitation:used`: el backend difunde el token que acaba de
    // usarse. Solo si coincide con el token que mostramos en nuestro QR, se
    // regenera la invitación (decisión local, sin `deviceId`). El match por token
    // es inmune al replay del buffer SSE: tras regenerar, el token cambia y el
    // evento reenviado deja de coincidir.
    effect(() => {
      const evt = invitationUsed();
      if (!evt) return;
      if (evt.token !== this.invitation()?.token) return;
      void this.loadInvitation(true);
    });
  }

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
      // Hardening de race: si la invitación recién cargada coincide con el último
      // token difundido como usado, es que ya fue canjeada (el evento SSE llegó
      // antes de cargar el QR) → se regenera una vez para no estacionar un token
      // muerto. `return await` mantiene `invitationLoading` activo hasta terminar.
      if (!regenerate && inv.token === invitationUsed()?.token) {
        return await this.loadInvitation(true);
      }
      this.invitation.set(inv);
      // El QR apunta al origen REAL del frontend (Vercel en prod, localhost en dev),
      // no al `APP_BASE_URL` del backend (que puede quedar en localhost).
      const link = `${window.location.origin}/auth?token=${inv.token}`;
      this.invitationLink.set(link);
      this.invitationQr.set(await makeInvitationQrDataUrl(link, inv.emoji));
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
      this.appForm = {
        defaultQuantity: s.defaultQuantity ?? 50,
        visible: s.visible ?? true,
        sendCategoryToGemini: s.sendCategoryToGemini ?? false,
        sendBrandToGemini: s.sendBrandToGemini ?? false,
        currency: s.currency,
        language: s.language,
        skuPrefix: s.skuPrefix,
      };
      this.gcForm = { gc: { ...s.gc } };
    } catch (err) {
      this.appError.set(err instanceof Error ? err.message : 'Error cargando settings');
      this.gcError.set(err instanceof Error ? err.message : 'Error cargando settings');
    }
  }

  /** Guarda moneda, idioma, prefijo SKU, stock inicial, visibilidad y toggles (sin tocar `gc`). */
  async saveApp(): Promise<void> {
    if (!this.appForm) return;
    this.appMessage.set('');
    this.appError.set('');
    try {
      const updated = await putSettings({
        defaultQuantity: this.appForm.defaultQuantity,
        visible: this.appForm.visible,
        sendCategoryToGemini: this.appForm.sendCategoryToGemini,
        sendBrandToGemini: this.appForm.sendBrandToGemini,
        currency: this.appForm.currency.toUpperCase(),
        language: this.appForm.language,
        skuPrefix: this.appForm.skuPrefix,
      });
      settings.set(updated);
      this.appMessage.set('Settings guardados ✔');
    } catch (err) {
      this.appError.set(err instanceof Error ? err.message : 'Error guardando settings');
    }
  }

  /** Re-ejecuta los endpoints de categorías/marcas (sync Wix → Neon + signals + caché). */
  async refreshWix(): Promise<void> {
    this.refreshingRefs.set(true);
    this.refsError.set('');
    try {
      await refreshWixReferences();
    } catch (err) {
      this.refsError.set(
        err instanceof Error ? err.message : 'Error actualizando referencias de Wix',
      );
    } finally {
      this.refreshingRefs.set(false);
    }
  }

  /** Guarda únicamente los límites del script GC. */
  async saveGc(): Promise<void> {
    if (!this.gcForm) return;
    this.gcMessage.set('');
    this.gcError.set('');
    try {
      const updated = await putSettings({ gc: this.gcForm.gc });
      settings.set(updated);
      this.gcMessage.set('Límites guardados ✔');
    } catch (err) {
      this.gcError.set(err instanceof Error ? err.message : 'Error guardando límites');
    }
  }

  async refreshFromWix(): Promise<void> {
    this.appMessage.set('');
    this.appError.set('');
    try {
      const updated = await refreshSettings();
      settings.set(updated);
      this.appMessage.set('Moneda e idioma refrescados desde Wix ✔');
      await this.load();
    } catch (err) {
      this.appError.set(err instanceof Error ? err.message : 'Error refrescando');
    }
  }

  async onRunGc(): Promise<void> {
    this.gcRunning.set(true);
    this.gcResult.set(null);
    this.gcRunError.set('');
    try {
      this.gcResult.set(await runGc());
    } catch (err) {
      this.gcRunError.set(err instanceof Error ? err.message : 'Error ejecutando GC');
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
    // 4px menores (2px por lado) para dejar espacio visual alrededor del emoji,
    // manteniendo la caja blanca del tamaño original.
    ctx.font = `${overlay - 4}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, size / 2, size / 2 + 2);
  }
  return canvas.toDataURL('image/png');
}
