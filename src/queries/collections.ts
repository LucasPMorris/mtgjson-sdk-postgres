import type { Connection } from "../connection.js";
import { SQLBuilder } from "../sql-builder.js";
import type { CollectionItemCard } from "../types/index.js";
import { applyCardFilters, applyCardSort, SORT_FIELD_MAP, type SearchOptions, type SortDirection } from "./_card-filters.js";
import { collated } from "./_sort-helpers.js";
import { liftRow } from "./_lift.js";

// ---------------------------------------------------------------------------
// Collection-specific sort fields (mapped to collection_items columns)
// ---------------------------------------------------------------------------

export type CollectionSortField = "name" | "manaValue" | "power" | "toughness" | "number" | "set"
	| "quantity" | "itemCondition" | "itemLanguage" | "itemFinish";
export type CollectionSortOption = CollectionSortField | `${CollectionSortField}:${SortDirection}`;

const COLLECTION_SORT_FIELD_MAP: Record<string, { column: string; table: "ci" }> = {
	quantity:      { column: "quantity",       table: "ci" },
	itemCondition: { column: "item_condition", table: "ci" },
	itemLanguage:  { column: "item_language",  table: "ci" },
	itemFinish:    { column: "item_finish",    table: "ci" },
};

// ---------------------------------------------------------------------------
// Search options
// ---------------------------------------------------------------------------

export type CollectionSearchOptions = SearchOptions & {
	itemCondition?: string | string[];
	itemFinish?: string | string[];
	locationUuid?: string | string[];
	sort?: CollectionSortOption | CollectionSortOption[];
};

// ---------------------------------------------------------------------------
// SELECT columns for collection_items fields
// ---------------------------------------------------------------------------

const CI_COLUMNS = [
	"ci.uuid AS item_uuid",
	"ci.item_collection_id",
	"ci.quantity",
	"ci.item_finish",
	"ci.item_condition",
	"ci.location_uuid",
	"ci.item_language",
	"ci.created_at AS added_at",
	"ci.updated_at AS item_updated_at",
].join(", ");

// ---------------------------------------------------------------------------
// CollectionQuery
// ---------------------------------------------------------------------------

export class CollectionQuery {
	private _conn: Connection;

	constructor(conn: Connection) { this._conn = conn; }

	/** Apply collection-item-level WHERE filters. */
	private _applyItemFilters(q: SQLBuilder, opts: CollectionSearchOptions): void {
		if (opts.itemCondition) {	Array.isArray(opts.itemCondition) ? q.whereIn("ci.item_condition", opts.itemCondition) : q.whereEq("ci.item_condition", opts.itemCondition);}
		if (opts.itemFinish) { Array.isArray(opts.itemFinish) ? q.whereIn("ci.item_finish", opts.itemFinish) : q.whereEq("ci.item_finish", opts.itemFinish); }
		if (opts.locationUuid) { Array.isArray(opts.locationUuid) ? q.whereIn("ci.location_uuid", opts.locationUuid) : q.whereEq("ci.location_uuid", opts.locationUuid); }
	}

	/** Apply ORDER BY for both card-level and collection-item-level sort fields. */
	private _applySort(q: SQLBuilder, sort: CollectionSortOption | CollectionSortOption[] | undefined): void {
		if (!sort) { q.orderBy(`${collated("v.name")} ASC`, `${collated("v.number")} ASC`); return; }

		const sorts = Array.isArray(sort) ? sort : [sort];

		// Separate card sorts from collection-item sorts
		const cardSorts: string[] = [];
		for (const s of sorts) {
			const [field, dir = "ASC"] = s.split(":") as [string, SortDirection?];
			const direction = dir === "DESC" ? "DESC" : "ASC";

			const ciMapping = COLLECTION_SORT_FIELD_MAP[field];
			if (ciMapping) {
				q.orderBy(`${ciMapping.table}.${ciMapping.column} ${direction}`);
				continue;
			}

			// Delegate card-level sort fields
			const cardMapping = SORT_FIELD_MAP[field as keyof typeof SORT_FIELD_MAP];
			if (cardMapping) { cardSorts.push(s); }
		}

		if (cardSorts.length > 0) {
			applyCardSort(q, cardSorts as import("./_card-filters.js").SortOption[], "v");
		}
	}

	/** Build base query: collection_items ci JOIN v_cards v, scoped to a collection and item_type='card'. */
	private _baseQuery(collectionId: string): SQLBuilder {
		const q = new SQLBuilder("collection_items ci");
		q.select(`v.*`, CI_COLUMNS);
		q.join("JOIN v_cards v ON ci.item_uuid = v.uuid");
		q.whereEq("ci.item_collection_id", collectionId);
		q._where.push("ci.item_type = 'card'");
		q._where.push("(v.side = 'a' OR v.side IS NULL)");
		return q;
	}

