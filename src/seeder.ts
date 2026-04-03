/**
 * Core database seeding logic extracted from scripts/seed-from-json.ts.
 * Exported so it can be called programmatically (e.g. from sdk.update()).
 */
import { createReadStream, readFileSync } from "node:fs";
import { get as httpsGet } from "node:https";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { chain } from "stream-chain";
import parser from "stream-json";
import pick from "stream-json/filters/Pick.js";
import streamObject from "stream-json/streamers/StreamObject.js";
import streamValues from "stream-json/streamers/StreamValues.js";
import postgres from "postgres";
import { CDN_BASE } from "./config.js";
import type { CardSet, CardToken, CardTypes, DeckSet, Identifiers, Keywords, LeadershipSkills, Legalities, PurchaseUrls, SealedProduct, Set as MTGSet, SourceProducts } from "./types";

// ── Types ─────────────────────────────────────────────────────────────────────

type AnyRow = Record<string, unknown>;

interface JunctionData { cardRelatedCards: AnyRow[]; tokenRelatedCards: AnyRow[];	cardSourceProducts:  AnyRow[];	tokenSourceProducts: AnyRow[]; }

export interface SeedProgress {	setCode: string; setCount: number; cardCount: number;	tokenCount: number; }
export interface SeedResult {	version: string; date: string; sets: number; cards: number;	tokens: number; }
export interface SeedOptions { schemaDir?: string; onProgress?: (progress: SeedProgress) => void; } 	/** Directory containing schema.sql and relations.sql.*  Defaults to the `scripts/` directory bundled with the SDK package. */

// ── Default schema directory (resolved relative to the compiled dist file) ────
function defaultSchemaDir(): string {
	// Works whether running from source (src/) or installed package (dist/).
	const here = typeof __dirname !== "undefined"
		? __dirname                           // CJS
		: dirname(fileURLToPath(import.meta.url)); // ESM
	return join(here, "..", "scripts");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

const MTGJSON_LINK_RE = /^https?:\/\/mtgjson\.com\/links\//;
function transformPurchaseUrl(url: string | undefined, uuid: string, merchant: string): string | null {
	if (!url) return null;
	return MTGJSON_LINK_RE.test(url) ? `/links/${uuid}/${merchant}` : url;
}

function mapPurchaseUrls(urls: PurchaseUrls | undefined, uuid: string): AnyRow {
	const t = (url: string | undefined, m: string) => transformPurchaseUrl(url, uuid, m);
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
		alchemy: legalities?.alchemy ?? null, brawl: legalities?.brawl ?? null, commander: legalities?.commander ?? null,
		duel: legalities?.duel ?? null, explorer: legalities?.explorer ?? null, future: legalities?.future ?? null,
		gladiator: legalities?.gladiator ?? null, historic: legalities?.historic ?? null, historicbrawl: legalities?.historicbrawl ?? null,
		legacy: legalities?.legacy ?? null, modern: legalities?.modern ?? null, oathbreaker: legalities?.oathbreaker ?? null,
		oldschool: legalities?.oldschool ?? null, pauper: legalities?.pauper ?? null, paupercommander: legalities?.paupercommander ?? null,
		penny: legalities?.penny ?? null, pioneer: legalities?.pioneer ?? null, predh: legalities?.predh ?? null,
		premodern: legalities?.premodern ?? null, standard: legalities?.standard ?? null, standardbrawl: legalities?.standardbrawl ?? null,
		timeless: legalities?.timeless ?? null, vintage: legalities?.vintage ?? null,
	};
}

const BATCH_SIZE = 500;
// biome-ignore lint/suspicious/noExplicitAny: postgres.js transaction type
async function batchInsert(db: any, table: string, rows: AnyRow[]): Promise<void> {
	if (rows.length === 0) return;
	for (let i = 0; i < rows.length; i += BATCH_SIZE) {
		const batch = rows.slice(i, i + BATCH_SIZE);
		await db`INSERT INTO ${db(table)} ${db(batch)} ON CONFLICT DO NOTHING`;
	}
}

