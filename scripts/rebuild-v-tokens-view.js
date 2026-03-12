import postgres from "postgres";

const connectionUrl = process.argv[2] ?? process.env.DATABASE_URL;

if (!connectionUrl) {
	console.error("Usage: node scripts/rebuild-v-tokens-view.js <postgres-connection-url>");
	console.error("Or set DATABASE_URL in the environment.");
	process.exit(1);
}

const db = postgres(connectionUrl, { max: 1 });

const SQL = `
DROP MATERIALIZED VIEW IF EXISTS v_tokens CASCADE;

CREATE MATERIALIZED VIEW v_tokens AS
SELECT
    t.*, 

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

    (SELECT CASE WHEN count(*) = 0 THEN NULL ELSE json_build_object(
        'reverse_related', array_agg(related_uuid) FILTER (WHERE relation_type = 'reverseRelated'),
        'spellbook',       array_agg(related_uuid) FILTER (WHERE relation_type = 'spellbook')
    ) END
     FROM token_related_cards
     WHERE token_uuid = t.uuid)              AS related_cards,

    (SELECT array_agg(sealed_product_uuid)
     FROM token_source_products
     WHERE token_uuid = t.uuid)              AS source_products

FROM tokens t
LEFT JOIN token_identifiers ti ON ti.uuid = t.uuid;

CREATE UNIQUE INDEX idx_v_tokens_uuid        ON v_tokens (uuid);
CREATE        INDEX idx_v_tokens_set_code    ON v_tokens (set_code);
CREATE        INDEX idx_v_tokens_set_name    ON v_tokens (set_name);
CREATE        INDEX idx_v_tokens_name        ON v_tokens (name);
CREATE        INDEX idx_v_tokens_scryfall_id ON v_tokens (identifiers_scryfall_id);
CREATE        INDEX idx_v_tokens_color_identity ON v_tokens USING GIN (color_identity);
`;

try {
	await db.unsafe(SQL);
	console.log("Rebuilt v_tokens materialized view.");
} catch (error) {
	console.error("Failed to rebuild v_tokens:", error);
	process.exitCode = 1;
} finally {
	await db.end();
}
