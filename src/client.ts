import { BoosterSimulator } from "./booster/simulator.js";
import { CacheManager, type ProgressCallback } from "./cache.js";
import { Connection } from "./connection.js";
import { CardQuery, CollectionQuery, DeckQuery, EnumQuery, IdentifierQuery, LegalityQuery, PriceQuery, SealedQuery, SetQuery, SkuQuery, TokenQuery } from "./queries/index.js";
import { setNameCollation } from "./queries/_sort-helpers.js";
import { seedCatalogs } from "./seeder.js";
import { checkForSetUpdates, applySetUpdates, refreshMaterializedViews, type UpdateCheckResult, type UpdateResult, type UpdateProgress } from "./updater.js";
import { ensurePricingSchema, updatePricingFull, updatePricingToday, type UpdatePricingOptions, type UpdatePricingResult } from "./pricing.js";

/**
 * PostgreSQL connection URL. Falls back to DATABASE_URL env var.
 *
 * `nameCollation` controls the collation appended to text ORDER BY clauses so sort
 * results stay consistent across Postgres installations with different default locales
 * (e.g. local `C.UTF-8` vs Render `en_US.UTF-8`). Defaults to `"C"`; pass `null` to
 * opt out and use the database's default collation.
 */
export interface MtgjsonSDKOptions { databaseUrl?: string; cacheDir?: string; offline?: boolean; timeout?: number;	onProgress?: ProgressCallback; staleCheckTtlMs?: number; nameCollation?: string | null; }

export class MtgjsonSDK {
	private _cache: CacheManager;
	private _conn!: Connection;
	private _connectionUrl!: string;

	private _cards: CardQuery | null = null;
	private _sets: SetQuery | null = null;
	private _prices: PriceQuery | null = null;
	private _decks: DeckQuery | null = null;
	private _sealed: SealedQuery | null = null;
	private _skus: SkuQuery | null = null;
	private _identifiers: IdentifierQuery | null = null;
	private _legalities: LegalityQuery | null = null;
	private _tokens: TokenQuery | null = null;
	private _enums: EnumQuery | null = null;
	private _collections: CollectionQuery | null = null;
	private _booster: BoosterSimulator | null = null;

	private constructor(options?: MtgjsonSDKOptions) { this._cache = new CacheManager({ cacheDir: options?.cacheDir, offline: options?.offline, timeout: options?.timeout, onProgress: options?.onProgress, staleCheckTtlMs: options?.staleCheckTtlMs }); }

	static async create(options?: MtgjsonSDKOptions): Promise<MtgjsonSDK> {
		const sdk = new MtgjsonSDK(options);
		await sdk._cache.init();
		const url = options?.databaseUrl ?? process.env.DATABASE_URL ?? "postgresql://localhost/mtgjson";
		sdk._connectionUrl = url;
		sdk._conn = Connection.create(url);
		if (options && "nameCollation" in options) setNameCollation(options.nameCollation ?? null);
		return sdk;
	}

	get cards(): CardQuery {
		if (!this._cards) this._cards = new CardQuery(this._conn);
		return this._cards;
	}

	get sets(): SetQuery {
		if (!this._sets) this._sets = new SetQuery(this._conn);
		return this._sets;
	}

	get prices(): PriceQuery {
		if (!this._prices) this._prices = new PriceQuery(this._conn);
		return this._prices;
	}

	get decks(): DeckQuery {
		if (!this._decks) this._decks = new DeckQuery(this._conn);
		return this._decks;
	}

	get sealed(): SealedQuery {
		if (!this._sealed) this._sealed = new SealedQuery(this._conn);
		return this._sealed;
	}

	get skus(): SkuQuery {
		if (!this._skus) this._skus = new SkuQuery(this._conn);
		return this._skus;
	}

	get identifiers(): IdentifierQuery {
		if (!this._identifiers) this._identifiers = new IdentifierQuery(this._conn);
		return this._identifiers;
	}