// ── Row builders ──────────────────────────────────────────────────────────────

function buildSetRow(set: MTGSet): AnyRow {
	return {
		code: set.code, name: set.name ?? null, type: set.type ?? null,
		release_date: set.releaseDate ?? null, base_set_size: set.baseSetSize ?? 0,
		total_set_size: set.totalSetSize ?? 0, block: set.block ?? null,
		cardsphere_set_id: set.cardsphereSetId ?? null, is_foil_only: set.isFoilOnly ?? false,
		is_foreign_only: set.isForeignOnly ?? null, is_non_foil_only: set.isNonFoilOnly ?? null,
		is_online_only: set.isOnlineOnly ?? false, is_paper_only: set.isPaperOnly ?? null,
		is_partial_preview: set.isPartialPreview ?? null, keyrune_code: set.keyruneCode ?? null,
		languages: set.languages ?? null, mcm_id: set.mcmId ?? null, mcm_id_extras: set.mcmIdExtras ?? null,
		mcm_name: set.mcmName ?? null, mtgo_code: set.mtgoCode ?? null, parent_code: set.parentCode ?? null,
		tcgplayer_group_id: set.tcgplayerGroupId ?? null, token_set_code: set.tokenSetCode ?? null,
	};
}
function buildTranslationRows(set: MTGSet): AnyRow[] {
	return Object.entries(set.translations)
		.filter(([, t]) => !!t)
		.map(([language, translation]) => ({ code: set.code, language, translation }));
}

function buildSealedProductRows(setCode: string, sps: SealedProduct[]) {
	const products: AnyRow[] = [], identifiers: AnyRow[] = [], purchaseUrls: AnyRow[] = [], contents: AnyRow[] = [];
	for (const sp of sps) {
		products.push({ uuid: sp.uuid, set_code: setCode, name: sp.name, card_count: sp.cardCount ?? null, category: sp.category ?? null, subtype: sp.subtype ?? null, product_size: sp.productSize ?? null, release_date: sp.releaseDate ?? null });
		identifiers.push({ sealed_product_uuid: sp.uuid, ...mapIdentifiers(sp.identifiers) });
		purchaseUrls.push({ sealed_product_uuid: sp.uuid, ...mapPurchaseUrls(sp.purchaseUrls, sp.uuid) });
		for (const item of sp.contents?.card   ?? []) contents.push({ uuid: sp.uuid, content_type: "card",   name: item.name ?? null, set_code: item.set ?? null, foil: item.foil ?? null,  number: item.number ?? null, card_uuid: item.uuid ?? null, code: null, count: null });
		for (const item of sp.contents?.deck   ?? []) contents.push({ uuid: sp.uuid, content_type: "deck",   name: item.name ?? null, set_code: item.set ?? null, foil: null, number: null, card_uuid: null, code: null, count: null });
		for (const item of sp.contents?.other  ?? []) contents.push({ uuid: sp.uuid, content_type: "other",  name: item.name ?? null, set_code: null, foil: null, number: null, card_uuid: null, code: null, count: null });
		for (const item of sp.contents?.pack   ?? []) contents.push({ uuid: sp.uuid, content_type: "pack",   name: null, set_code: item.set ?? null, foil: null, number: null, card_uuid: null, code: (item as AnyRow).code as string ?? null, count: null });
		for (const item of sp.contents?.sealed ?? []) contents.push({ uuid: sp.uuid, content_type: "sealed", name: item.name ?? null, set_code: item.set ?? null, foil: null, number: null, card_uuid: item.uuid ?? null, code: null, count: item.count ?? null });
	}
	return { products, identifiers, purchaseUrls, contents };
}

