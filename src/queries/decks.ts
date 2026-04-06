import type { Connection } from "../connection.js";
import { SQLBuilder } from "../sql-builder.js";
import type { DeckCard, DeckCardEntry, DeckList, DeckStats, DeckToken, PreconDeck } from "../types/index.js";
import { liftRow } from "./_lift.js";

// ---------------------------------------------------------------------------
// Search options (minimal for now — filters can be added later)
// ---------------------------------------------------------------------------

export type DeckSearchOptions = {
	limit?: number;
	offset?: number;
};

// ---------------------------------------------------------------------------
// DeckQuery
// ---------------------------------------------------------------------------

export class DeckQuery {
	private _conn: Connection;

	constructor(conn: Connection) { this._conn = conn; }

	/** @deprecated Use search() for hydrated results. */
	async list(options?: { setCode?: string;	deckType?: string; }): Promise<DeckList[]> {
  	const q = new SQLBuilder("set_decks");

		if (options?.setCode) q.whereEq("set_code", options.setCode.toUpperCase());
		if (options?.deckType) q.whereEq("type", options.deckType);

		q.orderBy("set_code DESC", "name ASC");

		const [sql, params] = q.build();
		return (await this._conn.execute(sql, params)) as DeckList[];
	}

	/**
	 * Search decks and return fully hydrated results with card data in boards.
	 */
	async search(options?: DeckSearchOptions): Promise<PreconDeck[]> {
		const opts = options ?? {};
		const limit = opts.limit ?? 20;
		const offset = opts.offset ?? 0;

		const q = new SQLBuilder("set_decks");
		q.orderBy("set_code DESC", "name ASC");
		q.limit(limit).offset(offset);

		const [sql, params] = q.build();
		const deckRows = await this._conn.execute(sql, params);

		return this._hydrate(deckRows);
	}

	/**
	 * Get a single deck by code, fully hydrated with card data.
	 */
	async getByCode(code: string): Promise<PreconDeck | null> {
		const deckRows = await this._conn.execute(
			"SELECT * FROM set_decks WHERE code = $1", [code]
		);
		if (!deckRows.length) return null;
		const results = await this._hydrate(deckRows);
		return results[0] ?? null;
	}

	async count(): Promise<number> { return (((await this._conn.executeScalar("SELECT COUNT(*) FROM set_decks" )) as number) ?? 0 ); }

	/**
	 * Create a sliding-window paginator over hydrated decks.
	 */
	async paginate(opts?: Omit<DeckSearchOptions, "limit" | "offset">, pageSize = 20): Promise<DeckPaginator> {
		return DeckPaginator.create(this, opts, pageSize);
	}

	// -----------------------------------------------------------------------
	// Hydration
	// -----------------------------------------------------------------------

	/**
	 * Takes raw set_decks rows and returns fully hydrated PreconDeck objects.
	 * 1. Batch-fetch set_deck_cards for all decks
	 * 2. Batch-fetch card data from v_cards_combined for all unique UUIDs
	 * 3. Assemble boards per deck
	 */
	async _hydrate(deckRows: Record<string, unknown>[]): Promise<PreconDeck[]> {
		if (!deckRows.length) return [];

		const codes = deckRows.map(r => r.code as string);

		// Fetch all card entries for these decks
		const entryQ = new SQLBuilder("set_deck_cards").whereIn("deck_code", codes);
		const [entrySql, entryParams] = entryQ.build();
		const entryRows = await this._conn.execute(entrySql, entryParams);

		// Collect unique card UUIDs and batch-fetch from v_cards_combined
		const uuids = [...new Set(entryRows.map(r => r.uuid as string))];
		const cardMap = new Map<string, Record<string, unknown>>();

		if (uuids.length > 0) {
			const cardQ = new SQLBuilder("v_cards_combined").whereIn("uuid", uuids);
			const [cardSql, cardParams] = cardQ.build();
			const cardRows = await this._conn.execute(cardSql, cardParams);
			for (const r of cardRows) {
				const lifted = liftRow(r);
				cardMap.set(lifted.uuid as string, lifted);
			}
		}

		// Group entries by deck_code
		const entriesByDeck = new Map<string, Record<string, unknown>[]>();
		for (const entry of entryRows) {
			const dc = entry.deckCode as string;
			let arr = entriesByDeck.get(dc);
			if (!arr) { arr = []; entriesByDeck.set(dc, arr); }
			arr.push(entry);
		}

		// Assemble PreconDeck objects
		return deckRows.map(deck => {
			const deckCode = deck.code as string;
			const entries = entriesByDeck.get(deckCode) ?? [];

			const commander: DeckCard[] = [];
			const mainBoard: DeckCard[] = [];
			const sideBoard: DeckCard[] = [];
			const tokens: DeckToken[] = [];

			for (const entry of entries) {
				const cardData = cardMap.get(entry.uuid as string);
				if (!cardData) continue;

				const deckEntry: DeckCardEntry = {
					uuid: entry.uuid as string,
					count: entry.count as number,
					isFoil: (entry.isFoil as boolean) ?? undefined,
					collectionItemUuid: (entry.collectionItemUuid as string) ?? null,
				};

				const sourceTable = cardData.sourceTable as string | undefined;

				if (sourceTable === "token") {
					tokens.push({ ...cardData, ...deckEntry } as DeckToken);
				} else {
					const card = { ...cardData, ...deckEntry } as DeckCard;
					const boardType = entry.boardType as string;
					if (boardType === "commander") commander.push(card);
					else if (boardType === "sideBoard") sideBoard.push(card);
					else mainBoard.push(card);
				}
			}

			const stats = deck.stats ? (typeof deck.stats === "string" ? JSON.parse(deck.stats as string) : deck.stats) as DeckStats : null;

			return {
				code: deckCode,
				uuid: deck.uuid as string,
				name: deck.name as string,
				source: deck.source as string,
				type: deck.type as string,
				description: (deck.description as string) ?? null,
				releaseDate: deck.releaseDate as string,
				sealedProductUuids: (deck.sealedProductUuids as string[]) ?? null,
				stats,
				createdAt: (deck.createdAt as string) ?? null,
				updatedAt: (deck.updatedAt as string) ?? null,
				commander: commander.length ? commander : undefined,
				mainBoard,
				sideBoard: sideBoard.length ? sideBoard : undefined,
				tokens: tokens.length ? tokens : undefined,
			} satisfies PreconDeck;
		});
	}
}

