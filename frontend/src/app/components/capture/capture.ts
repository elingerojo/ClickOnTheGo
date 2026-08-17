import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { uploadImage } from '../../services/upload';
import { analyzeImages } from '../../services/products';
import { settings, defaultCategory, wixBrands, wixCategories } from '../../services/session';
import { setPendingImages, setPendingAnalysis } from '../../services/capture-store';

@Component({
  selector: 'app-capture',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="space-y-6">
      <h1 class="text-2xl font-bold">Capturar producto 📷</h1>
      <p class="text-slate-500 text-sm">
        Toma una o varias fotos del producto. Gemini autocompletará el formulario.
      </p>

      <div class="bg-white rounded-2xl shadow p-6 space-y-4">
        <!-- Categoría y marca de Wix (referencias opcionales; solo si sus toggles en Settings están activos) -->
        <div *ngIf="settings()?.sendCategoryToGemini || settings()?.sendBrandToGemini"
             class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div *ngIf="settings()?.sendCategoryToGemini">
            <label class="block text-sm font-medium text-slate-600 mb-1">Categoría (Wix)</label>
            <select
              class="w-full rounded-lg border border-slate-300 px-3 py-2"
              [ngModel]="selectedCategory()"
              (ngModelChange)="onCategoryChange($event)"
            >
              <option [ngValue]="null">— Sin categoría —</option>
              <option *ngFor="let c of wixCategories()" [ngValue]="c.name">{{ c.name }}</option>
            </select>
            <p class="text-xs text-slate-400 mt-1">
              Se mantiene como default de la sesión y se envía a Gemini como referencia.
            </p>
          </div>
          <div *ngIf="settings()?.sendBrandToGemini">
            <label class="block text-sm font-medium text-slate-600 mb-1">Marca (Wix)</label>
            <select
              class="w-full rounded-lg border border-slate-300 px-3 py-2"
              [ngModel]="selectedBrand()"
              (ngModelChange)="onBrandChange($event)"
            >
              <option [ngValue]="null">— Sin marca —</option>
              <option *ngFor="let b of wixBrands()" [ngValue]="b.name">{{ b.name }}</option>
            </select>
            <p class="text-xs text-slate-400 mt-1">Gemini valida si es razonable incluirla.</p>
          </div>
        </div>

        <!-- Selector de fotos / cámara -->
        <div>
          <label
            class="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-brand-300 rounded-xl bg-brand-50 cursor-pointer hover:bg-brand-100 transition"
          >
            <span class="text-4xl">📸</span>
            <span class="mt-2 text-sm text-brand-700 font-medium">
              Toca para tomar foto o elegir imágenes
            </span>
            <input
              #fileInput
              type="file"
              accept="image/*"
              capture="environment"
              multiple
              class="hidden"
              (change)="onFilesSelected($event)"
            />
          </label>
        </div>

        <!-- Previews -->
        <div *ngIf="files().length" class="grid grid-cols-3 sm:grid-cols-4 gap-3">
          <div *ngFor="let preview of previews(); let i = index" class="relative group">
            <img [src]="preview" class="w-full h-28 object-cover rounded-lg border border-slate-200" />
            <button
              (click)="removeAt(i)"
              class="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-red-600 text-white text-xs shadow group-hover:block hidden"
            >✕</button>
          </div>
        </div>

        <!-- Acciones -->
        <div class="flex items-center gap-3 flex-wrap">
          <button
            (click)="onAnalyze()"
            [disabled]="files().length === 0 || analyzing()"
            class="px-5 py-2.5 rounded-lg bg-brand-600 text-white font-medium hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {{ analyzing() ? 'Analizando con Gemini…' : '✨ Analizar producto' }}
          </button>
          <button
            (click)="clearAll()"
            *ngIf="files().length"
            class="px-4 py-2.5 rounded-lg bg-slate-200 text-slate-700 hover:bg-slate-300"
          >Limpiar</button>
        </div>

        <p *ngIf="error()" class="text-sm text-red-600">{{ error() }}</p>
      </div>
    </div>
  `,
})
export class CaptureComponent {
  files = signal<File[]>([]);
  previews = signal<string[]>([]);
  analyzing = signal(false);
  error = signal('');
  selectedCategory = signal<string | null>(defaultCategory());
  selectedBrand = signal<string | null>(null);
  settings = settings;
  wixCategories = wixCategories;
  wixBrands = wixBrands;

  constructor(private readonly router: Router) {}

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files) return;
    const incoming = Array.from(input.files).filter((f) => f.type.startsWith('image/'));
    const merged = [...this.files(), ...incoming].slice(0, 12);
    this.files.set(merged);
    this.previews.set(merged.map((f) => URL.createObjectURL(f)));
    input.value = '';
  }

  removeAt(index: number): void {
    const next = this.files().filter((_, i) => i !== index);
    this.files.set(next);
    this.previews.set(next.map((f) => URL.createObjectURL(f)));
  }

  clearAll(): void {
    this.files.set([]);
    this.previews.set([]);
    this.error.set('');
  }

  onCategoryChange(value: string | null): void {
    this.selectedCategory.set(value);
    defaultCategory.set(value); // persiste como default de sesión
  }

  onBrandChange(value: string | null): void {
    this.selectedBrand.set(value);
  }

  async onAnalyze(): Promise<void> {
    if (this.files().length === 0) return;
    this.analyzing.set(true);
    this.error.set('');
    try {
      // 1) Subida directa a Vercel Blob
      const urls: string[] = [];
      for (const file of this.files()) {
        urls.push(await uploadImage(file));
      }
      setPendingImages(urls);

      // 2) Análisis con Gemini
      const result = await analyzeImages({
        imageUrls: urls,
        category: this.selectedCategory() ?? undefined,
        brand: this.selectedBrand() ?? undefined,
      });
      setPendingAnalysis(result);
      await this.router.navigate(['/producto']);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Error al analizar las fotos');
    } finally {
      this.analyzing.set(false);
    }
  }
}
