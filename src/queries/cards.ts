import type { Connection } from "../connection.js";
import { SQLBuilder } from "../sql-builder.js";
import type { CardAtomic, CardSet } from "../types/index.js";

const KNOWN_FORMATS = new Set([ "alchemy",   "brawl",   "commander",       "duel",  "explorer",  "future",  "gladiator",  "historic",  "historicbrawl",  "legacy",   "modern", 	"oathbreaker",
                                "oldschool", "pauper",  "paupercommander", "penny",	"pioneer",   "predh",   "premodern",  "standard",  "standardbrawl",	 "timeless", "vintage" ]);

type KeywordOperator = "All" | "Any" | "Exact";

export type SortField = "name" | "manaValue" | "power" | "toughness" | "number" | "set";
export type SortDirection = "ASC" | "DESC";
export type SortOption = SortField | `${SortField}:${SortDirection}`;

const SORT_FIELD_MAP: Record<SortField, { column: string; numeric?: boolean }> = {
	name:      { column: "name" },
	manaValue: { column: "mana_value" },
	power:     { column: "power", numeric: true },
	toughness: { column: "toughness", numeric: true },
	number:    { column: "number" },
	set:       { column: "set_code" },
};

type SearchOptions = {
	name?: string;
	localizedName?: string;
	setCode?: string;
	colors?: string[];
	colorIdentity?: string[];
	types?: string;
	subtype?: string;
	rarity?: string | string[];
	legalIn?: string;
	manaValue?: number;
	manaValueLte?: number;
	manaValueGte?: number;
	manaValueLt?: number;
	manaValueGt?: number;
	text?: string;
	textRegex?: string;
	power?: string;
	powerGte?: number;
	powerLte?: number;
	powerGt?: number;
	powerLt?: number;
	toughness?: string;
	toughnessGte?: number;
	toughnessLte?: number;
	toughnessGt?: number;
	toughnessLt?: number;
	artist?: string;
	keywordAbilities?: string[];
	keywordActions?: string[];
	keywordOperator?: KeywordOperator;
	isPromo?: boolean | 'only';
	isOversized?: boolean | 'only';
	isOnlineOnly?: boolean | 'only';
	isToken?: boolean | 'only';
	isArtSeries?: boolean | 'only';
	availability?: string;
	language?: string;
	layout?: string;
	setType?: string;
	sort?: SortOption | SortOption[];
	limit?: number;
	offset?: number;
};

export class CardQuery {
	private _conn: Connection;

	constructor(conn: Connection) {	this._conn = conn; }

	/** Parse sort options and apply ORDER BY clauses to the query builder. */
	private _applySort(q: SQLBuilder, sort: SortOption | SortOption[] | undefined, table: string): void {
		if (!sort) {
			q.orderBy(`${table}.name ASC`, `${table}.number ASC`);
			return;
		}
		const sorts = Array.isArray(sort) ? sort : [sort];
		for (const s of sorts) {
			const [field, dir = "ASC"] = s.split(":") as [SortField, SortDirection?];
			const mapping = SORT_FIELD_MAP[field];
			if (!mapping) continue;
			const col = `${table}.${mapping.column}`;
			const direction = dir === "DESC" ? "DESC" : "ASC";
			if (mapping.numeric) {
				// Cast to numeric for proper ordering, push NULLs/non-numeric to the end
				const nulls = direction === "ASC" ? "LAST" : "FIRST";
				q.orderBy(`(CASE WHEN ${col} ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN ${col}::NUMERIC END) ${direction} NULLS ${nulls}`);
			} else {
				q.orderBy(`${col} ${direction}`);
			}
		}
	}

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