function buildBoosterRows(set: MTGSet) {
	const sheets: AnyRow[] = [], sheetCards: AnyRow[] = [], contents: AnyRow[] = [], contentWeights: AnyRow[] = [];
	for (const [boosterName, config] of Object.entries(set.booster ?? {})) {
		for (const [sheetName, sheet] of Object.entries(config.sheets)) {
			sheets.push({ set_code: set.code, booster_name: boosterName, sheet_name: sheetName, sheet_is_foil: sheet.foil ?? null, sheet_has_balance_colors: sheet.balanceColors ?? null, sheet_total_weight: sheet.totalWeight ?? null });
			for (const [cardUuid, cardWeight] of Object.entries(sheet.cards)) sheetCards.push({ set_code: set.code, booster_name: boosterName, sheet_name: sheetName, card_uuid: cardUuid, card_weight: cardWeight });
		}
		config.boosters.forEach((booster, boosterIndex) => {
			contentWeights.push({ set_code: set.code, booster_name: boosterName, booster_index: boosterIndex, booster_weight: booster.weight });
			for (const [sheetName, sheetPicks] of Object.entries(booster.contents)) contents.push({ set_code: set.code, booster_name: boosterName, booster_index: boosterIndex, sheet_name: sheetName, sheet_picks: sheetPicks });
		});
	}
	return { sheets, sheetCards, contents, contentWeights };
}

function buildDeckRows(setCode: string, decks: DeckSet[]) {
	const deckRows: AnyRow[] = [], deckCardRows: AnyRow[] = [];
	for (const deck of decks) {
		deckRows.push({ code: deck.code, set_code: setCode, name: deck.name, type: deck.type, release_date: deck.releaseDate, sealed_product_uuids: deck.sealedProductUuids ?? null });
		for (const card of deck.commander ?? []) deckCardRows.push({ deck_code: deck.code, board_type: "commander", uuid: card.uuid, count: card.count, is_foil: card.isFoil ?? null });
		for (const card of deck.mainBoard)        deckCardRows.push({ deck_code: deck.code, board_type: "mainBoard",  uuid: card.uuid, count: card.count, is_foil: card.isFoil ?? null });
		for (const card of deck.sideBoard)        deckCardRows.push({ deck_code: deck.code, board_type: "sideBoard",  uuid: card.uuid, count: card.count, is_foil: card.isFoil ?? null });
	}
	return { deckRows, deckCardRows };
}

