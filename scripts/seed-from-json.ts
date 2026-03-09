/**
 * CLI: full initial database seed from a local AllPrintings.json.
 * For day-to-day incremental updates use sdk.update() or sdk.checkForUpdates().
 *
 * Usage:
 *   DATABASE_URL=postgresql://user:pass@host/db \
 *   bun scripts/seed-from-json.ts [path/to/AllPrintings.json]
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { seedDatabase } from "../src/seeder.js";

// Legacy imports kept below — no longer used by main() but left for reference.
import { createReadStream } from "node:fs";
import { chain } from "stream-chain";
import parser from "stream-json";
import pick from "stream-json/filters/Pick.js";
import streamObject from "stream-json/streamers/StreamObject.js";
import streamValues from "stream-json/streamers/StreamValues.js";
import postgres from "postgres";
import type {
	CardSet,
	CardToken,
	DeckSet,
	Identifiers,
	LeadershipSkills,
	Legalities,
	PurchaseUrls,
	SealedProduct,
	Set as MTGSet,
	SourceProducts,
} from "../tempdata/ALLMTGJSONTypes.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AnyRow = Record<string, unknown>;

interface JunctionData {
	cardRelatedCards:    AnyRow[];
	tokenRelatedCards:   AnyRow[];
	cardSourceProducts:  AnyRow[];
	tokenSourceProducts: AnyRow[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapIdentifiers(ids: Identifiers | undefined): AnyRow {
	return {
		abu_id:                                ids?.abuId                             ?? null,
		card_kingdom_etched_id:                ids?.cardKingdomEtchedId               ?? null,
		card_kingdom_foil_id:                  ids?.cardKingdomFoilId                 ?? null,
		card_kingdom_id:                       ids?.cardKingdomId                     ?? null,
		cardsphere_foil_id:                    ids?.cardsphereFoilId                  ?? null,
		cardsphere_id:                         ids?.cardsphereId                      ?? null,
		cardtrader_id:                         ids?.cardtraderId                      ?? null,
		csi_id:                                ids?.csiId                             ?? null,
		deckbox_id:                            null,
		mcm_id:                                ids?.mcmId                             ?? null,
		mcm_meta_id:                           ids?.mcmMetaId                         ?? null,
		miniaturemarket_id:                    ids?.miniaturemarketId                 ?? null,
		mtg_arena_id:                          ids?.mtgArenaId                        ?? null,
		mtgjson_foil_version_id:               ids?.mtgjsonFoilVersionId              ?? null,
		mtgjson_non_foil_version_id:           ids?.mtgjsonNonFoilVersionId           ?? null,
		mtgjson_v4_id:                         ids?.mtgjsonV4Id                       ?? null,
		mtgo_foil_id:                          ids?.mtgoFoilId                        ?? null,
		mtgo_id:                               ids?.mtgoId                            ?? null,
		multiverse_id:                         ids?.multiverseId                      ?? null,
		scg_id:                                ids?.scgId                             ?? null,
		scryfall_card_back_id:                 ids?.scryfallCardBackId                ?? null,
		scryfall_id:                           ids?.scryfallId                        ?? null,
		scryfall_illustration_id:              ids?.scryfallIllustrationId            ?? null,
		scryfall_oracle_id:                    ids?.scryfallOracleId                  ?? null,
		tcgplayer_alternative_foil_product_id: ids?.tcgplayerAlternativeFoilProductId ?? null,
		tcgplayer_etched_product_id:           ids?.tcgplayerEtchedProductId          ?? null,
		tcgplayer_product_id:                  ids?.tcgplayerProductId                ?? null,
		tnt_id:                                ids?.tntId                             ?? null,
	};
}

// Matches the MTGJSON affiliate redirect base URL.
const MTGJSON_LINK_RE = /^https?:\/\/mtgjson\.com\/links\//;

/**
 * Transforms a raw purchase URL into a local redirect path.
 * MTGJSON affiliate links (https://mtgjson.com/links/<hex>) are replaced with
 * /links/<uuid>/<merchant> so your app controls the redirect and affiliate params.
 * Any URL that doesn't match the MTGJSON pattern is stored as-is.
 */
function transformPurchaseUrl(
	url: string | undefined,
	uuid: string,
	merchant: string,
): string | null {
	if (!url) return null;
	return MTGJSON_LINK_RE.test(url) ? `/links/${uuid}/${merchant}` : url;
}

