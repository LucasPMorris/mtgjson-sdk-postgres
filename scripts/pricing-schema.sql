-- MTGJSON SDK - Pricing Schema (Apache 2 Timescale only)
--
-- Kept separate from schema.sql because:
--   1. schema.sql drops/recreates on every seed; pricing data is long-lived.
--   2. TimescaleDB is required only for pricing, not the rest of the SDK.
--   3. This file is re-runnable: every statement is IF NOT EXISTS / CREATE OR REPLACE.
--
-- Compatibility: Apache 2 features only. No compression, no continuous
-- aggregates, no Timescale policies, no TSL-only functions (first/last/etc).
-- This keeps the schema portable between local Timescale Community builds and
-- managed hosts that only ship the Apache 2 surface (e.g. Render Postgres).
--
-- Rollup refresh is an EXTERNAL responsibility. prices_weekly / prices_monthly
-- are plain materialized views; the ingest tick (SDK updatePricingToday) runs
-- REFRESH MATERIALIZED VIEW CONCURRENTLY at the end of each run.
--
-- Apply with:  psql $DATABASE_URL -f pricing-schema.sql
-- Or via SDK:  sdk.ensurePricingSchema()

-- ============================================================
-- Extension
-- ============================================================

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ============================================================
-- providers (lookup)
--   5 supported pricing providers. Static; hand-seeded below.
--   id is used as the provider component of `dims`.
-- ============================================================

CREATE TABLE IF NOT EXISTS providers (
    id       SMALLINT    PRIMARY KEY,
    name     TEXT        NOT NULL UNIQUE,
    format   TEXT        NOT NULL CHECK (format IN ('paper', 'mtgo')),
    currency CHAR(3)     NOT NULL
);

INSERT INTO providers (id, name, format, currency) VALUES
    (0, 'cardhoarder', 'mtgo',  'USD'),
    (1, 'cardkingdom', 'paper', 'USD'),
    (2, 'cardmarket',  'paper', 'EUR'),
    (3, 'cardsphere',  'paper', 'USD'),
    (4, 'tcgplayer',   'paper', 'USD')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Dimension packing
--
-- `dims` is a SMALLINT bit-packing four categorical dimensions into one
-- column so the PK of prices_daily stays narrow:
--
--   bits 0     : price_type  (0=retail, 1=buylist)
--   bits 1..2  : finish      (0=normal, 1=foil, 2=etched)
--   bits 3     : format      (0=paper, 1=mtgo)
--   bits 4..6  : provider_id (matches providers.id, 0..4)
--
-- Total: 7 bits. Unused high bits stay 0 for future expansion.
-- ============================================================

CREATE OR REPLACE FUNCTION pack_dims_ints(
    p_provider_id SMALLINT,
    p_format_bit  SMALLINT,
    p_finish      SMALLINT,
    p_price_type  SMALLINT
) RETURNS SMALLINT
LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
    SELECT (
        ((p_provider_id & 7)::INT << 4) |
        ((p_format_bit  & 1)::INT << 3) |
        ((p_finish      & 3)::INT << 1) |
         (p_price_type  & 1)::INT
    )::SMALLINT
$$;

-- String-argument convenience wrapper. Used by ingestion and the legacy
-- migration pipe; resolves human-readable names to ids via the lookup tables.
CREATE OR REPLACE FUNCTION pack_dims(
    p_provider   TEXT,
    p_format     TEXT,
    p_finish     TEXT,
    p_price_type TEXT
) RETURNS SMALLINT
LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
    SELECT pack_dims_ints(
        (SELECT id FROM providers WHERE name = p_provider)::SMALLINT,
        (CASE p_format     WHEN 'paper' THEN 0 WHEN 'mtgo' THEN 1 END)::SMALLINT,
        (CASE p_finish     WHEN 'normal' THEN 0 WHEN 'foil' THEN 1 WHEN 'etched' THEN 2 END)::SMALLINT,
        (CASE p_price_type WHEN 'retail' THEN 0 WHEN 'buylist' THEN 1 END)::SMALLINT
    )
$$;

