/**
 * Acceso tipado y centralizado a las variables de entorno.
 * Se lee DESPUÉS de `loadEnvFile()` (llamado en `index.ts` / scripts).
 */
import type { PoolConfig } from 'pg';

export function boolFromEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function numberFromEnv(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export const env = {
  get port(): number {
    return numberFromEnv(process.env.PORT, 4000);
  },

  get nodeEnv(): string {
    return process.env.NODE_ENV ?? 'development';
  },

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  },

  get geminiApiKey(): string | undefined {
    return process.env.GEMINI_API_KEY;
  },

  get blobReadWriteToken(): string | undefined {
    return process.env.BLOB_READ_WRITE_TOKEN;
  },

  get wixApiKey(): string | undefined {
    return process.env.WIX_API_KEY;
  },

  get wixSiteId(): string | undefined {
    return process.env.WIX_SITE_ID;
  },

  get adminToken(): string | undefined {
    return process.env.ADMIN_TOKEN;
  },

  get skuPrefix(): string {
    return process.env.SKU_PREFIX ?? 'SKU-';
  },

  get appBaseUrl(): string {
    return process.env.APP_BASE_URL ?? 'http://localhost:4200';
  },

  /** Días de validez de una invitación QR (caducidad dura en el exchange). Default: 7. */
  get invitationTtlDays(): number {
    return numberFromEnv(process.env.INVITATION_TTL_DAYS, 7);
  },

  get backendPublicUrl(): string {
    return process.env.BACKEND_PUBLIC_URL ?? `http://localhost:${this.port}`;
  },

  /** Configuración del pool `pg`. Soporta DATABASE_URL o variables individuales. */
  get poolConfig(): PoolConfig {
    if (process.env.DATABASE_URL) {
      return {
        connectionString: process.env.DATABASE_URL,
        max: 10,
        ssl: boolFromEnv(process.env.DATABASE_SSL, true)
          ? { rejectUnauthorized: false }
          : undefined,
      };
    }
    return {
      host: process.env.DATABASE_HOST ?? 'localhost',
      port: numberFromEnv(process.env.DATABASE_PORT, 5432),
      database: process.env.DATABASE_NAME ?? 'clickonthego',
      user: process.env.DATABASE_USERNAME ?? 'postgres',
      password: process.env.DATABASE_PASSWORD ?? '',
      max: 10,
      ssl: boolFromEnv(process.env.DATABASE_SSL, false)
        ? { rejectUnauthorized: false }
        : undefined,
    };
  },
};

/** Lanza un error claro si faltan variables obligatorias (incluidas las de Wix). */
export function assertRequiredEnv(): void {
  const missing: string[] = [];
  if (!env.geminiApiKey) missing.push('GEMINI_API_KEY');
  if (!env.blobReadWriteToken) missing.push('BLOB_READ_WRITE_TOKEN');
  if (!env.adminToken) missing.push('ADMIN_TOKEN');
  if (!env.wixApiKey) missing.push('WIX_API_KEY');
  if (!env.wixSiteId) missing.push('WIX_SITE_ID');
  if (!process.env.DATABASE_URL && !process.env.DATABASE_HOST) {
    missing.push('DATABASE_URL (o DATABASE_HOST + DATABASE_USERNAME + ...)');
  }
  if (missing.length > 0) {
    console.warn(
      `[env] Variables de entorno faltantes: ${missing.join(', ')}. ` +
        'Configúralas o copia backend/.env.example a backend/.env.',
    );
  }
}
