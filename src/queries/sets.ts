import type { Connection } from "../connection.js";
import { SQLBuilder } from "../sql-builder.js";
import type { SetList } from "../types/index.js";

export class SetQuery {
	private _conn: Connection;

	constructor(conn: Connection) { this._conn = conn; }

	async get(code: string): Promise<SetList | null> {
		const rows = await this._conn.execute( "SELECT * FROM sets WHERE code = $1", [code.toUpperCase()] );
		return (rows[0] as SetList) ?? null;
	}

	async list(options?: {setType?: string; name?: string; limit?: number;	offset?: number; }): Promise<SetList[]> {
    const q = new SQLBuilder("sets");

		if (options?.setType) q.whereEq("type", options.setType);
		if (options?.name) {
			if (options.name.includes("%")) {	q.whereLike("name", options.name); }
      else { q.whereEq("name", options.name);}
		}

		q.orderBy("release_date DESC");
		q.limit(options?.limit ?? 1000).offset(options?.offset ?? 0);

		const [sql, params] = q.build();
		return (await this._conn.execute(sql, params)) as SetList[];
	}

	async search(options?: { name?: string;	setType?: string;	block?: string; releaseYear?: number;	limit?: number;	}): Promise<SetList[]> {
		const q = new SQLBuilder("sets");

		if (options?.name) q.whereLike("name", `%${options.name}%`);
		if (options?.setType) q.whereEq("type", options.setType);
		if (options?.block) q.whereLike("block", `%${options.block}%`);
		if (options?.releaseYear) {
			const idx = q._params.length + 1;
			q._where.push(`EXTRACT(YEAR FROM release_date::DATE) = $${idx}`);
			q._params.push(options.releaseYear);
		}

		q.orderBy("release_date DESC");
		q.limit(options?.limit ?? 100);

		const [sql, params] = q.build();
		return (await this._conn.execute(sql, params)) as SetList[];
	}

	/** Not yet available — prices have not been seeded into postgres. */
	async getFinancialSummary( _setCode: string, 	_options?: { provider?: string; currency?: string;	finish?: string; priceType?: string; }): Promise<Record<string, unknown> | null> { return null; }

	async count(): Promise<number> { return (((await this._conn.executeScalar("SELECT COUNT(*) FROM sets" )) as number) ?? 0 ); }
}
