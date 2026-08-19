-- ============================================================
-- ClickOnTheGo — Esquema Neon (PostgreSQL)
-- Tablas: products, jobs, devices, one_time_tokens, settings, audit_log
-- Idempotente: se puede ejecutar varias veces (IF NOT EXISTS).
-- ============================================================

CREATE TABLE IF NOT EXISTS products (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sku            text UNIQUE NOT NULL,
    name           text NOT NULL,
    description    text,
    price          numeric,
    currency       text NOT NULL DEFAULT 'USD',
    category       text,
    -- Forma productOptions / variantsInfo para no romper la estructura de Wix
    variants       jsonb,
    -- Marcado schema.org (Product + Offer + inLanguage) para seoData.tags
    json_ld        jsonb,
    -- URL definitiva de Wix Media (reemplaza la URL staging de Vercel Blob)
    image_urls     text[] NOT NULL DEFAULT '{}',
    status         text NOT NULL DEFAULT 'draft', -- draft | approved | synced | error
    wix_product_id text,
    wix_revision   int,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_created_at ON products(created_at);

-- Marca de Wix elegida para el alta (nombre; se resuelve a `brand: { id }` vía `brands`).
ALTER TABLE products ADD COLUMN IF NOT EXISTS brand text;

-- GTIN (UPC/EAN) detectado por Gemini — opcional; solo se persiste si es un barcode válido.
ALTER TABLE products ADD COLUMN IF NOT EXISTS gtin text;

-- Catálogo de categorías de Wix sincronizado (Wix → Neon) para el frontend.
CREATE TABLE IF NOT EXISTS categories (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    wix_category_id text UNIQUE NOT NULL,
    name            text NOT NULL,
    parent_id       text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_categories_name ON categories(name);

-- Catálogo de marcas de Wix sincronizado (Wix → Neon) para el frontend y el alta.
CREATE TABLE IF NOT EXISTS brands (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    wix_brand_id text UNIQUE NOT NULL,
    name         text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brands_name ON brands(name);

-- Cola productor-consumidor
CREATE TABLE IF NOT EXISTS jobs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    state           text NOT NULL DEFAULT 'pending', -- pending | processing | success | error
    attempts        int NOT NULL DEFAULT 0,
    max_attempts    int NOT NULL DEFAULT 3,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    last_error      text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Índice de claim del worker: tomar el pending más antiguo con next_attempt_at <= now()
CREATE INDEX IF NOT EXISTS idx_jobs_claim ON jobs(state, next_attempt_at);

-- Autenticación multi-dispositivo
CREATE TABLE IF NOT EXISTS devices (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    token        text UNIQUE NOT NULL,
    name         text,
    last_seen_at timestamptz,
    revoked_at   timestamptz,
    revoked_by   uuid,
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- Invitación activa (un solo uso) de cada dispositivo: cada device tiene como
-- máximo UNA invitación sin usar; se genera lazy al mostrar el QR en Settings.
ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_unused_one_time_token text;
CREATE INDEX IF NOT EXISTS idx_devices_last_unused_token
  ON devices(last_unused_one_time_token) WHERE last_unused_one_time_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS one_time_tokens (
    token      text PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    used_at    timestamptz
);

-- Config central (categorías Wix, moneda, idioma, prefijo SKU, límites GC)
CREATE TABLE IF NOT EXISTS settings (
    key        text PRIMARY KEY,
    value      jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Auditoría de eventos
CREATE TABLE IF NOT EXISTS audit_log (
    id         bigserial PRIMARY KEY,
    event      text NOT NULL,
    data       jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);

-- ============================================================
-- Seed de settings por defecto (moneda, idioma, prefijo SKU, stock inicial,
-- visibilidad, toggles de referencia a Gemini y límites del script GC).
-- Las categorías ya NO viven en settings (tabla `categories`).
-- Se pueden sobrescribir desde el dashboard (Settings) o con PUT /api/settings.
-- ============================================================
INSERT INTO settings (key, value) VALUES
    ('app', '{"defaultQuantity":50,"visible":true,"sendCategoryToGemini":false,"sendBrandToGemini":false,"currency":"USD","language":"es-ES","skuPrefix":"SKU-"}'),
    ('gc',  '{"blobOkDays":7,"neonOkDays":15,"blobNotOkDays":14,"neonNotOkDays":21,"allDays":21,"skipActiveJobs":true}')
ON CONFLICT (key) DO NOTHING;
