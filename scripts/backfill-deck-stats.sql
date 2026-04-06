-- One-time backfill: compute and populate stats JSONB on all existing set_decks rows.
-- Run with: psql $DATABASE_URL -f scripts/backfill-deck-stats.sql

UPDATE set_decks sd
SET stats = sub.stats
FROM (
    SELECT
        sdc.deck_code,
        jsonb_build_object(
            'totalCards',      SUM(sdc.count),
            'uniqueCards',     COUNT(DISTINCT sdc.uuid),
            'avgManaValue',    COALESCE(
                                   ROUND(
                                       SUM(CASE WHEN NOT ('Land' = ANY(c.types)) THEN c.mana_value * sdc.count ELSE 0 END)::numeric
                                       / NULLIF(SUM(CASE WHEN NOT ('Land' = ANY(c.types)) THEN sdc.count ELSE 0 END), 0),
                                   2),
                               0),
            'landCount',       SUM(CASE WHEN 'Land' = ANY(c.types) THEN sdc.count ELSE 0 END),
            'colorIdentity',   COALESCE(
                                   (SELECT jsonb_agg(DISTINCT ci ORDER BY ci)
                                    FROM set_deck_cards sdc2
                                    JOIN cards c2 ON c2.uuid = sdc2.uuid
                                    CROSS JOIN LATERAL unnest(c2.color_identity) AS ci
                                    WHERE sdc2.deck_code = sdc.deck_code),
                               '[]'::jsonb),
            'creatureCount',     SUM(CASE WHEN 'Creature' = ANY(c.types) THEN sdc.count ELSE 0 END),
            'instantCount',      SUM(CASE WHEN 'Instant' = ANY(c.types) THEN sdc.count ELSE 0 END),
            'sorceryCount',      SUM(CASE WHEN 'Sorcery' = ANY(c.types) THEN sdc.count ELSE 0 END),
            'enchantmentCount',  SUM(CASE WHEN 'Enchantment' = ANY(c.types) THEN sdc.count ELSE 0 END),
            'artifactCount',     SUM(CASE WHEN 'Artifact' = ANY(c.types) THEN sdc.count ELSE 0 END),
            'planeswalkerCount', SUM(CASE WHEN 'Planeswalker' = ANY(c.types) THEN sdc.count ELSE 0 END),
            'battleCount',       SUM(CASE WHEN 'Battle' = ANY(c.types) THEN sdc.count ELSE 0 END),
            'multiTypeCount',    SUM(CASE WHEN array_length(c.types, 1) > 1 THEN sdc.count ELSE 0 END)
        ) AS stats
    FROM set_deck_cards sdc
    LEFT JOIN cards c ON c.uuid = sdc.uuid
    GROUP BY sdc.deck_code
) sub
WHERE sd.code = sub.deck_code;
