/**
 * Populate set_decks and set_deck_cards from AllPrintings.json.
 * Only inserts deck data — does not touch cards, tokens, sets, or other tables.
 *
 * Usage:
 *   DATABASE_URL=postgresql://user:pass@host/db \
 *   bun scripts/populate-decks.ts [path/to/AllPrintings.json]
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chain } from "stream-chain";
import parser from "stream-json";
import pick from "stream-json/filters/Pick.js";
import streamObject from "stream-json/streamers/StreamObject.js";
import postgres from "postgres";

type AnyRow = Record<string, unknown>;

interface DeckSetEntry {
	code: string;
	name: string;
	type: string;
	releaseDate: string;
	sealedProductUuids: string[] | null;
	commander?: { uuid: string; count: number; isFoil?: boolean }[];
	mainBoard: { uuid: string; count: number; isFoil?: boolean }[];
	sideBoard: { uuid: string; count: number; isFoil?: boolean }[];
}

interface SetData {
	code: string;
	decks?: DeckSetEntry[];
	cards: { uuid: string; types?: string[]; manaValue?: number; colorIdentity?: string[] }[];
}

function generateDeckUuid(setCode: string, name: string): string {
	const hash = createHash("sha256").update(`${setCode}:${name}`).digest("hex");
	return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

function computeStats(deck: DeckSetEntry, cardMap: Map<string, SetData["cards"][0]>) {
	const allEntries = [...(deck.commander ?? []), ...deck.mainBoard, ...deck.sideBoard];
	const uniqueUuids = new Set(allEntries.map(e => e.uuid));
	let totalCards = 0, landCount = 0, manaValueSum = 0, nonLandCount = 0;
	let creatureCount = 0, instantCount = 0, sorceryCount = 0, enchantmentCount = 0;
	let artifactCount = 0, planeswalkerCount = 0, battleCount = 0, multiTypeCount = 0;
	const colorIdentitySet = new Set<string>();

	for (const entry of allEntries) {
		totalCards += entry.count;
		const card = cardMap.get(entry.uuid);
		if (!card) continue;
		for (const c of card.colorIdentity ?? []) colorIdentitySet.add(c);
		const types = card.types ?? [];
		const isLand = types.includes("Land");
		if (isLand) { landCount += entry.count; } else { manaValueSum += (card.manaValue ?? 0) * entry.count; nonLandCount += entry.count; }
		let typeHits = 0;
		if (types.includes("Creature"))     { creatureCount += entry.count; typeHits++; }
		if (types.includes("Instant"))      { instantCount += entry.count; typeHits++; }
		if (types.includes("Sorcery"))      { sorceryCount += entry.count; typeHits++; }
		if (types.includes("Enchantment"))  { enchantmentCount += entry.count; typeHits++; }
		if (types.includes("Artifact"))     { artifactCount += entry.count; typeHits++; }
		if (types.includes("Planeswalker")) { planeswalkerCount += entry.count; typeHits++; }
		if (types.includes("Battle"))       { battleCount += entry.count; typeHits++; }
		if (types.includes("Land"))         { typeHits++; }
		if (typeHits > 1) multiTypeCount += entry.count;
	}

	return {
		totalCards, uniqueCards: uniqueUuids.size,
		avgManaValue: nonLandCount > 0 ? Math.round((manaValueSum / nonLandCount) * 100) / 100 : 0,
		landCount, colorIdentity: [...colorIdentitySet].sort(),
		creatureCount, instantCount, sorceryCount, enchantmentCount,
		artifactCount, planeswalkerCount, battleCount, multiTypeCount,
	};
}

const BATCH_SIZE = 500;
async function batchInsert(db: any, table: string, rows: AnyRow[]): Promise<void> {
	if (rows.length === 0) return;
	for (let i = 0; i < rows.length; i += BATCH_SIZE) {
		const batch = rows.slice(i, i + BATCH_SIZE);
		await db`INSERT INTO ${db(table)} ${db(batch)} ON CONFLICT DO NOTHING`;
	}
}

async function main() {
	const connStr = process.env.DATABASE_URL;
	if (!connStr) { console.error("Error: DATABASE_URL is required."); process.exit(1); }

	const jsonPath = process.argv[2] ?? "./tempdata/AllPrintings.json";
	console.log(`Populating decks from ${jsonPath} …\n`);

	const db = postgres(connStr);

	const pipeline = chain([createReadStream(jsonPath), parser(), new pick({ filter: "data" }), new streamObject()]);

	let setCount = 0;
	let deckCount = 0;

	for await (const { key, value } of pipeline as AsyncIterable<{ key: string; value: SetData }>) {
		const set = value;
		const decks = set.decks ?? [];
		if (decks.length === 0) continue;

		const cardMap = new Map(set.cards.map(c => [c.uuid, c]));
		const deckRows: AnyRow[] = [];
		const deckCardRows: AnyRow[] = [];

		for (const deck of decks) {
			const deckUuid = generateDeckUuid(set.code, deck.name);
			const stats = computeStats(deck, cardMap);
			deckRows.push({
				uuid: deckUuid, set_code: set.code, name: deck.name, type: deck.type,
				source: "mtgjson", description: null, release_date: deck.releaseDate,
				sealed_product_uuids: deck.sealedProductUuids ?? null, stats: JSON.stringify(stats),
				created_at: null, updated_at: null,
			});
			for (const card of deck.commander ?? []) deckCardRows.push({ deck_uuid: deckUuid, board_type: "commander", uuid: card.uuid, count: card.count, is_foil: card.isFoil ?? null, collection_item_uuid: null });
			for (const card of deck.mainBoard)        deckCardRows.push({ deck_uuid: deckUuid, board_type: "mainBoard",  uuid: card.uuid, count: card.count, is_foil: card.isFoil ?? null, collection_item_uuid: null });
			for (const card of deck.sideBoard)        deckCardRows.push({ deck_uuid: deckUuid, board_type: "sideBoard",  uuid: card.uuid, count: card.count, is_foil: card.isFoil ?? null, collection_item_uuid: null });
		}

		await batchInsert(db, "set_decks", deckRows);
		await batchInsert(db, "set_deck_cards", deckCardRows);

		deckCount += decks.length;
		setCount++;
		process.stdout.write(`\r  Sets: ${setCount}  Decks: ${deckCount}  (${set.code})            `);
	}

	await db.end();
	console.log(`\r  Done: ${deckCount} decks across ${setCount} sets.                              `);
}

main().catch((err) => { console.error(err); process.exit(1); });