	/** Applies all search filter conditions to the given SQLBuilder.
	 *  @param table  Base table/view name used for qualified column references (default: "v_cards").
	 */
	private _applyFilters(q: SQLBuilder, opts: SearchOptions, table = "v_cards"): void {
		if (opts.name) {
			if (opts.name.includes("%")) {
				q.whereLike("name", opts.name);
			} else {
				q.whereEq("name", opts.name);
			}
		}
		if (opts.setCode) q.whereEq("set_code", opts.setCode);
		if (opts.rarity) Array.isArray(opts.rarity) ? q.whereIn("rarity", opts.rarity) : q.whereEq("rarity", opts.rarity);
		if (opts.manaValue !== undefined) q.whereEq("mana_value", opts.manaValue);
		if (opts.manaValueLte !== undefined) q.whereLte("mana_value", opts.manaValueLte);
		if (opts.manaValueGte !== undefined) q.whereGte("mana_value", opts.manaValueGte);
		if (opts.manaValueLt  !== undefined) q.where("mana_value < $1", opts.manaValueLt);
		if (opts.manaValueGt  !== undefined) q.where("mana_value > $1", opts.manaValueGt);
		if (opts.text) q.whereLike("text", `%${opts.text}%`);
		if (opts.textRegex) q.whereRegex("text", opts.textRegex);
		if (opts.types) q.whereLike("type", `%${opts.types}%`);
		if (opts.subtype) {
			const idx = q._params.length + 1;
			q._where.push(`$${idx} = ANY(subtypes)`);
			q._params.push(opts.subtype);
		}
		if (opts.power) q.whereEq("power", opts.power);
		if (opts.powerGte !== undefined) q.where(`power ~ '^-?[0-9]+(\\.[0-9]+)?$' AND power::NUMERIC >= $1`, opts.powerGte);
		if (opts.powerLte !== undefined) q.where(`power ~ '^-?[0-9]+(\\.[0-9]+)?$' AND power::NUMERIC <= $1`, opts.powerLte);
		if (opts.powerGt  !== undefined) q.where(`power ~ '^-?[0-9]+(\\.[0-9]+)?$' AND power::NUMERIC > $1`,  opts.powerGt);
		if (opts.powerLt  !== undefined) q.where(`power ~ '^-?[0-9]+(\\.[0-9]+)?$' AND power::NUMERIC < $1`,  opts.powerLt);
		if (opts.toughness) q.whereEq("toughness", opts.toughness);
		if (opts.toughnessGte !== undefined) q.where(`toughness ~ '^-?[0-9]+(\\.[0-9]+)?$' AND toughness::NUMERIC >= $1`, opts.toughnessGte);
		if (opts.toughnessLte !== undefined) q.where(`toughness ~ '^-?[0-9]+(\\.[0-9]+)?$' AND toughness::NUMERIC <= $1`, opts.toughnessLte);
		if (opts.toughnessGt  !== undefined) q.where(`toughness ~ '^-?[0-9]+(\\.[0-9]+)?$' AND toughness::NUMERIC > $1`,  opts.toughnessGt);
		if (opts.toughnessLt  !== undefined) q.where(`toughness ~ '^-?[0-9]+(\\.[0-9]+)?$' AND toughness::NUMERIC < $1`,  opts.toughnessLt);
		if (opts.artist) q.whereLike("artist", `%${opts.artist}%`);
		if (opts.language) q.whereEq("language", opts.language);
		if (opts.layout) q.whereEq("layout", opts.layout);
		// Boolean include filters:
		//   undefined / false → exclude (default)
		//   true              → lift the exclusion (include alongside other results)
		//   'only'            → positive inclusion (WHERE field = true); multiple 'only' values are OR'd
		const onlyConditions: string[] = [];

		if (opts.isPromo === 'only')      onlyConditions.push("is_promo = true");
		else if (opts.isPromo !== true)    q._where.push("(is_promo IS NULL OR is_promo = FALSE)");

		if (opts.isOversized === 'only')      onlyConditions.push("is_oversized = true");
		else if (opts.isOversized !== true)    q._where.push("(is_oversized IS NULL OR is_oversized = FALSE)");

		if (opts.isOnlineOnly === 'only')      onlyConditions.push("is_online_only = true");
		else if (opts.isOnlineOnly !== true)    q._where.push("(is_online_only IS NULL OR is_online_only = FALSE)");

		// Layout-based include filters — excluded by default; only applied when layout is not explicitly set
		if (!opts.layout) {
			if (opts.isToken === 'only')        onlyConditions.push("layout = 'token'");
			if (opts.isArtSeries === 'only')    onlyConditions.push("layout = 'art_series'");

			const layoutExcludes: string[] = [];
			if (opts.isToken !== true && opts.isToken !== 'only')          layoutExcludes.push("token");
			if (opts.isArtSeries !== true && opts.isArtSeries !== 'only')  layoutExcludes.push("art_series");
			if (layoutExcludes.length > 0) {
				const placeholders = layoutExcludes.map((_, i) => `$${q._params.length + i + 1}`).join(", ");
				q._where.push(`layout NOT IN (${placeholders})`);
				q._params.push(...layoutExcludes);
			}
		}

		if (onlyConditions.length > 0) { q._where.push(`(${onlyConditions.join(" OR ")})`);	}

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
			q.select(`${table}.*`);
			q.join(`JOIN card_foreign_data cfd ON ${table}.uuid = cfd.uuid`);
			if (opts.localizedName.includes("%")) {	q.whereLike("cfd.name", opts.localizedName); }
			else { q.whereEq("cfd.name", opts.localizedName); }
		}