function mapPurchaseUrls(urls: PurchaseUrls | undefined, uuid: string): AnyRow {
	const t = (url: string | undefined, merchant: string) =>
		transformPurchaseUrl(url, uuid, merchant);
	return {
		card_kingdom:               t(urls?.cardKingdom,              "cardKingdom"),
		card_kingdom_etched:        t(urls?.cardKingdomEtched,        "cardKingdomEtched"),
		card_kingdom_foil:          t(urls?.cardKingdomFoil,          "cardKingdomFoil"),
		cardmarket:                 t(urls?.cardmarket,               "cardmarket"),
		tcgplayer:                  t(urls?.tcgplayer,                "tcgplayer"),
		tcgplayer_alternative_foil: t(urls?.tcgplayerAlternativeFoil, "tcgplayerAlternativeFoil"),
		tcgplayer_etched:           t(urls?.tcgplayerEtched,          "tcgplayerEtched"),
	};
}

function mapLegalities(legalities: Legalities | undefined): AnyRow {
	return {
		alchemy:         legalities?.alchemy         ?? null,
		brawl:           legalities?.brawl           ?? null,
		commander:       legalities?.commander       ?? null,
		duel:            legalities?.duel            ?? null,
		explorer:        legalities?.explorer        ?? null,
		future:          legalities?.future          ?? null,
		gladiator:       legalities?.gladiator       ?? null,
		historic:        legalities?.historic        ?? null,
		historicbrawl:   legalities?.historicbrawl   ?? null,
		legacy:          legalities?.legacy          ?? null,
		modern:          legalities?.modern          ?? null,
		oathbreaker:     legalities?.oathbreaker     ?? null,
		oldschool:       legalities?.oldschool       ?? null,
		pauper:          legalities?.pauper          ?? null,
		paupercommander: legalities?.paupercommander ?? null,
		penny:           legalities?.penny           ?? null,
		pioneer:         legalities?.pioneer         ?? null,
		predh:           legalities?.predh           ?? null,
		premodern:       legalities?.premodern       ?? null,
		standard:        legalities?.standard        ?? null,
		standardbrawl:   legalities?.standardbrawl   ?? null,
		timeless:        legalities?.timeless        ?? null,
		vintage:         legalities?.vintage         ?? null,
	};
}

// ---------------------------------------------------------------------------
// Batch insert (postgres.js multi-row INSERT)
// Max PG params = 65535; with ~60-col tables use BATCH_SIZE ≤ 1000.
// ---------------------------------------------------------------------------

const BATCH_SIZE = 500;

// biome-ignore lint/suspicious/noExplicitAny: transaction and connection share same SQL API
async function batchInsert( db: any, table: string,rows: AnyRow[] ): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    for (const row of batch) {
      if (Object.values(row).some(v => v === undefined)) {
        console.error(`Undefined value found in table '${table}':`, row);
        throw new Error(`Undefined value in row for table '${table}'`);
      }
    }
    await db`INSERT INTO ${db(table)} ${db(batch)} ON CONFLICT DO NOTHING`;
  }
}

// ---------------------------------------------------------------------------
// Row builders
// ---------------------------------------------------------------------------

function buildSetRow(set: MTGSet): AnyRow {
	return {
		code:               set.code,
		name:               set.name               ?? null,
		type:               set.type               ?? null,
		release_date:       set.releaseDate        ?? null,
		base_set_size:      set.baseSetSize        ?? 0,
		total_set_size:     set.totalSetSize       ?? 0,
		block:              set.block              ?? null,
		cardsphere_set_id:  set.cardsphereSetId    ?? null,
		is_foil_only:       set.isFoilOnly         ?? false,
		is_foreign_only:    set.isForeignOnly      ?? null,
		is_non_foil_only:   set.isNonFoilOnly      ?? null,
		is_online_only:     set.isOnlineOnly       ?? false,
		is_paper_only:      set.isPaperOnly        ?? null,
		is_partial_preview: set.isPartialPreview   ?? null,
		keyrune_code:       set.keyruneCode        ?? null,
		languages:          set.languages          ?? null,
		mcm_id:             set.mcmId              ?? null,
		mcm_id_extras:      set.mcmIdExtras        ?? null,
		mcm_name:           set.mcmName            ?? null,
		mtgo_code:          set.mtgoCode           ?? null,
		parent_code:        set.parentCode         ?? null,
		tcgplayer_group_id: set.tcgplayerGroupId   ?? null,
		token_set_code:     set.tokenSetCode       ?? null,
	};
}

