/**
 * Servicio de UPSERT por SKU contra Wix Catalog V3 (sección 5.2 del plan).
 *
 * 1. `queryProducts().eq('sku', sku)`.
 * 2. Si existe: filtra tags JSON-LD antiguos, inyecta el nuevo y CONSERVA
 *    `productOptions` y `variantsInfo` de la revisión actual (evita que
 *    Catalog V3 borre los arreglos omitidos). `updateProduct` con `revision`.
 * 3. Si no existe: `createProduct` con el JSON-LD en `seoData.tags`.
 */
import type { ProductCapture, WixProductEntity } from '@click-on-the-go/shared';
import { getWixClient, WixRevisionConflictError } from '../config/wixClient.js';
import { buildWixPayload, toSchemaTag } from './mapService.js';

export async function upsertProduct(product: ProductCapture): Promise<WixProductEntity> {
  const client = getWixClient();
  const existing = await client.queryBySku(product.sku);
  const payload = buildWixPayload(product, product.imageUrls);

  if (existing) {
    // Filtrar tags script/ld+json antiguos para no duplicar el marcado
    const tags = (existing.seoData?.tags ?? []).filter(
      (t: any) => !(t?.type === 'script' && t?.props?.type === 'application/ld+json'),
    );
    if (product.jsonLd) tags.push(toSchemaTag(product.jsonLd));

    payload.seoData = { tags };
    // Conservar la estructura compleja de la revisión actual en Wix
    payload.productOptions = existing.productOptions ?? [];
    payload.variantsInfo = existing.variantsInfo ?? { variants: [] };

    return client.updateProduct(existing._id, {
      revision: existing.revision,
      product: payload,
    });
  }

  return client.createProduct({ product: payload });
}

/**
 * UPSERT con reintento ante conflicto de revisión (edición concurrente en el
 * dashboard de Wix): re-lee el producto y reintenta con la revisión nueva.
 */
export async function upsertProductWithRetry(
  product: ProductCapture,
  attemptsLeft = 2,
): Promise<WixProductEntity> {
  try {
    return await upsertProduct(product);
  } catch (err) {
    if (err instanceof WixRevisionConflictError && attemptsLeft > 0) {
      console.warn(`[wix] Conflicto de revisión para "${product.sku}", re-leyendo y reintentando...`);
      return upsertProductWithRetry(product, attemptsLeft - 1);
    }
    throw err;
  }
}
