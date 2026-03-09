ALTER TABLE sets ADD CONSTRAINT sets_parent_code_fkey FOREIGN KEY (parent_code) REFERENCES sets (code) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE set_translations ADD CONSTRAINT set_translations_code_fkey FOREIGN KEY (code) REFERENCES sets (code) ON DELETE CASCADE;
ALTER TABLE sealed_product ADD CONSTRAINT sealed_product_set_code_fkey FOREIGN KEY (set_code) REFERENCES sets (code) ON DELETE CASCADE;
ALTER TABLE sealed_product_identifiers ADD CONSTRAINT sealed_product_identifiers_uuid_fkey FOREIGN KEY (sealed_product_uuid) REFERENCES sealed_product (uuid) ON DELETE CASCADE;
ALTER TABLE sealed_product_purchase_urls ADD CONSTRAINT sealed_product_purchase_urls_uuid_fkey FOREIGN KEY (sealed_product_uuid) REFERENCES sealed_product (uuid) ON DELETE CASCADE;
ALTER TABLE sealed_product_contents ADD CONSTRAINT sealed_product_contents_uuid_fkey FOREIGN KEY (uuid) REFERENCES sealed_product (uuid) ON DELETE CASCADE;
ALTER TABLE set_booster_sheets ADD CONSTRAINT set_booster_sheets_set_code_fkey FOREIGN KEY (set_code) REFERENCES sets (code) ON DELETE CASCADE;
ALTER TABLE set_booster_sheet_cards ADD CONSTRAINT set_booster_sheet_cards_sheet_fkey FOREIGN KEY (set_code, booster_name, sheet_name) REFERENCES set_booster_sheets (set_code, booster_name, sheet_name) ON DELETE CASCADE;
ALTER TABLE set_booster_contents ADD CONSTRAINT set_booster_contents_set_code_fkey FOREIGN KEY (set_code) REFERENCES sets (code) ON DELETE CASCADE;
ALTER TABLE set_booster_content_weights ADD CONSTRAINT set_booster_content_weights_set_code_fkey FOREIGN KEY (set_code) REFERENCES sets (code) ON DELETE CASCADE;
ALTER TABLE set_decks ADD CONSTRAINT set_decks_set_code_fkey FOREIGN KEY (set_code) REFERENCES sets (code) ON DELETE CASCADE;
ALTER TABLE set_deck_cards ADD CONSTRAINT set_deck_cards_deck_code_fkey FOREIGN KEY (deck_code) REFERENCES set_decks (code) ON DELETE CASCADE;
ALTER TABLE cards ADD CONSTRAINT cards_set_code_fkey FOREIGN KEY (set_code) REFERENCES sets (code);
ALTER TABLE card_identifiers ADD CONSTRAINT card_identifiers_uuid_fkey FOREIGN KEY (uuid) REFERENCES cards (uuid) ON DELETE CASCADE;
ALTER TABLE card_legalities ADD CONSTRAINT card_legalities_uuid_fkey FOREIGN KEY (uuid) REFERENCES cards (uuid) ON DELETE CASCADE;
ALTER TABLE card_foreign_data ADD CONSTRAINT card_foreign_data_uuid_fkey FOREIGN KEY (uuid) REFERENCES cards (uuid) ON DELETE CASCADE;
ALTER TABLE card_rulings ADD CONSTRAINT card_rulings_uuid_fkey FOREIGN KEY (uuid) REFERENCES cards (uuid) ON DELETE CASCADE;
ALTER TABLE card_purchase_urls ADD CONSTRAINT card_purchase_urls_uuid_fkey FOREIGN KEY (uuid) REFERENCES cards (uuid) ON DELETE CASCADE;
ALTER TABLE card_related_cards ADD CONSTRAINT card_related_cards_card_uuid_fkey FOREIGN KEY (card_uuid) REFERENCES cards (uuid) ON DELETE CASCADE;
ALTER TABLE card_source_products ADD CONSTRAINT card_source_products_card_uuid_fkey FOREIGN KEY (card_uuid) REFERENCES cards (uuid) ON DELETE CASCADE;
ALTER TABLE card_source_products ADD CONSTRAINT card_source_products_sealed_product_uuid_fkey FOREIGN KEY (sealed_product_uuid) REFERENCES sealed_product (uuid);
ALTER TABLE tokens ADD CONSTRAINT tokens_set_code_fkey FOREIGN KEY (set_code) REFERENCES sets (code);
ALTER TABLE token_identifiers ADD CONSTRAINT token_identifiers_uuid_fkey FOREIGN KEY (uuid) REFERENCES tokens (uuid) ON DELETE CASCADE;
ALTER TABLE token_related_cards ADD CONSTRAINT token_related_cards_token_uuid_fkey FOREIGN KEY (token_uuid) REFERENCES tokens (uuid) ON DELETE CASCADE;
ALTER TABLE token_source_products ADD CONSTRAINT token_source_products_token_uuid_fkey FOREIGN KEY (token_uuid) REFERENCES tokens (uuid) ON DELETE CASCADE;
ALTER TABLE token_source_products ADD CONSTRAINT token_source_products_sealed_product_uuid_fkey FOREIGN KEY (sealed_product_uuid) REFERENCES sealed_product (uuid);

