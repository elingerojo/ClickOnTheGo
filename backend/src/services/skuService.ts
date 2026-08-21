/**
 * Servicio de SKU — independiente y configurable.
 *
 * - Entrada primaria: `skuSuggestion` de Gemini (modelo o identificador popular
 *   del producto dentro de su marca/categoría).
 * - Entrada de respaldo: el código de barras del producto (`barcode`).
 * - Salida: concatenación configurable, por defecto `SKU-` + valor.
 * - Si no hay ningún valor, cae a una regla de respaldo configurable
 *   ('code' = código aleatorio, 'uuid' = fragmento de UUID).
 * El prefijo se toma de `SKU_PREFIX` (env) o de `settings.skuPrefix`.
 *
 * (A2) El SKU se limita a 40 caracteres: Wix Stores Catalog V3 define el campo
 * `sku` de la variante (VariantWithInventory) con `minLength 1 / maxLength 40`.
 *
 * (B2) También expone `sanitizeGtin`: normaliza y valida un código de barras
 * GTIN (UPC-A=12, EAN-13=13, EAN-8=8, GTIN-14=14) con el checksum GS1 de
 * pesos alternos ×1/×3 (mod-10).
 * Gemini puede alucinar un GTIN; aquí se descarta cualquier valor inválido y
 * el barcode en Wix se trata como OPCIONAL (nunca se fuerza un dato falso).
 *
 * (C2) `sanitizeBarcode` resuelve el código de barras ÚNICO del producto con
 * prioridad GTIN > UPC > ASIN: si hay un GTIN válido (longitud + Luhn) se usan
 * los dígitos (UPC-A = GTIN-12); si no, un ASIN (10 alfanuméricos, empieza por
 * 'B') como último caso; cualquier otro valor se descarta.
 */
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';

const FALLBACK_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Longitud máxima del SKU (Wix: maxLength 40). */
const MAX_SKU_LENGTH = 40;

/** Longitudes de GTIN válidas: UPC-A (12), EAN-13 (13), EAN-8 (8), GTIN-14 (14). */
const GTIN_LENGTHS = new Set([8, 12, 13, 14]);

export function sanitizeId(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.replace(/[^A-Za-z0-9-]/g, '').toUpperCase().slice(0, MAX_SKU_LENGTH);
}

export function randomCode(length = 8): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += FALLBACK_CHARS[b % FALLBACK_CHARS.length];
  return out;
}

export interface SkuBuildOptions {
  prefix?: string;
  /** Regla de respaldo cuando no hay identificador comercial. */
  fallback?: 'code' | 'uuid';
}

/**
 * Construye el SKU del producto.
 *
 * - `primary`: sugerencia de Gemini (modelo/identificador popular) — se usa
 *   primero.
 * - `fallback`: código de barras del producto — se usa si `primary` está vacío.
 * - Si ambos están vacíos, cae a una regla de respaldo (código aleatorio o UUID).
 */
export function buildSku(
  primary: string | null | undefined,
  fallback: string | null | undefined,
  options?: SkuBuildOptions,
): string {
  const prefix = options?.prefix ?? env.skuPrefix;
  const clean = sanitizeId(primary) || sanitizeId(fallback);
  if (clean) return `${prefix}${clean}`.slice(0, MAX_SKU_LENGTH);
  const rule = options?.fallback ?? 'code';
  const code =
    rule === 'uuid'
      ? randomUUID().replace(/-/g, '').toUpperCase().slice(0, 8)
      : randomCode(8);
  return `${prefix}${code}`.slice(0, MAX_SKU_LENGTH);
}

/**
 * Checksum GS1 de los GTIN/UPC/EAN (mod-10 con pesos alternos): se recorre de
 * derecha a izquierda asignando peso 1 al dígito verificador (el último) y
 * alternando ×1/×3 hacia la izquierda; la suma debe ser múltiplo de 10.
 * NOTA: NO es el "Luhn" de tarjetas/IMEI (doblar con reducción de dígitos);
 * ese algoritmo rechaza GTIN válidos (p. ej. 7501005129947 o 9780306406157).
 */
function gtinChecksum(digits: string): boolean {
  let sum = 0;
  let weight = 1; // el dígito verificador (último) tiene peso 1
  for (let i = digits.length - 1; i >= 0; i--) {
    const ch = digits.charCodeAt(i);
    if (ch < 48 || ch > 57) return false;
    sum += (ch - 48) * weight;
    weight = weight === 1 ? 3 : 1;
  }
  return sum % 10 === 0;
}

/**
 * Normaliza y valida un GTIN (código de barras). Devuelve los dígitos si pasan
 * longitud + checksum GS1; `null` si está vacío o no es un GTIN válido.
 * OPCIONAL por diseño: si Gemini alucina un valor, aquí se descarta.
 */
export function sanitizeGtin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!GTIN_LENGTHS.has(digits.length)) return null;
  return gtinChecksum(digits) ? digits : null;
}

/**
 * Resuelve el código de barras ÚNICO del producto con prioridad GTIN > UPC > ASIN.
 * - GTIN/UPC: dígitos con longitud válida (8/12/13/14) y checksum GS1 → dígitos
 *   (UPC-A es un GTIN-12, así que cubre tanto GTIN como UPC).
 * - ASIN: último caso, solo si no hay GTIN válido (10 alfanuméricos que empiezan
 *   por 'B', formato de Amazon).
 * - Cualquier otro valor se descarta → null.
 *
 * NOTA: el valor resuelto es el barcode asignado al producto (se persiste); a
 * Wix solo se envía como `barcode` si es un GTIN válido (ver `sanitizeGtin`).
 */
export function sanitizeBarcode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (GTIN_LENGTHS.has(digits.length) && gtinChecksum(digits)) return digits;
  const trimmed = raw.trim().toUpperCase();
  if (/^B[A-Z0-9]{9}$/.test(trimmed)) return trimmed;
  return null;
}