function buildTranslationRows(set: MTGSet): AnyRow[] {
	return Object.entries(set.translations)
		.filter(([, translation]) => !!translation)
		.map(([language, translation]) => ({ code: set.code, language, translation }));
}

function buildSealedProductRows(setCode: string, sps: SealedProduct[]) {
	const products: AnyRow[] = [];
	const identifiers: AnyRow[] = [];
	const purchaseUrls: AnyRow[] = [];
	const contents: AnyRow[] = [];

	for (const sp of sps) {
		products.push({
			uuid:         sp.uuid,
			set_code:     setCode,
			name:         sp.name,
			card_count:   sp.cardCount   ?? null,
			category:     sp.category    ?? null,
			subtype:      sp.subtype     ?? null,
			product_size: sp.productSize ?? null,
			release_date: sp.releaseDate ?? null,
		});
		identifiers.push({ sealed_product_uuid: sp.uuid, ...mapIdentifiers(sp.identifiers) });
		purchaseUrls.push({ sealed_product_uuid: sp.uuid, ...mapPurchaseUrls(sp.purchaseUrls, sp.uuid) });

		for (const item of sp.contents?.card ?? []) {
			contents.push({ uuid: sp.uuid, content_type: "card", name: item.name ?? null, set_code: item.set ?? null, foil: item.foil ?? null, number: item.number ?? null, card_uuid: item.uuid ?? null, code: null, count: null });
		}
		for (const item of sp.contents?.deck ?? []) {
			contents.push({ uuid: sp.uuid, content_type: "deck", name: item.name ?? null, set_code: item.set ?? null, foil: null, number: null, card_uuid: null, code: null, count: null });
		}
		for (const item of sp.contents?.other ?? []) {
			contents.push({ uuid: sp.uuid, content_type: "other", name: item.name ?? null, set_code: null, foil: null, number: null, card_uuid: null, code: null, count: null });
		}
		for (const item of sp.contents?.pack ?? []) {
			contents.push({ uuid: sp.uuid, content_type: "pack", name: null, set_code: item.set ?? null, foil: null, number: null, card_uuid: null, code: item.code ?? null, count: null });
		}
		for (const item of sp.contents?.sealed ?? []) {
			contents.push({ uuid: sp.uuid, content_type: "sealed", name: item.name ?? null, set_code: item.set ?? null, foil: null, number: null, card_uuid: item.uuid ?? null, code: null, count: item.count ?? null });
		}
		// contents.variable (recursive configs) is intentionally skipped
	}

	return { products, identifiers, purchaseUrls, contents };
}

function buildBoosterRows(set: MTGSet) {
	const sheets: AnyRow[] = [];
	const sheetCards: AnyRow[] = [];
	const contents: AnyRow[] = [];
	const contentWeights: AnyRow[] = [];

	for (const [boosterName, config] of Object.entries(set.booster ?? {})) {
		for (const [sheetName, sheet] of Object.entries(config.sheets)) {
			sheets.push({
				set_code:                 set.code,
				booster_name:             boosterName,
				sheet_name:               sheetName,
				sheet_is_foil:            sheet.foil           ?? null,
				sheet_has_balance_colors: sheet.balanceColors ?? null,
				sheet_total_weight:       sheet.totalWeight   ?? null,
			});
			for (const [cardUuid, cardWeight] of Object.entries(sheet.cards)) {
				sheetCards.push({ set_code: set.code, booster_name: boosterName, sheet_name: sheetName, card_uuid: cardUuid, card_weight: cardWeight });
			}
		}
		config.boosters.forEach((booster, boosterIndex) => {
			contentWeights.push({ set_code: set.code, booster_name: boosterName, booster_index: boosterIndex, booster_weight: booster.weight });
			for (const [sheetName, sheetPicks] of Object.entries(booster.contents)) {
				contents.push({ set_code: set.code, booster_name: boosterName, booster_index: boosterIndex, sheet_name: sheetName, sheet_picks: sheetPicks });
			}
		});
	}

	return { sheets, sheetCards, contents, contentWeights };
}

