/** CRUD de productos/capturas. */
import { api } from './api';
import type {
  AnalyzeResponse,
  Job,
  ProductCapture,
  ProductDraftInput,
} from '@click-on-the-go/shared';

export interface ListProductsResponse {
  products: ProductCapture[];
}

export interface AnalyzeRequestPayload {
  imageUrls: string[];
  category?: string;
  /** Marca de Wix elegida/preseleccionada (nombre) enviada a Gemini. */
  brand?: string;
}

export function listProducts(status?: string): Promise<ListProductsResponse> {
  const q = status ? `?status=${encodeURIComponent(status)}` : '';
  return api<ListProductsResponse>(`/api/products${q}`);
}

export function createProduct(input: ProductDraftInput): Promise<{ product: ProductCapture }> {
  return api<{ product: ProductCapture }>('/api/products', { method: 'POST', body: input });
}

/** Actualiza un borrador EN SITIO (conserva status='draft'). */
export function updateProduct(id: string, input: ProductDraftInput): Promise<{ product: ProductCapture }> {
  return api<{ product: ProductCapture }>(`/api/products/${id}`, { method: 'PUT', body: input });
}

/** Descarta un borrador (solo status='draft'). */
export function deleteProduct(id: string): Promise<void> {
  return api<void>(`/api/products/${id}`, { method: 'DELETE' });
}

export function approveProduct(id: string): Promise<{ job: Job }> {
  return api<{ job: Job }>(`/api/products/${id}/approve`, { method: 'POST' });
}

export function analyzeImages(payload: AnalyzeRequestPayload): Promise<AnalyzeResponse> {
  return api<AnalyzeResponse>('/api/analyze', { method: 'POST', body: payload });
}
