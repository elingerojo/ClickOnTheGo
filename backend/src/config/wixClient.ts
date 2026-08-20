/**
 * Cliente de Wix Catalog V3 (MVP) — integración real sin adaptador mock.
 *
 *   - stores/v3/products-with-inventory (alta con inventario, create-only)
 *   - site-properties/v4/properties (moneda e idioma dinámicos)
 *   - wix-media-backend (copia de imágenes)
 *   - Stores Catalog V3 (categorías, F3)
 *
 * Requiere `WIX_API_KEY` y `WIX_SITE_ID` (env). Si faltan, `getWixClient()`
 * lanza un error claro en el arranque (no hay fallback a mock).
 */
import { createClient, ApiKeyStrategy } from '@wix/sdk';
import { productsV3 } from '@wix/stores';
import * as categories from '@wix/auto_sdk_categories_categories';
import { files } from '@wix/media';
import { env } from './env.js';
import type {
  ProductWithInventoryPayload,
  ProductWithInventoryResponse,
  WixBrand,
  WixCategory,
  WixSiteProperties,
} from '@click-on-the-go/shared';

export interface WixCatalogClient {
  readonly mode: 'real';
  /** Moneda e idioma del sitio (site-properties v4). */
  getSiteProperties(): Promise<WixSiteProperties>;
  /**
   * Importa una imagen desde Blob staging a Wix Media (Media Manager) por URL
   * (`files.importFile` de `@wix/media`; copia Blob→Wix server-side, sin byte
   * streaming) y devuelve la URL canónica `wix:image://v1/...` que esperan las
   * APIs de catálogo/tiendas.
   * POLÍTICA DE ERROR (F7, confirmada): LANZA si la subida falla — no hay
   * fallback a la URL del Blob; el error propaga y el worker reintenta/falla
   * el job (el log queda como rastro forense).
   */
  uploadImageToMedia(blobUrl: string, title?: string): Promise<string>;
  /** (F3) Lista las categorías del catálogo del sitio (wix.categories.v1.category). */
  queryCategories(): Promise<WixCategory[]>;
  /** (F6) Alta de producto CON inventario inicial (stores/v3/products-with-inventory). */
  createProductWithInventory(
    payload: ProductWithInventoryPayload,
  ): Promise<ProductWithInventoryResponse>;
  /** (F6) Lista de marcas del sitio (REST POST /stores/v3/brands/query, sin params). */
  queryBrands(): Promise<WixBrand[]>;
}

/* ---------------------------------------------------------------------------
 * Cliente REAL (MVP) — @wix/sdk + @wix/stores-catalog + site-properties v4
 * ------------------------------------------------------------------------- */

class WixClient implements WixCatalogClient {
  readonly mode = 'real' as const;
  private readonly client: any;
  private readonly apiKey: string;
  private readonly siteId: string;

  constructor(apiKey: string, siteId: string) {
    this.apiKey = apiKey;
    this.siteId = siteId;
    this.client = createClient({
      modules: { productsV3, categories, files },
      auth: ApiKeyStrategy({ apiKey, siteId }),
    });
    this.client._wixApiKey = apiKey;
    this.client._wixSiteId = siteId;
  }