		if (opts.legalIn) {
			const fmt = opts.legalIn.toLowerCase();
			if (KNOWN_FORMATS.has(fmt)) {
				// v_cards already has legalities as JSONB — no join needed.
				q._where.push(`legalities->>'${fmt}' = 'Legal'`);
			}
		}

		if (opts.setType) {
			q.select(`${table}.*`);
			q.join(`JOIN sets s ON ${table}.set_code = s.code`);
			q.whereEq("s.type", opts.setType);
		}
	}

	/**
	 * After snakeToCamel, v_cards exposes flat prefixed keys for nested objects:
	 *   identifiers_scryfall_id   → identifiersScryfallId  → identifiers.scryfallId
	 *   purchase_urls_card_kingdom → purchaseUrlsCardKingdom → purchaseUrls.cardKingdom
	 * This helper lifts those into their proper nested objects.
	 * All other columns (legalities, leadershipSkills, rulings, foreignData,
	 * relatedCards, sourceProducts) are already proper JSONB objects in v_cards
	 * and pass through unchanged after snakeToCamel.
	 */
	private _liftRow(row: Record<string, unknown>): Record<string, unknown> {
		const identifiers: Record<string, unknown> = {};
		const purchaseUrls: Record<string, unknown> = {};
		const out: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(row)) {
			if (key.length > 11 && key.startsWith("identifiers") && /[A-Z]/.test(key[11])) {
				identifiers[key[11].toLowerCase() + key.slice(12)] = val;
			} else if (key.length > 12 && key.startsWith("purchaseUrls") && /[A-Z]/.test(key[12])) {
				purchaseUrls[key[12].toLowerCase() + key.slice(13)] = val;
			} else {
				out[key] = val;
			}
		}
		out.identifiers = identifiers;
		out.purchaseUrls = purchaseUrls;
		return out;
	}

	async getByUuid(uuid: string): Promise<CardSet | null> {
		const rows = await this._conn.execute("SELECT * FROM v_cards WHERE uuid = $1", [uuid]);
		return rows.length ? (this._liftRow(rows[0]) as CardSet) : null;
	}

	async getByUuids(uuids: string[]): Promise<CardSet[]> {
		if (uuids.length === 0) return [];
		const q = new SQLBuilder("v_cards").whereIn("uuid", uuids);
		const [sql, params] = q.build();
		const rows = await this._conn.execute(sql, params);
		return rows.map(r => this._liftRow(r)) as CardSet[];
	}

	async getByName( name: string, options?: { setCode?: string } ): Promise<CardSet[]> {
		const q = new SQLBuilder("v_cards").whereEq("name", name);
		if (options?.setCode) q.whereEq("set_code", options.setCode);
		q.orderBy("set_code DESC", "number ASC");
		const [sql, params] = q.build();
		return (await this._conn.execute(sql, params)).map(r => this._liftRow(r)) as CardSet[];
	}

	/**
	 * Fetch other faces for cards that have otherFaceIds, and append them
	 * after their corresponding side 'a' card in the results list.
	 */
	private async _appendOtherFaces(rows: CardSet[], view: string): Promise<CardSet[]> {
		const allFaceIds: string[] = [];
		for (const r of rows) {
			const ids = (r as Record<string, unknown>).otherFaceIds as string[] | null;
			if (ids?.length) allFaceIds.push(...ids);
		}
		if (allFaceIds.length === 0) return rows;

		const q = new SQLBuilder(view).whereIn("uuid", allFaceIds);
		const [sql, params] = q.build();
		const faceRows = (await this._conn.execute(sql, params)).map(r => this._liftRow(r)) as CardSet[];
		const faceMap = new Map<string, CardSet>();
		for (const f of faceRows) faceMap.set((f as Record<string, unknown>).uuid as string, f);

		const result: CardSet[] = [];
		for (const r of rows) {
			result.push(r);
			const ids = (r as Record<string, unknown>).otherFaceIds as string[] | null;
			if (ids?.length) {
				for (const id of ids) {
					const face = faceMap.get(id);
					if (face) result.push(face);
				}
			}
		}
		return result;
	}

	async search(options?: SearchOptions): Promise<CardSet[]> {
		const q = new SQLBuilder("v_cards");
		const opts = options ?? {};
		const limit = opts.limit ?? 100;
		const offset = opts.offset ?? 0;

		this._applyFilters(q, opts, "v_cards");
		q._where.push("(side = 'a' OR side IS NULL)");
		this._applySort(q, opts.sort, "v_cards");
		q.limit(limit).offset(offset);

		const [sql, params] = q.build();
		const rows = (await this._conn.execute(sql, params)).map(r => this._liftRow(r)) as CardSet[];
		return this._appendOtherFaces(rows, "v_cards");
	}

	/**
	 * Search the combined cards + tokens view (v_cards_combined).
	 * Returns results from both tables in a single sorted list.
	 * Token rows have NULL for card-only fields (manaValue, rarity, legalities, etc.).
	 */
	async searchCombined(options?: SearchOptions): Promise<CardSet[]> {
		const q = new SQLBuilder("v_cards_combined");
		const opts = options ?? {};
		const limit = opts.limit ?? 100;
		const offset = opts.offset ?? 0;

		this._applyFilters(q, opts, "v_cards_combined");
		q._where.push("(side = 'a' OR side IS NULL)");
		this._applySort(q, opts.sort, "v_cards_combined");
		q.limit(limit).offset(offset);

		const [sql, params] = q.build();
		const rows = (await this._conn.execute(sql, params)).map(r => this._liftRow(r)) as CardSet[];
		return this._appendOtherFaces(rows, "v_cards_combined");
	}

	/** Count rows in the combined cards + tokens view matching the given search options. */
	async countCombined(options?: SearchOptions): Promise<number> {
		const q = new SQLBuilder("v_cards_combined").select("COUNT(*)");
		this._applyFilters(q, options ?? {}, "v_cards_combined");
		q._where.push("(side = 'a' OR side IS NULL)");
		const [sql, params] = q.build();
		return ((await this._conn.executeScalar(sql, params)) as number) ?? 0;
	}

	async getPrintings(name: string): Promise<CardSet[]> { return this.getByName(name); }

	async getAtomic(name: string): Promise<CardAtomic[]> {
		const q = new SQLBuilder("v_cards");
		q.whereEq("name", name);
		q.orderBy("is_funny ASC NULLS FIRST", "is_online_only ASC NULLS FIRST", "side ASC NULLS FIRST");
		const [sql, params] = q.build();
		let rows = (await this._conn.execute(sql, params)).map(r => this._liftRow(r));

		// Fallback: search by face_name for split/adventure/MDFC cards
		if (rows.length === 0) {
			const q2 = new SQLBuilder("v_cards");
			q2.whereEq("face_name", name);
			q2.orderBy(
				"is_funny ASC NULLS FIRST",
				"is_online_only ASC NULLS FIRST",
				"side ASC NULLS FIRST",
			);
			const [sql2, params2] = q2.build();
			rows = (await this._conn.execute(sql2, params2)).map(r => this._liftRow(r));
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
		const sql = "SELECT * FROM v_cards WHERE identifiers_scryfall_id = $1";
		return (await this._conn.execute(sql, [scryfallId])).map(r => this._liftRow(r)) as CardSet[];
	}

	async random(count = 1): Promise<CardSet[]> {
		const sql = `SELECT * FROM v_cards ORDER BY RANDOM() LIMIT ${count}`;
		return (await this._conn.execute(sql)).map(r => this._liftRow(r)) as CardSet[];
	}

	/** Count cards matching the given search options (same filters as search()). */
	async count(options?: SearchOptions): Promise<number> {
		const q = new SQLBuilder("v_cards").select("COUNT(*)");
		this._applyFilters(q, options ?? {});
		q._where.push("(side = 'a' OR side IS NULL)");
		const [sql, params] = q.build();
		return ((await this._conn.executeScalar(sql, params)) as number) ?? 0;
	}

	/**
	 * Create a sliding-window paginator for the given search options.
	 * The first `pageSize` pages are pre-fetched in parallel on creation.
	 *
	 * @param opts   Search filters (limit/offset are managed by the paginator).
	 * @param pageSize  Number of cards per page (default 20).
	 */
	async paginate(	opts?: Omit<SearchOptions, "limit" | "offset">,	pageSize = 20 ): Promise<CardPaginator> { return CardPaginator.create(this, opts, pageSize); } }

