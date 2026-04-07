-- MTGJSON PostgreSQL Schema
-- Derived from official MTGJSON TypeScript types (ALLMTGJSONTypes.ts)
-- All identifiers are snake_case — no double-quote escaping needed in queries.
-- Arrays use TEXT[] / INTEGER[]; no JSONB; full FK constraints.
--
-- Drop views first (CASCADE on tables would handle it, but explicit is cleaner)

-- DROP MATERIALIZED VIEW IF EXISTS v_cards          CASCADE;
-- DROP MATERIALIZED VIEW IF EXISTS v_tokens         CASCADE;
-- DROP VIEW              IF EXISTS v_sealed_products CASCADE;

-- Drop order: children before parents

DROP TABLE IF EXISTS token_source_products       CASCADE;
DROP TABLE IF EXISTS token_related_cards         CASCADE;
DROP TABLE IF EXISTS token_identifiers           CASCADE;
DROP TABLE IF EXISTS tokens                      CASCADE;
DROP TABLE IF EXISTS card_source_products        CASCADE;
DROP TABLE IF EXISTS card_related_cards          CASCADE;
DROP TABLE IF EXISTS card_purchase_urls          CASCADE;
DROP TABLE IF EXISTS card_rulings                CASCADE;
DROP TABLE IF EXISTS card_foreign_data           CASCADE;
DROP TABLE IF EXISTS card_legalities             CASCADE;
DROP TABLE IF EXISTS card_identifiers            CASCADE;
DROP TABLE IF EXISTS cards                       CASCADE;
DROP TABLE IF EXISTS set_deck_cards              CASCADE;
DROP TABLE IF EXISTS set_decks                   CASCADE;
DROP TABLE IF EXISTS set_booster_content_weights CASCADE;
DROP TABLE IF EXISTS set_booster_contents        CASCADE;
DROP TABLE IF EXISTS set_booster_sheet_cards     CASCADE;
DROP TABLE IF EXISTS set_booster_sheets          CASCADE;
DROP TABLE IF EXISTS sealed_product_contents     CASCADE;
DROP TABLE IF EXISTS sealed_product_purchase_urls CASCADE;
DROP TABLE IF EXISTS sealed_product_identifiers  CASCADE;
DROP TABLE IF EXISTS sealed_product              CASCADE;
DROP TABLE IF EXISTS set_translations            CASCADE;
DROP TABLE IF EXISTS sets                        CASCADE;
DROP TABLE IF EXISTS meta                        CASCADE;

-- ============================================================
-- meta
-- ============================================================

CREATE TABLE meta (
    date    TEXT NOT NULL,
    version TEXT NOT NULL
);

-- ============================================================
-- sets
-- ============================================================

CREATE TABLE sets (
    code               TEXT    PRIMARY KEY,
    name               TEXT    NOT NULL,
    type               TEXT    NOT NULL,
    release_date       TEXT    NOT NULL,
    base_set_size      INTEGER NOT NULL DEFAULT 0,
    total_set_size     INTEGER NOT NULL DEFAULT 0,
    block              TEXT,
    cardsphere_set_id  INTEGER,
    is_foil_only       BOOLEAN NOT NULL DEFAULT FALSE,
    is_foreign_only    BOOLEAN,
    is_non_foil_only   BOOLEAN,
    is_online_only     BOOLEAN NOT NULL DEFAULT FALSE,
    is_paper_only      BOOLEAN,
    is_partial_preview BOOLEAN,
    keyrune_code       TEXT    NOT NULL,
    languages          TEXT[],
    mcm_id             INTEGER,
    mcm_id_extras      INTEGER,
    mcm_name           TEXT,
    mtgo_code          TEXT,
    parent_code        TEXT,
    tcgplayer_group_id INTEGER,
    token_set_code     TEXT
);

CREATE INDEX idx_sets_name         ON sets (name);
CREATE INDEX idx_sets_type         ON sets (type);
CREATE INDEX idx_sets_release_date ON sets (release_date);

-- ============================================================
-- set_translations
-- ============================================================

CREATE TABLE set_translations (
    code        TEXT NOT NULL,
    language    TEXT NOT NULL,
    translation TEXT NOT NULL,
    PRIMARY KEY (code, language)
);

-- ============================================================
-- sealed_product
-- ============================================================

CREATE TABLE sealed_product (
    uuid         TEXT PRIMARY KEY,
    set_code     TEXT NOT NULL,
    name         TEXT NOT NULL,
    card_count   INTEGER,
    category     TEXT,
    subtype      TEXT,
    product_size INTEGER,
    release_date TEXT
);