-- ============================================================
-- Materialized views (populated on CREATE, refresh after each seed)
-- ============================================================

DROP MATERIALIZED VIEW IF EXISTS v_cards          CASCADE;
DROP MATERIALIZED VIEW IF EXISTS v_tokens         CASCADE;
DROP VIEW              IF EXISTS v_sealed_products CASCADE;

-- ============================================================
-- Identifier columns reused across v_cards, v_tokens, v_sealed_products.
-- Prefixed with identifiers_ so the SDK can group them into one object.
-- ============================================================

-- v_cards: cards + identifiers + purchase_urls + legalities +
--          leadership_skills + rulings + foreign_data + related_cards + source_products
CREATE MATERIALIZED VIEW v_cards AS
SELECT
    c.*,

    -- identifiers (prefixed)
    ci.abu_id                                AS identifiers_abu_id,
    ci.card_kingdom_etched_id                AS identifiers_card_kingdom_etched_id,
    ci.card_kingdom_foil_id                  AS identifiers_card_kingdom_foil_id,
    ci.card_kingdom_id                       AS identifiers_card_kingdom_id,
    ci.cardsphere_foil_id                    AS identifiers_cardsphere_foil_id,
    ci.cardsphere_id                         AS identifiers_cardsphere_id,
    ci.cardtrader_id                         AS identifiers_cardtrader_id,
    ci.csi_id                                AS identifiers_csi_id,
    ci.deckbox_id                            AS identifiers_deckbox_id,
    ci.mcm_id                                AS identifiers_mcm_id,
    ci.mcm_meta_id                           AS identifiers_mcm_meta_id,
    ci.miniaturemarket_id                    AS identifiers_miniaturemarket_id,
    ci.mtg_arena_id                          AS identifiers_mtg_arena_id,
    ci.mtgjson_foil_version_id               AS identifiers_mtgjson_foil_version_id,
    ci.mtgjson_non_foil_version_id           AS identifiers_mtgjson_non_foil_version_id,
    ci.mtgjson_v4_id                         AS identifiers_mtgjson_v4_id,
    ci.mtgo_foil_id                          AS identifiers_mtgo_foil_id,
    ci.mtgo_id                               AS identifiers_mtgo_id,
    ci.multiverse_id                         AS identifiers_multiverse_id,
    ci.scg_id                                AS identifiers_scg_id,
    ci.scryfall_card_back_id                 AS identifiers_scryfall_card_back_id,
    ci.scryfall_id                           AS identifiers_scryfall_id,
    ci.scryfall_illustration_id              AS identifiers_scryfall_illustration_id,
    ci.scryfall_oracle_id                    AS identifiers_scryfall_oracle_id,
    ci.tcgplayer_alternative_foil_product_id AS identifiers_tcgplayer_alternative_foil_product_id,
    ci.tcgplayer_etched_product_id           AS identifiers_tcgplayer_etched_product_id,
    ci.tcgplayer_product_id                  AS identifiers_tcgplayer_product_id,
    ci.tnt_id                                AS identifiers_tnt_id,

    -- purchase URLs (prefixed)
    cpu.card_kingdom                         AS purchase_urls_card_kingdom,
    cpu.card_kingdom_etched                  AS purchase_urls_card_kingdom_etched,
    cpu.card_kingdom_foil                    AS purchase_urls_card_kingdom_foil,
    cpu.cardmarket                           AS purchase_urls_cardmarket,
    cpu.tcgplayer                            AS purchase_urls_tcgplayer,
    cpu.tcgplayer_alternative_foil           AS purchase_urls_tcgplayer_alternative_foil,
    cpu.tcgplayer_etched                     AS purchase_urls_tcgplayer_etched,

    -- legalities JSONB
    json_build_object(
        'alchemy',         cl.alchemy,
        'brawl',           cl.brawl,
        'commander',       cl.commander,
        'duel',            cl.duel,
        'explorer',        cl.explorer,
        'future',          cl.future,
        'gladiator',       cl.gladiator,
        'historic',        cl.historic,
        'historicbrawl',   cl.historicbrawl,
        'legacy',          cl.legacy,
        'modern',          cl.modern,
        'oathbreaker',     cl.oathbreaker,
        'oldschool',       cl.oldschool,
        'pauper',          cl.pauper,
        'paupercommander', cl.paupercommander,
        'penny',           cl.penny,
        'pioneer',         cl.pioneer,
        'predh',           cl.predh,
        'premodern',       cl.premodern,
        'standard',        cl.standard,
        'standardbrawl',   cl.standardbrawl,
        'timeless',        cl.timeless,
        'vintage',         cl.vintage
    )                                        AS legalities,

    -- leadership_skills JSONB (columns already in c.* as flat booleans)
    json_build_object(
        'brawl',       c.leadership_brawl,
        'commander',   c.leadership_commander,
        'oathbreaker', c.leadership_oathbreaker
    )                                        AS leadership_skills,

    -- rulings JSONB array
    (SELECT json_agg(json_build_object('date', r.date::text, 'text', r.text) ORDER BY r.date)
     FROM card_rulings r
     WHERE r.uuid = c.uuid)                  AS rulings,

    -- foreign_data JSONB array (identifiers inlined per row)
    (SELECT json_agg(json_build_object(
        'language',    fd.language,
        'name',        fd.name,
        'face_name',   fd.face_name,
        'flavor_text', fd.flavor_text,
        'text',        fd.text,
        'type',        fd.type,
        'uuid',        fd.foreign_uuid,
        'identifiers', json_build_object(
            'abu_id',                                fd.abu_id,
            'card_kingdom_etched_id',                fd.card_kingdom_etched_id,
            'card_kingdom_foil_id',                  fd.card_kingdom_foil_id,
            'card_kingdom_id',                       fd.card_kingdom_id,
            'cardsphere_foil_id',                    fd.cardsphere_foil_id,
            'cardsphere_id',                         fd.cardsphere_id,
            'cardtrader_id',                         fd.cardtrader_id,
            'csi_id',                                fd.csi_id,
            'deckbox_id',                            fd.deckbox_id,
            'mcm_id',                                fd.mcm_id,
            'mcm_meta_id',                           fd.mcm_meta_id,
            'miniaturemarket_id',                    fd.miniaturemarket_id,
            'mtg_arena_id',                          fd.mtg_arena_id,
            'mtgjson_foil_version_id',               fd.mtgjson_foil_version_id,
            'mtgjson_non_foil_version_id',           fd.mtgjson_non_foil_version_id,
            'mtgjson_v4_id',                         fd.mtgjson_v4_id,
            'mtgo_foil_id',                          fd.mtgo_foil_id,
            'mtgo_id',                               fd.mtgo_id,
            'multiverse_id',                         fd.multiverse_id,
            'scg_id',                                fd.scg_id,
            'scryfall_card_back_id',                 fd.scryfall_card_back_id,
            'scryfall_id',                           fd.scryfall_id,
            'scryfall_illustration_id',              fd.scryfall_illustration_id,
            'scryfall_oracle_id',                    fd.scryfall_oracle_id,
            'tcgplayer_alternative_foil_product_id', fd.tcgplayer_alternative_foil_product_id,
            'tcgplayer_etched_product_id',           fd.tcgplayer_etched_product_id,
            'tcgplayer_product_id',                  fd.tcgplayer_product_id,
            'tnt_id',                                fd.tnt_id
        )
    ) ORDER BY fd.language)
     FROM card_foreign_data fd
     WHERE fd.uuid = c.uuid)                 AS foreign_data,

    -- related_cards JSONB (NULL when card has none)
    (SELECT CASE WHEN count(*) = 0 THEN NULL ELSE json_build_object(
        'reverse_related', array_agg(related_uuid) FILTER (WHERE relation_type = 'reverseRelated'),
        'spellbook',       array_agg(related_uuid) FILTER (WHERE relation_type = 'spellbook')
    ) END
     FROM card_related_cards
     WHERE card_uuid = c.uuid)               AS related_cards,

    -- source_products JSONB (NULL when card has none)
    (SELECT CASE WHEN count(*) = 0 THEN NULL ELSE json_build_object(
        'etched',   array_agg(sealed_product_uuid) FILTER (WHERE finish_type = 'etched'),
        'foil',     array_agg(sealed_product_uuid) FILTER (WHERE finish_type = 'foil'),
        'nonfoil',  array_agg(sealed_product_uuid) FILTER (WHERE finish_type = 'nonfoil')
    ) END
     FROM card_source_products
     WHERE card_uuid = c.uuid)               AS source_products