function buildDeckRows(setCode: string, decks: DeckSet[]) {
	const deckRows: AnyRow[] = [];
	const deckCardRows: AnyRow[] = [];

	for (const deck of decks) {
		deckRows.push({ code: deck.code, set_code: setCode, name: deck.name, type: deck.type, release_date: deck.releaseDate, sealed_product_uuids: deck.sealedProductUuids ?? null });
		for (const card of deck.commander ?? []) {
			deckCardRows.push({ deck_code: deck.code, board_type: "commander", uuid: card.uuid, count: card.count, is_foil: card.isFoil ?? null });
		}
		for (const card of deck.mainBoard) {
			deckCardRows.push({ deck_code: deck.code, board_type: "mainBoard", uuid: card.uuid, count: card.count, is_foil: card.isFoil ?? null });
		}
		for (const card of deck.sideBoard) {
			deckCardRows.push({ deck_code: deck.code, board_type: "sideBoard", uuid: card.uuid, count: card.count, is_foil: card.isFoil ?? null });
		}
	}

	return { deckRows, deckCardRows };
}

function buildCardRows(cards: CardSet[]) {
	const cardRows: AnyRow[] = [];
	const identifierRows: AnyRow[] = [];
	const legalityRows: AnyRow[] = [];
	const foreignDataRows: AnyRow[] = [];
	const rulingRows: AnyRow[] = [];
	const purchaseUrlRows: AnyRow[] = [];

	for (const card of cards) {
		const ls = card.leadershipSkills as LeadershipSkills | undefined;
		const c = card as CardSet & AnyRow;

		cardRows.push({
			uuid:                       card.uuid,
			set_code:                   card.setCode,
			artist:                     card.artist                  ?? null,
			artist_ids:                 card.artistIds               ?? null,
			ascii_name:                 card.asciiName               ?? null,
			attraction_lights:          card.attractionLights        ?? null,
			availability:               card.availability,
			booster_types:              card.boosterTypes            ?? null,
			border_color:               card.borderColor,
			card_parts:                 card.cardParts               ?? null,
			color_identity:             card.colorIdentity,
			color_indicator:            card.colorIndicator          ?? null,
			colors:                     card.colors,
			converted_mana_cost:        card.convertedManaCost       ?? null,
			defense:                    card.defense                 ?? null,
			duel_deck:                  card.duelDeck                ?? null,
			edhrec_rank:                card.edhrecRank              ?? null,
			edhrec_saltiness:           card.edhrecSaltiness         ?? null,
			face_converted_mana_cost:   card.faceConvertedManaCost   ?? null,
			face_flavor_name:           card.faceFlavorName          ?? null,
			face_mana_value:            card.faceManaValue           ?? null,
			face_name:                  card.faceName                ?? null,
			finishes:                   card.finishes,
			flavor_name:                card.flavorName              ?? null,
			flavor_text:                card.flavorText              ?? null,
			frame_effects:              card.frameEffects            ?? null,
			frame_version:              card.frameVersion,
			hand:                       card.hand                    ?? null,
			has_alternative_deck_limit: card.hasAlternativeDeckLimit ?? null,
			has_content_warning:        card.hasContentWarning       ?? null,
			is_alternative:             card.isAlternative           ?? null,
			is_full_art:                card.isFullArt               ?? null,
			is_funny:                   card.isFunny                 ?? null,
			is_game_changer:            card.isGameChanger           ?? null,
			is_online_only:             card.isOnlineOnly            ?? null,
			is_oversized:               card.isOversized             ?? null,
			is_promo:                   card.isPromo                 ?? null,
			is_rebalanced:              card.isRebalanced            ?? null,
			is_reprint:                 card.isReprint               ?? null,
			is_reserved:                card.isReserved              ?? null,
			is_story_spotlight:         card.isStorySpotlight        ?? null,
			is_textless:                card.isTextless              ?? null,
			is_timeshifted:             card.isTimeshifted           ?? null,
			keywords:                   card.keywords                ?? null,
			language:                   card.language,
			layout:                     card.layout,
			leadership_brawl:           ls?.brawl                   ?? null,
			leadership_commander:       ls?.commander               ?? null,
			leadership_oathbreaker:     ls?.oathbreaker             ?? null,
			life:                       card.life                    ?? null,
			loyalty:                    card.loyalty                 ?? null,
			mana_cost:                  card.manaCost                ?? null,
			mana_value:                 card.manaValue,
			name:                       card.name,
			number:                     card.number,
			original_printings:         card.originalPrintings       ?? null,
			original_release_date:      card.originalReleaseDate     ?? null,
			original_text:              card.originalText            ?? null,
			original_type:              card.originalType            ?? null,
			other_face_ids:             card.otherFaceIds            ?? null,
			power:                      card.power                   ?? null,
			printed_name:               (c.printedName as string)   ?? null,
			printed_text:               (c.printedText as string)   ?? null,
			printed_type:               (c.printedType as string)   ?? null,
			printings:                  card.printings               ?? null,
			promo_types:                card.promoTypes              ?? null,
			rarity:                     card.rarity,
			rebalanced_printings:       card.rebalancedPrintings     ?? null,
			security_stamp:             card.securityStamp           ?? null,
			side:                       card.side                    ?? null,
			signature:                  (c.signature as string)     ?? null,
			subsets:                    card.subsets                 ?? null,
			subtypes:                   card.subtypes,
			supertypes:                 card.supertypes,
			text:                       card.text                    ?? null,
			toughness:                  card.toughness               ?? null,
			type:                       card.type,
			types:                      card.types,
			variations:                 card.variations              ?? null,
			watermark:                  card.watermark               ?? null,
		});

		identifierRows.push({ uuid: card.uuid, ...mapIdentifiers(card.identifiers) });
		legalityRows.push({ uuid: card.uuid, ...mapLegalities((c.legalities as Legalities | undefined)) });
		purchaseUrlRows.push({ uuid: card.uuid, ...mapPurchaseUrls(card.purchaseUrls, card.uuid) });

		for (const fd of card.foreignData ?? []) {
			foreignDataRows.push({
				uuid:         card.uuid,
				language:     fd.language,
				name:         fd.name,
				face_name:    fd.faceName    ?? null,
				flavor_text:  fd.flavorText  ?? null,
				text:         fd.text        ?? null,
				type:         fd.type        ?? null,
				foreign_uuid: fd.uuid        ?? null,
				...mapIdentifiers(fd.identifiers),
			});
		}
		for (const ruling of card.rulings ?? []) {
			rulingRows.push({ uuid: card.uuid, date: ruling.date, text: ruling.text });
		}
	}

	return { cardRows, identifierRows, legalityRows, foreignDataRows, rulingRows, purchaseUrlRows };
}