-- Reverse: SMALLINT → (provider, format, finish, price_type) text record.
-- Useful for debugging and for reshaping rows into the app's nested format.
CREATE OR REPLACE FUNCTION unpack_dims(p_dims SMALLINT)
RETURNS TABLE(provider TEXT, format TEXT, finish TEXT, price_type TEXT)
LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
    SELECT
        (SELECT name FROM providers WHERE id = ((p_dims >> 4) & 7)::SMALLINT),
        CASE ((p_dims >> 3) & 1) WHEN 0 THEN 'paper' ELSE 'mtgo' END,
        CASE ((p_dims >> 1) & 3) WHEN 0 THEN 'normal' WHEN 1 THEN 'foil' WHEN 2 THEN 'etched' END,
        CASE (p_dims & 1) WHEN 0 THEN 'retail' ELSE 'buylist' END
$$;

-- ============================================================
-- prices_daily  (TimescaleDB hypertable, change-only)
--
-- One row per (uuid, dims, effective_date) PRICE CHANGE - not per day.
-- A row says: "on effective_date, the price for this combo became X,
-- and holds until the next row (or present) for this combo."
-- ============================================================

CREATE TABLE IF NOT EXISTS prices_daily (
    uuid           UUID          NOT NULL,
    dims           SMALLINT      NOT NULL,
    effective_date DATE          NOT NULL,
    price          NUMERIC(10,4) NOT NULL,
    PRIMARY KEY (uuid, dims, effective_date)
);

-- Convert to TimescaleDB hypertable (no-op if already done).
SELECT create_hypertable(
    'prices_daily',
    'effective_date',
    chunk_time_interval => INTERVAL '30 days',
    if_not_exists       => TRUE
);

-- ============================================================
-- prices_current  (latest-row cache for card-list batch reads)
--
-- Fixed size: one row per (uuid, dims) combo. Maintained by a trigger on
-- prices_daily so card-list queries never have to do "latest row per group"
-- scans; they do a pure PK lookup.
-- ============================================================

CREATE TABLE IF NOT EXISTS prices_current (
    uuid       UUID          NOT NULL,
    dims       SMALLINT      NOT NULL,
    price      NUMERIC(10,4) NOT NULL,
    since_date DATE          NOT NULL,
    PRIMARY KEY (uuid, dims)
);

CREATE OR REPLACE FUNCTION prices_current_upsert()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO prices_current (uuid, dims, price, since_date)
    VALUES (NEW.uuid, NEW.dims, NEW.price, NEW.effective_date)
    ON CONFLICT (uuid, dims) DO UPDATE
        SET price      = EXCLUDED.price,
            since_date = EXCLUDED.since_date
        WHERE EXCLUDED.since_date > prices_current.since_date;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prices_current_upsert ON prices_daily;
CREATE TRIGGER trg_prices_current_upsert
    AFTER INSERT ON prices_daily
    FOR EACH ROW
    EXECUTE FUNCTION prices_current_upsert();

-- ============================================================
-- prices_weekly  (plain materialized view)
--
-- Weekly rollup per (uuid, dims). Refreshed by the ingest tick via
-- REFRESH MATERIALIZED VIEW CONCURRENTLY; the unique index below is
-- what enables CONCURRENTLY.
-- ============================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS prices_weekly AS
SELECT
    uuid,
    dims,
    time_bucket('1 week', effective_date) AS bucket,
    avg(price)::NUMERIC(10,4)             AS avg_price,
    min(price)                            AS min_price,
    max(price)                            AS max_price
FROM prices_daily
GROUP BY uuid, dims, bucket
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS prices_weekly_key
    ON prices_weekly (uuid, dims, bucket);

-- ============================================================
-- prices_monthly  (plain materialized view)
--
-- Monthly rollup per (uuid, dims). Refresh cadence same as prices_weekly.
-- ============================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS prices_monthly AS
SELECT
    uuid,
    dims,
    time_bucket('1 month', effective_date) AS bucket,
    avg(price)::NUMERIC(10,4)              AS avg_price,
    min(price)                             AS min_price,
    max(price)                             AS max_price
FROM prices_daily
GROUP BY uuid, dims, bucket
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS prices_monthly_key
    ON prices_monthly (uuid, dims, bucket);
