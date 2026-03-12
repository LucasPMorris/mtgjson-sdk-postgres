import type { Connection } from "../connection.js";
import { SQLBuilder } from "../sql-builder.js";

export class SealedQuery {
	private _conn: Connection;

	constructor(conn: Connection) { this._conn = conn; }

	async list(options?: { setCode?: string; category?: string; limit?: number; }): Promise<Record<string, unknown>[]> {
		const q = new SQLBuilder("sealed_product");

		if (options?.setCode) q.whereEq("set_code", options.setCode.toUpperCase());
		if (options?.category) q.whereEq("category", options.category);

		q.orderBy("set_code ASC", "name ASC");
		q.limit(options?.limit ?? 100);

		const [sql, params] = q.build();
		return this._conn.execute(sql, params);
	}

	async get(uuid: string): Promise<Record<string, unknown> | null> {
		const rows = await this._conn.execute( "SELECT * FROM sealed_product WHERE uuid = $1 LIMIT 1", [uuid] );
		return rows[0] ?? null;
	}
}
