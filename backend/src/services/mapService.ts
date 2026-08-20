/**
 * Mapeo de DOS salidas JSON a partir del JSON base de Gemini (sección 5.5 del plan).
 *
 * 1. JSON-LD (schema.org) → se guarda en `products.json_ld` y se inyecta en
 *    `seoData.tags` (tipo script, application/ld+json) durante el UPSERT.
 * 2. Payload Wix Catalog V3 → el producto nativo de Wix.
 *
 * También contiene el esquema Zod (frontera A) usado como `responseSchema` de
 * Gemini (vía zod-to-json-schema) y para validar la salida por campo.
 */
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type {
  GeminiProductResult,
  JsonLdProduct,
  ProductWithInventoryPayload,
  WixVariants,
} from '@click-on-the-go/shared';
import { convertMarkdownToWixHtml, stripMarkdown } from './richContent.js';
import { sanitizeGtin } from './skuService.js';

/* ---------------------------------------------------------------------------
 * Zod (frontera A) — salida estructurada de Gemini
 * ------------------------------------------------------------------------- */

export const geminiVariantSchema = z.object({
  name: z.string().max(100).optional(),
  value: z.string().max(100).optional(),
  price: z.number().nonnegative().optional(),
  sku: z.string().max(100).optional(),
});

export const geminiProductSchema = z.object({
  name: z.string().min(1, 'El nombre es obligatorio').max(300),
  description: z.string().max(5000).default(''),
  price: z.number().nonnegative().nullable().optional(),
  currency: z.string().max(8).default('USD'),
  category: z.string().max(100).nullable().optional(),
  /** Marca de Wix sugerida (debe ser uno de los nombres disponibles; null si no aplica). */
  brand: z.string().max(100).nullable().optional(),
  /** Código de barras ÚNICO con prioridad GTIN > UPC > ASIN; null si no es legible. */
  barcode: z.string().max(60).nullable().optional(),
  /** SKU sugerido: modelo o identificador popular del producto en su marca/categoría. */
  skuSuggestion: z.string().max(40).nullable().optional(),
  variants: z.array(geminiVariantSchema).default([]),
});

export type GeminiOutput = z.infer<typeof geminiProductSchema>;

/** JSON Schema derivado del esquema Zod → `responseSchema` de Gemini. */
export const geminiResponseJsonSchema = zodToJsonSchema(geminiProductSchema, {
  target: 'openApi3',
}) as Record<string, unknown>;

export type ValidationResult =
  | { ok: true; data: GeminiOutput }
  | { ok: false; fieldErrors: Record<string, string> };

export function validateGeminiOutput(data: unknown): ValidationResult {
  const result = geminiProductSchema.safeParse(data);
  if (result.success) return { ok: true, data: result.data };
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const field = issue.path.join('.') || '_root';
    if (!fieldErrors[field]) fieldErrors[field] = issue.message;
  }
  return { ok: false, fieldErrors };
}

/** Coercion best-effort de una salida cruda (para cuando falla la validación). */
export function coerceGeminiOutput(data: any): GeminiOutput {
  return {
    name: typeof data?.name === 'string' && data.name ? data.name : 'Producto sin nombre',
    description: typeof data?.description === 'string' ? data.description : '',
    price: typeof data?.price === 'number' && data.price >= 0 ? data.price : null,
    currency: typeof data?.currency === 'string' ? data.currency : 'USD',
    category: typeof data?.category === 'string' ? data.category : null,
    brand: typeof data?.brand === 'string' ? data.brand : null,
    barcode: typeof data?.barcode === 'string' ? data.barcode : null,
    skuSuggestion: typeof data?.skuSuggestion === 'string' ? data.skuSuggestion : null,
    variants: Array.isArray(data?.variants) ? data.variants : [],
  };
}

/* ---------------------------------------------------------------------------
 * Salida 1: JSON-LD (schema.org)
 * ------------------------------------------------------------------------- */

export interface JsonLdInput {
  name: string;
  description?: string;
  price?: number | null;
  currency?: string;
  category?: string | null;
  /** Fuente para `mpn`: SKU sugerido por Gemini (modelo/identificador popular). */
  skuSuggestion?: string | null;
  /** Respaldo para `mpn` si no hay `skuSuggestion`. */
  barcode?: string | null;
}