	get legalities(): LegalityQuery {
		if (!this._legalities) this._legalities = new LegalityQuery(this._conn);
		return this._legalities;
	}

	get tokens(): TokenQuery {
		if (!this._tokens) this._tokens = new TokenQuery(this._conn);
		return this._tokens;
	}

	get enums(): EnumQuery {
		if (!this._enums) this._enums = new EnumQuery(this._conn);
		return this._enums;
	}

	get collections(): CollectionQuery {
		if (!this._collections) this._collections = new CollectionQuery(this._conn);
		return this._collections;
	}

	get booster(): BoosterSimulator {
		if (!this._booster) this._booster = new BoosterSimulator(this._conn);
		return this._booster;
	}

	get meta(): Promise<Record<string, unknown>> {
		return this._conn.execute("SELECT * FROM meta LIMIT 1").then((rows) => rows[0] ?? {}).catch(() => ({})); }

	async sql( query: string, params?: unknown[] ): Promise<Record<string, unknown>[]> { return this._conn.execute(query, params); }

	/** No-op in postgres mode — data is persistent. */
	async refresh(): Promise<boolean> { return false; }

	/**
	 * Check MTGJSON's SetList.json and return any set codes not yet in the database.
	 * Makes a single CDN request (SetList.json is the lightweight manifest).
	 */
	async checkForUpdates(): Promise<UpdateCheckResult> {	return checkForSetUpdates(this._connectionUrl); }

	/**
	 * Download and seed any sets present in MTGJSON but absent from the database.
	 * Each new set is fetched individually — no full AllPrintings.json download needed.
	 *
	 * @param options.sets   Explicit set codes to add — skips the SetList check.
	 * @param options.onProgress  Called after each set is seeded.
	 */
	async update(options?: { sets?: string[];	timeout?: number;	onProgress?: (progress: UpdateProgress) => void; }): Promise<UpdateResult> { return applySetUpdates(this._connectionUrl, options); }

	/**
	 * Refresh the denormalized materialized views (`v_cards`, `v_tokens`, `v_cards_combined`)
	 * that the SDK's read API queries. `update()` already calls this at the end of a run, so
	 * only call it directly after out-of-band base-table writes (e.g. a standalone `seedSingleSet`).
	 */
	async refreshViews(): Promise<void> { return refreshMaterializedViews(this._connectionUrl); }

	/** Re-download Keywords, CardTypes, and EnumValues from MTGJSON and upsert into the catalogs table. */
	async refreshCatalogs(options?: { timeout?: number }): Promise<number> {
		const pg = (await import("postgres")).default(this._connectionUrl);
		try { return await seedCatalogs(pg, options); }
		finally { await pg.end(); }
	}

	/** Ensure the pricing schema (tables, hypertable, continuous aggregates, trigger) is applied. Safe to call repeatedly. */
	async ensurePricingSchema(): Promise<void> { return ensurePricingSchema(this._connectionUrl); }

	/**
	 * Seed/refresh pricing from MTGJSON's `AllPrices.json` (90-day history).
	 * Writes change-only rows to `prices_daily`. Re-runnable; PK conflicts ignored.
	 */
	async updatePricingFull(options?: UpdatePricingOptions): Promise<UpdatePricingResult> { return updatePricingFull(this._connectionUrl, options); }

	/**
	 * Daily delta ingest from MTGJSON's `AllPricesToday.json`.
	 * Only writes rows for combos whose price changed since the last run.
	 */
	async updatePricingToday(options?: UpdatePricingOptions): Promise<UpdatePricingResult> { return updatePricingToday(this._connectionUrl, options); }

	async close(): Promise<void> {
  	await this._conn.close();
		this._cache.close();
	}

	/** For `await using sdk = await MtgjsonSDK.create()` */
	async [Symbol.asyncDispose](): Promise<void> { await this.close();	}
}
