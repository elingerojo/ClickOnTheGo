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
  resetCapture,
} from '../../services/capture-store';
import { createProduct, approveProduct } from '../../services/products';
import { autoApproved, settings, defaultCategory } from '../../services/session';
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

@Component({
  selector: 'app-product-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-bold">Revisar producto</h1>
        <button (click)="back()" class="text-sm text-brand-600 hover:underline">← Nueva captura</button>
      </div>

      <p *ngIf="!pendingAnalysis()" class="text-slate-500 bg-white rounded-xl p-6 shadow text-center">
        No hay análisis pendiente. Ve a <a routerLink="/" class="text-brand-600 underline">Captura</a>
        y analiza un producto primero.
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
              <label class="block text-sm font-medium text-slate-600 mb-1">Categoría</label>
              <select formControlName="category" class="w-full rounded-lg border border-slate-300 px-3 py-2">
                <option [ngValue]="null">— Sin categoría —</option>
                <option *ngFor="let c of settings()?.categories ?? []" [ngValue]="c">{{ c }}</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium text-slate-600 mb-1">Identificador (UPC/ASIN)</label>
              <input formControlName="commercialId" class="w-full rounded-lg border border-slate-300 px-3 py-2" />
              <p *ngIf="analysis.fieldErrors?.['commercialId']" class="text-xs text-red-600 mt-1">⚠️ {{ analysis.fieldErrors['commercialId'] }}</p>
            </div>
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

          <p *ngIf="lastJob() as job" class="text-sm text-emerald-700 bg-emerald-50 rounded-lg p-3">
            Producto encolado. Job: <strong>{{ job.id }}</strong> — estado
            <strong>{{ job.state }}</strong>. Ve al <a routerLink="/dashboard" class="underline">Dashboard</a>.
          </p>
        </form>
      </ng-container>
    </div>
  `,
})
export class ProductFormComponent implements OnInit {
  form!: FormGroup;
  pendingAnalysis = pendingAnalysis;
  imageUrls = pendingImageUrls;
  autoApproved = autoApproved;
  settings = settings;
  saving = signal(false);
  error = signal('');
  lastJob = signal<{ id: string; state: string } | null>(null);

  constructor(
    private readonly fb: FormBuilder,
    private readonly router: Router,
  ) {}

  ngOnInit(): void {
    const analysis = pendingAnalysis();
    const defaults = settings() ?? null;
    this.form = this.fb.group({
      name: [analysis?.product.name ?? '', Validators.required],
      description: [analysis?.product.description ?? ''],
      price: [analysis?.product.price ?? null],
      currency: [analysis?.product.currency ?? defaults?.currency ?? 'USD'],
      category: [analysis?.product.category ?? defaultCategory() ?? null],
      commercialId: [analysis?.product.commercialId ?? ''],
    });
  }

  back(): void {
    resetCapture();
    void this.router.navigate(['/']);
  }

  private buildPayload(): {
    name: string;
    description: string;
    price: number | null;
    currency: string;
    category: string | null;
    commercialId: string | null;
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
      commercialId: v.commercialId ? String(v.commercialId).trim() : null,
      imageUrls: this.imageUrls(),
      variants: toWixVariants(pendingAnalysis()?.product.variants ?? []),
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
      await createProduct(this.buildPayload());
      this.back();
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
      const { product } = await createProduct(this.buildPayload());
      const { job } = await approveProduct(product.id);
      this.lastJob.set({ id: job.id, state: job.state });
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Error al aprobar');
    } finally {
      this.saving.set(false);
    }
  }
}
