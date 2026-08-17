/**
 * TEMP F6 — Diagnóstico: comparar la ESTRUCTURA del inventario (dónde vive la
 * cantidad) entre productos existentes con inventario disponible (de
 * `WIX_SPIKE_PRODUCT_IDS` en .env) y un producto recién creado que muestra
 * "OUT_OF_STOCK".
 *
 * Uso: npx tsx src/scripts/spikeInventoryCompare.ts [productIdExtra...]
 * Se leen los productos por REST (GET /stores/v3/products/{id}) y se imprimen
 * las rutas que contienen claves de inventario/cantidad. SE ELIMINA al terminar F6.
 */
import { loadEnvFile } from '../config/loadEnv.js';

loadEnvFile('.env');

const API_BASE = 'https://www.wixapis.com/stores/v3';

function extractPaths(node: unknown, path: string, acc: Array<{ path: string; value: unknown }>): void {
  if (node === null || node === undefined) return;
  const seg = path.toLowerCase();
  if (
    seg.includes('inventory') ||
    seg.includes('quantity') ||
    seg.includes('track') ||
    seg.includes('stock')
  ) {
    acc.push({ path, value: node });
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => extractPaths(v, `${path}[${i}]`, acc));
  } else if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      extractPaths(v, `${path}.${k}`, acc);
    }
  }
}

async function getProduct(id: string): Promise<{ status: number; data: any }> {
  const res = await fetch(`${API_BASE}/products/${id}`, {
    headers: {
      Authorization: process.env.WIX_API_KEY!,
      'wix-site-id': process.env.WIX_SITE_ID!,
    },
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

/** Consulta los inventory items de un producto (donde vive la CANTIDAD real). */
async function getInventoryItems(productId: string): Promise<{ status: number; data: any }> {
  const res = await fetch(`${API_BASE}/inventory-items/query`, {
    method: 'POST',
    headers: {
      Authorization: process.env.WIX_API_KEY!,
      'wix-site-id': process.env.WIX_SITE_ID!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: { filter: { productId }, paging: { limit: 10 } },
    }),
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

async function main(): Promise<void> {
  const idsFromEnv = (process.env.WIX_SPIKE_PRODUCT_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const extraIds = process.argv.slice(2).map((s) => s.trim()).filter(Boolean);
  const ids = [...idsFromEnv, ...extraIds];

  console.log('[inventory] IDs a comparar:', ids.length);
  for (const id of ids) {
    console.log('\n==================================================');
    console.log(`[inventory] PRODUCTO ${id}`);
    try {
      const { status, data } = await getProduct(id);
      console.log('[inventory] status =', status);
      if (status !== 200 || !data?.product) {
        console.log('[inventory] respuesta:', JSON.stringify(data)?.slice(0, 500));
        continue;
      }
      const p = data.product;
      console.log('[inventory] name =', p.name, '| visible =', p.visible);
      console.log('[inventory] top-level inventory =', JSON.stringify(p.inventory));
      const found: Array<{ path: string; value: unknown }> = [];
      extractPaths(p, 'product', found);
      console.log('[inventory] rutas con inventario/cantidad:');
      for (const f of found) {
        console.log('   ', f.path, '=', JSON.stringify(f.value)?.slice(0, 400));
      }
      // Inventory items (cantidad real) de este producto
      const inv = await getInventoryItems(id);
      console.log('[inventory] inventory-items status =', inv.status);
      console.log('[inventory] inventory-items =', JSON.stringify(inv.data)?.slice(0, 1200));
    } catch (err: any) {
      console.log('[inventory] error:', err?.message ?? err);
    }
  }
}

main().catch((err) => {
  console.error('[inventory] error global:', err?.message ?? err);
  process.exitCode = 1;
});