FROM cards c
LEFT JOIN card_identifiers   ci  ON ci.uuid  = c.uuid
LEFT JOIN card_purchase_urls cpu ON cpu.uuid = c.uuid
LEFT JOIN card_legalities    cl  ON cl.uuid  = c.uuid;

CREATE UNIQUE INDEX idx_v_cards_uuid        ON v_cards (uuid);
CREATE        INDEX idx_v_cards_set_code    ON v_cards (set_code);
CREATE        INDEX idx_v_cards_name        ON v_cards (name);
CREATE        INDEX idx_v_cards_scryfall_id ON v_cards (identifiers_scryfall_id);
CREATE        INDEX idx_v_cards_oracle_id   ON v_cards (identifiers_scryfall_oracle_id);
CREATE        INDEX idx_v_cards_color_identity ON v_cards USING GIN (color_identity);

-- ============================================================
-- v_tokens: tokens + identifiers + related_cards + source_products
-- token_products JSONB is already a column on tokens (stored at seed time)
-- ============================================================

CREATE MATERIALIZED VIEW v_tokens AS
SELECT
    t.*,

    -- identifiers (prefixed)
    ti.abu_id                                AS identifiers_abu_id,
    ti.card_kingdom_etched_id                AS identifiers_card_kingdom_etched_id,
    ti.card_kingdom_foil_id                  AS identifiers_card_kingdom_foil_id,
    ti.card_kingdom_id                       AS identifiers_card_kingdom_id,
    ti.cardsphere_foil_id                    AS identifiers_cardsphere_foil_id,
    ti.cardsphere_id                         AS identifiers_cardsphere_id,
    ti.cardtrader_id                         AS identifiers_cardtrader_id,
    ti.csi_id                                AS identifiers_csi_id,
    ti.deckbox_id                            AS identifiers_deckbox_id,
    ti.mcm_id                                AS identifiers_mcm_id,
    ti.mcm_meta_id                           AS identifiers_mcm_meta_id,
    ti.miniaturemarket_id                    AS identifiers_miniaturemarket_id,
    ti.mtg_arena_id                          AS identifiers_mtg_arena_id,
    ti.mtgjson_foil_version_id               AS identifiers_mtgjson_foil_version_id,
    ti.mtgjson_non_foil_version_id           AS identifiers_mtgjson_non_foil_version_id,
    ti.mtgjson_v4_id                         AS identifiers_mtgjson_v4_id,
    ti.mtgo_foil_id                          AS identifiers_mtgo_foil_id,
    ti.mtgo_id                               AS identifiers_mtgo_id,
    ti.multiverse_id                         AS identifiers_multiverse_id,
    ti.scg_id                                AS identifiers_scg_id,
    ti.scryfall_card_back_id                 AS identifiers_scryfall_card_back_id,
    ti.scryfall_id                           AS identifiers_scryfall_id,
    ti.scryfall_illustration_id              AS identifiers_scryfall_illustration_id,
    ti.scryfall_oracle_id                    AS identifiers_scryfall_oracle_id,
    ti.tcgplayer_alternative_foil_product_id AS identifiers_tcgplayer_alternative_foil_product_id,
    ti.tcgplayer_etched_product_id           AS identifiers_tcgplayer_etched_product_id,
    ti.tcgplayer_product_id                  AS identifiers_tcgplayer_product_id,
    ti.tnt_id                                AS identifiers_tnt_id,

    -- related_cards JSONB (NULL when token has none)
    (SELECT CASE WHEN count(*) = 0 THEN NULL ELSE json_build_object(
        'reverse_related', array_agg(related_uuid) FILTER (WHERE relation_type = 'reverseRelated'),
        'spellbook',       array_agg(related_uuid) FILTER (WHERE relation_type = 'spellbook')
    ) END
     FROM token_related_cards
     WHERE token_uuid = t.uuid)              AS related_cards,

    -- source_products: flat UUID array (CardToken.sourceProducts is string[])
    (SELECT array_agg(sealed_product_uuid)
     FROM token_source_products
     WHERE token_uuid = t.uuid)              AS source_products

