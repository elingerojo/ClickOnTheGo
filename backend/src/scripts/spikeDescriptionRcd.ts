/**
 * TEMP F8 — Script CLI del spike de validación del campo de DESCRIPCIÓN
 * (Rich Content) en `stores/v3/products-with-inventory`.
 *
 * Uso: npm run db:spike-desc -w @click-on-the-go/backend
 *
 * Valida el árbol de decisión de F8 (Parte D del plan):
 *  - **Vía A** — `product.description = '<html>'`: ¿Wix convierte el HTML a RCD
 *    (`description.nodes`)?
 *  - **Vía B** — `product.plainDescription = '<html>'`: ¿Wix convierte a RCD?
 *  - **Vía C** — fallback con el paquete Ricos (NO se valida aquí; requiere
 *    DOM/jsdom, fuera del alcance del spike).
 *
 * Read-back con `productsV3.getProduct(id, { fields: ['DESCRIPTION',
 * 'PLAIN_DESCRIPTION'] })` y reporte JSON con la conclusión (A / B / C).
 *
 * OJO (ESM hoisting): `db.js` crea el `Pool` al evaluarse el módulo y necesita
 * `DATABASE_URL` YA cargada en `process.env`. Por eso `db.js`/`env.js` se
 * importan DINÁMICAMENTE después de `loadEnvFile` (mismo patrón que `index.ts`
 * y el spike F7); de lo contrario el pool se crea con la config fallback y el
 * SCRAM a Neon falla con "client password must be a string".
 *
 * SE ELIMINA al terminar F8 (como los spikes previos).
 */
import { createClient, ApiKeyStrategy } from '@wix/sdk';
import { productsV3 } from '@wix/stores';
import { loadEnvFile } from '../config/loadEnv.js';

loadEnvFile('.env');

/** HTML de prueba: párrafo con negrita + lista (lo que produce `marked`). */
const TEST_HTML = '<p><strong>Hola</strong></p><ul><li>A</li><li>B</li></ul>';

/** Crea un producto de prueba con el HTML en `field` (description | plainDescription). */
async function createProduct(
  client: any,
  sku: string,
  field: 'description' | 'plainDescription',
  html: string,
): Promise<{ id: string | null; status: number | null; error: string | null }> {
  const payload = {
    product: {
      name: `Spike RCD ${sku}`,
      productType: 'PHYSICAL',
      physicalProperties: { sku },
      visible: false,
      tags: { privateTag: { tagIds: [`SPIKE-${new Date().toISOString().slice(0, 10)}`] } },
      variantsInfo: {
        variants: [
          {
            choices: [],
            price: { actualPrice: { amount: '10', currency: 'USD' } },
            inventoryItem: { trackQuantity: true, quantity: 1 },
          },
        ],
      },
      [field]: html,
    },
    returnEntity: true,
  };
  const res = await fetch('https://www.wixapis.com/stores/v3/products-with-inventory', {
    method: 'POST',
    headers: {
      Authorization: client._wixApiKey,
      'wix-site-id': client._wixSiteId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`[spike-desc] create (${field}) HTTP ${res.status}: ${body.slice(0, 800)}`);
    return { id: null, status: res.status, error: body.slice(0, 800) };
  }
  const created: any = JSON.parse(body);
  return { id: created?.product?.id ?? null, status: res.status, error: null };
}

/** Read-back con DESCRIPTION + PLAIN_DESCRIPTION (sin ellos no se devuelven). */
async function readBack(client: any, productId: string): Promise<any> {
  const res = await client.productsV3.getProduct(productId, {
    fields: ['DESCRIPTION', 'PLAIN_DESCRIPTION'],
  });
  return res?.product ?? res ?? null;
}

async function main(): Promise<void> {
  // Import dinámico DESPUÉS de cargar .env (ESM hoisting) — patrón de index.ts.
  const { pool } = await import('../config/db.js');
  const { env } = await import('../config/env.js');

  try {
    if (!env.wixApiKey || !env.wixSiteId) {
      throw new Error('[spike-desc] Faltan WIX_API_KEY/WIX_SITE_ID (reales).');
    }
    const client: any = createClient({
      modules: { productsV3 },
      auth: ApiKeyStrategy({ apiKey: env.wixApiKey, siteId: env.wixSiteId }),
    });
    // Guardar credenciales para el REST fetch (createProductWithInventory).
    client._wixApiKey = env.wixApiKey;
    client._wixSiteId = env.wixSiteId;

    // 1) Vía A — description = HTML
    const skuA = `SPIKE-DESC-A-${Date.now()}`;
    console.log(`[spike-desc] Vía A: description=${JSON.stringify(TEST_HTML)}`);
    const { id: idA, status: statusA, error: errorA } = await createProduct(
      client,
      skuA,
      'description',
      TEST_HTML,
    );
    const readA = idA ? await readBack(client, idA) : null;
    const descA = readA?.description;
    const plainA = readA?.plainDescription;
    const nodesA = Array.isArray(descA?.nodes) ? descA.nodes : null;
    console.log('[spike-desc] read-back A description:', JSON.stringify(descA ?? null).slice(0, 800));
    console.log('[spike-desc] read-back A plainDescription:', JSON.stringify(plainA ?? null).slice(0, 800));
    const viaAOk = Boolean(nodesA && nodesA.length > 0);

    // 2) Vía B — plainDescription = HTML (segundo producto de prueba)
    const skuB = `SPIKE-DESC-B-${Date.now()}`;
    console.log(`[spike-desc] Vía B: plainDescription=${JSON.stringify(TEST_HTML)}`);
    const { id: idB, status: statusB, error: errorB } = await createProduct(
      client,
      skuB,
      'plainDescription',
      TEST_HTML,
    );
    const readB = idB ? await readBack(client, idB) : null;
    const descB = readB?.description;
    const plainB = readB?.plainDescription;
    const nodesB = Array.isArray(descB?.nodes) ? descB.nodes : null;
    console.log('[spike-desc] read-back B description:', JSON.stringify(descB ?? null).slice(0, 800));
    console.log('[spike-desc] read-back B plainDescription:', JSON.stringify(plainB ?? null).slice(0, 800));
    const viaBOk = Boolean(nodesB && nodesB.length > 0);

    const report = {
      testHtml: TEST_HTML,
      viaA: {
        sku: skuA,
        create: { status: statusA, error: errorA, productId: idA },
        readBack: {
          description: descA,
          plainDescription: plainA,
          hasNodes: Boolean(nodesA && nodesA.length > 0),
          nodeTypes: nodesA?.map((n: any) => n?.type ?? '?') ?? [],
        },
      },
      viaB: {
        sku: skuB,
        create: { status: statusB, error: errorB, productId: idB },
        readBack: {
          description: descB,
          plainDescription: plainB,
          hasNodes: Boolean(nodesB && nodesB.length > 0),
          nodeTypes: nodesB?.map((n: any) => n?.type ?? '?') ?? [],
        },
      },
      conclusion: viaAOk ? 'VÍA A (description acepta HTML → RCD)' : viaBOk ? 'VÍA B (plainDescription acepta HTML → RCD)' : 'VÍA C (Ricos manual)',
    };

    console.log('\n[spike-desc] REPORTE JSON:');
    console.log(JSON.stringify(report, null, 2));
    console.log(`\n[spike-desc] CONCLUSIÓN: ${report.conclusion}`);
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((err: any) => {
  console.error('[spike-desc] Error ejecutando el spike:', err?.message ?? err);
  process.exitCode = 1;
});
