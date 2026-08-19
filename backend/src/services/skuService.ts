/**
 * Servicio de SKU — independiente y configurable.
 *
 * - Entrada: identificador comercial detectado por Gemini (UPC/ASIN/EAN).
 * - Salida: concatenación configurable, por defecto `SKU-` + identificador.
 * - Si no hay identificador, cae a una regla de respaldo configurable
 *   ('code' = código aleatorio, 'uuid' = fragmento de UUID).
 * El prefijo se toma de `SKU_PREFIX` (env) o de `settings.skuPrefix`.
 *
 * (A2) El SKU se limita a 40 caracteres: Wix Stores Catalog V3 define el campo
 * `sku` de la variante (VariantWithInventory) con `minLength 1 / maxLength 40`.
 *
 * (B2) También expone `sanitizeGtin`: normaliza y valida un código de barras
 * GTIN (UPC-A=12, EAN-13=13, EAN-8=8, GTIN-14=14) con checksum Luhn mod-10.
 * Gemini puede alucinar un GTIN; aquí se descarta cualquier valor inválido y
 * el barcode en Wix se trata como OPCIONAL (nunca se fuerza un dato falso).
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

export function buildSku(
  commercialId: string | null | undefined,
  options?: SkuBuildOptions,
): string {
  const prefix = options?.prefix ?? env.skuPrefix;
  const clean = sanitizeId(commercialId);
  if (clean) return `${prefix}${clean}`.slice(0, MAX_SKU_LENGTH);
  const fallback = options?.fallback ?? 'code';
  const code =
    fallback === 'uuid'
      ? randomUUID().replace(/-/g, '').toUpperCase().slice(0, 8)
      : randomCode(8);
  return `${prefix}${code}`.slice(0, MAX_SKU_LENGTH);
}

/**
 * Validación Luhn mod-10 sobre la cadena completa de dígitos (incluye el dígito
 * verificador, que es el último). Es el estándar de los GTIN/UPC/EAN.
 */
function luhnCheck(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    const ch = digits.charCodeAt(i);
    if (ch < 48 || ch > 57) return false;
    let d = ch - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Normaliza y valida un GTIN (código de barras). Devuelve los dígitos si pasan
 * longitud + checksum Luhn; `null` si está vacío o no es un GTIN válido.
 * OPCIONAL por diseño: si Gemini alucina un valor, aquí se descarta.
 */
export function sanitizeGtin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (!GTIN_LENGTHS.has(digits.length)) return null;
  return luhnCheck(digits) ? digits : null;
}
