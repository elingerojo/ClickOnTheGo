/**
 * Servicio de análisis con Google Gemini (visión).
 *
 * - Descarga las fotos desde Vercel Blob → base64.
 * - Envía TODAS las fotos + categoría elegida + prompt.
 * - Fuerza salida JSON estructurada con `responseSchema` (derivado del esquema
 *   Zod de la frontera A) y `responseMimeType: application/json`.
 * - Valida con Zod (errores por campo) y construye el JSON-LD con la moneda e
 *   idioma dinámicos del sitio Wix.
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

export interface AnalyzeOptions {
  /** Categoría elegida/preseleccionada por el usuario (nombre). */
  category?: string;
  /** Marca elegida/preseleccionada por el usuario (nombre). */
  brand?: string;
  /** Nombres de categorías disponibles (desde la tabla `categories`). */
  availableCategories?: string[];
  /** Nombres de marcas disponibles (desde la tabla `brands`). */
  availableBrands?: string[];
  /** Enviar categoría a Gemini como referencia (settings toggle). */
  sendCategory?: boolean;
  /** Enviar marca a Gemini como referencia (settings toggle). */
  sendBrand?: boolean;
}

function buildPrompt(opts: AnalyzeOptions = {}): string {
  const parts: string[] = [
    'Analiza las fotos de un producto para una tienda eCommerce Wix.',
    ' Extrae la información más probable de cada campo del JSON.',
  ];

  if (opts.sendCategory && opts.category?.trim()) {
    parts.push(` La categoría elegida por el usuario es "${opts.category}".`);
  }
  if (opts.sendCategory && opts.availableCategories?.length) {
    parts.push(
      ` Categorías disponibles de la tienda: ${opts.availableCategories.join(', ')}.` +
        ' Si tiene sentido, usa una de esas categorías en "category"; si no, null.',
    );
  }

  if (opts.sendBrand) {
    if (opts.brand?.trim()) {
      parts.push(` La marca elegida por el usuario es "${opts.brand}".`);
    }
    if (opts.availableBrands?.length) {
      parts.push(
        ` Marcas disponibles de la tienda: ${opts.availableBrands.join(', ')}.` +
          ' Valida si es razonable incluir la marca del producto: si es visible/identificable' +
          ' y está entre las disponibles, ponla en "brand"; si no, null.',
      );
    }
  }

  parts.push(
    ` El campo "barcode" debe ser UN SOLO código de barras del producto con esta prioridad:` +
      ` 1) GTIN (EAN-8/EAN-13/GTIN-14, SOLO dígitos), 2) UPC (UPC-A, 12 dígitos),` +
      ` 3) ASIN (10 alfanuméricos que empiezan por 'B') — SOLO si es legible y nítido` +
      ` en las fotos; si el código no se ve con claridad o no existe, pon null.` +
      ` NUNCA inventes ni adivines un "barcode": es opcional y un valor falso rompe el barcode en Wix.` +
      ` El campo "skuSuggestion" debe ser UN BUEN SKU con el modelo o identificador popular` +
      ` del producto dentro de su marca o categoría (ej. "XPS-13", "AirMax-90", "GalaxyS24");` +
      ` se usará como base para el SKU final "SKU-{valor}" en Wix; si no puedes deducirlo, pon null.` +
      ` "price" debe ser un número (usa el punto como decimal), o null si no es visible.` +
      ` "currency" usa código ISO 4217 (ej. MXN, USD).` +
      ` "variants" lista las opciones (ej. Talla: M) y sus precios/SKU si aplican.` +
      // (F8) La descripción va en MARKDOWN SIMPLE (el backend la convierte a HTML
      // con `marked` para el Rich Content de Wix V3). Sin fences ni tablas.
      ` "description" en MARKDOWN SIMPLE: párrafos, encabezados (# a ######),` +
      ` listas (- o 1.), negritas (**texto**) y cursivas (*texto*).` +
      ` SIN bloques de código ni fences (no uses triple backtick), SIN tablas (|)` +
      ` ni bloques complejos (<pre>/<table>); máximo 5000 caracteres.` +
      ` Devuelve únicamente JSON válido con la forma del responseSchema.`,
  );

  return parts.join('');
}

export async function analyzeProduct(
  imageUrls: string[],
  opts: AnalyzeOptions = {},
): Promise<AnalyzeResponse> {
  const genai = new GoogleGenAI({ apiKey: env.geminiApiKey });
  const images = await Promise.all(imageUrls.map(downloadImageAsBase64));

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> =
    images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.base64 } }));
  parts.push({ text: buildPrompt(opts) });

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

  // Moneda e idioma dinámicos del sitio (site-properties v4)
  const site = await getWixClient().getSiteProperties();
  const sku = buildSku(data.skuSuggestion, data.barcode);
  const jsonLd = buildJsonLd(data, {
    sku,
    currency: site.currency,
    language: site.language,
  });

  return { product: toGeminiProductResult(data, jsonLd) };
}
