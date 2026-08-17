/**
 * Escritura de productos en Wix Catalog V3 con inventario inicial (F6).
 *
 * 1. `queryBySkuV3(sku)` → si NO existe: `buildProductWithInventoryPayload` +
 *    `createProductWithInventory` (stock inicial + `visible` + tag privado
 *    `COTG-{fecha}` + marca `{ id }` si aplica).
 * 2. Si EXISTE: NO se recrea (actualizar stock de existentes = fuera de
 *    alcance, futuro módulo de inventario). Se devuelve el producto existente
 *    para que el worker marque status/audit sin inventario nuevo.
 *
 * NO se usa la vía legacy V1 (products / collectionIds): solo V3.
 */
import type { ProductCapture } from '@click-on-the-go/shared';
import { getWixClient } from '../config/wixClient.js';
import { buildProductWithInventoryPayload } from './mapService.js';

export interface UpsertV3Options {
  /** Stock inicial (inventario) — viene de settings (`defaultQuantity`). */
  quantity: number;
  /** Publicar el producto — viene de settings (`visible`). */
  visible: boolean;
  /** Id de la marca de Wix (resuelto vía tabla `brands`) — opcional. */
  brandId?: string;
}

export interface UpsertV3Result {
  productId: string;
  revision: string | number | null;
  /** Cantidad devuelta por Wix en `inventoryOptions` (si aplica). */
  inventoryQuantity: number | null;
  /** `true` = se creó en Wix; `false` = SKU ya existía (no se recreó). */
  created: boolean;
}

export async function upsertProductV3(
  product: ProductCapture,
  opts: UpsertV3Options,
): Promise<UpsertV3Result> {
  const client = getWixClient();

  const existing = await client.queryBySkuV3(product.sku);
  if (existing) {
    // No recrear: log y estado sin inventario nuevo (actualizar stock de
    // existentes = fuera de alcance, futuro módulo de inventario).
    console.warn(
      `[wix] SKU "${product.sku}" ya existe en Wix (${existing._id}); no se recrea (sin inventario nuevo).`,
    );
    return {
      productId: existing._id,
      revision: existing.revision ?? null,
      inventoryQuantity: null,
      created: false,
    };
  }

  const tag = `COTG-${new Date().toISOString().slice(0, 10)}`;
  const payload = buildProductWithInventoryPayload(product, {
    quantity: opts.quantity,
    visible: opts.visible,
    brandId: opts.brandId,
    tag,
  });
  const response = await client.createProductWithInventory(payload);

  // F6a real (docs de Wix): el inventory item (cantidad) se crea en la MISMA
  // llamada vía `variantsInfo.variants[].inventoryItem`; la respuesta lo
  // devuelve en `inventoryResults.results[].item.quantity`.
  const createdItem = (response.inventoryResults?.results?.[0] as any)?.item;
  const inventoryQuantity =
    createdItem?.quantity != null ? Number(createdItem.quantity) : null;

  return {
    productId: response.product.id,
    revision: response.product.revision ?? null,
    inventoryQuantity,
    created: true,
  };
}
