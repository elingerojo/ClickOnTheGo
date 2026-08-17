/**
 * TEMP F6a — Spike de VALIDACIÓN de escritura en Wix (alta mínima real).
 *
 * Da de alta un producto REAL con `stores/v3/products-with-inventory`
 * (inventario + visible + tag privado `COTG-{fecha}` + marca si hay) y reporta:
 *   - permisos (401/403 de escritura),
 *   - shape devuelto (product.id, revision, inventoryOptions, tags, brand),
 *   - read-back con `readProductV3(id)`.
 *
 * Se usa SIEMPRE el cliente real (sin mock). SE ELIMINA al terminar F6.
 */
import { createRealWixClient } from '../config/wixClient.js';
import { env } from '../config/env.js';
import { buildProductWithInventoryPayload } from './mapService.js';
import type { WixCatalogProduct } from '@click-on-the-go/shared';

export interface SpikeCreateReport {
  meta: {
    mode: string;
    wixApiKey: boolean;
    wixSiteId: boolean;
    tag: string;
    sku: string;
  };
  brands: {
    count: number;
    sample: Array<{ _id: string; name: string }>;
    error?: string;
  };
  create: {
    attempted: boolean;
    ok: boolean;
    statusCode?: number;
    productId?: string;
    revision?: string | number;
    shape?: unknown;
    inventoryOptions?: unknown;
    error?: string;
  };
  readBack?: {
    ok: boolean;
    product?: WixCatalogProduct | null;
    error?: string;
  };
}

export async function runSpikeCreate(): Promise<SpikeCreateReport> {
  const client = createRealWixClient();
  const tag = `COTG-${new Date().toISOString().slice(0, 10)}`;
  const sku = `SPIKE-F6A-${Date.now()}`;
  const report: SpikeCreateReport = {
    meta: {
      mode: client.mode,
      wixApiKey: Boolean(env.wixApiKey),
      wixSiteId: Boolean(env.wixSiteId),
      tag,
      sku,
    },
    brands: { count: 0, sample: [] },
    create: { attempted: false, ok: false },
  };

  // 1) Marcas: confirmar shape de `stores/v3/brands/query` y probar `brand: { id }`
  let brandId: string | undefined;
  try {
    const brands = await client.queryBrands();
    report.brands.count = brands.length;
    report.brands.sample = brands.slice(0, 3);
    brandId = brands[0]?._id;
  } catch (err: any) {
    report.brands.error = err?.message ?? String(err);
  }

  // 2) Alta mínima real con inventario + visible + tag + marca (si aplica)
  const payload = buildProductWithInventoryPayload(
    {
      name: `Spike F6a ${new Date().toISOString().slice(0, 10)}`,
      description:
        'Producto temporal de validación F6a (inventario+visible+tag). Puede eliminarse.',
      price: 9.99,
      sku,
    },
    [],
    { quantity: 5, visible: true, brandId, tag, includeDescriptionMediaSeo: true },
  );

  report.create.attempted = true;
  try {
    const response = await client.createProductWithInventory(payload);
    report.create.ok = true;
    report.create.productId = response.product?.id;
    report.create.revision = response.product?.revision;
    report.create.shape = response.product;
    report.create.inventoryOptions = response.inventoryOptions;
  } catch (err: any) {
    report.create.ok = false;
    report.create.statusCode = Number(err?.status ?? err?.statusCode ?? 0) || undefined;
    report.create.error = err?.message ?? String(err);
  }

  // 3) Read-back: confirmar que el producto existe (readProductV3)
  if (report.create.productId) {
    try {
      const product = await client.readProductV3(report.create.productId);
      report.readBack = { ok: Boolean(product), product };
    } catch (err: any) {
      report.readBack = { ok: false, error: err?.message ?? String(err) };
    }
  }

  console.log('[F6a spike] ===========================================================');
  console.log('[F6a spike] REPORTE — Escritura Wix REAL (products-with-inventory).');
  console.log('[F6a spike] ===========================================================');
  console.log(JSON.stringify(report, null, 2));
  return report;
}
