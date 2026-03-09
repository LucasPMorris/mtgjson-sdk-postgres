import { BoosterSimulator } from "./booster/simulator.js";
import { CacheManager, type ProgressCallback } from "./cache.js";
import { Connection } from "./connection.js";
import { CardQuery, DeckQuery, EnumQuery, IdentifierQuery, LegalityQuery, PriceQuery, SealedQuery, SetQuery, SkuQuery, TokenQuery } from "./queries/index.js";

/** PostgreSQL connection URL. Falls back to DATABASE_URL env var. */
export interface MtgjsonSDKOptions { databaseUrl?: string; cacheDir?: string; offline?: boolean; timeout?: number;	onProgress?: ProgressCallback; }

export class MtgjsonSDK {
	private _cache: CacheManager;
	private _conn!: Connection;

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
	private _booster: BoosterSimulator | null = null;

	private constructor(options?: MtgjsonSDKOptions) { this._cache = new CacheManager({ cacheDir: options?.cacheDir,offline: options?.offline, timeout: options?.timeout, onProgress: options?.onProgress }); }

	static async create(options?: MtgjsonSDKOptions): Promise<MtgjsonSDK> {
		const sdk = new MtgjsonSDK(options);
		await sdk._cache.init();
		const url =	options?.databaseUrl ??	process.env.DATABASE_URL ?? "postgresql://localhost/mtgjson";
		sdk._conn = Connection.create(url);
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
		if (!this._enums) this._enums = new EnumQuery(this._cache);
		return this._enums;
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

	async close(): Promise<void> {
		await this._conn.close();
		this._cache.close();
	}

	/** For `await using sdk = await MtgjsonSDK.create()` */
	async [Symbol.asyncDispose](): Promise<void> { await this.close();	}
}