function buildCardRows(cards: CardSet[], setName: string) {
	const cardRows: AnyRow[] = [], identifierRows: AnyRow[] = [], legalityRows: AnyRow[] = [],
	      foreignDataRows: AnyRow[] = [], rulingRows: AnyRow[] = [], purchaseUrlRows: AnyRow[] = [];
	for (const card of cards) {
		const ls = card.leadershipSkills as LeadershipSkills | undefined;
		const c  = card as CardSet & AnyRow;
		cardRows.push({
			uuid: card.uuid, set_code: card.setCode, set_name: card.setName ?? setName, artist: card.artist ?? null, artist_ids: card.artistIds ?? null,
			ascii_name: card.asciiName ?? null, attraction_lights: card.attractionLights ?? null,
			availability: card.availability, booster_types: card.boosterTypes ?? null, border_color: card.borderColor,
			card_parts: card.cardParts ?? null, color_identity: card.colorIdentity, color_indicator: card.colorIndicator ?? null,
			colors: card.colors, converted_mana_cost: card.convertedManaCost ?? null, defense: card.defense ?? null,
			duel_deck: card.duelDeck ?? null, edhrec_rank: card.edhrecRank ?? null, edhrec_saltiness: card.edhrecSaltiness ?? null,
			face_converted_mana_cost: card.faceConvertedManaCost ?? null, face_flavor_name: card.faceFlavorName ?? null,
			face_mana_value: card.faceManaValue ?? null, face_name: card.faceName ?? null, finishes: card.finishes,
			flavor_name: card.flavorName ?? null, flavor_text: card.flavorText ?? null, frame_effects: card.frameEffects ?? null,
			frame_version: card.frameVersion, hand: card.hand ?? null, has_alternative_deck_limit: card.hasAlternativeDeckLimit ?? null,
			has_content_warning: card.hasContentWarning ?? null, is_alternative: card.isAlternative ?? null,
			is_full_art: card.isFullArt ?? null, is_funny: card.isFunny ?? null, is_game_changer: card.isGameChanger ?? null,
			is_online_only: card.isOnlineOnly ?? null, is_oversized: card.isOversized ?? null, is_promo: card.isPromo ?? null,
			is_rebalanced: card.isRebalanced ?? null, is_reprint: card.isReprint ?? null, is_reserved: card.isReserved ?? null,
			is_story_spotlight: card.isStorySpotlight ?? null, is_textless: card.isTextless ?? null,
			is_timeshifted: card.isTimeshifted ?? null, keywords: card.keywords ?? null, language: card.language,
			layout: card.layout, leadership_brawl: ls?.brawl ?? null, leadership_commander: ls?.commander ?? null,
			leadership_oathbreaker: ls?.oathbreaker ?? null, life: card.life ?? null, loyalty: card.loyalty ?? null,
			mana_cost: card.manaCost ?? null, mana_value: card.manaValue, name: card.name, number: card.number,
			original_printings: card.originalPrintings ?? null, original_release_date: card.originalReleaseDate ?? null,
			original_text: card.originalText ?? null, original_type: card.originalType ?? null,
			other_face_ids: card.otherFaceIds ?? null, power: card.power ?? null,
			printed_name: (c.printedName as string) ?? null, printed_text: (c.printedText as string) ?? null,
			printed_type: (c.printedType as string) ?? null, face_printed_name: (c.facePrintedName as string) ?? null,
			printings: card.printings ?? null, promo_types: card.promoTypes ?? null, rarity: card.rarity,
			rebalanced_printings: card.rebalancedPrintings ?? null, security_stamp: card.securityStamp ?? null,
			side: card.side ?? null, signature: (c.signature as string) ?? null, subsets: card.subsets ?? null,
			subtypes: card.subtypes, supertypes: card.supertypes, text: card.text ?? null,
			toughness: card.toughness ?? null, type: card.type, types: card.types,
			variations: card.variations ?? null, watermark: card.watermark ?? null,
		});
		identifierRows.push({ uuid: card.uuid, ...mapIdentifiers(card.identifiers) });
		legalityRows.push({ uuid: card.uuid, ...mapLegalities((c.legalities as Legalities | undefined)) });
		purchaseUrlRows.push({ uuid: card.uuid, ...mapPurchaseUrls(card.purchaseUrls, card.uuid) });
		for (const fd of card.foreignData ?? []) foreignDataRows.push({ uuid: card.uuid, language: fd.language, name: fd.name, face_name: fd.faceName ?? null, flavor_text: fd.flavorText ?? null, text: fd.text ?? null, type: fd.type ?? null, foreign_uuid: fd.uuid ?? null, ...mapIdentifiers(fd.identifiers) });
		for (const ruling of card.rulings ?? []) rulingRows.push({ uuid: card.uuid, date: ruling.date, text: ruling.text });
	}
	return { cardRows, identifierRows, legalityRows, foreignDataRows, rulingRows, purchaseUrlRows };
}

