/**
 * @click-on-the-go/shared
 * Contratos de datos compartidos entre frontend (Angular) y backend (Express).
 * Tipos + helpers de runtime sin dependencias (p. ej. `invitationIdentity`).
 */

/* ---------------------------------------------------------------------------
 * Products / Capturas
 * ------------------------------------------------------------------------- */

export type ProductStatus = 'draft' | 'approved' | 'synced' | 'error';

/** Variantes con la forma que espera Wix Catalog V3 para no romper la estructura. */
export interface WixVariants {
  productOptions?: unknown[];
  variantsInfo?: { variants?: unknown[] };
}

/** Marcado schema.org que se inyecta en `seoData.tags` (tipo script / application/ld+json). */
export interface JsonLdProduct {
  '@context': string;
  '@type': 'Product';
  name: string;
  description?: string;
  sku?: string;
  mpn?: string;
  image?: string[];
  inLanguage?: string;
  offers?: {
    '@type': 'Offer';
    price?: string;
    priceCurrency?: string;
    availability?: string;
    url?: string;
  };
  [key: string]: unknown;
}

export interface ProductCapture {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  price: number | null;
  currency: string;
  category: string | null;
  /** Marca de Wix elegida/preseleccionada (nombre, resuelto a `brand: { id }` en el alta). */
  brand: string | null;
  variants: WixVariants | null;
  jsonLd: JsonLdProduct | null;
  imageUrls: string[];
  status: ProductStatus;
  wixProductId: string | null;
  wixRevision: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Payload del frontend al crear/actualizar una captura (borrador). */
export interface ProductDraftInput {
  name: string;
  description?: string;
  price?: number | null;
  currency?: string;
  category?: string | null;
  brand?: string | null;
  commercialId?: string | null;
  imageUrls?: string[];
  variants?: WixVariants | null;
  jsonLd?: JsonLdProduct | null;
}

/* ---------------------------------------------------------------------------
 * Gemini / Análisis
 * ------------------------------------------------------------------------- */

export interface GeminiVariant {
  name?: string;
  value?: string;
  price?: number;
  sku?: string;
}

/** JSON base integrado que Gemini devuelve (validado con Zod en la frontera A). */
export interface GeminiProductResult {
  name: string;
  description: string;
  price: number | null;
  currency: string;
  category: string | null;
  /** Marca de Wix sugerida por Gemini (nombre de la lista disponible; null si no aplica). */
  brand?: string | null;
  /** Identificador comercial detectado (UPC / ASIN / EAN...). */
  commercialId: string | null;
  variants: GeminiVariant[];
  /** JSON-LD schema.org Product + Offer + inLanguage. */
  jsonLd: JsonLdProduct;
}

export interface AnalyzeRequest {
  imageUrls: string[];
  category?: string;
  /** Marca de Wix elegida/preseleccionada por el usuario (nombre). */
  brand?: string;
}

export interface AnalyzeResponse {
  product: GeminiProductResult;
  /** Errores por campo (clave = campo) para marcar en el formulario qué corregir. */
  fieldErrors?: Record<string, string>;
}

/* ---------------------------------------------------------------------------
 * Upload (Vercel Blob)
 * ------------------------------------------------------------------------- */

export interface UploadTokenResponse {
  url: string;
  downloadUrl: string;
  pathname: string;
  contentType?: string;
  contentDisposition?: string;
}

export interface AnalyzeErrorResponse {
  error: string;
  fieldErrors?: Record<string, string>;
}

/* ---------------------------------------------------------------------------
 * Jobs (cola productor-consumidor)
 * ------------------------------------------------------------------------- */

export type JobState = 'pending' | 'processing' | 'success' | 'error';

export interface Job {
  id: string;
  productId: string;
  product: ProductCapture | null;
  state: JobState;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RetryResponse {
  job: Job;
}

/* ---------------------------------------------------------------------------
 * Dispositivos / Auth
 * ------------------------------------------------------------------------- */

export interface Device {
  id: string;
  name: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface OneTimeTokenResponse {
  token: string;
  link: string;
  /** Cantidad de dispositivos autenticados actualmente. */
  devicesActive: number;
}

export interface ExchangeResponse {
  deviceToken: string;
  deviceId: string;
  deviceName?: string;
}

/** Respuesta de GET /api/auth/validate: confirma si un device token sigue siendo válido. */
export interface ValidateTokenResponse {
  valid: boolean;
  device?: { id: string; name: string | null };
}

export interface CreateDeviceInput {
  name?: string;
}

/** Identidad humana de una invitación (1 palabra + 1 emoji, diccionario de 20). */
export interface InvitationIdentity {
  word: string;
  emoji: string;
}

/** Respuesta de GET /api/devices/me/invitation: la invitación activa del device. */
export interface InvitationResponse {
  token: string;
  word: string;
  emoji: string;
}

/** Diccionario de 20 entradas (palabra → emoji) para el identificador humano. */
const INVITATION_DICTIONARY: ReadonlyArray<{ word: string; emoji: string }> = [
  { word: 'tigre', emoji: '🐯' },
  { word: 'luna', emoji: '🌙' },
  { word: 'sopa', emoji: '🍲' },
  { word: 'lluvia', emoji: '🌧️' },
  { word: 'león', emoji: '🦁' },
  { word: 'pan', emoji: '🍞' },
  { word: 'sol', emoji: '☀️' },
  { word: 'gato', emoji: '🐱' },
  { word: 'estrella', emoji: '⭐' },
  { word: 'casa', emoji: '🏠' },
  { word: 'mar', emoji: '🌊' },
  { word: 'árbol', emoji: '🌳' },
  { word: 'nube', emoji: '☁️' },
  { word: 'pájaro', emoji: '🐦' },
  { word: 'rana', emoji: '🐸' },
  { word: 'manzana', emoji: '🍎' },
  { word: 'rayo', emoji: '⚡' },
  { word: 'flor', emoji: '🌸' },
  { word: 'perro', emoji: '🐶' },
  { word: 'montaña', emoji: '⛰️' },
];

/**
 * Deriva de forma determinista la identidad (1 palabra + 1 emoji) de un token de
 * invitación usando un hash FNV-1a de 32 bits. Es un fingerprint VISUAL: no revela
 * el token; sirve para que dos humanos comparen "la misma invitación" por teléfono.
 */
export function invitationIdentity(token: string): InvitationIdentity {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return INVITATION_DICTIONARY[Math.abs(hash) % INVITATION_DICTIONARY.length];
}

/* ---------------------------------------------------------------------------
 * Settings
 * ------------------------------------------------------------------------- */

export interface GcLimits {
  /** Guardado OK en Wix → borrar Blob después de N días. */
  blobOkDays: number;
  /** Guardado OK en Wix → borrar registro Neon después de N días. */
  neonOkDays: number;
  /** No sincronizado → borrar Blob después de N días. */
  blobNotOkDays: number;
  /** No sincronizado → borrar registro Neon después de N días. */
  neonNotOkDays: number;
  /** Catch-all / seguridad → cualquier registro. */
  allDays: number;
  /** Excluir jobs pending/processing. */
  skipActiveJobs: boolean;
}

export interface AppSettings {
  /** Stock inicial con el que se da de alta un producto en Wix (inventario). */
  defaultQuantity?: number;
  /** Publicar el producto (visible) al darlo de alta en Wix. Default: true. */
  visible?: boolean;
  /** Enviar la categoría elegida a Gemini como referencia (toggle). Default: false. */
  sendCategoryToGemini?: boolean;
  /** Enviar la marca elegida a Gemini como referencia (toggle). Default: false. */
  sendBrandToGemini?: boolean;
  currency: string;
  language: string;
  skuPrefix: string;
  gc: GcLimits;
}

export interface SettingsUpdate {
  defaultQuantity?: number;
  visible?: boolean;
  sendCategoryToGemini?: boolean;
  sendBrandToGemini?: boolean;
  currency?: string;
  language?: string;
  skuPrefix?: string;
  gc?: Partial<GcLimits>;
}

/* ---------------------------------------------------------------------------
 * Wix Catalog V3 (payloads)
 * ------------------------------------------------------------------------- */

export interface WixProductPayload {
  name: string;
  sku?: string;
  description?: string;
  productType?: 'physical' | 'digital';
  visible?: boolean;
  priceData?: { price?: number; currency?: string };
  media?: { mediaItems?: Array<{ url?: string; title?: string }> };
  manageVariants?: boolean;
  productOptions?: unknown[];
  variantsInfo?: { variants?: unknown[] };
  seoData?: { tags?: unknown[] };
}

export interface WixProductEntity {
  _id: string;
  revision: string | number;
  sku?: string;
  name?: string;
  productOptions?: unknown[];
  variantsInfo?: { variants?: unknown[] };
  seoData?: { tags?: unknown[] };
}

export interface WixSiteProperties {
  currency: string;
  language: string;
}

/* ---------------------------------------------------------------------------
 * Wix Catalog V3 (alta con inventario) — stores/v3/products-with-inventory
 * ------------------------------------------------------------------------- */

/** Precio de la variante de producto — `actualPrice` es un objeto con `amount`
 * (string decimal) y `currency`. Validado en F6a real: `price.actualPrice` como
 * string → HTTP 400 "Expected an object"; `actualPrice.amount` es obligatorio.
 */
export interface ProductVariantPrice {
  actualPrice: { amount: string; currency?: string };
}

/** Variante base del producto (mapeo de `variantsInfo.variants`).
 * `choices` es un ARRAY de `{ optionName, value }` — validado en F6a real:
 * un objeto `{}` da HTTP 400 "Expected an array for field choices".
 * `inventoryItem` DENTRO de la variante crea el inventory item (cantidad) en la
 * MISMA llamada (docs de Wix + F6a real): si no se envía, no se crea inventario
 * y el producto queda OUT_OF_STOCK. Campo `trackQuantity` (no `trackInventory`).
 */
export interface ProductWithInventoryVariant {
  choices?: Array<{ optionName?: string; value?: string }>;
  price: ProductVariantPrice;
  inventoryItem?: { trackQuantity: boolean; quantity: number };
}

/** Contrato del body de `POST /stores/v3/products-with-inventory` (Catalog V3). */
export interface ProductWithInventoryPayload {
  product: {
    name: string;
    productType: 'PHYSICAL';
    physicalProperties: { sku: string; weight?: number };
    visible: boolean;
    brand?: { id: string };
    tags: { privateTag: { tagIds: string[] } };
    variantsInfo: {
      variants: ProductWithInventoryVariant[];
    };
    // De bajo costo/beneficio; se incluyen si el spike F6a confirma que el
    // endpoint los acepta sin costo. `description` es un OBJETO (validado en
    // F6a real: un string da HTTP 400 "Expected an object").
    description?: { text?: string; plainText?: string; richText?: string };
    media?: { mediaItems?: Array<{ url?: string; title?: string }> };
    seoData?: { tags?: unknown[] };
  };
  /** Devuelve las entidades de inventario en la respuesta (docs: default false). */
  returnEntity?: boolean;
}

/** Contrato de la respuesta de `POST /stores/v3/products-with-inventory`. */
export interface ProductWithInventoryResponse {
  product: { id: string; revision?: string | number; [k: string]: unknown };
  /** Aplicación de inventario por variante (F6a real: `inventoryResults.results`). */
  inventoryResults?: { results?: Array<Record<string, unknown>> };
  inventoryOptions?: { variants?: Array<{ inventoryOptions?: { quantity?: number } }> };
}

/** Inventory item de Wix (módulo inventory-items-v3): entidad donde vive la CANTIDAD real.
 * `products-with-inventory` NO la crea; hay que crearla aparte con `createInventoryItem`.
 */
export interface WixInventoryItem {
  id: string;
  productId: string;
  variantId: string;
  locationId?: string;
  quantity?: number;
  trackQuantity?: boolean;
  inStock?: boolean;
  availabilityStatus?: string;
  [k: string]: unknown;
}

/** Marca de Wix (GET/POST stores/v3/brands) para el selector y el alta `brand: { id }`. */
export interface WixBrand {
  _id: string;
  name: string;
}

/** Opción de categoría para el frontend (id + nombre) — `Pick<WixCategory, '_id' | 'name'>`. */
export type CategoryOption = Pick<WixCategory, '_id' | 'name'>;

/* ---------------------------------------------------------------------------
 * Wix Catalog V3 (lectura) — Modelos de Referencia (F3)
 * ------------------------------------------------------------------------- */

/** Categoría referenciada por un producto Catalog V3 (allCategoriesInfo / directCategoriesInfo). */
export interface WixCategoryInfo {
  /** ID de la categoría en el catálogo de categorías de Wix (wix.categories.v1.category). */
  _id?: string | null;
  /** Índice/orden de la categoría dentro de la lista del producto. */
  index?: number | null;
}

/**
 * Producto de Wix Stores Catalog V3 tal como lo devuelve el SDK real.
 * Incluye la info de categorías que F3 necesita (`allCategoriesInfo`,
 * `directCategoriesInfo`, `mainCategoryId`) y los campos base de la extracción
 * de schema (`productOptions`, `variantsInfo`, `discount`, `media`).
 * Se mantiene flexible (`[key: string]: unknown`) para no perder campos que el
 * spike F0 debe verificar.
 */
export interface WixCatalogProduct {
  _id?: string | null;
  revision?: string | null;
  sku?: string | null;
  name?: string | null;
  description?: string | null;
  /** Lista de TODAS las categorías del producto (ancestros incluidos). */
  allCategoriesInfo?: { categories?: WixCategoryInfo[] } | null;
  /** Lista de categorías DIRECTAS del producto. */
  directCategoriesInfo?: { categories?: WixCategoryInfo[] } | null;
  /** Categoría principal que define la estructura del schema (default de ronda). */
  mainCategoryId?: string | null;
  productOptions?: unknown[];
  variantsInfo?: unknown;
  discount?: unknown;
  media?: unknown;
  [key: string]: unknown;
}

/** Categoría del catálogo de categorías de Wix (wix.categories.v1.category). */
export interface WixCategory {
  _id?: string | null;
  name?: string | null;
  /** Referencia a la categoría padre (jerarquía). */
  parentCategory?: { id?: string | null } | null;
  [key: string]: unknown;
}

/* ---------------------------------------------------------------------------
 * SSE
 * ------------------------------------------------------------------------- */

export interface GcResult {
  scanned: number;
  deletedBlobs: number;
  deletedNeon: number;
  skippedActive: number;
  details: Array<{
    productId: string;
    sku: string;
    blobDeleted: boolean;
    neonDeleted: boolean;
    reason: string;
  }>;
}

/**
 * Payload del evento SSE `invitation:used`: el backend difunde el token de un
 * solo uso que acaba de canjearse. Cada dispositivo conectado compara ese token
 * con el de su propia invitación estacionada; el que coincide regenera la suya.
 * No lleva `deviceId` ni identidad del nuevo dispositivo: la decisión es local.
 */
export interface InvitationUsedEvent {
  /** Token de un solo uso que acaba de usarse (ya no es válido). */
  token: string;
}

export type SseEvent =
  | { type: 'job:state'; data: Job }
  | { type: 'product:updated'; data: ProductCapture }
  | { type: 'gc:done'; data: GcResult }
  | { type: 'invitation:used'; data: InvitationUsedEvent };
