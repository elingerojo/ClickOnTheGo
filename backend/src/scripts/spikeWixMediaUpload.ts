/**
 * TEMP F7 — Script CLI del spike de validación de SUBIDA a Wix Media (Media
 * Manager) + `media` en el alta de `stores/v3/products-with-inventory`.
 *
 * Uso: npm run db:spike-media -w @click-on-the-go/backend
 * (o: cd backend && npm run db:spike-media)
 *
 * Valida el árbol de decisión de F7 (§A.1 del plan):
 *  1. **Vía 1a** — `files.importFile(url, { mediaType: 'IMAGE', displayName,
 *     mimeType })` importa la imagen por URL (copia Blob→Wix server-side, sin
 *     byte streaming) y devuelve `file.media.image.image` (`wix:image://v1/...`).
 *  2. **Alta con media** — `stores/v3/products-with-inventory` acepta
 *     `media.mediaItems[{ url, title }]` (shape `shared`).
 *  3. **Read-back** — `productsV3.getProduct(id)` confirma que `media` quedó
 *     asociado y se reporta `availabilityStatus`.
 *
 * Fuente de la imagen: Neon (`products.image_urls[0]` de un producto reciente
 * con URL REAL de Vercel Blob, prefijo `*.blob.vercel-storage.com` y distinta
 * de `mock.wixmedia`), o el env `SPIKE_MEDIA_URL`. Si no existe, imprime aviso
 * de correr una captura en la app.
 *
 * OJO (ESM hoisting): `db.js` crea el `Pool` al evaluarse el módulo y necesita
 * `DATABASE_URL` YA cargada en `process.env`. Por eso `db.js`/`env.js` se
 * importan DINÁMICAMENTE después de `loadEnvFile` (mismo patrón que `index.ts`);
 * de lo contrario el pool se crea con la config fallback y el SCRAM a Neon
 * falla con "client password must be a string".
 *
 * SE ELIMINA al terminar F7 (como los spikes previos).
 */
import { createClient, ApiKeyStrategy } from '@wix/sdk';
import { files } from '@wix/media';
import { productsV3 } from '@wix/stores';
import { loadEnvFile } from '../config/loadEnv.js';

loadEnvFile('.env');

/** URL real de Vercel Blob (excluye `mock.wixmedia`). */
const BLOB_URL_RE = /\.blob\.vercel-storage\.com\//i;

/** Deduce el `mimeType` de la extensión de la URL (default `image/jpeg`). */
function mimeFromUrl(url: string): string {
  const ext = (url.split('?')[0].split('.').pop() ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  const map: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    avif: 'image/avif',
    heic: 'image/heic',
    svg: 'image/svg+xml',
  };
  return map[ext] ?? 'image/jpeg';
}

/** Resuelve la URL fuente: `SPIKE_MEDIA_URL` o la del producto más reciente de
 * Neon con `image_urls[0]` real de Vercel Blob. */
async function resolveSourceUrl(pool: any): Promise<{ url: string; sku?: string; productId?: string }> {
  if (process.env.SPIKE_MEDIA_URL) {
    console.log(`[spike-media] Fuente: SPIKE_MEDIA_URL=${process.env.SPIKE_MEDIA_URL}`);
    return { url: process.env.SPIKE_MEDIA_URL };
  }
  const { rows } = await pool.query(
    `SELECT id, sku, name, image_urls, created_at
       FROM products
      WHERE cardinality(image_urls) > 0
      ORDER BY created_at DESC
      LIMIT 25`,
  );
  const candidates = (rows as any[])
    .filter((r) => Array.isArray(r.image_urls) && r.image_urls.length > 0)
    .filter((r) => BLOB_URL_RE.test(String(r.image_urls[0])));
  if (candidates.length === 0) {
    throw new Error(
      '[spike-media] No se encontró ningún producto con URL real de Vercel Blob en Neon. ' +
        'Corre una captura en la app (o define SPIKE_MEDIA_URL).',
    );
  }
  const best = candidates[0];
  console.log(
    `[spike-media] Fuente desde Neon: sku=${best.sku} (${best.id}) url=${best.image_urls[0]}`,
  );
  return { url: best.image_urls[0] as string, sku: best.sku, productId: best.id };
}

