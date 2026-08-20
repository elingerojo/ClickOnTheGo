/**
 * Cliente de Wix Catalog V3 con ADAPTADOR MOCK para la PoC.
 *
 * Misma interfaz que el SDK real (`@wix/stores-catalog` + `@wix/sdk`):
 *   - stores/v3/products-with-inventory (alta con inventario, create-only)
 *   - site-properties/v4/properties (moneda e idioma dinámicos)
 *   - wix-media-backend (copia de imágenes)
 *   - Stores Catalog V3 (lectura de productos/categorías, F0/F3)
 *
 * Si faltan `WIX_API_KEY` / `WIX_SITE_ID` (env), se usa el mock
 * (in-memory) para validar el flujo punta a punta sin credenciales reales.
 */
import { randomUUID } from 'node:crypto';
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
  WixCatalogProduct,
  WixProductEntity,
  WixSiteProperties,
} from '@click-on-the-go/shared';

export interface WixCatalogClient {
  readonly mode: 'mock' | 'real';
  /** Moneda e idioma del sitio (site-properties v4). */
  getSiteProperties(): Promise<WixSiteProperties>;
  /**
   * Importa una imagen desde Blob staging a Wix Media (Media Manager) por URL
   * (`files.importFile` de `@wix/media`; copia Blob→Wix server-side, sin byte
   * streaming) y devuelve la URL canónica `wix:image://v1/...` que esperan las
   * APIs de catálogo/tiendas. En el mock devuelve una URL simulada.
   * POLÍTICA DE ERROR (F7, confirmada): LANZA si la subida falla — no hay
   * fallback a la URL del Blob; el error propaga y el worker reintenta/falla
   * el job (el log queda como rastro forense).
   */
  uploadImageToMedia(blobUrl: string, title?: string): Promise<string>;
  /**
   * (F3/F0) Lee un producto de Stores Catalog V3 por ID. Incluye
   * `allCategoriesInfo` / `directCategoriesInfo` / `mainCategoryId`.
   * (F0b) `opts.fields` incluye campos OPCIONALES adicionales (enum
   * `RequestedFields`, p. ej. `ALL_CATEGORIES_INFO` / `DIRECT_CATEGORIES_INFO` /
   * `DESCRIPTION` / `DISCOUNT_INFO`); los campos regulares siempre se devuelven.
   */
  readProductV3(id: string, opts?: { fields?: string[] }): Promise<WixCatalogProduct | null>;
  /**
   * (F3/F0) Lista productos de Stores Catalog V3 (paginado por cursor).
   * Devuelve la primera página y si hay más (`hasMore`).
   * (F0b) `opts.fields` incluye campos OPCIONALES adicionales (enum
   * `RequestedFields`) en la lista.
   */
  queryProductsV3(opts?: { limit?: number; fields?: string[] }): Promise<{ products: WixCatalogProduct[]; hasMore: boolean }>;
  /** (F3/F0) Lista las categorías del catálogo del sitio (wix.categories.v1.category). */
  queryCategories(): Promise<WixCategory[]>;
  /**
   * (F0b) Lee una categoría por ID (wix.categories.v1.category).
   * `opts.fields` incluye campos OPCIONALES adicionales (enum de categorías:
   * `DESCRIPTION` / `RICH_CONTENT_DESCRIPTION` / `BREADCRUMBS_INFO`).
   */
  readCategoryV3(id: string, opts?: { fields?: string[] }): Promise<WixCategory | null>;
  /** (F6) Alta de producto CON inventario inicial (stores/v3/products-with-inventory). */
  createProductWithInventory(
    payload: ProductWithInventoryPayload,
  ): Promise<ProductWithInventoryResponse>;
  /** (F6) Lista de marcas del sitio (REST POST /stores/v3/brands/query, sin params). */
  queryBrands(): Promise<WixBrand[]>;
}