function buildTokenRows(tokens: CardToken[]) {
	const tokenRows: AnyRow[] = [];
	const identifierRows: AnyRow[] = [];

	for (const token of tokens) {
		const t = token as CardToken & AnyRow;
		tokenRows.push({
			uuid:              token.uuid,
			set_code:          token.setCode,
			artist:            token.artist           ?? null,
			artist_ids:        token.artistIds         ?? null,
			ascii_name:        token.asciiName         ?? null,
			attraction_lights: token.attractionLights  ?? null,
			availability:      token.availability,
			booster_types:     token.boosterTypes      ?? null,
			border_color:      token.borderColor,
			card_parts:        token.cardParts          ?? null,
			color_identity:    token.colorIdentity,
			color_indicator:   token.colorIndicator    ?? null,
			colors:            token.colors,
			edhrec_saltiness:  token.edhrecSaltiness   ?? null,
			face_flavor_name:  token.faceFlavorName     ?? null,
			face_name:         token.faceName           ?? null,
			finishes:          token.finishes,
			flavor_name:       token.flavorName         ?? null,
			flavor_text:       token.flavorText         ?? null,
			frame_effects:     token.frameEffects       ?? null,
			frame_version:     token.frameVersion,
			is_full_art:       token.isFullArt          ?? null,
			is_funny:          token.isFunny            ?? null,
			is_online_only:    token.isOnlineOnly        ?? null,
			is_oversized:      token.isOversized         ?? null,
			is_promo:          token.isPromo             ?? null,
			is_reprint:        token.isReprint           ?? null,
			is_textless:       token.isTextless          ?? null,
			keywords:          token.keywords           ?? null,
			language:          token.language,
			layout:            token.layout,
			loyalty:           token.loyalty            ?? null,
			mana_cost:         token.manaCost           ?? null,
			name:              token.name,
			number:            token.number,
			orientation:       token.orientation        ?? null,
			original_text:     token.originalText       ?? null,
			original_type:     token.originalType       ?? null,
			other_face_ids:    token.otherFaceIds        ?? null,
			power:             token.power              ?? null,
			printed_type:      (t.printedType as string) ?? null,
			produced_mana:     (t.producedMana as string[] | undefined) ?? null,
			promo_types:       token.promoTypes          ?? null,
			security_stamp:    token.securityStamp       ?? null,
			side:              token.side               ?? null,
			signature:         (t.signature as string)  ?? null,
			subsets:           token.subsets            ?? null,
			subtypes:          token.subtypes,
			supertypes:        token.supertypes,
			text:              token.text               ?? null,
			toughness:         token.toughness          ?? null,
			token_products:    token.tokenProducts      ?? null,
			type:              token.type,
			types:             token.types,
			watermark:         token.watermark          ?? null,
		});

		identifierRows.push({ uuid: token.uuid, ...mapIdentifiers(token.identifiers) });
	}

	return { tokenRows, identifierRows };
}

