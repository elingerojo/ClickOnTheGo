/**
 * Cliente de Wix Catalog V3 con ADAPTADOR MOCK para la PoC.
 *
 * Misma interfaz que el SDK real (`@wix/stores-catalog` + `@wix/sdk`):
 *   - queryProducts().eq('sku', sku)
 *   - createProduct / updateProduct
 *   - site-properties/v4/properties (moneda e idioma dinámicos)
 *   - wix-media-backend (copia de imágenes)
 *
 * Si faltan `WIX_API_KEY` / `WIX_SITE_ID` (env), se usa el mock
 * (in-memory) para validar el flujo punta a punta sin credenciales reales.
 */
import { randomUUID } from 'node:crypto';
import { createClient, ApiKeyStrategy } from '@wix/sdk';
import { products } from '@wix/stores';
import { env } from './env.js';
import type {
  WixProductPayload,
  WixProductEntity,
  WixSiteProperties,
} from '@click-on-the-go/shared';

export interface WixCatalogClient {
  readonly mode: 'mock' | 'real';
  /** Busca un producto por SKU. Devuelve `null` si no existe. */
  queryBySku(sku: string): Promise<WixProductEntity | null>;
  /** Crea un producto (payload con `product`). */
  createProduct(input: { product: WixProductPayload }): Promise<WixProductEntity>;
  /** Actualiza un producto (exige `revision` para control de concurrencia). */
  updateProduct(
    id: string,
    input: { revision: string | number; product: WixProductPayload },
  ): Promise<WixProductEntity>;
  /** Moneda e idioma del sitio (site-properties v4). */
  getSiteProperties(): Promise<WixSiteProperties>;
  /**
   * Copia una imagen desde Blob staging a wix-media-backend.
   * Devuelve la URL definitiva de Wix Media. En el mock devuelve una URL
   * simulada; en modo real, intenta subir y hace fallback a la URL del Blob.
   */
  uploadImageToMedia(blobUrl: string, title?: string): Promise<string>;
}

/** Error de conflicto de revisión (edición concurrente en el dashboard de Wix). */
export class WixRevisionConflictError extends Error {
  constructor(public readonly sku: string) {
    super(`Conflicto de revisión en Wix para el SKU ${sku}. Re-leer y reintentar.`);
    this.name = 'WixRevisionConflictError';
  }
}

/* ---------------------------------------------------------------------------
 * Adaptador MOCK (PoC) — simula Catalog V3 y wix-media-backend en memoria
 * ------------------------------------------------------------------------- */

class MockWixClient implements WixCatalogClient {
  readonly mode = 'mock' as const;
  private readonly store = new Map<string, WixProductEntity>();
  /** Forzar un conflicto de revisión en el siguiente update (para probar reintentos). */
  private failNextUpdate = false;

  constructor() {
    // Seed de ejemplo para probar el caso UPDATE por SKU
    this.store.set('SKU-12345678', {
      _id: randomUUID(),
      revision: 1,
      sku: 'SKU-12345678',
      name: 'Producto de ejemplo (existe en mock)',
      productOptions: [{ name: 'Talla', choices: [{ value: 'M' }, { value: 'L' }] }],
      variantsInfo: { variants: [] },
      seoData: { tags: [] },
    });
  }

  simulateConflictOnNextUpdate(): void {
    this.failNextUpdate = true;
  }

  async queryBySku(sku: string): Promise<WixProductEntity | null> {
    return this.store.get(sku) ?? null;
  }

  async createProduct(input: { product: WixProductPayload }): Promise<WixProductEntity> {
    const product = input.product;
    if (!product.sku) throw new Error('Mock: falta sku en createProduct');
    const entity: WixProductEntity = {
      _id: randomUUID(),
      revision: 1,
      sku: product.sku,
      name: product.name,
      productOptions: product.productOptions ?? [],
      variantsInfo: product.variantsInfo ?? { variants: [] },
      seoData: product.seoData ?? { tags: [] },
    };
    this.store.set(product.sku, entity);
    return entity;
  }

  async updateProduct(
    id: string,
    input: { revision: string | number; product: WixProductPayload },
  ): Promise<WixProductEntity> {
    const existing = [...this.store.values()].find((e) => e._id === id);
    if (!existing) throw new Error(`Mock: producto ${id} no existe`);
    if (this.failNextUpdate) {
      this.failNextUpdate = false;
      throw new WixRevisionConflictError(existing.sku ?? id);
    }
    if (String(existing.revision) !== String(input.revision)) {
      throw new WixRevisionConflictError(existing.sku ?? id);
    }
    const updated: WixProductEntity = {
      ...existing,
      ...input.product,
      _id: id,
      revision: Number(existing.revision) + 1,
      sku: input.product.sku ?? existing.sku,
    };
    // conservar estructura de variantes
    updated.productOptions = input.product.productOptions ?? existing.productOptions ?? [];
    updated.variantsInfo = input.product.variantsInfo ?? existing.variantsInfo ?? { variants: [] };
    this.store.set(updated.sku!, updated);
    return updated;
  }