export function buildJsonLd(
  input: JsonLdInput,
  opts: { sku: string; currency: string; language: string },
): JsonLdProduct {
  const mpn = input.skuSuggestion?.trim() || input.barcode?.trim() || undefined;
  const jsonLd: JsonLdProduct = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: input.name,
    // (F8) schema.org NO debe llevar markdown crudo: se envía la descripción en
    // TEXTO PLANO (stripMarkdown) para `seoData.tags`.
    ...(input.description ? { description: stripMarkdown(input.description) } : {}),
    sku: opts.sku,
    ...(mpn ? { mpn } : {}),
    ...(input.category ? { category: input.category } : {}),
    inLanguage: opts.language,
    offers: {
      '@type': 'Offer',
      ...(input.price != null ? { price: String(input.price) } : {}),
      priceCurrency: input.currency || opts.currency,
      availability: 'https://schema.org/InStock',
    },
  };
  return jsonLd;
}

/** Tag `script` / `application/ld+json` listo para `seoData.tags`. */
export function toSchemaTag(jsonLd: JsonLdProduct): {
  type: 'script';
  props: { type: 'application/ld+json'; children: string };
} {
  return {
    type: 'script',
    props: { type: 'application/ld+json', children: JSON.stringify(jsonLd) },
  };
}

/* ---------------------------------------------------------------------------
 * Salida 2: Payload Wix Catalog V3 — alta con inventario (F6)
 * ------------------------------------------------------------------------- */

export interface ProductWithInventoryBuildOptions {
  /** Stock inicial (inventario) con el que se crea el producto. */
  quantity: number;
  /** Peso físico (kg/lb) opcional en `physicalProperties`. */
  weight?: number;
  /** Publicar el producto en Wix (settings del usuario). */
  visible: boolean;
  /** Id de la marca de Wix elegida → `product.brand: { id }` (si aplica). */
  brandId?: string;
  /** Tag privado a inyectar en `tags.privateTag.tagIds` (p. ej. `COTG-{fecha}`). */
  tag: string;
  /** Gate de bajo costo heredado del spike F6a (si el endpoint aceptaba
   * description/media/seoData). VESTIGIAL: el spike ya se eliminó y en producción
   * siempre queda `true` (default). Revisar/eliminar en la v1. */
  includeDescriptionMediaSeo?: boolean;
}

/** Construye el payload de `stores/v3/products-with-inventory` (mínimo como piso + bajo costo).
 * Shape validado en F6a REAL:
 *  - `variantsInfo.variants[0].choices` = ARRAY (un objeto da HTTP 400 "Expected an array").
 *  - `variantsInfo.variants[0].price.actualPrice` = `{ amount: string, currency }` (obligatorio).
 *  - (F8) `plainDescription` = string HTML (generado con `marked` desde el
 *    Markdown de Gemini) → Wix lo convierte a Rich Content en `description`.
 *    Vía B CONFIRMADA por el spike F8: `description` como string da HTTP 400
 *    "Expected an object" (Vía A descartada).
 *  - `inventoryOptions.variants[0].choices` = ARRAY.
 *  - (F7) `media.itemsInfo.items[{ url, displayName, mediaType }]` se emite SI
 *    `product.imageUrls` trae URLs (el worker las reemplaza por URLs de Wix Media
 *    ANTES del upsert). Shape CONFIRMADO por el spike F7 real: `mediaItems` NO es
 *    una clave válida (queda `media: {}`); la correcta es `itemsInfo.items`.
 */