// ---------------------------------------------------------------------------
// Sliding-window paginator
// ---------------------------------------------------------------------------

const PAGINATOR_WINDOW_SIZE = 5;

/**
 * Maintains a sliding window of `PAGINATOR_WINDOW_SIZE` (5) pre-fetched pages.
 *
 * Sliding rules (window of 5):
 *   - Moving forward: when the user reaches the 4th page in the window, the
 *     next page is fetched in the background and page 1 of the window is evicted.
 *   - Moving backward: when the user reaches the 2nd page in the window (and
 *     there are earlier pages), the previous page is fetched in the background
 *     and the last page of the window is evicted.
 *
 * Example forward walk:
 *   load         →  window [1,2,3,4,5]  current=1
 *   next()       →  window [1,2,3,4,5]  current=2
 *   next()       →  window [1,2,3,4,5]  current=3
 *   next()       →  window [1,2,3,4,5]  current=4  → bg-fetch p6, evict p1
 *   next()       →  window [2,3,4,5,6]  current=5  → bg-fetch p7, evict p2
 */
export class CardPaginator {
	private _query: CardQuery;
	private _opts: Omit<SearchOptions, "limit" | "offset">;
	private _pageSize: number;
	private _cache: Map<number, CardSet[]>;               /** page-number → results */
	private _windowPages: number[];                       /** page numbers currently held in the window, in order (for eviction decisions) */
	private _currentPage: number;
	private _pendingSlide: Promise<void> | null = null;   /** In-flight slide operation, if any. */

