import type { Connection } from "../connection.js";
import type { TcgplayerSkus } from "../types/index.js";

// TCGPlayer SKUs have not yet been seeded into postgres.
// These methods return empty results until a tcgplayer_skus table is added.
export class SkuQuery {
	private _conn: Connection;

	constructor(conn: Connection) { this._conn = conn; }

	async get(_uuid: string): Promise<TcgplayerSkus[]> {return []; }

	async findBySkuId(_skuId: number): Promise<Record<string, unknown> | null> { return null; }

	async findByProductId(_productId: number): Promise<Record<string, unknown>[]> {	return []; }
}