CREATE INDEX idx_sealed_product_set_code  ON sealed_product (set_code);
CREATE INDEX idx_sealed_product_category  ON sealed_product (category);

-- ============================================================
-- sealed_product_identifiers
-- ============================================================

CREATE TABLE sealed_product_identifiers (
    sealed_product_uuid                   TEXT PRIMARY KEY,
    abu_id                                TEXT,
    card_kingdom_etched_id                TEXT,
    card_kingdom_foil_id                  TEXT,
    card_kingdom_id                       TEXT,
    cardsphere_foil_id                    TEXT,
    cardsphere_id                         TEXT,
    cardtrader_id                         TEXT,
    csi_id                                TEXT,
    deckbox_id                            TEXT,
    mcm_id                                TEXT,
    mcm_meta_id                           TEXT,
    miniaturemarket_id                    TEXT,
    mtg_arena_id                          TEXT,
    mtgjson_foil_version_id               TEXT,
    mtgjson_non_foil_version_id           TEXT,
    mtgjson_v4_id                         TEXT,
    mtgo_foil_id                          TEXT,
    mtgo_id                               TEXT,
    multiverse_id                         TEXT,
    scg_id                                TEXT,
    scryfall_card_back_id                 TEXT,
    scryfall_id                           TEXT,
    scryfall_illustration_id              TEXT,
    scryfall_oracle_id                    TEXT,
    tcgplayer_alternative_foil_product_id TEXT,
    tcgplayer_etched_product_id           TEXT,
    tcgplayer_product_id                  TEXT,
    tnt_id                                TEXT
);

-- ============================================================
-- sealed_product_purchase_urls
-- ============================================================

CREATE TABLE sealed_product_purchase_urls (
    sealed_product_uuid        TEXT PRIMARY KEY,
    card_kingdom               TEXT,
    card_kingdom_etched        TEXT,
    card_kingdom_foil          TEXT,
    cardmarket                 TEXT,
    tcgplayer                  TEXT,
    tcgplayer_alternative_foil TEXT,
    tcgplayer_etched           TEXT
);

-- ============================================================
-- sealed_product_contents
-- Rows per item in SealedProductContents (card/deck/other/pack/sealed).
-- Columns are nullable; only the fields relevant to content_type are filled.
-- ============================================================

CREATE TABLE sealed_product_contents (
    id           SERIAL  PRIMARY KEY,
    uuid         TEXT    NOT NULL,          -- SealedProduct.uuid (FK to sealed_product)
    content_type TEXT    NOT NULL,          -- 'card' | 'deck' | 'other' | 'pack' | 'sealed'
    name         TEXT,                      -- shared
    set_code     TEXT,
    foil         BOOLEAN,                   -- card
    number       TEXT,                      -- card
    card_uuid    TEXT,                      -- SealedProductCard.uuid / SealedProductSealed.uuid
    code         TEXT,                      -- pack booster code
    count        INTEGER                    -- sealed
);

CREATE INDEX idx_sealed_product_contents_uuid ON sealed_product_contents (uuid);

-- ============================================================
-- set_booster_sheets
-- ============================================================

CREATE TABLE set_booster_sheets (
    set_code                TEXT    NOT NULL,
    booster_name            TEXT    NOT NULL,
    sheet_name              TEXT    NOT NULL,
    sheet_is_foil           BOOLEAN,
    sheet_has_balance_colors BOOLEAN,
    sheet_total_weight      BIGINT,
    PRIMARY KEY (set_code, booster_name, sheet_name)
);

-- ============================================================
-- set_booster_sheet_cards
-- card_uuid may reference cards or tokens; no FK enforced.
-- ============================================================

CREATE TABLE set_booster_sheet_cards (
    set_code     TEXT   NOT NULL,
    booster_name TEXT   NOT NULL,
    sheet_name   TEXT   NOT NULL,
    card_uuid    TEXT   NOT NULL,
    card_weight  BIGINT NOT NULL
);

CREATE INDEX idx_set_booster_sheet_cards_card_uuid ON set_booster_sheet_cards (card_uuid);

-- ============================================================
-- set_booster_contents
-- ============================================================

CREATE TABLE set_booster_contents (
    set_code      TEXT    NOT NULL,
    booster_name  TEXT    NOT NULL,
    booster_index INTEGER NOT NULL,
    sheet_name    TEXT    NOT NULL,
    sheet_picks   INTEGER NOT NULL,
    PRIMARY KEY (set_code, booster_name, booster_index, sheet_name)
);

