/**
 * Estado compartido del flujo de captura:
 * fotos seleccionadas, análisis de Gemini pendiente y sus errores por campo.
 * También soporta RECICLAR un borrador guardado: se rehidrata el análisis desde
 * un `ProductCapture` (mismo producto, sin duplicar) para que el formulario de
 * revisión se comporte "como si Gemini acabara de responder".
 */
import { signal } from '@angular/core';
import type {
  AnalyzeResponse,
  ProductCapture,
} from '@click-on-the-go/shared';

export const pendingImageUrls = signal<string[]>([]);
export const pendingAnalysis = signal<AnalyzeResponse | null>(null);
/**
 * Borrador que se está reciclando (null = captura nueva). Mientras está activo,
 * el formulario precarga sus datos (incluido el SKU exacto) y al guardar/aprobar
 * actualiza el MISMO registro en vez de crear uno nuevo.
 */
export const recycleDraft = signal<ProductCapture | null>(null);

export function setPendingImages(urls: string[]): void {
  pendingImageUrls.set(urls);
}

export function setPendingAnalysis(result: AnalyzeResponse | null): void {
  pendingAnalysis.set(result);
}

export function setRecycleDraft(product: ProductCapture | null): void {
  recycleDraft.set(product);
}

/**
 * Rehidrata un `AnalyzeResponse` desde un borrador guardado. La forma de
 * variantes guardada ya es Wix (productOptions/variantsInfo), así que aquí se
 * deja `variants: []`; el formulario usa `recycleDraft().variants` directamente.
 * El `skuSuggestion` original no se persiste (solo el SKU final), por eso va null.
 */
export function toRecycleAnalysis(product: ProductCapture): AnalyzeResponse {
  return {
    product: {
      name: product.name,
      description: product.description ?? '',
      price: product.price,
      currency: product.currency,
      category: product.category,
      brand: product.brand,
      barcode: product.barcode ?? null,
      skuSuggestion: null,
      variants: [],
      jsonLd:
        product.jsonLd ?? {
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: product.name,
        },
    },
  };
}

export function resetCapture(): void {
  pendingImageUrls.set([]);
  pendingAnalysis.set(null);
  recycleDraft.set(null);
}
