import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import { Router } from '@angular/router';
import {
  pendingAnalysis,
  pendingImageUrls,
  recycleDraft,
  resetCapture,
} from '../../services/capture-store';
import { setPendingJob, showToast } from '../../services/toast';
import { createProduct, updateProduct, approveProduct } from '../../services/products';
import {
  autoApproved,
  settings,
  defaultCategory,
  wixBrands,
  wixCategories,
} from '../../services/session';
import type {
  GeminiVariant,
  ProductCapture,
  WixVariants,
} from '@click-on-the-go/shared';

/** Convierte variantes de Gemini a la forma Wix (productOptions/variantsInfo). */
function toWixVariants(variants: GeminiVariant[]): WixVariants | null {
  if (!variants || variants.length === 0) return null;
  const names = [...new Set(variants.map((v) => v.name).filter(Boolean))] as string[];
  if (names.length === 0) return null;
  return {
    productOptions: names.map((name) => ({
      name,
      choices: [
        ...new Set(variants.filter((v) => v.name === name).map((v) => v.value).filter(Boolean)),
      ].map((value) => ({ value })),
    })),
    variantsInfo: {
      variants: variants.map((v) => ({
        choices: names.map((name) => ({ optionName: name, value: v.value ?? '' })),
        ...(v.price != null ? { price: v.price } : {}),
        ...(v.sku ? { sku: v.sku } : {}),
      })),
    },
  };
}

/** Normaliza la base de un SKU (misma regla que el backend `sanitizeId`). */
function sanitizeSkuBase(raw: string | null | undefined): string {
  return (raw ?? '').replace(/[^A-Za-z0-9-]/g, '').toUpperCase().slice(0, 40);
}

/** Vista previa del SKU generado: `prefijo` + sugerencia de Gemini (o barcode). */
function buildSkuPreview(
  skuSuggestion: string | null | undefined,
  barcode: string | null | undefined,
  prefix: string,
): string {
  const base = sanitizeSkuBase(skuSuggestion) || sanitizeSkuBase(barcode);
  return base ? `${prefix}${base}` : '';
}

