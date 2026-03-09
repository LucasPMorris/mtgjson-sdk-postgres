import type { Connection } from "../connection.js";
import { SQLBuilder } from "../sql-builder.js";
import type { CardAtomic, CardSet } from "../types/index.js";

const KNOWN_FORMATS = new Set([ "alchemy",   "brawl",   "commander",       "duel",  "explorer",  "future",  "gladiator",  "historic",  "historicbrawl",  "legacy",   "modern", 	"oathbreaker",
                                "oldschool", "pauper",  "paupercommander", "penny",	"pioneer",   "predh",   "premodern",  "standard",  "standardbrawl",	 "timeless", "vintage" ]);

type KeywordOperator = "All" | "Any" | "Exact";

type SearchOptions = {
	name?: string;
	localizedName?: string;
	setCode?: string;
	colors?: string[];
	colorIdentity?: string[];
	types?: string;
	rarity?: string;
	legalIn?: string;
	manaValue?: number;
	manaValueLte?: number;
	manaValueGte?: number;
	text?: string;
	textRegex?: string;
	power?: string;
	toughness?: string;
	artist?: string;
	keywordAbilities?: string[];
	keywordActions?: string[];
	keywordOperator?: KeywordOperator;
	isPromo?: boolean;
	isOversized?: boolean;
	isOnlineOnly?: boolean;
	isToken?: boolean;
	isArtSeries?: boolean;
	availability?: string;
	language?: string;
	layout?: string;
	setType?: string;
	limit?: number;
	offset?: number;
};

export class CardQuery {
	private _conn: Connection;

	constructor(conn: Connection) {	this._conn = conn; }

	private _applyKeywordFilter(q: SQLBuilder, keywords: string[], op: KeywordOperator): void {
		if (keywords.length === 0) return;
		if (op === "Any") {
			const parts = keywords.map(kw => {
				const idx = q._params.length + 1;
				q._params.push(kw);
				return `$${idx} = ANY(keywords)`;
			});
			q._where.push(`(${parts.join(" OR ")})`);
		} else if (op === "All") {
			for (const kw of keywords) {
				const idx = q._params.length + 1;
				q._params.push(kw);
				q._where.push(`$${idx} = ANY(keywords)`);
			}
		} else {
			// Exact: keywords array must contain exactly the specified values
			const idx = q._params.length + 1;
			q._params.push(keywords);
			q._where.push(`keywords @> $${idx}::text[] AND keywords <@ $${idx}::text[]`);
		}
	}

	/** Applies all search filter conditions to the given SQLBuilder. */
	private _applyFilters(q: SQLBuilder, opts: SearchOptions): void {
		if (opts.name) {
			if (opts.name.includes("%")) {
				q.whereLike("name", opts.name);
			} else {
				q.whereEq("name", opts.name);
			}
		}
		if (opts.setCode) q.whereEq("set_code", opts.setCode);
		if (opts.rarity) q.whereEq("rarity", opts.rarity);
		if (opts.manaValue !== undefined) q.whereEq("mana_value", opts.manaValue);
		if (opts.manaValueLte !== undefined) q.whereLte("mana_value", opts.manaValueLte);
		if (opts.manaValueGte !== undefined) q.whereGte("mana_value", opts.manaValueGte);
		if (opts.text) q.whereLike("text", `%${opts.text}%`);
		if (opts.textRegex) q.whereRegex("text", opts.textRegex);
		if (opts.types) q.whereLike("type", `%${opts.types}%`);
		if (opts.power) q.whereEq("power", opts.power);
		if (opts.toughness) q.whereEq("toughness", opts.toughness);
		if (opts.artist) q.whereLike("artist", `%${opts.artist}%`);
		if (opts.language) q.whereEq("language", opts.language);
		if (opts.layout) q.whereEq("layout", opts.layout);
		// Boolean include filters — excluded by default; enabling lifts the exclusion
		if (opts.isPromo !== true)     q._where.push("(is_promo IS NULL OR is_promo = FALSE)");
		if (opts.isOversized !== true)  q._where.push("(is_oversized IS NULL OR is_oversized = FALSE)");
		if (opts.isOnlineOnly !== true) q._where.push("(is_online_only IS NULL OR is_online_only = FALSE)");

		// Layout-based include filters — excluded by default; only applied when layout is not explicitly set
		if (!opts.layout) {
			const layoutExcludes: string[] = [];
			if (opts.isToken !== true)    layoutExcludes.push("token");
			if (opts.isArtSeries !== true) layoutExcludes.push("art_series");
			if (layoutExcludes.length > 0) {
				const placeholders = layoutExcludes.map((_, i) => `$${q._params.length + i + 1}`).join(", ");
				q._where.push(`layout NOT IN (${placeholders})`);
				q._params.push(...layoutExcludes);
			}
		}

		for (const color of opts.colors ?? []) {
			const idx = q._params.length + 1;
			q._where.push(`$${idx} = ANY(colors)`);
			q._params.push(color);
		}
		for (const color of opts.colorIdentity ?? []) {
			const idx = q._params.length + 1;
			q._where.push(`$${idx} = ANY(color_identity)`);
			q._params.push(color);
		}

		// Keyword filters with operator support
		const op: KeywordOperator = opts.keywordOperator ?? "Any";
		this._applyKeywordFilter(q, opts.keywordAbilities ?? [], op);
		this._applyKeywordFilter(q, opts.keywordActions ?? [], op);

		if (opts.availability) {
			const idx = q._params.length + 1;
			q._where.push(`$${idx} = ANY(availability)`);
			q._params.push(opts.availability);
		}

		if (opts.localizedName) {
			q.select("cards.*");
			q.join("JOIN card_foreign_data cfd ON cards.uuid = cfd.uuid");
			if (opts.localizedName.includes("%")) {	q.whereLike("cfd.name", opts.localizedName); } 
      else { q.whereEq("cfd.name", opts.localizedName); }
		}

		if (opts.legalIn) {
			const fmt = opts.legalIn.toLowerCase();
			if (KNOWN_FORMATS.has(fmt)) {
				q.join("JOIN card_legalities cl ON cards.uuid = cl.uuid");
				q._where.push(`cl.${fmt} = 'Legal'`);
			}
		}

		if (opts.setType) {
			q.select("cards.*");
			q.join("JOIN sets s ON cards.set_code = s.code");
			q.whereEq("s.type", opts.setType);
		}
	}