-- ============================================================
-- set_booster_content_weights
-- ============================================================

CREATE TABLE set_booster_content_weights (
    set_code      TEXT    NOT NULL,
    booster_name  TEXT    NOT NULL,
    booster_index INTEGER NOT NULL,
    booster_weight INTEGER NOT NULL,
    PRIMARY KEY (set_code, booster_name, booster_index)
);

-- ============================================================
-- set_decks  (preconstructed + user-created decks)
-- ============================================================

CREATE TABLE set_decks (
    uuid                 TEXT        PRIMARY KEY,
    set_code             TEXT,                              -- set code for precon decks (e.g. '10E'), null for user decks
    name                 TEXT        NOT NULL,
    type                 TEXT        NOT NULL,
    source               TEXT        NOT NULL DEFAULT 'mtgjson',  -- 'mtgjson' | 'user' | 'other'
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

-- ============================================================
-- set_deck_cards
-- uuid may reference cards or tokens; no FK enforced.
-- ============================================================

CREATE TABLE set_deck_cards (
    id                   SERIAL  PRIMARY KEY,
    deck_uuid            TEXT    NOT NULL,
    board_type           TEXT    NOT NULL, -- 'commander' | 'mainBoard' | 'sideBoard'
    uuid                 TEXT    NOT NULL,
    count                INTEGER NOT NULL,
    is_foil              BOOLEAN,
    collection_item_uuid TEXT               -- null = pool card, set = from user's collection
);

CREATE INDEX idx_set_deck_cards_deck_uuid ON set_deck_cards (deck_uuid);
CREATE INDEX idx_set_deck_cards_uuid      ON set_deck_cards (uuid);

-- ============================================================
-- cards
-- leadership_skills inlined as three boolean columns.
-- related_cards and source_products are in their own junction tables.
-- ============================================================

CREATE TABLE cards (
    uuid                      TEXT     PRIMARY KEY,
    set_code                  TEXT     NOT NULL,
    set_name                  TEXT     NOT NULL,
    artist                    TEXT,
    artist_ids                TEXT[],
    ascii_name                TEXT,
    attraction_lights         INTEGER[],
    availability              TEXT[]   NOT NULL,
    booster_types             TEXT[],
    border_color              TEXT     NOT NULL,
    card_parts                TEXT[],
    color_identity            TEXT[]   NOT NULL,
    color_indicator           TEXT[],
    colors                    TEXT[]   NOT NULL,
    converted_mana_cost       FLOAT,
    defense                   TEXT,
    duel_deck                 TEXT,
    edhrec_rank               INTEGER,
    edhrec_saltiness          FLOAT,
    face_converted_mana_cost  FLOAT,
    face_flavor_name          TEXT,
    face_mana_value           FLOAT,
    face_name                 TEXT,
    finishes                  TEXT[]   NOT NULL,
    flavor_name               TEXT,
    flavor_text               TEXT,
    frame_effects             TEXT[],
    frame_version             TEXT     NOT NULL,
    hand                      TEXT,
    has_alternative_deck_limit BOOLEAN,
    has_content_warning       BOOLEAN,
    is_alternative            BOOLEAN,
    is_full_art               BOOLEAN,
    is_funny                  BOOLEAN,
    is_game_changer           BOOLEAN,
    is_online_only            BOOLEAN,
    is_oversized              BOOLEAN,
    is_promo                  BOOLEAN,
    is_rebalanced             BOOLEAN,
    is_reprint                BOOLEAN,
    is_reserved               BOOLEAN,
    is_story_spotlight        BOOLEAN,
    is_textless               BOOLEAN,
    is_timeshifted            BOOLEAN,
    keywords                  TEXT[],
    language                  TEXT     NOT NULL,
    layout                    TEXT     NOT NULL,
    leadership_brawl          BOOLEAN,
    leadership_commander      BOOLEAN,
    leadership_oathbreaker    BOOLEAN,
    life                      TEXT,
    loyalty                   TEXT,
    mana_cost                 TEXT,
    mana_value                FLOAT    NOT NULL,
    name                      TEXT     NOT NULL,
    number                    TEXT     NOT NULL,
    original_printings        TEXT[],
    original_release_date     TEXT,
    original_text             TEXT,
    original_type             TEXT,
    other_face_ids            TEXT[],
    power                     TEXT,
    printed_name              TEXT,
    printed_text              TEXT,
    printed_type              TEXT,
    printings                 TEXT[],
    promo_types               TEXT[],
    rarity                    TEXT     NOT NULL,
    rebalanced_printings      TEXT[],
    security_stamp            TEXT,
    side                      TEXT,
    signature                 TEXT,
    subsets                   TEXT[],
    subtypes                  TEXT[]   NOT NULL,
    supertypes                TEXT[]   NOT NULL,
    text                      TEXT,
    toughness                 TEXT,
    type                      TEXT     NOT NULL,
    types                     TEXT[]   NOT NULL,
    variations                TEXT[],
    watermark                 TEXT
);

CREATE INDEX idx_cards_set_code       ON cards (set_code);
CREATE INDEX idx_cards_set_name       ON cards (set_name);
CREATE INDEX idx_cards_name           ON cards (name);
CREATE INDEX idx_cards_mana_value     ON cards (mana_value);
CREATE INDEX idx_cards_rarity         ON cards (rarity);
CREATE INDEX idx_cards_layout         ON cards (layout);
CREATE INDEX idx_cards_color_identity ON cards USING GIN (color_identity);
CREATE INDEX idx_cards_colors         ON cards USING GIN (colors);
CREATE INDEX idx_cards_keywords       ON cards USING GIN (keywords);
CREATE INDEX idx_cards_types          ON cards USING GIN (types);
CREATE INDEX idx_cards_subtypes       ON cards USING GIN (subtypes);

-- ============================================================
-- card_identifiers
-- ============================================================

CREATE TABLE card_identifiers (
    uuid                                  TEXT PRIMARY KEY,
    abu_id                                TEXT,
    card_kingdom_etched_id                TEXT,
    card_kingdom_foil_id                  TEXT,
    card_kingdom_id                       TEXT,
    cardsphere_foil_id                    TEXT,
    cardsphere_id                         TEXT,
    cardtrader_id                         TEXT,
    csi_id                                TEXT,
    deckbox_id                            TEXT,
    mcm_id                                TEXT,
    mcm_meta_id                           TEXT,
    miniaturemarket_id                    TEXT,
    mtg_arena_id                          TEXT,
    mtgjson_foil_version_id               TEXT,
    mtgjson_non_foil_version_id           TEXT,
    mtgjson_v4_id                         TEXT,
    mtgo_foil_id                          TEXT,
    mtgo_id                               TEXT,
    multiverse_id                         TEXT,
    scg_id                                TEXT,
    scryfall_card_back_id                 TEXT,
    scryfall_id                           TEXT,
    scryfall_illustration_id              TEXT,
    scryfall_oracle_id                    TEXT,
    tcgplayer_alternative_foil_product_id TEXT,
    tcgplayer_etched_product_id           TEXT,
    tcgplayer_product_id                  TEXT,
    tnt_id                                TEXT
);

CREATE INDEX idx_card_identifiers_scryfall_id        ON card_identifiers (scryfall_id);
CREATE INDEX idx_card_identifiers_scryfall_oracle_id ON card_identifiers (scryfall_oracle_id);
CREATE INDEX idx_card_identifiers_mtg_arena_id       ON card_identifiers (mtg_arena_id);
CREATE INDEX idx_card_identifiers_tcgplayer_id       ON card_identifiers (tcgplayer_product_id);

-- ============================================================
-- card_legalities
-- Values: 'Legal' | 'Banned' | 'Restricted' | 'Not Legal'
-- Includes all formats from Legalities type plus explorer/historicbrawl.
-- ============================================================

CREATE TABLE card_legalities (
    uuid            TEXT PRIMARY KEY,
    alchemy         TEXT,
    brawl           TEXT,
    commander       TEXT,
    duel            TEXT,
    explorer        TEXT,
    future          TEXT,
    gladiator       TEXT,
    historic        TEXT,
    historicbrawl   TEXT,
    legacy          TEXT,
    modern          TEXT,
    oathbreaker     TEXT,
    oldschool       TEXT,
    pauper          TEXT,
    paupercommander TEXT,
    penny           TEXT,
    pioneer         TEXT,
    predh           TEXT,
    premodern       TEXT,
    standard        TEXT,
    standardbrawl   TEXT,
    timeless        TEXT,
    vintage         TEXT
);

-- ============================================================
-- card_foreign_data
-- ForeignData.identifiers inlined as columns to avoid a 4th join level.
-- foreign_uuid = ForeignData.uuid (the foreign-data record's own identifier).
-- ============================================================

CREATE TABLE card_foreign_data (
    id                                    SERIAL PRIMARY KEY,
    uuid                                  TEXT   NOT NULL,
    language                              TEXT   NOT NULL,
    name                                  TEXT   NOT NULL,
    face_name                             TEXT,
    flavor_text                           TEXT,
    text                                  TEXT,
    type                                  TEXT,
    foreign_uuid                          TEXT,
    -- Identifiers (inlined from ForeignData.identifiers)
    abu_id                                TEXT,
    card_kingdom_etched_id                TEXT,
    card_kingdom_foil_id                  TEXT,
    card_kingdom_id                       TEXT,
    cardsphere_foil_id                    TEXT,
    cardsphere_id                         TEXT,
    cardtrader_id                         TEXT,
    csi_id                                TEXT,
    deckbox_id                            TEXT,
    mcm_id                                TEXT,
    mcm_meta_id                           TEXT,
    miniaturemarket_id                    TEXT,
    mtg_arena_id                          TEXT,
    mtgjson_foil_version_id               TEXT,
    mtgjson_non_foil_version_id           TEXT,
    mtgjson_v4_id                         TEXT,
    mtgo_foil_id                          TEXT,
    mtgo_id                               TEXT,
    multiverse_id                         TEXT,
    scg_id                                TEXT,
    scryfall_card_back_id                 TEXT,
    scryfall_id                           TEXT,
    scryfall_illustration_id              TEXT,
    scryfall_oracle_id                    TEXT,
    tcgplayer_alternative_foil_product_id TEXT,
    tcgplayer_etched_product_id           TEXT,
    tcgplayer_product_id                  TEXT,
    tnt_id                                TEXT
);

CREATE INDEX idx_card_foreign_data_uuid     ON card_foreign_data (uuid);
CREATE INDEX idx_card_foreign_data_language ON card_foreign_data (language);

-- ============================================================
-- card_rulings
-- ============================================================

CREATE TABLE card_rulings (
    id   SERIAL PRIMARY KEY,
    uuid TEXT   NOT NULL,
    date DATE   NOT NULL,
    text TEXT   NOT NULL
);

CREATE INDEX idx_card_rulings_uuid ON card_rulings (uuid);

-- ============================================================
-- card_purchase_urls
-- ============================================================

CREATE TABLE card_purchase_urls (
    uuid                       TEXT PRIMARY KEY,
    card_kingdom               TEXT,
    card_kingdom_etched        TEXT,
    card_kingdom_foil          TEXT,
    cardmarket                 TEXT,
    tcgplayer                  TEXT,
    tcgplayer_alternative_foil TEXT,
    tcgplayer_etched           TEXT
);

-- ============================================================
-- card_related_cards  (junction for RelatedCards)
-- related_uuid has no FK: cross-set references may not always resolve.
-- ============================================================

CREATE TABLE card_related_cards (
    id            SERIAL PRIMARY KEY,
    card_uuid     TEXT   NOT NULL,
    relation_type TEXT   NOT NULL, -- 'reverseRelated' | 'spellbook'
    related_uuid  TEXT   NOT NULL
);

CREATE INDEX idx_card_related_cards_card_uuid    ON card_related_cards (card_uuid);
CREATE INDEX idx_card_related_cards_related_uuid ON card_related_cards (related_uuid);

-- ============================================================
-- card_source_products  (junction for SourceProducts)
-- finish_type: 'etched' | 'foil' | 'nonfoil'
-- ============================================================

CREATE TABLE card_source_products (
    id                  SERIAL PRIMARY KEY,
    card_uuid           TEXT   NOT NULL,
    finish_type         TEXT   NOT NULL,
    sealed_product_uuid TEXT   NOT NULL
);

CREATE INDEX idx_card_source_products_card_uuid           ON card_source_products (card_uuid);
CREATE INDEX idx_card_source_products_sealed_product_uuid ON card_source_products (sealed_product_uuid);

-- ============================================================
-- tokens
-- ============================================================

CREATE TABLE tokens (
    uuid              TEXT    PRIMARY KEY,
    set_code          TEXT    NOT NULL,
    set_name          TEXT    NOT NULL,
    artist            TEXT,
    artist_ids        TEXT[],
    ascii_name        TEXT,
    attraction_lights INTEGER[],
    availability      TEXT[]  NOT NULL,
    booster_types     TEXT[],
    border_color      TEXT    NOT NULL,
    card_parts        TEXT[],
    color_identity    TEXT[]  NOT NULL,
    color_indicator   TEXT[],
    colors            TEXT[]  NOT NULL,
    edhrec_saltiness  FLOAT,
    face_flavor_name  TEXT,
    face_name         TEXT,
    finishes          TEXT[]  NOT NULL,
    flavor_name       TEXT,
    flavor_text       TEXT,
    frame_effects     TEXT[],
    frame_version     TEXT    NOT NULL,
    is_full_art       BOOLEAN,
    is_funny          BOOLEAN,
    is_online_only    BOOLEAN,
    is_oversized      BOOLEAN,
    is_promo          BOOLEAN,
    is_reprint        BOOLEAN,
    is_textless       BOOLEAN,
    keywords          TEXT[],
    language          TEXT    NOT NULL,
    layout            TEXT    NOT NULL,
    loyalty           TEXT,
    mana_cost         TEXT,
    name              TEXT    NOT NULL,
    number            TEXT    NOT NULL,
    orientation       TEXT,
    original_text     TEXT,
    original_type     TEXT,
    other_face_ids    TEXT[],
    power             TEXT,
    printed_type      TEXT,
    produced_mana     TEXT[],
    promo_types       TEXT[],
    security_stamp    TEXT,
    side              TEXT,
    signature         TEXT,
    subsets           TEXT[],
    subtypes          TEXT[]  NOT NULL,
    supertypes        TEXT[]  NOT NULL,
    text              TEXT,
    toughness         TEXT,
    token_products    JSONB,
    type              TEXT    NOT NULL,
    types             TEXT[]  NOT NULL,
    watermark         TEXT
);

CREATE INDEX idx_tokens_set_code       ON tokens (set_code);
CREATE INDEX idx_tokens_set_name       ON tokens (set_name);
CREATE INDEX idx_tokens_name           ON tokens (name);
CREATE INDEX idx_tokens_color_identity ON tokens USING GIN (color_identity);
CREATE INDEX idx_tokens_colors         ON tokens USING GIN (colors);
CREATE INDEX idx_tokens_subtypes       ON tokens USING GIN (subtypes);

-- ============================================================
-- token_identifiers
-- ============================================================

CREATE TABLE token_identifiers (
    uuid                                  TEXT PRIMARY KEY,
    abu_id                                TEXT,
    card_kingdom_etched_id                TEXT,
    card_kingdom_foil_id                  TEXT,
    card_kingdom_id                       TEXT,
    cardsphere_foil_id                    TEXT,
    cardsphere_id                         TEXT,
    cardtrader_id                         TEXT,
    csi_id                                TEXT,
    deckbox_id                            TEXT,
    mcm_id                                TEXT,
    mcm_meta_id                           TEXT,
    miniaturemarket_id                    TEXT,
    mtg_arena_id                          TEXT,
    mtgjson_foil_version_id               TEXT,
    mtgjson_non_foil_version_id           TEXT,
    mtgjson_v4_id                         TEXT,
    mtgo_foil_id                          TEXT,
    mtgo_id                               TEXT,
    multiverse_id                         TEXT,
    scg_id                                TEXT,
    scryfall_card_back_id                 TEXT,
    scryfall_id                           TEXT,
    scryfall_illustration_id              TEXT,
    scryfall_oracle_id                    TEXT,
    tcgplayer_alternative_foil_product_id TEXT,
    tcgplayer_etched_product_id           TEXT,
    tcgplayer_product_id                  TEXT,
    tnt_id                                TEXT
);

CREATE INDEX idx_token_identifiers_scryfall_id ON token_identifiers (scryfall_id);

-- ============================================================
-- token_related_cards  (junction)
-- ============================================================

CREATE TABLE token_related_cards (
    id            SERIAL PRIMARY KEY,
    token_uuid    TEXT   NOT NULL,
    relation_type TEXT   NOT NULL,
    related_uuid  TEXT   NOT NULL
);

CREATE INDEX idx_token_related_cards_token_uuid   ON token_related_cards (token_uuid);
CREATE INDEX idx_token_related_cards_related_uuid ON token_related_cards (related_uuid);

-- ============================================================
-- token_source_products  (junction)
-- CardToken.sourceProducts is string[] with no finish type.
-- ============================================================

CREATE TABLE token_source_products (
    id                  SERIAL PRIMARY KEY,
    token_uuid          TEXT   NOT NULL,
    sealed_product_uuid TEXT   NOT NULL
);

CREATE INDEX idx_token_source_products_token_uuid           ON token_source_products (token_uuid);
CREATE INDEX idx_token_source_products_sealed_product_uuid  ON token_source_products (sealed_product_uuid);