function collectJunctions(junctions: JunctionData, cards: CardSet[], tokens: CardToken[]): void {
	for (const card of cards) {
		const rc = card.relatedCards;
		if (rc) {
			for (const relatedUuid of rc.reverseRelated ?? []) {
				junctions.cardRelatedCards.push({ card_uuid: card.uuid, relation_type: "reverseRelated", related_uuid: relatedUuid });
			}
			for (const relatedUuid of rc.spellbook ?? []) {
				junctions.cardRelatedCards.push({ card_uuid: card.uuid, relation_type: "spellbook", related_uuid: relatedUuid });
			}
		}
		const sp = card.sourceProducts as SourceProducts | undefined;
		if (sp) {
			for (const sealedProductUuid of sp.etched  ?? []) junctions.cardSourceProducts.push({ card_uuid: card.uuid, finish_type: "etched",   sealed_product_uuid: sealedProductUuid });
			for (const sealedProductUuid of sp.foil    ?? []) junctions.cardSourceProducts.push({ card_uuid: card.uuid, finish_type: "foil",     sealed_product_uuid: sealedProductUuid });
			for (const sealedProductUuid of sp.nonfoil ?? []) junctions.cardSourceProducts.push({ card_uuid: card.uuid, finish_type: "nonfoil",  sealed_product_uuid: sealedProductUuid });
		}
	}

	for (const token of tokens) {
		const rc = token.relatedCards;
		if (rc) {
			for (const relatedUuid of rc.reverseRelated ?? []) {
				junctions.tokenRelatedCards.push({ token_uuid: token.uuid, relation_type: "reverseRelated", related_uuid: relatedUuid });
			}
			for (const relatedUuid of rc.spellbook ?? []) {
				junctions.tokenRelatedCards.push({ token_uuid: token.uuid, relation_type: "spellbook", related_uuid: relatedUuid });
			}
		}
    if (Array.isArray(token.sourceProducts)) {
      for (const sealedProductUuid of token.sourceProducts) {
        junctions.tokenSourceProducts.push({ token_uuid: token.uuid, sealed_product_uuid: sealedProductUuid });
      }
    }
	}
}