/* ---------------------------------------------------------------------------
 * Adaptador MOCK (PoC) — simula Catalog V3 y wix-media-backend en memoria
 * ------------------------------------------------------------------------- */

class MockWixClient implements WixCatalogClient {
  readonly mode = 'mock' as const;
  private readonly store = new Map<string, WixProductEntity>();

  async createProductWithInventory(
    payload: ProductWithInventoryPayload,
  ): Promise<ProductWithInventoryResponse> {
    const sku = payload.product.physicalProperties.sku;
    if (!sku) throw new Error('Mock: falta sku en createProductWithInventory');
    if (this.store.has(sku)) {
      // Duplicado de SKU → 409 simulado; el error PROPAGA (create-only) y el
      // worker reintenta/falla el job visiblemente.
      const err: any = new Error(`Wix 409: producto con SKU "${sku}" ya existe.`);
      err.status = 409;
      throw err;
    }
    const product = payload.product;
    const entity: WixProductEntity = {
      _id: randomUUID(),
      revision: 1,
      sku,
      name: product.name,
      productOptions: [],
      variantsInfo: product.variantsInfo ?? { variants: [] },
      seoData: product.seoData ?? { tags: [] },
    };
    this.store.set(sku, entity);
    const inv = product.variantsInfo?.variants?.[0]?.inventoryItem;
    return {
      product: { id: entity._id, revision: entity.revision },
      inventoryResults: {
        results: inv
          ? [
              {
                itemMetadata: { id: randomUUID(), originalIndex: 0, success: true },
                item: {
                  id: randomUUID(),
                  productId: entity._id,
                  variantId: randomUUID(),
                  quantity: inv.quantity,
                  trackQuantity: inv.trackQuantity,
                  availabilityStatus: 'IN_STOCK',
                },
              },
            ]
          : [],
      },
    };
  }

  async queryBrands(): Promise<WixBrand[]> {
    return [
      { _id: 'mock-brand-1', name: 'Nike' },
      { _id: 'mock-brand-2', name: 'Adidas' },
      { _id: 'mock-brand-3', name: 'Puma' },
    ];
  }

  async getSiteProperties(): Promise<WixSiteProperties> {
    return { currency: 'USD', language: 'es-ES' };
  }

  async uploadImageToMedia(_blobUrl: string, title?: string): Promise<string> {
    const hash = randomUUID().replace(/-/g, '').slice(0, 16);
    return `https://mock.wixmedia.example/${hash}/${title ?? 'image'}.jpg`;
  }

  // (F0) Stubs: el spike usa SIEMPRE el cliente real, no se mockea la lectura.
  async readProductV3(_id: string, _opts?: { fields?: string[] }): Promise<WixCatalogProduct | null> {
    console.warn('[wix] mock: readProductV3 no implementado (F0 usa cliente real).');
    return null;
  }

  async queryProductsV3(_opts?: { limit?: number; fields?: string[] }): Promise<{ products: WixCatalogProduct[]; hasMore: boolean }> {
    console.warn('[wix] mock: queryProductsV3 no implementado (F0 usa cliente real).');
    return { products: [], hasMore: false };
  }

  async queryCategories(): Promise<WixCategory[]> {
    return [
      { _id: 'mock-cat-1', name: 'Ropa' },
      { _id: 'mock-cat-2', name: 'Calzado' },
      { _id: 'mock-cat-3', name: 'Accesorios' },
    ];
  }

  async readCategoryV3(_id: string, _opts?: { fields?: string[] }): Promise<WixCategory | null> {
    console.warn('[wix] mock: readCategoryV3 no implementado (F0 usa cliente real).');
    return null;
  }

}

/* ---------------------------------------------------------------------------
 * Adaptador REAL (MVP) — @wix/sdk + @wix/stores-catalog + site-properties v4
 * ------------------------------------------------------------------------- */

class RealWixClient implements WixCatalogClient {
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

