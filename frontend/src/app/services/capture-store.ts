/**
 * Estado compartido del flujo de captura:
 * fotos seleccionadas, análisis de Gemini pendiente y sus errores por campo.
 */
import { signal } from '@angular/core';
import type { AnalyzeResponse } from '@click-on-the-go/shared';

export const pendingImageUrls = signal<string[]>([]);
export const pendingAnalysis = signal<AnalyzeResponse | null>(null);

export function setPendingImages(urls: string[]): void {
  pendingImageUrls.set(urls);
}

export function setPendingAnalysis(result: AnalyzeResponse | null): void {
  pendingAnalysis.set(result);
}

export function resetCapture(): void {
  pendingImageUrls.set([]);
  pendingAnalysis.set(null);
}