async function main(): Promise<void> {
  // Import dinámico DESPUÉS de cargar .env (ESM hoisting): db.js crea el Pool
  // al evaluarse y debe leer DATABASE_URL ya en process.env (patrón de index.ts).
  const { pool } = await import('../config/db.js');
  const { env } = await import('../config/env.js');

  try {
    if (!env.wixApiKey || !env.wixSiteId) {
      throw new Error('[spike-media] Faltan WIX_API_KEY/WIX_SITE_ID (reales).');
    }
    const apiKey = env.wixApiKey;
    const siteId = env.wixSiteId;

    // Cliente SDK REAL local del spike: valida @wix/media (módulo `files`) con
    // ApiKeyStrategy de forma AISLADA (sin depender de createRealWixClient ni de
    // cambios de producción de F7).
    const client: any = createClient({
      modules: { files, productsV3 },
      auth: ApiKeyStrategy({ apiKey, siteId }),
    });

    const { url: blobUrl } = await resolveSourceUrl(pool);
    const fileName = `spike-media-${Date.now()}`;
    const mimeType = mimeFromUrl(blobUrl);

    // 1) Vía 1a — importación por URL
    console.log(
      `[spike-media] files.importFile(url=${blobUrl}, mediaType=IMAGE, displayName=${fileName}, mimeType=${mimeType})`,
    );
    const importResult = await client.files.importFile(blobUrl, {
      mediaType: files.MediaType.IMAGE,
      displayName: fileName,
      mimeType,
    });
    const file: any = importResult?.file ?? {};
    const fileId = file._id ?? null;
    // El `wix:image://v1/...` vive en `file.media.image.image` (el `url` es un
    // CDN temporal, no el URI canónico que esperan las APIs de catálogo/tiendas).
    const wixMediaUrl = file?.media?.image?.image ?? file?.url ?? null;
    console.log('[spike-media] importFile OK:', { fileId, wixMediaUrl, mediaType: file?.mediaType });

    // 2) Alta de prueba con `media` vía stores/v3/products-with-inventory (REST,
    // patrón del cliente real; aislado aquí para no tocar producción).
    const sku = `SPIKE-MEDIA-${Date.now()}`;
    const payload = {
      product: {
        name: `Spike media ${sku}`,
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
        description: { text: 'Producto de prueba del spike F7 (se borra después).' },
        // Shape V3 correcta (validada en el spike): `media.itemsInfo.items[]`,
        // cada item con `url` (URL externa) + `displayName`. NO `mediaItems`.
        media: wixMediaUrl
          ? { itemsInfo: { items: [{ url: wixMediaUrl, displayName: fileName }] } }
          : undefined,
      },
      returnEntity: true,
    };

    console.log(`[spike-media] createProductWithInventory(sku=${sku}) con media=${Boolean(wixMediaUrl)}`);
    const createRes = await fetch('https://www.wixapis.com/stores/v3/products-with-inventory', {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'wix-site-id': siteId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const createBody = await createRes.text();
    if (!createRes.ok) {
      throw new Error(
        `[spike-media] createProductWithInventory HTTP ${createRes.status}: ${createBody.slice(0, 800)}`,
      );
    }
    const created: any = JSON.parse(createBody);
    const productId: string | null = created?.product?.id ?? null;
    const availabilityStatus: string | null =
      created?.inventoryResults?.results?.[0]?.item?.availabilityStatus ?? null;
    console.log('[spike-media] createProductWithInventory OK:', {
      productId,
      availabilityStatus,
    });

    // 3) Read-back con productsV3.getProduct + fields MEDIA_ITEMS_INFO (sin él,
    // `media.itemsInfo` no se devuelve y `media` sale como `{}`).
    let readBack: any = null;
    let mediaAccepted = false;
    if (productId) {
      const res = await client.productsV3.getProduct(productId, {
        fields: ['MEDIA_ITEMS_INFO'],
      });
      readBack = res?.product ?? res ?? null;
      const media = readBack?.media;
      const items = media?.itemsInfo?.items ?? media?.items ?? [];
      mediaAccepted = Array.isArray(items) && items.length > 0;
      console.log(
        '[spike-media] read-back media:',
        JSON.stringify(media ?? null).slice(0, 500),
        `→ mediaAccepted=${mediaAccepted}`,
      );
    }

    const report = {
      blobUrl,
      fileName,
      mimeType,
      import: { fileId, wixMediaUrl },
      create: { sku, productId, availabilityStatus },
      readBack,
      gates: {
        via1a_importFileByUrl: Boolean(wixMediaUrl),
        mediaAcceptedOnCreate: mediaAccepted,
      },
    };

    console.log('\n[spike-media] REPORTE JSON:');
    console.log(JSON.stringify(report, null, 2));
    console.log(
      `\n[spike-media] CONCLUSIÓN: ` +
        (wixMediaUrl
          ? 'Vía 1a OK → implementar files.importFile en RealWixClient.uploadImageToMedia y ' +
            `emitir media en el builder. ${mediaAccepted ? 'media aceptado en el alta.' : 'media rechazado en el alta → Vía 3 (adjuntar con updateProduct).'}`
          : 'Vía 1a falló → evaluar Vía 1b (bytes) / Vía 2 (REST media).'),
    );
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((err: any) => {
  console.error('[spike-media] Error ejecutando el spike:', err?.message ?? err);
  process.exitCode = 1;
});
