-- Migration: rebuild set_decks and set_deck_cards with new schema.
-- The old schema used set code as PK, causing only 1 deck per set to be stored.
-- This migration drops the old data and recreates the tables with uuid as PK.
--
-- After running this, do a full re-seed to populate all 2,686 individual decks:
--   DATABASE_URL=postgresql://user:pass@host/db bun scripts/seed-from-json.ts
--
-- Run with: psql $DATABASE_URL -f scripts/migrate-decks.sql

BEGIN;

-- Drop old tables (cascade removes FK constraints)
DROP TABLE IF EXISTS set_deck_cards CASCADE;
DROP TABLE IF EXISTS set_decks CASCADE;

-- Recreate set_decks with uuid as PK
CREATE TABLE set_decks (
    uuid                 TEXT        PRIMARY KEY,
    set_code             TEXT,
    name                 TEXT        NOT NULL,
    type                 TEXT        NOT NULL,
    source               TEXT        NOT NULL DEFAULT 'mtgjson',
    description          TEXT,
    release_date         TEXT        NOT NULL,
    sealed_product_uuids TEXT[],
    stats                JSONB,
    created_at           TIMESTAMPTZ,
    updated_at           TIMESTAMPTZ
);

CREATE INDEX idx_set_decks_set_code ON set_decks (set_code);
CREATE INDEX idx_set_decks_source   ON set_decks (source);
CREATE UNIQUE INDEX idx_set_decks_set_code_name ON set_decks (set_code, name);

-- Recreate set_deck_cards with deck_uuid FK
CREATE TABLE set_deck_cards (
    id                   SERIAL  PRIMARY KEY,
    deck_uuid            TEXT    NOT NULL,
    board_type           TEXT    NOT NULL,
    uuid                 TEXT    NOT NULL,
    count                INTEGER NOT NULL,
    is_foil              BOOLEAN,
    collection_item_uuid TEXT
);

CREATE INDEX idx_set_deck_cards_deck_uuid ON set_deck_cards (deck_uuid);
CREATE INDEX idx_set_deck_cards_uuid      ON set_deck_cards (uuid);

-- Re-add FK constraints
ALTER TABLE set_decks ADD CONSTRAINT set_decks_set_code_fkey
    FOREIGN KEY (set_code) REFERENCES sets (code) ON DELETE CASCADE;
ALTER TABLE set_deck_cards ADD CONSTRAINT set_deck_cards_deck_uuid_fkey
    FOREIGN KEY (deck_uuid) REFERENCES set_decks (uuid) ON DELETE CASCADE;

COMMIT;