  async getSiteProperties(): Promise<WixSiteProperties> {
    try {
      const response = await this.client.fetch(
        'https://www.wixapis.com/site-properties/v4/properties',
      );
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Wix 401: WIX_API_KEY inválida o expirada.');
        }
        if (response.status === 403) {
          throw new Error('Wix 403: la API Key no tiene acceso a Site Properties.');
        }
        throw new Error(`Wix error ${response.status} en site-properties.`);
      }
      const data = await response.json();
      const properties = data?.properties ?? {};
      return {
        currency: properties.paymentCurrency ?? 'USD',
        language: properties.languageCode ?? 'es-ES',
      };
    } catch (err: any) {
      console.warn('[wix] No se pudo leer site-properties, usando fallback:', err.message);
      return { currency: 'USD', language: 'es-ES' };
    }
  }

  // (F7) Subida real a Wix Media — Vía 1a (`files.importFile` por URL): la
  // copia Blob→Wix la hace Wix server-side, sin `fetch`/`File` en el worker.
  // Verificada en el spike F7 (`@wix/media` + `ApiKeyStrategy`). POLÍTICA DE
  // ERROR CONFIRMADA: lanzar. Si la subida falla, el error propaga y el worker
  // reintenta/falla el job (el log queda como rastro forense). NO hay código
  // de fallback a la URL del Blob.
  async uploadImageToMedia(blobUrl: string, title?: string): Promise<string> {
    const filesModule: any = this.client.files;
    if (!filesModule || typeof filesModule.importFile !== 'function') {
      throw new Error(
        '[wix][uploadImageToMedia] Módulo `files` (@wix/media) no disponible. ' +
          'Evaluar Vía 2 (REST media) como alternativa.',
      );
    }
    const displayName = title || fileNameFromUrl(blobUrl);
    const mimeType = mimeTypeFromUrl(blobUrl);
    let importResult: any;
    try {
      importResult = await filesModule.importFile(blobUrl, {
        mediaType: filesModule.MediaType?.IMAGE ?? 'IMAGE',
        displayName,
        mimeType,
      });
    } catch (err: any) {
      throw new Error(`[wix][uploadImageToMedia] importFile falló: ${err?.message ?? err}`);
    }
    const file: any = importResult?.file;
    // El URI canónico `wix:image://v1/...` vive en `file.media.image.image`;
    // `file.url` es un CDN temporal (no el URI que esperan catálogo/tiendas).
    const wixMediaUrl = file?.media?.image?.image ?? file?.url ?? null;
    if (!wixMediaUrl) {
      throw new Error('[wix][uploadImageToMedia] importFile no devolvió wixMediaUrl.');
    }
    return wixMediaUrl;
  }

  // (F3) Catálogo de categorías del sitio (wix.categories.v1.category).
  // Nota: el builder requiere al menos una condición de filtro no vacía; si solo
  // se pasa `treeReference` en options, Wix responde `INVALID_FILTER` ("empty
  // condition"). Se añade `.eq('treeReference.appNamespace', '@wix/stores')`.
  async queryCategories(): Promise<WixCategory[]> {
    try {
      const result = await this.client.categories
        .queryCategories({
          treeReference: { appNamespace: '@wix/stores' },
          returnNonVisibleCategories: true,
        })
        .eq('treeReference.appNamespace', '@wix/stores')
        .find();
      return (result?.items ?? []) as WixCategory[];
    } catch (err: unknown) {
      throw contextualWixError('queryCategories(treeReference=@wix/stores)', err);
    }
  }

  // (F6) Alta de producto CON inventario inicial por REST `fetch` (patrón ya
  // usado en site-properties): Authorization + wix-site-id + JSON.
  // `returnEntity: true` (docs de Wix) hace que la respuesta devuelva las
  // entidades de inventario aplicadas (si no, `inventoryResults` sale vacío).
  async createProductWithInventory(
    payload: ProductWithInventoryPayload,
  ): Promise<ProductWithInventoryResponse> {
    const url = 'https://www.wixapis.com/stores/v3/products-with-inventory';
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: this.apiKey,
          'wix-site-id': this.siteId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...payload, returnEntity: true }),
      });
    } catch (err: any) {
      throw new Error(`[wix][createProductWithInventory] Red: ${err?.message ?? err}`);
    }
    if (!response.ok) {
      // §8.8: nunca loguear el body del payload ni la API key completa.
      let bodyText = '';
      try {
        bodyText = await response.text();
      } catch {
        /* sin body */
      }
      throw new Error(
        `[wix][createProductWithInventory] HTTP ${response.status}: ${bodyText.slice(0, 500)}`,
      );
    }
    const data = (await response.json()) as ProductWithInventoryResponse;
    return data;
  }

  // (F6) Lista de marcas por REST (POST stores/v3/brands/query, sin params).
  async queryBrands(): Promise<WixBrand[]> {
    const url = 'https://www.wixapis.com/stores/v3/brands/query';
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: this.apiKey,
          'wix-site-id': this.siteId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
    } catch (err: any) {
      throw new Error(`[wix][queryBrands] Red: ${err?.message ?? err}`);
    }
    if (!response.ok) {
      let bodyText = '';
      try {
        bodyText = await response.text();
      } catch {
        /* sin body */
      }
      throw new Error(`[wix][queryBrands] HTTP ${response.status}: ${bodyText.slice(0, 500)}`);
    }
    const data = (await response.json()) as any;
    // F6a real: `brands/query` devuelve `{ brands: [{ id, name }] }` (campo `id`, no `_id`).
    const list: Array<{ id?: string; _id?: string; name?: string }> = Array.isArray(data)
      ? data
      : data?.brands ?? [];
    return list
      .filter((b) => (b.id ?? b._id) && b.name)
      .map((b) => ({ _id: (b.id ?? b._id)!, name: b.name! }));
  }
}

/** Deduce el `mimeType` de una imagen por la extensión de su URL (default jpeg). */
function mimeTypeFromUrl(url: string): string {
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

/** Extrae un nombre de archivo legible de una URL (para `displayName` de importFile). */
function fileNameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    const base = path.split('/').filter(Boolean).pop() ?? 'image';
    return (base.split('.')[0] || 'image').slice(0, 100);
  } catch {
    return 'image';
  }
}

/** Envuelve un error de Wix con el nombre de la operación (diagnóstico F3). */
function contextualWixError(op: string, err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  const wrapped = new Error(`[wix][${op}] ${message}`);
  (wrapped as { cause?: unknown }).cause = err;
  console.error(`[wix][${op}] Error:`, message);
  return wrapped;
}

/* ---------------------------------------------------------------------------
 * Singleton
 * ------------------------------------------------------------------------- */

let instance: WixCatalogClient | null = null;

export function getWixClient(): WixCatalogClient {
  if (instance) return instance;
  if (!env.wixApiKey || !env.wixSiteId) {
    throw new Error(
      '[wix] WIX_API_KEY/WIX_SITE_ID no configurados (no hay adaptador mock). ' +
        'Configúralos en Railway o en backend/.env y reinicia el servicio.',
    );
  }
  console.log(
    `[wix][DIAG] Cliente REAL (Catalog V3). siteIdDefinida=${Boolean(env.wixSiteId)}.`,
  );
  instance = new WixClient(env.wixApiKey, env.wixSiteId);
  return instance;
}

export const wixClient = getWixClient();