function buildTokenRows(tokens: CardToken[], setName: string, tokenSetCode?: string) {
	const tokenRows: AnyRow[] = [], identifierRows: AnyRow[] = [];
	for (const token of tokens) {
		const t = token as CardToken & AnyRow;
		tokenRows.push({
			uuid: token.uuid, set_code: tokenSetCode ?? token.setCode, set_name: token.setName ?? setName, artist: token.artist ?? null, artist_ids: token.artistIds ?? null,
			ascii_name: token.asciiName ?? null, attraction_lights: token.attractionLights ?? null,
			availability: token.availability, booster_types: token.boosterTypes ?? null, border_color: token.borderColor,
			card_parts: token.cardParts ?? null, color_identity: token.colorIdentity, color_indicator: token.colorIndicator ?? null,
			colors: token.colors, edhrec_saltiness: token.edhrecSaltiness ?? null, face_flavor_name: token.faceFlavorName ?? null,
			face_name: token.faceName ?? null, finishes: token.finishes, flavor_name: token.flavorName ?? null,
			flavor_text: token.flavorText ?? null, frame_effects: token.frameEffects ?? null, frame_version: token.frameVersion,
			is_full_art: token.isFullArt ?? null, is_funny: token.isFunny ?? null, is_online_only: token.isOnlineOnly ?? null,
			is_oversized: token.isOversized ?? null, is_promo: token.isPromo ?? null, is_reprint: token.isReprint ?? null,
			is_textless: token.isTextless ?? null, keywords: token.keywords ?? null, language: token.language,
			layout: token.layout, loyalty: token.loyalty ?? null, mana_cost: token.manaCost ?? null,
			name: token.name, number: token.number, orientation: token.orientation ?? null,
			original_text: token.originalText ?? null, original_type: token.originalType ?? null,
			other_face_ids: token.otherFaceIds ?? null, power: token.power ?? null,
			printed_type: (t.printedType as string) ?? null, produced_mana: (t.producedMana as string[] | undefined) ?? null,
			promo_types: token.promoTypes ?? null, security_stamp: token.securityStamp ?? null,
			side: token.side ?? null, signature: (t.signature as string) ?? null, subsets: token.subsets ?? null,
			subtypes: token.subtypes, supertypes: token.supertypes, text: token.text ?? null,
			toughness: token.toughness ?? null, token_products: token.tokenProducts ?? null,
			type: token.type, types: token.types, watermark: token.watermark ?? null,
		});
		identifierRows.push({ uuid: token.uuid, ...mapIdentifiers(token.identifiers) });
	}
	return { tokenRows, identifierRows };
}

function collectJunctions(junctions: JunctionData, cards: CardSet[], tokens: CardToken[]): void {
	for (const card of cards) {
		const rc = card.relatedCards;
		if (rc) {
			for (const u of rc.reverseRelated ?? []) junctions.cardRelatedCards.push({ card_uuid: card.uuid, relation_type: "reverseRelated", related_uuid: u });
			for (const u of rc.spellbook ?? [])       junctions.cardRelatedCards.push({ card_uuid: card.uuid, relation_type: "spellbook",       related_uuid: u });
		}
		const sp = card.sourceProducts as SourceProducts | undefined;
		if (sp) {
			for (const u of sp.etched  ?? []) junctions.cardSourceProducts.push({ card_uuid: card.uuid, finish_type: "etched",   sealed_product_uuid: u });
			for (const u of sp.foil    ?? []) junctions.cardSourceProducts.push({ card_uuid: card.uuid, finish_type: "foil",     sealed_product_uuid: u });
			for (const u of sp.nonfoil ?? []) junctions.cardSourceProducts.push({ card_uuid: card.uuid, finish_type: "nonfoil",  sealed_product_uuid: u });
		}
	}
	for (const token of tokens) {
		const rc = token.relatedCards;
		if (rc) {
			for (const u of rc.reverseRelated ?? []) junctions.tokenRelatedCards.push({ token_uuid: token.uuid, relation_type: "reverseRelated", related_uuid: u });
			for (const u of rc.spellbook ?? [])       junctions.tokenRelatedCards.push({ token_uuid: token.uuid, relation_type: "spellbook",       related_uuid: u });
		}
		if (Array.isArray(token.sourceProducts)) {
			for (const u of token.sourceProducts) junctions.tokenSourceProducts.push({ token_uuid: token.uuid, sealed_product_uuid: u });
		}
	}
}

// ── Streaming helpers ─────────────────────────────────────────────────────────