	/**
	 * Search collection items (cards) with full card filtering, sorting, and pagination.
	 * Combines card-level filters from SearchOptions with collection-item filters.
	 */
	async search(collectionId: string, options?: CollectionSearchOptions): Promise<CollectionItemCard[]> {
		const opts = options ?? {};
		const limit = opts.limit ?? 100;
		const offset = opts.offset ?? 0;

		const q = this._baseQuery(collectionId);
		applyCardFilters(q, opts, "v");
		this._applyItemFilters(q, opts);
		this._applySort(q, opts.sort);
		q.limit(limit).offset(offset);

		const [sql, params] = q.build();
		const rows = await this._conn.execute(sql, params);
		return rows.map(r => liftRow(r)) as CollectionItemCard[];
	}

	/** Count collection items (cards) matching the given search options. */
	async count(collectionId: string, options?: CollectionSearchOptions): Promise<number> {
		const opts = options ?? {};
		const q = new SQLBuilder("collection_items ci");
		q.select("COUNT(*)");
		q.join("JOIN v_cards v ON ci.item_uuid = v.uuid");
		q.whereEq("ci.item_collection_id", collectionId);
		q._where.push("ci.item_type = 'card'");
		q._where.push("(v.side = 'a' OR v.side IS NULL)");
		applyCardFilters(q, opts, "v");
		this._applyItemFilters(q, opts);

		const [sql, params] = q.build();
		return ((await this._conn.executeScalar(sql, params)) as number) ?? 0;
	}

	/**
	 * Create a sliding-window paginator for collection card search.
	 *
	 * @param collectionId  The collection to search within.
	 * @param opts          Search filters (limit/offset managed by the paginator).
	 * @param pageSize      Number of items per page (default 20).
	 */
	async paginate(	collectionId: string, opts?: Omit<CollectionSearchOptions, "limit" | "offset">, pageSize = 20,	): Promise<CollectionPaginator> {
		return CollectionPaginator.create(this, collectionId, opts, pageSize);
	}
}

// ---------------------------------------------------------------------------
// Sliding-window paginator
// ---------------------------------------------------------------------------

const PAGINATOR_WINDOW_SIZE = 5;

/**
 * Maintains a sliding window of pre-fetched pages for collection card search.
 * Same sliding-window pattern as CardPaginator.
 */
export class CollectionPaginator {
	private _query: CollectionQuery;
	private _collectionId: string;
	private _opts: Omit<CollectionSearchOptions, "limit" | "offset">;
	private _pageSize: number;
	private _cache: Map<number, CollectionItemCard[]>;
	private _windowPages: number[];
	private _currentPage: number;
	private _pendingSlide: Promise<void> | null = null;

	private constructor( query: CollectionQuery, collectionId: string, opts: Omit<CollectionSearchOptions, "limit" | "offset">, pageSize: number	) {
		this._query = query;
		this._collectionId = collectionId;
		this._opts = opts;
		this._pageSize = pageSize;
		this._cache = new Map();
		this._windowPages = [];
		this._currentPage = 1;
	}

	static async create( query: CollectionQuery, collectionId: string, opts?: Omit<CollectionSearchOptions, "limit" | "offset">, pageSize = 20 ): Promise<CollectionPaginator> {
		const p = new CollectionPaginator(query, collectionId, opts ?? {}, pageSize);
		await p._initWindow();
		return p;
	}

	private async _fetchPage(pageNum: number): Promise<void> {
		if (this._cache.has(pageNum)) return;
		const offset = (pageNum - 1) * this._pageSize;
		const results = await this._query.search(this._collectionId, { ...this._opts, limit: this._pageSize, offset });
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

	get current(): CollectionItemCard[] { return this._cache.get(this._currentPage) ?? []; }
	get currentPageNumber(): number { return this._currentPage; }
	get hasNext(): boolean { return (this._cache.get(this._currentPage)?.length ?? 0) >= this._pageSize; }
	get hasPrev(): boolean { return this._currentPage > 1; }
	get windowPages(): readonly number[] { return this._windowPages; }

	async next(): Promise<CollectionItemCard[]> {
		if (!this.hasNext) return this.current;
		this._currentPage++;
		const windowEnd = this._windowPages[this._windowPages.length - 1];
		if (this._currentPage >= windowEnd - 1) { this._slideForward(); }
		if (!this._cache.has(this._currentPage)) { await this._fetchPage(this._currentPage); }
		return this.current;
	}

	async prev(): Promise<CollectionItemCard[]> {
		if (!this.hasPrev) return this.current;
		this._currentPage--;
		const windowStart = this._windowPages[0];
		if (this._currentPage <= windowStart + 1 && windowStart > 1) { this._slideBackward(); }
		if (!this._cache.has(this._currentPage)) { await this._fetchPage(this._currentPage); }
		return this.current;
	}
}
