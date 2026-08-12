/**
 * Servicio de SKU — independiente y configurable.
 *
 * - Entrada: identificador comercial detectado por Gemini (UPC/ASIN/EAN).
 * - Salida: concatenación configurable, por defecto `SKU-` + identificador.
 * - Si no hay identificador, cae a una regla de respaldo configurable
 *   ('code' = código aleatorio, 'uuid' = fragmento de UUID).
 * El prefijo se toma de `SKU_PREFIX` (env) o de `settings.skuPrefix`.
 */
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';

const FALLBACK_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function sanitizeId(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.replace(/[^A-Za-z0-9-]/g, '').toUpperCase().slice(0, 40);
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
  if (clean) return `${prefix}${clean}`;
  const fallback = options?.fallback ?? 'code';
  const code =
    fallback === 'uuid'
      ? randomUUID().replace(/-/g, '').toUpperCase().slice(0, 8)
      : randomCode(8);
  return `${prefix}${code}`;
}