// ---------------------------------------------------------------------------
// Process one set inside a transaction
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: transaction type not easily parameterised
async function processSet(tx: any, set: MTGSet, junctions: JunctionData): Promise<void> {
	// 1. Set
	await tx`INSERT INTO sets ${tx([buildSetRow(set)])} ON CONFLICT DO NOTHING`;

	// 2. Translations
	const translationRows = buildTranslationRows(set);
	await batchInsert(tx, "set_translations", translationRows);

	// 3. Sealed products (FK: sets)
	const sps = set.sealedProduct ?? [];
	if (sps.length > 0) {
		const sp = buildSealedProductRows(set.code, sps);
		await batchInsert(tx, "sealed_product",              sp.products);
		await batchInsert(tx, "sealed_product_identifiers",  sp.identifiers);
		await batchInsert(tx, "sealed_product_purchase_urls", sp.purchaseUrls);
		await batchInsert(tx, "sealed_product_contents",     sp.contents);
	}

	// 4. Boosters (FK: sets)
	const boosters = buildBoosterRows(set);
	await batchInsert(tx, "set_booster_sheets",          boosters.sheets);
	await batchInsert(tx, "set_booster_sheet_cards",     boosters.sheetCards);
	await batchInsert(tx, "set_booster_contents",        boosters.contents);
	await batchInsert(tx, "set_booster_content_weights", boosters.contentWeights);

	// 5. Decks (FK: sets)
	const decks = buildDeckRows(set.code, set.decks ?? []);
	await batchInsert(tx, "set_decks",      decks.deckRows);
	await batchInsert(tx, "set_deck_cards", decks.deckCardRows);

	// 6. Cards + sub-tables (FK: sets, then FK: cards for sub-tables)
	if (set.cards.length > 0) {
		const c = buildCardRows(set.cards);
		await batchInsert(tx, "cards",            c.cardRows);
		await batchInsert(tx, "card_identifiers", c.identifierRows);
		await batchInsert(tx, "card_legalities",  c.legalityRows);
		await batchInsert(tx, "card_foreign_data", c.foreignDataRows);
		await batchInsert(tx, "card_rulings",     c.rulingRows);
		await batchInsert(tx, "card_purchase_urls", c.purchaseUrlRows);
	}

	// 7. Tokens + identifiers (FK: sets)
	if (set.tokens.length > 0) {
		const t = buildTokenRows(set.tokens);
		await batchInsert(tx, "tokens",            t.tokenRows);
		await batchInsert(tx, "token_identifiers", t.identifierRows);
	}

	// 8. Buffer junction rows for post-stream phase
	collectJunctions(junctions, set.cards, set.tokens);
}

// ---------------------------------------------------------------------------
// Streaming helpers
// ---------------------------------------------------------------------------

/** Read only the "meta" top-level key. Terminates early — does not scan the
 *  whole file. */
async function readMeta(jsonPath: string): Promise<{ date: string; version: string }> {
	const pipeline = chain([
		createReadStream(jsonPath),
		parser(),
		new pick({ filter: "meta" }),
		new streamValues(),
	]);

	for await (const { value } of pipeline as AsyncIterable<{ value: { date: string; version: string } }>) {
		return value;
	}

	throw new Error(`Could not find "meta" key in ${jsonPath}`);
}

/** Stream the "data" object, yielding one fully-assembled set object at a time.
 *  Memory footprint: one set in memory at a time (plus junction buffers). */
async function streamSets(
	jsonPath: string,
	onSet: (setCode: string, set: MTGSet) => Promise<void>,
): Promise<number> {
	const pipeline = chain([
		createReadStream(jsonPath),
		parser(),
		new pick({ filter: "data" }),
		new streamObject(),
	]);

	let count = 0;
	for await (const { key, value } of pipeline as AsyncIterable<{ key: string; value: MTGSet }>) {
		await onSet(key, value);
		count++;
	}
	return count;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	const connStr = process.env.DATABASE_URL;
	if (!connStr) {
		console.error("Error: DATABASE_URL environment variable is required.");
		process.exit(1);
	}

	const jsonPath  = process.argv[2] ?? "./tempdata/AllPrintings.json";
	const schemaDir = join(fileURLToPath(import.meta.url), "..", ".");
	console.log(`Seeding from ${jsonPath} …\n`);

	let lastSet = "";
	const result = await seedDatabase(connStr, jsonPath, {
		schemaDir,
		onProgress: ({ setCode, setCount, cardCount, tokenCount }) => {
			lastSet = setCode;
			process.stdout.write(`\r  Sets: ${setCount}  Cards: ${cardCount}  Tokens: ${tokenCount}  (${setCode})            `);
		},
	});

	console.log(`\r  Done: ${result.sets} sets, ${result.cards} cards, ${result.tokens} tokens (last: ${lastSet}).           `);
	console.log(`\nSeed complete — MTGJSON ${result.version} (${result.date})`);
}

main().catch((err) => {
	process.stderr.write("\n");
	console.error(err);
	process.exit(1);
});
// ──────────────────────────────────────────────────────────────────────────────
// Legacy implementations below — superseded by src/seeder.ts
// These are kept for reference but are NOT called by main().
// ──────────────────────────────────────────────────────────────────────────────