	async getByUuid(uuid: string): Promise<CardSet | null> {
		const rows = await this._conn.execute(
			"SELECT * FROM cards WHERE uuid = $1",
			[uuid],
		);
		return (rows[0] as CardSet) ?? null;
	}

	async getByUuids(uuids: string[]): Promise<CardSet[]> {
		if (uuids.length === 0) return [];
		const q = new SQLBuilder("cards").whereIn("uuid", uuids);
		const [sql, params] = q.build();
		return (await this._conn.execute(sql, params)) as CardSet[];
	}

	async getByName(
		name: string,
		options?: { setCode?: string },
	): Promise<CardSet[]> {
		const q = new SQLBuilder("cards").whereEq("name", name);
		if (options?.setCode) q.whereEq("set_code", options.setCode);
		q.orderBy("set_code DESC", "number ASC");
		const [sql, params] = q.build();
		return (await this._conn.execute(sql, params)) as CardSet[];
	}

	async search(options?: SearchOptions): Promise<CardSet[]> {
		const q = new SQLBuilder("cards");
		const opts = options ?? {};
		const limit = opts.limit ?? 100;
		const offset = opts.offset ?? 0;

		this._applyFilters(q, opts);
		q.orderBy("cards.name ASC", "cards.number ASC");
		q.limit(limit).offset(offset);

		const [sql, params] = q.build();
		return (await this._conn.execute(sql, params)) as CardSet[];
	}

	async getPrintings(name: string): Promise<CardSet[]> { return this.getByName(name); }

	async getAtomic(name: string): Promise<CardAtomic[]> {
		const atomicCols = [ "name",  "hand",   "colors",  "subsets",  "ascii_name", "is_funny",  "mana_value", "subtypes",    "color_identity",  "edhrec_saltiness",  "has_alternative_deck_limit", "leadership_brawl",
                         "text",  "life",   "layout",  "types",    "toughness",  "face_name", "printings",  "is_reserved", "face_mana_value", "is_game_changer",   "face_converted_mana_cost",   "leadership_commander",
                         "type",  "side",   "power",   "loyalty",  "keywords",   "defense",   "mana_cost",  "supertypes",  "edhrec_rank",     "color_indicator",   "leadership_oathbreaker" ];

		const q = new SQLBuilder("cards");
		q.select(...atomicCols);
		q.whereEq("name", name);
		q.orderBy("is_funny ASC NULLS FIRST", "is_online_only ASC NULLS FIRST", "side ASC NULLS FIRST" );
		const [sql, params] = q.build();
		let rows = await this._conn.execute(sql, params);

		// Fallback: search by face_name for split/adventure/MDFC cards
		if (rows.length === 0) {
			const q2 = new SQLBuilder("cards");
			q2.select(...atomicCols);
			q2.whereEq("face_name", name);
			q2.orderBy(
				"is_funny ASC NULLS FIRST",
				"is_online_only ASC NULLS FIRST",
				"side ASC NULLS FIRST",
			);
			const [sql2, params2] = q2.build();
			rows = await this._conn.execute(sql2, params2);
		}

		if (rows.length === 0) return [];

		// De-duplicate by name+faceName (camelCase after snakeToCamel in Connection)
		const seen = new Set<string>();
		const unique: Record<string, unknown>[] = [];
		for (const r of rows) {
			const key = `${r.name ?? ""}|${r.faceName ?? ""}`;
			if (!seen.has(key)) {
				seen.add(key);
				unique.push(r);
			}
		}
		return unique as CardAtomic[];
	}

	async findByScryfallId(scryfallId: string): Promise<CardSet[]> {
		const sql =
			"SELECT c.* FROM cards c " +
			"JOIN card_identifiers ci ON c.uuid = ci.uuid " +
			"WHERE ci.scryfall_id = $1";
		return (await this._conn.execute(sql, [scryfallId])) as CardSet[];
	}

	async random(count = 1): Promise<CardSet[]> {
		const sql = `SELECT * FROM cards ORDER BY RANDOM() LIMIT ${count}`;
		return (await this._conn.execute(sql)) as CardSet[];
	}

	/** Count cards matching the given search options (same filters as search()). */
	async count(options?: SearchOptions): Promise<number> {
		const q = new SQLBuilder("cards").select("COUNT(*)");
		if (options && Object.keys(options).length > 0) {
			this._applyFilters(q, options);
		}
		const [sql, params] = q.build();
		return ((await this._conn.executeScalar(sql, params)) as number) ?? 0;
	}
}
