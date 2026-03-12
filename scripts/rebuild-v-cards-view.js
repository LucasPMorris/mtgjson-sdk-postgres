import postgres from "postgres";

const connectionUrl = process.argv[2] ?? process.env.DATABASE_URL;

if (!connectionUrl) {
	console.error("Usage: node scripts/rebuild-v-cards-view.js <postgres-connection-url>");
	console.error("Or set DATABASE_URL in the environment.");
	process.exit(1);
}

const db = postgres(connectionUrl, { max: 1 });

const SQL = `
DROP MATERIALIZED VIEW IF EXISTS v_cards CASCADE;

CREATE MATERIALIZED VIEW v_cards AS
SELECT
    c.*,

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

    cpu.card_kingdom                         AS purchase_urls_card_kingdom,
    cpu.card_kingdom_etched                  AS purchase_urls_card_kingdom_etched,
    cpu.card_kingdom_foil                    AS purchase_urls_card_kingdom_foil,
    cpu.cardmarket                           AS purchase_urls_cardmarket,
    cpu.tcgplayer                            AS purchase_urls_tcgplayer,
    cpu.tcgplayer_alternative_foil           AS purchase_urls_tcgplayer_alternative_foil,
    cpu.tcgplayer_etched                     AS purchase_urls_tcgplayer_etched,

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

    json_build_object(
        'brawl',       c.leadership_brawl,
        'commander',   c.leadership_commander,
        'oathbreaker', c.leadership_oathbreaker
    )                                        AS leadership_skills,

    (SELECT json_agg(json_build_object('date', r.date::text, 'text', r.text) ORDER BY r.date)
     FROM card_rulings r
     WHERE r.uuid = c.uuid)                  AS rulings,

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

    (SELECT CASE WHEN count(*) = 0 THEN NULL ELSE json_build_object(
        'reverse_related', array_agg(related_uuid) FILTER (WHERE relation_type = 'reverseRelated'),
        'spellbook',       array_agg(related_uuid) FILTER (WHERE relation_type = 'spellbook')
    ) END
     FROM card_related_cards
     WHERE card_uuid = c.uuid)               AS related_cards,

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
`;

try {
	await db.unsafe(SQL);
	console.log("Rebuilt v_cards materialized view.");
} catch (error) {
	console.error("Failed to rebuild v_cards:", error);
	process.exitCode = 1;
} finally {
	await db.end();
}
