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
  /** Identificador comercial detectado (UPC / ASIN / EAN...). */
  commercialId: string | null;
  variants: GeminiVariant[];
  /** JSON-LD schema.org Product + Offer + inLanguage. */
  jsonLd: JsonLdProduct;
}

export interface AnalyzeRequest {
  imageUrls: string[];
  category?: string;
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
  categories: string[];
  currency: string;
  language: string;
  skuPrefix: string;
  gc: GcLimits;
}

export interface SettingsUpdate {
  categories?: string[];
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
