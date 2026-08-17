/**
 * Escritura de productos en Wix Catalog V3 con inventario inicial (F6).
 *
 * 1. `buildProductWithInventoryPayload` + `createProductWithInventory`
 *    (stock inicial + `visible` + tag privado `COTG-{fecha}` + marca `{ id }`
 *    si aplica).
 * 2. Si Wix responde HTTP 409 por SKU duplicado: NO se recrea (actualizar
 *    stock de existentes = fuera de alcance, futuro módulo de inventario). Se
 *    devuelve `created: false` para que el worker marque status/audit sin
 *    inventario nuevo.
 *
 * NOTA: NO se pre-consulta por SKU (`queryBySkuV3`): Catalog V3 no declara
 * `sku` como campo filterable en `queryProducts`. Se confía en el 409 del alta.
 *
 * NO se usa la vía legacy V1 (products / collectionIds): solo V3.
 */
import type { ProductCapture, ProductWithInventoryResponse } from '@click-on-the-go/shared';
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
  /** Id del producto en Wix; `null` si el SKU ya existía (409) y no se tiene el id. */
  productId: string | null;
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

  const tag = `COTG-${new Date().toISOString().slice(0, 10)}`;
  const payload = buildProductWithInventoryPayload(product, {
    quantity: opts.quantity,
    visible: opts.visible,
    brandId: opts.brandId,
    tag,
  });

  let response: ProductWithInventoryResponse;
  try {
    response = await client.createProductWithInventory(payload);
  } catch (err: any) {
    // Catalog V3 no permite filtrar queryProducts por `sku` (no filterable),
    // así que NO se pre-consulta; un SKU duplicado devuelve HTTP 409 → se
    // trata como "ya existe" (sin recrear ni tocar inventario).
    if (isDuplicateSkuError(err)) {
      console.warn(
        `[wix] SKU "${product.sku}" ya existe en Wix (HTTP 409); no se recrea (sin inventario nuevo).`,
      );
      return {
        productId: null,
        revision: null,
        inventoryQuantity: null,
        created: false,
      };
    }
    throw err;
  }

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

/** Detecta un HTTP 409 de Wix (SKU duplicado en el alta de producto). */
function isDuplicateSkuError(err: unknown): boolean {
  const e = err as { status?: number; statusCode?: number; message?: string };
  const status = Number(e?.status ?? e?.statusCode ?? 0);
  const message = String(e?.message ?? '');
  return status === 409 || /(?:^|\s)409(?:\s|$)/.test(message);
}