async function readMeta(jsonPath: string): Promise<{ date: string; version: string }> {
	const pipeline = chain([ createReadStream(jsonPath), parser(), new pick({ filter: "meta" }), new streamValues() ]);
	for await (const { value } of pipeline as AsyncIterable<{ value: { date: string; version: string } }>) return value;
	throw new Error(`Could not find "meta" key in ${jsonPath}`);
}

async function streamSets(jsonPath: string, onSet: (setCode: string, set: MTGSet) => Promise<void>): Promise<number> {
	const pipeline = chain([ createReadStream(jsonPath), parser(), new pick({ filter: "data" }), new streamObject() ]);
	let count = 0;
	for await (const { key, value } of pipeline as AsyncIterable<{ key: string; value: MTGSet }>) {
		await onSet(key, value);
		count++;
	}
	return count;
}

// biome-ignore lint/suspicious/noExplicitAny: postgres.js transaction type
async function processSet(tx: any, set: MTGSet, junctions: JunctionData): Promise<void> {
	const setRow = buildSetRow(set);
	await tx`
		INSERT INTO sets ${tx([setRow])}
		ON CONFLICT (code) DO UPDATE SET
			total_set_size     = EXCLUDED.total_set_size,
			base_set_size      = EXCLUDED.base_set_size,
			is_partial_preview = EXCLUDED.is_partial_preview
	`;
	await batchInsert(tx, "set_translations", buildTranslationRows(set));
	const sps = set.sealedProduct ?? [];
	if (sps.length > 0) {
		const sp = buildSealedProductRows(set.code, sps);
		await batchInsert(tx, "sealed_product",              sp.products);
		await batchInsert(tx, "sealed_product_identifiers",  sp.identifiers);
		await batchInsert(tx, "sealed_product_purchase_urls", sp.purchaseUrls);
		await batchInsert(tx, "sealed_product_contents",     sp.contents);
	}
	const boosters = buildBoosterRows(set);
	await batchInsert(tx, "set_booster_sheets",          boosters.sheets);
	await batchInsert(tx, "set_booster_sheet_cards",     boosters.sheetCards);
	await batchInsert(tx, "set_booster_contents",        boosters.contents);
	await batchInsert(tx, "set_booster_content_weights", boosters.contentWeights);
	const decks = buildDeckRows(set.code, set.decks ?? []);
	await batchInsert(tx, "set_decks",      decks.deckRows);
	await batchInsert(tx, "set_deck_cards", decks.deckCardRows);
	if (set.cards.length > 0) {
		const c = buildCardRows(set.cards, set.name);
		await batchInsert(tx, "cards",             c.cardRows);
		await batchInsert(tx, "card_identifiers",  c.identifierRows);
		await batchInsert(tx, "card_legalities",   c.legalityRows);
		await batchInsert(tx, "card_foreign_data", c.foreignDataRows);
		await batchInsert(tx, "card_rulings",      c.rulingRows);
		await batchInsert(tx, "card_purchase_urls", c.purchaseUrlRows);
	}
	if (set.tokens.length > 0) {
		// If the set has a tokenSetCode, ensure a stub row exists in sets for it
		// so the foreign key constraint on tokens.set_code is satisfied.
		if (set.tokenSetCode) {
			await tx`
				INSERT INTO sets (code, name, type, release_date, base_set_size, total_set_size,
				                  is_foil_only, is_online_only, keyrune_code)
				VALUES (
					${set.tokenSetCode},
					${set.name + ' Tokens'},
					'token',
					${set.releaseDate ?? null},
					0,
					${set.tokens.length},
					false,
					false,
					${set.code}
				)
				ON CONFLICT (code) DO UPDATE SET
					total_set_size = EXCLUDED.total_set_size
			`;
		}
		const t = buildTokenRows(set.tokens, set.name, set.tokenSetCode);
		await batchInsert(tx, "tokens",            t.tokenRows);
		await batchInsert(tx, "token_identifiers", t.identifierRows);
	}
	collectJunctions(junctions, set.cards, set.tokens);
}