@Component({
  selector: 'app-product-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold">Revisar producto</h1>
        <button (click)="back()" class="text-sm text-brand-600 hover:underline">
          {{ recycleDraft() ? '← Volver' : '← Nueva captura' }}
        </button>
      </div>

      <p *ngIf="!pendingAnalysis()" class="text-slate-500 bg-white rounded-xl p-6 shadow text-center">
        No hay análisis pendiente. Ve a <a routerLink="/" class="text-brand-600 underline">Captura</a>
        y analiza un producto primero.
      </p>

      <p *ngIf="recycleDraft() as recycled"
         class="text-xs text-brand-700 bg-brand-50 border border-brand-200 rounded-lg px-3 py-2">
        ✏️ Editando borrador <span class="font-semibold">{{ recycled.sku }}</span> — al guardar se
        actualiza este mismo producto.
      </p>

      <ng-container *ngIf="pendingAnalysis() as analysis">
        <!-- Thumbnails -->
        <div *ngIf="imageUrls().length" class="grid grid-cols-3 sm:grid-cols-4 gap-3">
          <img *ngFor="let url of imageUrls()" [src]="url" class="h-24 w-full object-cover rounded-lg border" />
        </div>

        <form [formGroup]="form" class="bg-white rounded-2xl shadow p-6 space-y-4">
          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">Nombre *</label>
            <input formControlName="name" class="w-full rounded-lg border border-slate-300 px-3 py-2" />
            <p *ngIf="analysis.fieldErrors?.['name']" class="text-xs text-red-600 mt-1">
              ⚠️ {{ analysis.fieldErrors['name'] }}
            </p>
          </div>

          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">Descripción</label>
            <textarea formControlName="description" rows="4" class="w-full rounded-lg border border-slate-300 px-3 py-2"></textarea>
            <p *ngIf="analysis.fieldErrors?.['description']" class="text-xs text-red-600 mt-1">
              ⚠️ {{ analysis.fieldErrors['description'] }}
            </p>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-slate-600 mb-1">Precio</label>
              <input formControlName="price" type="number" step="0.01" class="w-full rounded-lg border border-slate-300 px-3 py-2" />
              <p *ngIf="analysis.fieldErrors?.['price']" class="text-xs text-red-600 mt-1">⚠️ {{ analysis.fieldErrors['price'] }}</p>
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-600 mb-1">Moneda</label>
              <input formControlName="currency" maxlength="8" class="w-full rounded-lg border border-slate-300 px-3 py-2 uppercase" />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-slate-600 mb-1">Categoría (Wix)</label>
              <select formControlName="category" class="w-full rounded-lg border border-slate-300 px-3 py-2">
                <option [ngValue]="null">— Sin categoría —</option>
                <option *ngFor="let c of wixCategories()" [ngValue]="c.name">{{ c.name }}</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-600 mb-1">Marca (Wix)</label>
              <select formControlName="brand" class="w-full rounded-lg border border-slate-300 px-3 py-2">
                <option [ngValue]="null">— Sin marca —</option>
                <option *ngFor="let b of wixBrands()" [ngValue]="b.name">{{ b.name }}</option>
              </select>
              <p class="text-xs text-slate-400 mt-1">Gemini pre-selecciona; el usuario confirma o cambia.</p>
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">Código de barras</label>
            <input formControlName="barcode" class="w-full rounded-lg border border-slate-300 px-3 py-2" />
            <p class="text-xs text-slate-400 mt-1">Prioridad GTIN > UPC > ASIN (detectado por Gemini). Solo un GTIN válido se envía a Wix como barcode.</p>
          </div>

          <div>
            <label class="block text-sm font-medium text-slate-600 mb-1">SKU</label>
            <input formControlName="sku" class="w-full rounded-lg border border-slate-300 px-3 py-2" />
            <p *ngIf="analysis.fieldErrors?.['sku']" class="text-xs text-red-600 mt-1">⚠️ {{ analysis.fieldErrors['sku'] }}</p>
            <p class="text-xs text-slate-400 mt-1">Generado como SKU- + sugerencia de Gemini (o el código de barras si no hay sugerencia). Editable; vacío = se autogenera.</p>
          </div>

          <!-- Auto-approve -->
          <div class="flex items-center gap-3 bg-brand-50 rounded-xl p-4">
            <input type="checkbox" [checked]="autoApproved()" (change)="autoApproved.set($any($event.target).checked)"
                   id="auto" class="h-5 w-5 accent-brand-600" />
            <label for="auto" class="text-sm font-medium text-brand-800">
              Auto-aprobar (encolar sin revisión este y los siguientes productos)
            </label>
          </div>
          <p class="text-xs text-slate-400">El selector se reinicia a «apagado» al iniciar la app.</p>

          <div *ngIf="error()" class="text-sm text-red-600 bg-red-50 rounded-lg p-3">{{ error() }}</div>

          <div class="flex gap-3 flex-wrap pt-2">
            <button
              (click)="onSaveDraft()"
              [disabled]="saving()"
              class="px-5 py-2.5 rounded-lg bg-slate-700 text-white font-medium hover:bg-slate-800 disabled:opacity-50"
            >Guardar borrador</button>
            <button
              (click)="onApprove()"
              [disabled]="saving()"
              class="px-5 py-2.5 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50"
            >Aprobar y encolar 🚀</button>
          </div>

        </form>
      </ng-container>
    </div>
  `,
})
export class ProductFormComponent implements OnInit {
  form!: FormGroup;
  pendingAnalysis = pendingAnalysis;
  imageUrls = pendingImageUrls;
  recycleDraft = recycleDraft;
  autoApproved = autoApproved;
  settings = settings;
  wixCategories = wixCategories;
  wixBrands = wixBrands;
  saving = signal(false);
  error = signal('');
  /** Sugerencia de SKU de Gemini (modelo/identificador popular); no es un campo editable. */
  private skuSuggestion: string | null = null;

  constructor(
    private readonly fb: FormBuilder,
    private readonly router: Router,
  ) {}

  ngOnInit(): void {
    const analysis = pendingAnalysis();
    const defaults = settings() ?? null;
    const prefix = defaults?.skuPrefix ?? 'SKU-';
    // Modo reciclado: se edita el MISMO borrador (datos + SKU exacto). El
    // skuSuggestion original no se persiste, por eso aquí va null.
    const recycled = recycleDraft();
    this.skuSuggestion = recycled ? null : (analysis?.product.skuSuggestion ?? null);
    const initialBarcode = recycled
      ? (recycled.barcode ?? null)
      : (analysis?.product.barcode ?? null);
    this.form = this.fb.group({
      name: [recycled?.name ?? analysis?.product.name ?? '', Validators.required],
      description: [recycled?.description ?? analysis?.product.description ?? ''],
      price: [recycled?.price ?? analysis?.product.price ?? null],
      currency: [recycled?.currency ?? analysis?.product.currency ?? defaults?.currency ?? 'USD'],
      category: [recycled?.category ?? analysis?.product.category ?? defaultCategory() ?? null],
      brand: [recycled?.brand ?? analysis?.product.brand ?? null],
      barcode: [initialBarcode ?? ''],
      sku: [recycled?.sku ?? buildSkuPreview(this.skuSuggestion, initialBarcode, prefix)],
    });
    // SKU en vivo: se regenera al editar el barcode SOLO si el usuario no lo ha
    // tocado manualmente (skuControl.dirty); si ya lo editó, se respeta su valor.
    this.form.controls['barcode'].valueChanges.subscribe((value: string) => {
      const skuControl = this.form.controls['sku'];
      if (!skuControl.dirty) {
        skuControl.setValue(buildSkuPreview(this.skuSuggestion, value, prefix), { emitEvent: false });
      }
    });
    // En reciclado, el SKU guardado es el "definitivo": márcalo como tocado para
    // que la suscripción del barcode NO lo sobrescriba con la vista previa.
    if (recycled) this.form.controls['sku'].markAsDirty();
  }

  back(): void {
    const recycled = recycleDraft();
    resetCapture();
    // En modo reciclado, "volver" regresa al dashboard de donde vino.
    void this.router.navigate(recycled ? ['/dashboard'] : ['/']);
  }

  private buildPayload(): {
    name: string;
    description: string;
    price: number | null;
    currency: string;
    category: string | null;
    brand: string | null;
    barcode: string | null;
    skuSuggestion: string | null;
    sku: string | null;
    imageUrls: string[];
    variants: WixVariants | null;
  } {
    const v = this.form.value;
    return {
      name: v.name,
      description: v.description ?? '',
      price: v.price != null && v.price !== '' ? Number(v.price) : null,
      currency: (v.currency || 'USD').toUpperCase(),
      category: v.category ?? null,
      brand: v.brand ?? null,
      barcode: v.barcode ? String(v.barcode).trim() : null,
      skuSuggestion: this.skuSuggestion,
      sku: v.sku ? String(v.sku).trim() : null,
      imageUrls: this.imageUrls(),
      variants: recycleDraft()?.variants ?? toWixVariants(pendingAnalysis()?.product.variants ?? []),
    };
  }

  async onSaveDraft(): Promise<void> {
    this.error.set('');
    if (this.form.invalid) {
      this.error.set('El nombre es obligatorio.');
      return;
    }
    this.saving.set(true);
    try {
      const recycled = recycleDraft();
      const payload = this.buildPayload();
      if (recycled) {
        // Reciclado: se actualiza el MISMO borrador (sin duplicar).
        await updateProduct(recycled.id, payload);
      } else {
        await createProduct(payload);
      }
      // Decisión del usuario: tras guardar un borrador SIEMPRE se va al
      // dashboard, posicionado al inicio de la lista de borradores.
      resetCapture();
      this.error.set('');
      await this.router.navigate(['/dashboard'], { fragment: 'borradores' });
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Error al guardar');
    } finally {
      this.saving.set(false);
    }
  }

  async onApprove(): Promise<void> {
    this.error.set('');
    if (this.form.invalid) {
      this.error.set('El nombre es obligatorio.');
      return;
    }
    this.saving.set(true);
    try {
      const recycled = recycleDraft();
      const payload = this.buildPayload();
      // Reciclado: primero se actualiza el MISMO borrador, luego se aprueba.
      // Captura nueva: se crea y se aprueba (flujo existente).
      const product = recycled
        ? (await updateProduct(recycled.id, payload)).product
        : (await createProduct(payload)).product;
      const { job } = await approveProduct(product.id);
      // F7: toast de encolado + preparar el toast FINAL vía SSE. `pendingJobId`
      // se setea ANTES de navegar (el effect vive en AppComponent, siempre
      // montado) para no perder los eventos del job del bus SSE global.
      showToast('Producto encolado. Procesando…', 'info');
      setPendingJob(job.id);
      // Limpiar la captura y el formulario para la siguiente toma.
      resetCapture();
      this.error.set('');
      void this.router.navigate(['/']);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error al aprobar';
      showToast(`Error al aprobar: ${message} ❌`, 'error');
      this.error.set(message);
    } finally {
      this.saving.set(false);
    }
  }
}