  // (F3/F0) Lectura real de Stores Catalog V3 con info de categorías.
  // Nota: `productsV3.getProduct` recibe el `productId` como argumento posicional.
  // (F0b) `opts.fields` incluye campos OPCIONALES adicionales (enum RequestedFields).
  async readProductV3(id: string, opts?: { fields?: string[] }): Promise<WixCatalogProduct | null> {
    try {
      const res = await this.client.productsV3.getProduct(
        id,
        opts?.fields ? { fields: opts.fields } : undefined,
      );
      const product = (res as any)?.product ?? res;
      return product ? (product as WixCatalogProduct) : null;
    } catch (err: unknown) {
      throw contextualWixError('readProductV3', err);
    }
  }

  // (F3/F0) Paginado por cursor: devuelve la primera página y si hay más.
  // (F0b) `opts.fields` incluye campos OPCIONALES adicionales (enum RequestedFields).
  async queryProductsV3(opts?: { limit?: number; fields?: string[] }): Promise<{ products: WixCatalogProduct[]; hasMore: boolean }> {
    const limit = opts?.limit ?? 20;
    try {
      const result = await this.client.productsV3
        .queryProducts(opts?.fields ? { fields: opts.fields } : undefined)
        .limit(limit)
        .find();
      const items = (result?.items ?? []) as WixCatalogProduct[];
      return { products: items, hasMore: Boolean(result?.hasNext?.()) };
    } catch (err: unknown) {
      throw contextualWixError(`queryProductsV3(limit=${limit})`, err);
    }
  }

  // (F3/F0) Catálogo de categorías del sitio (wix.categories.v1.category).
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

  // (F0b) Lectura de una categoría por ID (wix.categories.v1.category).
  // `categories.getCategory(id, treeReference, options?)` exige `treeReference`.
  // (F0b) `opts.fields` incluye campos OPCIONALES adicionales (enum de categorías).
  async readCategoryV3(id: string, opts?: { fields?: string[] }): Promise<WixCategory | null> {
    try {
      const res = await this.client.categories.getCategory(
        id,
        { appNamespace: '@wix/stores' },
        opts?.fields ? { fields: opts.fields } : undefined,
      );
      const category = (res as any)?.category ?? res;
      return category ? (category as WixCategory) : null;
    } catch (err: unknown) {
      throw contextualWixError('readCategoryV3', err);
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
  // Shape a confirmar en F6a; se acepta `{ brands: [] }` o un arreglo directo.
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

/** Envuelve un error de Wix con el nombre de la operación (diagnóstico F0/F3). */
function contextualWixError(op: string, err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  const wrapped = new Error(`[wix][${op}] ${message}`);
  (wrapped as { cause?: unknown }).cause = err;
  console.error(`[wix][${op}] Error:`, message);
  return wrapped;
}

/* ---------------------------------------------------------------------------
 * Singleton según configuración
 * ------------------------------------------------------------------------- */

let instance: WixCatalogClient | null = null;

export function getWixClient(): WixCatalogClient {
  if (instance) return instance;
  const hasApiKey = Boolean(env.wixApiKey);
  const hasSiteId = Boolean(env.wixSiteId);
  if (env.wixMock || !hasApiKey || !hasSiteId) {
    console.warn(
      `[wix][DIAG] ADAPTADOR MOCK en uso (PoC). apiKeyDefinida=${hasApiKey}, siteIdDefinida=${hasSiteId}. ` +
        'Revisa WIX_API_KEY/WIX_SITE_ID en Railway y REINICIA el servicio.',
    );
    instance = new MockWixClient();
  } else {
    console.log(
      `[wix][DIAG] Cliente REAL (Catalog V3). apiKeyDefinida=${hasApiKey}, siteIdDefinida=${hasSiteId}.`,
    );
    instance = new RealWixClient(env.wixApiKey!, env.wixSiteId!);
  }
  return instance;
}

export const wixClient = getWixClient();