FROM tokens t
LEFT JOIN token_identifiers ti ON ti.uuid = t.uuid;

CREATE UNIQUE INDEX idx_v_tokens_uuid        ON v_tokens (uuid);
CREATE        INDEX idx_v_tokens_set_code    ON v_tokens (set_code);
CREATE        INDEX idx_v_tokens_name        ON v_tokens (name);
CREATE        INDEX idx_v_tokens_scryfall_id ON v_tokens (identifiers_scryfall_id);
CREATE        INDEX idx_v_tokens_color_identity ON v_tokens USING GIN (color_identity);

-- ============================================================
-- v_sealed_products: sealed_product + identifiers + purchase_urls
-- Regular view (data is small; no materialization benefit worth the disk)
-- ============================================================

CREATE VIEW v_sealed_products AS
SELECT
    sp.*,

    -- identifiers (prefixed)
    si.abu_id                                AS identifiers_abu_id,
    si.card_kingdom_etched_id                AS identifiers_card_kingdom_etched_id,
    si.card_kingdom_foil_id                  AS identifiers_card_kingdom_foil_id,
    si.card_kingdom_id                       AS identifiers_card_kingdom_id,
    si.cardsphere_foil_id                    AS identifiers_cardsphere_foil_id,
    si.cardsphere_id                         AS identifiers_cardsphere_id,
    si.cardtrader_id                         AS identifiers_cardtrader_id,
    si.csi_id                                AS identifiers_csi_id,
    si.deckbox_id                            AS identifiers_deckbox_id,
    si.mcm_id                                AS identifiers_mcm_id,
    si.mcm_meta_id                           AS identifiers_mcm_meta_id,
    si.miniaturemarket_id                    AS identifiers_miniaturemarket_id,
    si.mtg_arena_id                          AS identifiers_mtg_arena_id,
    si.mtgjson_foil_version_id               AS identifiers_mtgjson_foil_version_id,
    si.mtgjson_non_foil_version_id           AS identifiers_mtgjson_non_foil_version_id,
    si.mtgjson_v4_id                         AS identifiers_mtgjson_v4_id,
    si.mtgo_foil_id                          AS identifiers_mtgo_foil_id,
    si.mtgo_id                               AS identifiers_mtgo_id,
    si.multiverse_id                         AS identifiers_multiverse_id,
    si.scg_id                                AS identifiers_scg_id,
    si.scryfall_card_back_id                 AS identifiers_scryfall_card_back_id,
    si.scryfall_id                           AS identifiers_scryfall_id,
    si.scryfall_illustration_id              AS identifiers_scryfall_illustration_id,
    si.scryfall_oracle_id                    AS identifiers_scryfall_oracle_id,
    si.tcgplayer_alternative_foil_product_id AS identifiers_tcgplayer_alternative_foil_product_id,
    si.tcgplayer_etched_product_id           AS identifiers_tcgplayer_etched_product_id,
    si.tcgplayer_product_id                  AS identifiers_tcgplayer_product_id,
    si.tnt_id                                AS identifiers_tnt_id,

    -- purchase URLs (prefixed)
    spu.card_kingdom                         AS purchase_urls_card_kingdom,
    spu.card_kingdom_etched                  AS purchase_urls_card_kingdom_etched,
    spu.card_kingdom_foil                    AS purchase_urls_card_kingdom_foil,
    spu.cardmarket                           AS purchase_urls_cardmarket,
    spu.tcgplayer                            AS purchase_urls_tcgplayer,
    spu.tcgplayer_alternative_foil           AS purchase_urls_tcgplayer_alternative_foil,
    spu.tcgplayer_etched                     AS purchase_urls_tcgplayer_etched

FROM sealed_product sp
LEFT JOIN sealed_product_identifiers   si  ON si.sealed_product_uuid  = sp.uuid
LEFT JOIN sealed_product_purchase_urls spu ON spu.sealed_product_uuid = sp.uuid;
