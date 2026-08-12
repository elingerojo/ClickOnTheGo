/**
 * Servicio de análisis con Google Gemini (visión).
 *
 * - Descarga las fotos desde Vercel Blob → base64.
 * - Envía TODAS las fotos + categoría elegida + prompt.
 * - Fuerza salida JSON estructurada con `responseSchema` (derivado del esquema
 *   Zod de la frontera A) y `responseMimeType: application/json`.
 * - Valida con Zod (errores por campo) y construye el JSON-LD con la moneda e
 *   idioma dinámicos del sitio Wix.
 *
 * Modo demo (`GEMINI_MOCK=1` o sin `GEMINI_API_KEY`): devuelve un resultado
 * determinista para validar el flujo punta a punta de la PoC sin costos de IA.
 */
import { GoogleGenAI } from '@google/genai';
import { getWixClient } from '../config/wixClient.js';
import { env } from '../config/env.js';
import { buildSku } from './skuService.js';
import {
  buildJsonLd,
  coerceGeminiOutput,
  geminiResponseJsonSchema,
  toGeminiProductResult,
  validateGeminiOutput,
  type GeminiOutput,
} from './mapService.js';
import type { AnalyzeResponse } from '@click-on-the-go/shared';

interface DownloadedImage {
  mimeType: string;
  base64: string;
}

async function downloadImageAsBase64(url: string): Promise<DownloadedImage> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`No se pudo descargar la imagen (HTTP ${res.status}): ${url}`);
  }
  const contentType = res.headers.get('content-type') ?? 'image/jpeg';
  const mimeType = contentType.split(';')[0] || 'image/jpeg';
  const buffer = Buffer.from(await res.arrayBuffer());
  return { mimeType, base64: buffer.toString('base64') };
}

function buildPrompt(category?: string): string {
  const cat = category?.trim() ? ` La categoría elegida por el usuario es "${category}".` : '';
  return (
    `Analiza las fotos de un producto para una tienda eCommerce Wix.` +
    ` Extrae la información más probable de cada campo del JSON.${cat}` +
    ` El campo "commercialId" debe ser el identificador comercial impreso en el producto` +
    ` (UPC, EAN, ASIN, número de modelo o de pieza) si es legible; si no, null.` +
    ` "price" debe ser un número (usa el punto como decimal), o null si no es visible.` +
    ` "currency" usa código ISO 4217 (ej. MXN, USD).` +
    ` "variants" lista las opciones (ej. Talla: M) y sus precios/SKU si aplican.` +
    ` Devuelve únicamente JSON válido con la forma del responseSchema.`
  );
}

function mockAnalyze(imageUrls: string[], category?: string): AnalyzeResponse {
  const index = imageUrls.length;
  const price = 199 + index * 100;
  const currency = 'USD';
  const name = category ? `Producto de ejemplo (${category})` : 'Producto de ejemplo';
  const data: GeminiOutput = {
    name,
    description:
      'Producto capturado en modo demo (GEMINI_MOCK). Reemplaza esta descripción con la real antes de aprobar.',
    price,
    currency,
    category: category ?? null,
    commercialId: null,
    variants: [
      { name: 'Talla', value: 'M', price },
      { name: 'Talla', value: 'L', price: price + 50 },
    ],
  };
  const sku = buildSku(data.commercialId);
  const site = { currency, language: 'es-ES' };
  const jsonLd = buildJsonLd(data, { sku, currency: site.currency, language: site.language });
  return { product: toGeminiProductResult(data, jsonLd) };
}

export async function analyzeProduct(
  imageUrls: string[],
  category?: string,
): Promise<AnalyzeResponse> {
  // Modo demo / sin API key
  if (!env.geminiApiKey || process.env.GEMINI_MOCK === '1') {
    console.warn('[gemini] Modo demo (sin GEMINI_API_KEY o GEMINI_MOCK=1).');
    return mockAnalyze(imageUrls, category);
  }

  const genai = new GoogleGenAI({ apiKey: env.geminiApiKey });
  const images = await Promise.all(imageUrls.map(downloadImageAsBase64));

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> =
    images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.base64 } }));
  parts.push({ text: buildPrompt(category) });

  const response = await genai.models.generateContent({
    model: process.env.GEMINI_MODEL ?? 'gemini-2.0-flash',
    contents: [{ role: 'user', parts }],
    config: {
      responseMimeType: 'application/json',
      responseSchema: geminiResponseJsonSchema,
      temperature: 0.2,
    },
  });

  const text = response.text;
  if (!text) throw new Error('Gemini no devolvió contenido.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Gemini devolvió JSON inválido.');
  }

  const validation = validateGeminiOutput(parsed);
  let data: GeminiOutput;
  if (validation.ok) {
    data = validation.data;
  } else {
    // Devuelve el producto coaccionado + errores por campo para marcar en el formulario
    data = coerceGeminiOutput(parsed);
    const product = toGeminiProductResult(data, { '@context': 'https://schema.org', '@type': 'Product', name: data.name });
    return { product, fieldErrors: validation.fieldErrors };
  }

  // Moneda e idioma dinámicos del sitio (site-properties v4 / mock)
  const site = await getWixClient().getSiteProperties();
  const sku = buildSku(data.commercialId);
  const jsonLd = buildJsonLd(data, {
    sku,
    currency: site.currency,
    language: site.language,
  });

  return { product: toGeminiProductResult(data, jsonLd) };
}