	private constructor( query: CardQuery, opts: Omit<SearchOptions, "limit" | "offset">, pageSize: number ) {
		this._query = query;
		this._opts = opts;
		this._pageSize = pageSize;
		this._cache = new Map();
		this._windowPages = [];
		this._currentPage = 1;
	}

	/** Create and initialise a paginator, pre-fetching the first window of pages. */
	static async create( query: CardQuery, opts?: Omit<SearchOptions, "limit" | "offset">, pageSize = 20 ): Promise<CardPaginator> {
		const p = new CardPaginator(query, opts ?? {}, pageSize);
		await p._initWindow();
		return p;
	}

	private async _fetchPage(pageNum: number): Promise<void> {
		if (this._cache.has(pageNum)) return;
		const offset = (pageNum - 1) * this._pageSize;
		const results = await this._query.search({ ...this._opts, limit: this._pageSize, offset	});
		this._cache.set(pageNum, results);
	}

	private async _initWindow(): Promise<void> {
  	await Promise.all( Array.from({ length: PAGINATOR_WINDOW_SIZE }, (_, i) => this._fetchPage(i + 1) ) ); 
		this._windowPages = Array.from({ length: PAGINATOR_WINDOW_SIZE }, (_, i) => i + 1 );
		this._currentPage = 1;
	}

