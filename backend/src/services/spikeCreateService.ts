/**
 * TEMP F6a — Spike de VALIDACIÓN de escritura en Wix (primera alta real).
 *
 * Valida el camino PRODUCTIVO completo: `buildProductWithInventoryPayload`
 * (shape confirmado en F6a) → `createProductWithInventory` (REST real) →
 * read-back con `readProductV3`. Reporta permisos (401/403), el body crudo,
 * `inventoryResults` y la disponibilidad. SE ELIMINA al terminar F6.
 */
import { createRealWixClient } from '../config/wixClient.js';
import { env } from '../config/env.js';
import { buildProductWithInventoryPayload } from './mapService.js';
import type { WixCatalogProduct } from '@click-on-the-go/shared';

/** Consulta los inventory items de un producto (entidad donde vive la cantidad). */
async function queryInventoryItems(productId: string): Promise<any> {
  const res = await fetch('https://www.wixapis.com/stores/v3/inventory-items/query', {
    method: 'POST',
    headers: {
      Authorization: env.wixApiKey!,
      'wix-site-id': env.wixSiteId!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: { filter: { productId }, paging: { limit: 5 } } }),
  });
  const text = await res.text().catch(() => '');
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

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
    ok: boolean;
    statusCode?: number;
    productId?: string;
    revision?: string | number;
    rawBody?: unknown;
    /** Inventory item creado aparte (cantidad real) — `stores/v3/inventory-items`. */
    inventoryItem?: unknown;
    /** `availabilityStatus` del producto tras crear el inventory item. */
    availabilityAfter?: string;
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
    create: { ok: false },
  };

  // 1) Marcas: confirmar shape de `stores/v3/brands/query` (F6a real: `{ id, name }`)
  let brandId: string | undefined;
  try {
    const brands = await client.queryBrands();
    report.brands.count = brands.length;
    report.brands.sample = brands.slice(0, 3);
    brandId = brands[0]?._id;
  } catch (err: any) {
    report.brands.error = err?.message ?? String(err);
  }

  // 2) Alta real usando el BUILDER PRODUCTIVO (payload de la app, no hardcoded)
  const payload = buildProductWithInventoryPayload(
    {
      name: `Spike F6a ${new Date().toISOString().slice(0, 10)}`,
      description: 'Producto temporal de validación F6a (inventario+visible+tag+marca).',
      price: 9.99,
      currency: 'USD',
      sku,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: `Spike F6a ${new Date().toISOString().slice(0, 10)}`,
        sku,
        offers: { '@type': 'Offer', price: '9.99', priceCurrency: 'USD' },
      },
    },
    { quantity: 5, visible: true, brandId, tag, includeDescriptionMediaSeo: true },
  );

  // El builder productivo ya emite `variantsInfo.variants[].inventoryItem`
  // (docs: crea el inventory item en la MISMA llamada; validado en F6a real).
  console.log('[F6a spike] payload (builder productivo) =', JSON.stringify(payload));

  try {
    const response = await client.createProductWithInventory(payload);
    report.create.ok = true;
    report.create.productId = response.product?.id;
    report.create.revision = response.product?.revision;
    report.create.rawBody = response;

    // Verificar si el inventory item se creó en la MISMA llamada (docs) o no.
    if (report.create.productId) {
      const inv = await queryInventoryItems(report.create.productId);
      report.create.inventoryItem = inv?.inventoryItems?.[0] ?? inv ?? null;
      const after = await client.readProductV3(report.create.productId);
      report.create.availabilityAfter = (after as any)?.inventory?.availabilityStatus;
    }
  } catch (err: any) {
    report.create.ok = false;
    report.create.statusCode = Number(err?.status ?? err?.statusCode ?? 0) || undefined;
    report.create.error = err?.message ?? String(err);
  }

  // 4) Read-back del producto creado
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