// ---------------------------------------------------------------------------
// Sliding-window paginator
// ---------------------------------------------------------------------------

const PAGINATOR_WINDOW_SIZE = 5;

/**
 * Maintains a sliding window of `PAGINATOR_WINDOW_SIZE` (5) pre-fetched pages
 * of fully hydrated PreconDeck results.
 *
 * Sliding rules (window of 5):
 *   - Moving forward: when the user reaches the 4th page in the window, the
 *     next page is fetched in the background and page 1 of the window is evicted.
 *   - Moving backward: when the user reaches the 2nd page in the window (and
 *     there are earlier pages), the previous page is fetched in the background
 *     and the last page of the window is evicted.
 */
export class DeckPaginator {
	private _query: DeckQuery;
	private _opts: Omit<DeckSearchOptions, "limit" | "offset">;
	private _pageSize: number;
	private _cache: Map<number, PreconDeck[]>;
	private _windowPages: number[];
	private _currentPage: number;
	private _pendingSlide: Promise<void> | null = null;

	private constructor(query: DeckQuery, opts: Omit<DeckSearchOptions, "limit" | "offset">, pageSize: number) {
		this._query = query;
		this._opts = opts;
		this._pageSize = pageSize;
		this._cache = new Map();
		this._windowPages = [];
		this._currentPage = 1;
	}

	static async create(query: DeckQuery, opts?: Omit<DeckSearchOptions, "limit" | "offset">, pageSize = 20): Promise<DeckPaginator> {
		const p = new DeckPaginator(query, opts ?? {}, pageSize);
		await p._initWindow();
		return p;
	}

	private async _fetchPage(pageNum: number): Promise<void> {
		if (this._cache.has(pageNum)) return;
		const offset = (pageNum - 1) * this._pageSize;
		const results = await this._query.search({ ...this._opts, limit: this._pageSize, offset });
		this._cache.set(pageNum, results);
	}

	private async _initWindow(): Promise<void> {
		await Promise.all(Array.from({ length: PAGINATOR_WINDOW_SIZE }, (_, i) => this._fetchPage(i + 1)));
		this._windowPages = Array.from({ length: PAGINATOR_WINDOW_SIZE }, (_, i) => i + 1);
		this._currentPage = 1;
	}

	private _slideForward(): void {
		if (this._pendingSlide) return;
		const nextPage = this._windowPages[this._windowPages.length - 1] + 1;
		const evicted = this._windowPages.shift()!;
		this._windowPages.push(nextPage);
		this._pendingSlide = this._fetchPage(nextPage).then(() => { this._cache.delete(evicted); }).finally(() => { this._pendingSlide = null; });
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

	get current(): PreconDeck[] { return this._cache.get(this._currentPage) ?? []; }
	get currentPageNumber(): number { return this._currentPage; }

	get hasNext(): boolean { return (this._cache.get(this._currentPage)?.length ?? 0) >= this._pageSize; }
	get hasPrev(): boolean { return this._currentPage > 1; }
	get windowPages(): readonly number[] { return this._windowPages; }

	async next(): Promise<PreconDeck[]> {
		if (!this.hasNext) return this.current;

		this._currentPage++;

		const windowEnd = this._windowPages[this._windowPages.length - 1];
		if (this._currentPage >= windowEnd - 1) { this._slideForward(); }
		if (!this._cache.has(this._currentPage)) { await this._fetchPage(this._currentPage); }

		return this.current;
	}

	async prev(): Promise<PreconDeck[]> {
		if (!this.hasPrev) return this.current;

		this._currentPage--;

		const windowStart = this._windowPages[0];
		if (this._currentPage <= windowStart + 1 && windowStart > 1) { this._slideBackward(); }
		if (!this._cache.has(this._currentPage)) { await this._fetchPage(this._currentPage); }

		return this.current;
	}
}