	private _slideForward(): void {
		if (this._pendingSlide) return;
		const nextPage = this._windowPages[this._windowPages.length - 1] + 1;
		const evicted = this._windowPages.shift()!;               // Update the window immediately so navigation decisions are always correct.
		this._windowPages.push(nextPage);
		this._pendingSlide = this._fetchPage(nextPage).then(() => { this._cache.delete(evicted); }).finally(() => { this._pendingSlide = null; });  // Fetch in the background; evict from cache only after the fetch succeeds.
	}

	private _slideBackward(): void {
		if (this._pendingSlide) return;
		const windowStart = this._windowPages[0];
		if (windowStart <= 1) return;
		const prevPage = windowStart - 1;
		const evicted = this._windowPages.pop()!;
		this._windowPages.unshift(prevPage);
		this._pendingSlide = this._fetchPage(prevPage).then(() => { this._cache.delete(evicted); }).finally(() => { this._pendingSlide = null; });
	}

	// -----------------------------------------------------------------------
	// Public API
	// -----------------------------------------------------------------------


	get current(): CardSet[] { return this._cache.get(this._currentPage) ?? []; 	} 	/** Results for the current page. */
	get currentPageNumber(): number { return this._currentPage; } 	                  /** 1-based current page number. */

	/**
	 * True when the current page returned a full page of results, suggesting
	 * there are more pages beyond it.
	 */
	get hasNext(): boolean { return ( (this._cache.get(this._currentPage)?.length ?? 0) >= this._pageSize ); }
	get hasPrev(): boolean { return this._currentPage > 1; }            /** True when there is a previous page. */
	get windowPages(): readonly number[] { return this._windowPages; }  /** Page numbers currently held in the window (for inspection / debugging). */

	/**
	 * Advance to the next page and return its results.
	 * If the current page is the last one, the current page is returned unchanged.
	 * The window slides forward in the background when needed.
	 */
	async next(): Promise<CardSet[]> {
		if (!this.hasNext) return this.current;

		this._currentPage++;

		const windowEnd = this._windowPages[this._windowPages.length - 1];
		if (this._currentPage >= windowEnd - 1) {	this._slideForward();} 			                 // 4th or later slot in the window → slide forward in the background.
		if (!this._cache.has(this._currentPage)) { await this._fetchPage(this._currentPage); } // In normal flow the page is already cached; guard against edge cases.

		return this.current;
	}

	/**
	 * Go back to the previous page and return its results.
	 * If already on the first page, the current page is returned unchanged.
	 * The window slides backward in the background when needed.
	 */
	async prev(): Promise<CardSet[]> {
		if (!this.hasPrev) return this.current;

		this._currentPage--;

		const windowStart = this._windowPages[0];
		if (this._currentPage <= windowStart + 1 && windowStart > 1) { this._slideBackward();	}  // 2nd or earlier slot in the window → slide backward in the background.
		if (!this._cache.has(this._currentPage)) { await this._fetchPage(this._currentPage); }   // In normal flow the page is already cached; guard against edge cases.

		return this.current;
	}
}
