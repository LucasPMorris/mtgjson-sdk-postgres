import type { Connection } from "../connection.js";
import { SQLBuilder } from "../sql-builder.js";
import type { DeckList } from "../types/index.js";

export class DeckQuery {
	private _conn: Connection;

	constructor(conn: Connection) { this._conn = conn; }

	async list(options?: { setCode?: string;	deckType?: string; }): Promise<DeckList[]> {
  	const q = new SQLBuilder("set_decks");

		if (options?.setCode) q.whereEq("set_code", options.setCode.toUpperCase());
		if (options?.deckType) q.whereEq("type", options.deckType);

		q.orderBy("set_code DESC", "name ASC");

		const [sql, params] = q.build();
		return (await this._conn.execute(sql, params)) as DeckList[];
	}

	async search(options?: { name?: string; setCode?: string; }): Promise<DeckList[]> {	const q = new SQLBuilder("set_decks");

		if (options?.name) q.whereLike("name", `%${options.name}%`);
		if (options?.setCode) q.whereEq("set_code", options.setCode.toUpperCase());

		q.orderBy("set_code DESC", "name ASC");

		const [sql, params] = q.build();
		return (await this._conn.execute(sql, params)) as DeckList[];
	}

	async count(): Promise<number> { return (((await this._conn.executeScalar("SELECT COUNT(*) FROM set_decks" )) as number) ?? 0 ); }
}