// ── Catalog seeding ──────────────────────────────────────────────────────────

/** Lightweight JSON fetcher (follows one redirect). */
async function fetchJson<T>(url: string, timeout = 60_000): Promise<T> {
	return new Promise((resolve, reject) => {
		const req = httpsGet(url, { timeout }, (res) => {
			if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
				fetchJson<T>(res.headers.location, timeout).then(resolve, reject);
				return;
			}
			if (res.statusCode && res.statusCode >= 400) {
				reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
				res.resume();
				return;
			}
			const chunks: Buffer[] = [];
			res.on("data", (chunk: Buffer) => chunks.push(chunk));
			res.on("end", () => {
				try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")) as T); }
				catch (e) { reject(new Error(`JSON parse error for ${url}: ${e}`)); }
			});
			res.on("error", reject);
		});
		req.on("error", reject);
		req.on("timeout", () => { req.destroy(); reject(new Error(`Timeout fetching ${url}`)); });
	});
}

/** EnumValues keys to exclude (redundant with CardTypes hierarchy). */
const EXCLUDED_ENUM_KEYS = new Set(["card.types", "card.supertypes", "card.subtypes"]);

/** Flatten Keywords, CardTypes, and EnumValues JSON into catalog rows. */
function buildCatalogRows(
	keywords: { data: Keywords },
	cardTypes: { data: CardTypes },
	enumValues: { data: Record<string, Record<string, string[]>> },
): AnyRow[] {
	const seen = new Set<string>();
	const rows: AnyRow[] = [];

	const add = (category: string, name: string, values: string[]) => {
		const key = `${category}\0${name}`;
		if (seen.has(key)) return;
		seen.add(key);
		rows.push({ category, name, values });
	};

	// Keywords → category "keywords", name = key
	for (const [name, values] of Object.entries(keywords.data)) {
		add("keywords", name, values);
	}

	// CardTypes → category "cardTypes", name = "typeName.subTypes" / "typeName.superTypes"
	for (const [typeName, typeData] of Object.entries(cardTypes.data)) {
		add("cardTypes", `${typeName}.subTypes`, typeData.subTypes ?? []);
		add("cardTypes", `${typeName}.superTypes`, typeData.superTypes ?? []);
	}

	// EnumValues → category = top-level key, name = nested key (skip excluded)
	for (const [category, nested] of Object.entries(enumValues.data)) {
		for (const [name, values] of Object.entries(nested)) {
			if (EXCLUDED_ENUM_KEYS.has(`${category}.${name}`)) continue;
			add(category, name, Array.isArray(values) ? values : []);
		}
	}

	return rows;
}

/**
 * Download Keywords, CardTypes, and EnumValues from MTGJSON CDN and upsert
 * into the catalogs table.
 */
