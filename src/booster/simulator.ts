import type { Connection } from "../connection.js";
import type {
	BoosterConfig,
	BoosterPack,
	BoosterSheet,
	CardSet,
} from "../types/index.js";

export class BoosterSimulator {
	private _conn: Connection;

	constructor(conn: Connection) {
		this._conn = conn;
	}

	private async _getBoosterConfig(
		setCode: string,
	): Promise<Record<string, BoosterConfig> | null> {
		const code = setCode.toUpperCase();

		// 1. Sheet metadata
		const sheetsRows = await this._conn.execute(
			`SELECT booster_name, sheet_name, sheet_is_foil, sheet_has_balance_colors, sheet_total_weight
			 FROM set_booster_sheets WHERE set_code = $1`,
			[code],
		);
		if (sheetsRows.length === 0) return null;

		// 2. Sheet cards (uuid → weight)
		const sheetCardsRows = await this._conn.execute(
			`SELECT booster_name, sheet_name, card_uuid, card_weight
			 FROM set_booster_sheet_cards WHERE set_code = $1`,
			[code],
		);

		// 3. Booster pack weights
		const weightRows = await this._conn.execute(
			`SELECT booster_name, booster_index, booster_weight
			 FROM set_booster_content_weights WHERE set_code = $1
			 ORDER BY booster_index ASC`,
			[code],
		);

		// 4. Booster pack contents (sheet → picks)
		const contentRows = await this._conn.execute(
			`SELECT booster_name, booster_index, sheet_name, sheet_picks
			 FROM set_booster_contents WHERE set_code = $1
			 ORDER BY booster_index ASC`,
			[code],
		);

		// Assemble: group by booster_name
		const configs: Record<string, BoosterConfig> = {};

		// Build sheets per booster
		for (const row of sheetsRows) {
			const bName = row.boosterName as string;
			const sName = row.sheetName as string;
			if (!configs[bName]) {
				configs[bName] = { boosters: [], boostersTotalWeight: 0, sheets: {}, sourceSetCodes: [] };
			}
			configs[bName].sheets[sName] = {
				foil: (row.sheetIsFoil as boolean) ?? false,
				balanceColors: (row.sheetHasBalanceColors as boolean) ?? undefined,
				totalWeight: (row.sheetTotalWeight as number) ?? 0,
				cards: {},
			};
		}

		// Populate cards into sheets
		for (const row of sheetCardsRows) {
			const bName = row.boosterName as string;
			const sName = row.sheetName as string;
			const cardUuid = row.cardUuid as string;
			const cardWeight = row.cardWeight as number;
			if (configs[bName]?.sheets[sName]) {
				configs[bName].sheets[sName].cards[cardUuid] = cardWeight;
			}
		}

		// Build boosters array per booster name
		// First pass: ensure array slots exist from weight rows
		for (const row of weightRows) {
			const bName = row.boosterName as string;
			const idx = row.boosterIndex as number;
			const weight = row.boosterWeight as number;
			if (!configs[bName]) continue;
			while (configs[bName].boosters.length <= idx) {
				configs[bName].boosters.push({ contents: {}, weight: 0 });
			}
			configs[bName].boosters[idx].weight = weight;
			configs[bName].boostersTotalWeight += weight;
		}

		// Second pass: fill contents
		for (const row of contentRows) {
			const bName = row.boosterName as string;
			const idx = row.boosterIndex as number;
			const sName = row.sheetName as string;
			const picks = row.sheetPicks as number;
			if (configs[bName]?.boosters[idx]) {
				configs[bName].boosters[idx].contents[sName] = picks;
			}
		}

		return Object.keys(configs).length > 0 ? configs : null;
	}

	async availableTypes(setCode: string): Promise<string[]> {
		const config = await this._getBoosterConfig(setCode);
		if (!config) return [];
		return Object.keys(config);
	}

	async openPack(setCode: string, boosterType = "draft"): Promise<CardSet[]> {
		const configs = await this._getBoosterConfig(setCode);
		if (!configs || !(boosterType in configs)) {
			throw new Error(
				`No booster config for set '${setCode}' type '${boosterType}'. ` +
					`Available: ${configs ? Object.keys(configs) : []}`,
			);
		}

		const config = configs[boosterType];
		const packTemplate = pickPack(config.boosters);
		const sheets = config.sheets;

		const cardUuids: string[] = [];
		for (const [sheetName, count] of Object.entries(packTemplate.contents)) {
			if (!(sheetName in sheets)) continue;
			const sheet = sheets[sheetName];
			const picked = pickFromSheet(sheet, count as number);
			cardUuids.push(...picked);
		}

		if (cardUuids.length === 0) return [];

		const placeholders = cardUuids.map((_, i) => `$${i + 1}`).join(", ");
		const sql = `SELECT * FROM cards WHERE uuid IN (${placeholders})`;
		const rows = await this._conn.execute(sql, cardUuids);

		// Preserve pack order
		const uuidToRow = new Map<string, Record<string, unknown>>();
		for (const r of rows) {
			uuidToRow.set(r.uuid as string, r);
		}
		const ordered: Record<string, unknown>[] = [];
		for (const u of cardUuids) {
			const row = uuidToRow.get(u);
			if (row) ordered.push(row);
		}
		return ordered as CardSet[];
	}

	async openBox(
		setCode: string,
		boosterType = "draft",
		packs = 36,
	): Promise<CardSet[][]> {
		const results: CardSet[][] = [];
		for (let i = 0; i < packs; i++) {
			results.push(await this.openPack(setCode, boosterType));
		}
		return results;
	}

	async sheetContents(
		setCode: string,
		boosterType: string,
		sheetName: string,
	): Promise<Record<string, number> | null> {
		const configs = await this._getBoosterConfig(setCode);
		if (!configs || !(boosterType in configs)) return null;
		const sheets = configs[boosterType].sheets ?? {};
		const sheet = sheets[sheetName];
		if (!sheet) return null;
		return sheet.cards;
	}
}

function pickPack(boosters: BoosterPack[]): BoosterPack {
	const weights = boosters.map((b) => b.weight);
	return weightedChoice(boosters, weights);
}

function pickFromSheet(sheet: BoosterSheet, count: number): string[] {
	const cards = sheet.cards;
	const uuids = Object.keys(cards);
	const weights = Object.values(cards);
	const allowDuplicates = sheet.allowDuplicates ?? false;

	if (allowDuplicates) {
		const picked: string[] = [];
		for (let i = 0; i < count; i++) {
			picked.push(weightedChoice(uuids, weights));
		}
		return picked;
	}

	if (count >= uuids.length) {
		const result = [...uuids];
		shuffle(result);
		return result;
	}

	// Pick without replacement
	const picked: string[] = [];
	const remainingUuids = [...uuids];
	const remainingWeights = [...weights];

	for (let i = 0; i < Math.min(count, remainingUuids.length); i++) {
		const choice = weightedChoice(remainingUuids, remainingWeights);
		picked.push(choice);
		const idx = remainingUuids.indexOf(choice);
		remainingUuids.splice(idx, 1);
		remainingWeights.splice(idx, 1);
	}
	return picked;
}

function weightedChoice<T>(items: T[], weights: number[]): T {
	const totalWeight = weights.reduce((a, b) => a + b, 0);
	let random = Math.random() * totalWeight;
	for (let i = 0; i < items.length; i++) {
		random -= weights[i];
		if (random <= 0) return items[i];
	}
	return items[items.length - 1];
}

function shuffle<T>(array: T[]): void {
	for (let i = array.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[array[i], array[j]] = [array[j], array[i]];
	}
}