  async getSiteProperties(): Promise<WixSiteProperties> {
    return { currency: 'USD', language: 'es-ES' };
  }

  async uploadImageToMedia(_blobUrl: string, title?: string): Promise<string> {
    const hash = randomUUID().replace(/-/g, '').slice(0, 16);
    return `https://mock.wixmedia.example/${hash}/${title ?? 'image'}.jpg`;
  }
}

/* ---------------------------------------------------------------------------
 * Adaptador REAL (MVP) — @wix/sdk + @wix/stores-catalog + site-properties v4
 * ------------------------------------------------------------------------- */

class RealWixClient implements WixCatalogClient {
  readonly mode = 'real' as const;
  private readonly client: any;

  constructor(apiKey: string, siteId: string) {
    this.client = createClient({
      modules: { products },
      auth: ApiKeyStrategy({ apiKey, siteId }),
    });
    this.client._wixApiKey = apiKey;
    this.client._wixSiteId = siteId;
  }

  async queryBySku(sku: string): Promise<WixProductEntity | null> {
    const result = await this.client.products
      .queryProducts()
      .eq('sku', sku)
      .limit(1)
      .find();
    const item = result?.items?.[0];
    return item ? normalizeWixEntity(item) : null;
  }

  async createProduct(input: { product: WixProductPayload }): Promise<WixProductEntity> {
    const result = await this.client.products.createProduct({ product: input.product });
    return normalizeWixEntity(result?.product ?? result);
  }

  async updateProduct(
    id: string,
    input: { revision: string | number; product: WixProductPayload },
  ): Promise<WixProductEntity> {
    try {
      const result = await this.client.products.updateProduct(id, {
        revision: input.revision,
        product: input.product,
      });
      return normalizeWixEntity(result?.product ?? result);
    } catch (err: any) {
      if (isRevisionConflict(err)) {
        throw new WixRevisionConflictError(input.product.sku ?? id);
      }
      throw err;
    }
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

  async uploadImageToMedia(blobUrl: string, _title?: string): Promise<string> {
    // TODO (MVP paso 15 del plan): subida real a wix-media-backend con el
    // módulo `files` de `@wix/media`. Por ahora se conserva la URL staging
    // del Blob como fuente; el ADAPTADOR MOCK ya simula la copia a Wix Media.
    console.warn(
      '[wix] wix-media-backend: subida real pendiente de integrar (MVP). ' +
        'Se conserva la URL staging del Blob.',
    );
    return blobUrl;
  }
}

/** Normaliza la entidad que devuelve el SDK (con/sin envoltorio `product`). */
function normalizeWixEntity(item: any): WixProductEntity {
  return {
    _id: item._id,
    revision: item.revision,
    sku: item.sku,
    name: item.name,
    productOptions: item.productOptions ?? [],
    variantsInfo: item.variantsInfo ?? { variants: [] },
    seoData: item.seoData ?? { tags: [] },
  };
}

/** Detecta un conflicto de revisión en los errores del SDK de Wix. */
function isRevisionConflict(err: any): boolean {
  const msg = String(err?.message ?? '').toLowerCase();
  return (
    msg.includes('revision') ||
    msg.includes('conflict') ||
    err?.details?.applicationError?.code === 'CONCURRENT_MODIFICATION'
  );
}

/* ---------------------------------------------------------------------------
 * Singleton según configuración
 * ------------------------------------------------------------------------- */

let instance: WixCatalogClient | null = null;

export function getWixClient(): WixCatalogClient {
  if (instance) return instance;
  if (env.wixMock || !env.wixApiKey || !env.wixSiteId) {
    console.warn('[wix] Sin WIX_API_KEY/WIX_SITE_ID → usando ADAPTADOR MOCK (PoC).');
    instance = new MockWixClient();
  } else {
    console.log('[wix] Credenciales Wix detectadas → usando cliente REAL (Catalog V3).');
    instance = new RealWixClient(env.wixApiKey!, env.wixSiteId!);
  }
  return instance;
}

/** Útil para tests / debug: fuerza un conflicto de revisión en el mock. */
export function simulateWixConflictForTesting(): void {
  const client = getWixClient();
  if (client instanceof MockWixClient) {
    client.simulateConflictOnNextUpdate();
  }
}

export const wixClient = getWixClient();