export function buildProductWithInventoryPayload(
  product: {
    name: string;
    description?: string | null;
    price?: number | null;
    currency?: string;
    sku: string;
    /** Código de barras (GTIN/UPC/ASIN) — opcional; a Wix solo se envía si es un GTIN válido. */
    barcode?: string | null;
    jsonLd?: JsonLdProduct | null;
    imageUrls?: string[];
  },
  opts: ProductWithInventoryBuildOptions,
): ProductWithInventoryPayload {
  const include = opts.includeDescriptionMediaSeo ?? true;
  const currency = product.currency || 'USD';
  // (B4) Código de barras → `barcode` de la variante. Solo se incluye el campo si
  // es un GTIN válido (longitud + Luhn mod-10); si es vacío/inválido NO se envía
  // (un ASIN u otro código no es un barcode válido para Wix).
  const barcode = sanitizeGtin(product.barcode);
  const mediaItems = (product.imageUrls ?? [])
    .filter((url) => url)
    .map((url) => ({ url, displayName: product.name, mediaType: 'IMAGE' as const }));
  return {
    product: {
      name: product.name,
      productType: 'PHYSICAL',
      physicalProperties: {
        sku: product.sku,
        ...(opts.weight != null ? { weight: opts.weight } : {}),
      },
      visible: opts.visible,
      ...(opts.brandId ? { brand: { id: opts.brandId } } : {}),
      tags: { privateTag: { tagIds: [opts.tag] } },
      variantsInfo: {
        variants: [
          {
            // (F6b) El SKU vive en la VARIANTE (variantsInfo.variants[].sku):
            // el doc de products-with-inventory lo define como "Variant SKU
            // (stock keeping unit)". Sin esto, Wix crea el producto con SKU
            // vacío aunque `physicalProperties.sku` esté lleno.
            sku: product.sku,
            ...(barcode ? { barcode } : {}),
            choices: [],
            price: {
              actualPrice: {
                amount: product.price != null ? String(product.price) : '0',
                currency,
              },
            },
            // Inventory item DENTRO de la variante (docs + F6a real): crea la
            // CANTIDAD en la misma llamada. Sin esto, el producto queda OUT_OF_STOCK.
            inventoryItem: { trackQuantity: true, quantity: opts.quantity },
          },
        ],
      },
      // (F8) Vía B confirmada por el spike F8: `plainDescription` acepta HTML
      // (generado con `marked` desde el Markdown de Gemini) y Wix lo convierte
      // a Rich Content (`description` como string da HTTP 400 "Expected an
      // object" → no se usa la Vía A).
      ...(include && product.description
        ? { plainDescription: convertMarkdownToWixHtml(product.description) }
        : {}),
      ...(include && mediaItems.length > 0
        ? { media: { itemsInfo: { items: mediaItems } } }
        : {}),
      ...(include && product.jsonLd
        ? { seoData: { tags: [toSchemaTag(product.jsonLd)] } }
        : {}),
    },
  };
}

/**
 * Convierte las variantes detectadas por Gemini a la forma
 * `productOptions`/`variantsInfo` (modelo flexible; el modelo final es V1).
 */
export function geminiVariantsToWix(
  variants: Array<{ name?: string; value?: string; price?: number; sku?: string }>,
): WixVariants | null {
  if (!variants || variants.length === 0) return null;
  const optionNames = [...new Set(variants.map((v) => v.name).filter(Boolean))] as string[];
  if (optionNames.length === 0) return null;

  const productOptions = optionNames.map((name) => ({
    name,
    choices: [
      ...new Set(
        variants.filter((v) => v.name === name).map((v) => v.value).filter(Boolean),
      ),
    ].map((value) => ({ value })),
  }));

  const variantsInfo = {
    variants: variants.map((v) => ({
      choices: optionNames.map((name) => ({
        optionName: name,
        value: v.value ?? '',
      })),
      ...(v.price != null ? { price: v.price } : {}),
      ...(v.sku ? { sku: v.sku } : {}),
    })),
  };

  return { productOptions, variantsInfo };
}

/** Convierte un resultado validado de Gemini al contrato completo (con jsonLd). */
export function toGeminiProductResult(
  data: GeminiOutput,
  jsonLd: JsonLdProduct,
): GeminiProductResult {
  return {
    name: data.name,
    description: data.description ?? '',
    price: data.price ?? null,
    currency: data.currency || 'USD',
    category: data.category ?? null,
    brand: data.brand ?? null,
    barcode: data.barcode ?? null,
    skuSuggestion: data.skuSuggestion ?? null,
    variants: data.variants ?? [],
    jsonLd,
  };
}
