/**
 * Alta de productos en Wix Catalog V3 con inventario inicial (create-only).
 *
 * `buildProductWithInventoryPayload` + `createProductWithInventory`
 * (stock inicial + `visible` + tag privado `COTG-{fecha}` + marca `{ id }`
 * si aplica).
 *
 * NOTA: no hay ruta de update/upsert (se eliminó). Si el SKU ya existe en Wix,
 * el endpoint responde HTTP 409 y el error PROPAGA: el worker reintenta y el
 * job falla visiblemente en vez de omitirse en silencio.
 *
 * NO se usa la vía legacy V1 (products / collectionIds): solo V3.
 */
import type { ProductCapture, ProductWithInventoryResponse } from '@click-on-the-go/shared';
import { getWixClient } from '../config/wixClient.js';
import { buildProductWithInventoryPayload } from './mapService.js';

export interface CreateV3Options {
  /** Stock inicial (inventario) — viene de settings (`defaultQuantity`). */
  quantity: number;
  /** Publicar el producto — viene de settings (`visible`). */
  visible: boolean;
  /** Id de la marca de Wix (resuelto vía tabla `brands`) — opcional. */
  brandId?: string;
}

export interface CreateV3Result {
  /** Id del producto en Wix. */
  productId: string;
  revision: string | number | null;
  /** Cantidad devuelta por Wix en `inventoryResults` (si aplica). */
  inventoryQuantity: number | null;
}

export async function createProductV3(
  product: ProductCapture,
  opts: CreateV3Options,
): Promise<CreateV3Result> {
  const client = getWixClient();

  const tag = `COTG-${new Date().toISOString().slice(0, 10)}`;
  const payload = buildProductWithInventoryPayload(product, {
    quantity: opts.quantity,
    visible: opts.visible,
    brandId: opts.brandId,
    tag,
  });

  // El 409 (SKU duplicado) NO se captura aquí: propaga para que el worker
  // reintente con backoff y el job falle visiblemente.
  const response: ProductWithInventoryResponse =
    await client.createProductWithInventory(payload);

  // El inventory item (cantidad) se crea en la MISMA llamada vía
  // `variantsInfo.variants[].inventoryItem`; la respuesta lo devuelve en
  // `inventoryResults.results[].item.quantity`.
  const createdItem = (response.inventoryResults?.results?.[0] as any)?.item;
  const inventoryQuantity =
    createdItem?.quantity != null ? Number(createdItem.quantity) : null;

  return {
    productId: response.product.id,
    revision: response.product.revision ?? null,
    inventoryQuantity,
  };
}