// biome-ignore lint/suspicious/noExplicitAny: postgres.js transaction type
export async function seedCatalogs(db: any, options?: { timeout?: number }): Promise<number> {
	const timeout = options?.timeout ?? 60_000;

	const [keywords, cardTypes, enumValues] = await Promise.all([
		fetchJson<{ data: Keywords }>(`${CDN_BASE}/Keywords.json`, timeout),
		fetchJson<{ data: CardTypes }>(`${CDN_BASE}/CardTypes.json`, timeout),
		fetchJson<{ data: Record<string, Record<string, string[]>> }>(`${CDN_BASE}/EnumValues.json`, timeout),
	]);

	const rows = buildCatalogRows(keywords, cardTypes, enumValues);

	for (let i = 0; i < rows.length; i += BATCH_SIZE) {
		const batch = rows.slice(i, i + BATCH_SIZE);
		await db`
			INSERT INTO catalogs ${db(batch)}
			ON CONFLICT (category, name) DO UPDATE SET
				values = EXCLUDED.values
		`;
	}

	// Derive legality formats from the card_legalities table columns
	const formatRows = await db`
		SELECT column_name FROM information_schema.columns
		WHERE table_name = 'card_legalities' AND column_name != 'uuid'
		ORDER BY column_name
	`;
	if (formatRows.length > 0) {
		const formats = formatRows.map((r: AnyRow) => r.column_name as string);
		await db`
			INSERT INTO catalogs ${db([{ category: "legalities", name: "formats", values: formats }])}
			ON CONFLICT (category, name) DO UPDATE SET values = EXCLUDED.values
		`;
		rows.push({ category: "legalities", name: "formats", values: formats });
	}

	return rows.length;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Seed a PostgreSQL database from a local AllPrintings.json file.
 * Drops and recreates all tables before inserting.
 * Use this for initial setup only — for incremental updates use {@link seedSingleSet}.
 */
export async function seedDatabase(	connectionUrl: string, allPrintingsPath: string, options?: SeedOptions, ): Promise<SeedResult> {
	const schemaDir = options?.schemaDir ?? defaultSchemaDir();
	const onProgress = options?.onProgress;

	const db = postgres(connectionUrl);
	try {
		// Drop + recreate schema
		const schemaSql   = readFileSync(join(schemaDir, "schema.sql"),   "utf-8");
		const relationsSql = readFileSync(join(schemaDir, "relations.sql"), "utf-8");

		await db.unsafe(schemaSql);

		// Meta
		const meta = await readMeta(allPrintingsPath);
		await db`INSERT INTO meta ${db(meta)}`;

		// Stream sets
		const junctions: JunctionData = { cardRelatedCards: [], tokenRelatedCards: [], cardSourceProducts: [], tokenSourceProducts: [] };
		let setCount = 0, cardCount = 0, tokenCount = 0;

		await streamSets(allPrintingsPath, async (setCode, set) => {
			setCount++;
			cardCount  += set.cards.length;
			tokenCount += set.tokens.length;
			await db.begin(async (tx) => { await processSet(tx, set, junctions); });
			onProgress?.({ setCode, setCount, cardCount, tokenCount });
		});

		// Junction tables
		for (const { table, rows } of [
			{ table: "card_related_cards",   rows: junctions.cardRelatedCards },
			{ table: "token_related_cards",  rows: junctions.tokenRelatedCards },
			{ table: "card_source_products", rows: junctions.cardSourceProducts },
			{ table: "token_source_products", rows: junctions.tokenSourceProducts },
		]) {
			await batchInsert(db, table, rows);
		}

		// Catalogs (keywords, card types, enum values)
		await seedCatalogs(db);

		// Relations / indexes
		await db.unsafe(relationsSql);

		return { version: meta.version, date: meta.date, sets: setCount, cards: cardCount, tokens: tokenCount };
	} finally {
		await db.end();
	}
}

/**
 * Insert a single set into an already-initialized database.
 * Safe to call on sets that already exist — all inserts use ON CONFLICT DO NOTHING.
 * Junction table rows (relatedCards, sourceProducts) are committed after the set.
 */
export async function seedSingleSet( connectionUrl: string,	set: MTGSet ): Promise<{ cards: number; tokens: number }> {
	const db = postgres(connectionUrl);
	try {
		const junctions: JunctionData = { cardRelatedCards: [], tokenRelatedCards: [], cardSourceProducts: [], tokenSourceProducts: [] };

		await db.begin(async (tx) => { await processSet(tx, set, junctions); });

		for (const { table, rows } of [
			{ table: "card_related_cards",    rows: junctions.cardRelatedCards },
			{ table: "token_related_cards",   rows: junctions.tokenRelatedCards },
			{ table: "card_source_products",  rows: junctions.cardSourceProducts },
			{ table: "token_source_products", rows: junctions.tokenSourceProducts },
		]) { await batchInsert(db, table, rows); }

		return { cards: set.cards.length, tokens: set.tokens.length };
	} finally {	await db.end(); }
}
