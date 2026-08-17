/**
 * TEMP F6 — Prueba: crear un inventory item (entidad donde vive la CANTIDAD)
 * para un producto recién creado que quedó OUT_OF_STOCK, y verificar que pasa a
 * IN_STOCK. Confirma que `products-with-inventory` NO crea el inventory item y
 * que hay que crearlo aparte con el módulo de inventario.
 *
 * Uso: npx tsx src/scripts/spikeCreateInventoryItem.ts <productId> <variantId> [quantity]
 * SE ELIMINA al terminar F6.
 */
import { loadEnvFile } from '../config/loadEnv.js';

loadEnvFile('.env');

const API_BASE = 'https://www.wixapis.com/stores/v3';

async function post(path: string, body: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: process.env.WIX_API_KEY!,
      'wix-site-id': process.env.WIX_SITE_ID!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => '');
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

async function getProduct(id: string): Promise<any> {
  const res = await fetch(`${API_BASE}/products/${id}`, {
    headers: {
      Authorization: process.env.WIX_API_KEY!,
      'wix-site-id': process.env.WIX_SITE_ID!,
    },
  });
  const json = (await res.json()) as { product?: any };
  return json.product ?? null;
}

async function getInventory(productId: string): Promise<any> {
  const { data } = await post('/inventory-items/query', {
    query: { filter: { productId }, paging: { limit: 10 } },
  });
  return data;
}

async function main(): Promise<void> {
  const productId = process.argv[2]?.trim();
  const variantId = process.argv[3]?.trim();
  const quantity = Number(process.argv[4] ?? '5');

  if (!productId || !variantId) {
    console.error('[inventory-create] uso: npx tsx src/scripts/spikeCreateInventoryItem.ts <productId> <variantId> [quantity]');
    process.exit(1);
  }

  console.log('[inventory-create] producto =', productId, '| variante =', variantId, '| cantidad =', quantity);

  const before = await getProduct(productId);
  console.log('[inventory-create] antes: availabilityStatus =', before?.inventory?.availabilityStatus);

  // Crear el inventory item (trackQuantity = true => se trackea por CANTIDAD)
  const { status, data } = await post('/inventory-items', {
    inventoryItem: {
      productId,
      variantId,
      trackQuantity: true,
      quantity,
    },
  });
  console.log('[inventory-create] create inventory-item status =', status);
  console.log('[inventory-create] create inventory-item =', JSON.stringify(data)?.slice(0, 800));

  const after = await getProduct(productId);
  console.log('[inventory-create] después: availabilityStatus =', after?.inventory?.availabilityStatus);

  const inv = await getInventory(productId);
  console.log('[inventory-create] inventory-items =', JSON.stringify(inv)?.slice(0, 1200));
}

main().catch((err) => {
  console.error('[inventory-create] error global:', err?.message ?? err);
  process.exitCode = 1;
});
