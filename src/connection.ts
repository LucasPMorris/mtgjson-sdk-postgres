import postgres from "postgres";

// biome-ignore lint/suspicious/noExplicitAny: postgres unsafe API requires any[]
type PgParams = any[];

export class Connection {
	private _db: postgres.Sql;
	_registeredViews = new Set<string>();
	private constructor(db: postgres.Sql) {	this._db = db;}

	static create(databaseUrl: string): Connection {
		const db = postgres(databaseUrl);
		return new Connection(db);
	}

	async close(): Promise<void> { await this._db.end(); }

	/** No-op: all tables already exist in postgres. */
	async ensureViews(..._viewNames: string[]): Promise<void> {}

	async execute( sql: string,	params?: unknown[]): Promise<Record<string, unknown>[]> {
		const rows = await this._db.unsafe(sql, (params ?? []) as PgParams);
		return (rows as Record<string, unknown>[]).map(snakeToCamel);
	}

	async executeScalar(sql: string, params?: unknown[]): Promise<unknown> {
		const rows = await this._db.unsafe(sql, (params ?? []) as PgParams);
		if (!rows.length) return null;
		const val = Object.values(rows[0] as Record<string, unknown>)[0] ?? null;
		if (typeof val === "bigint") return Number(val);
		return val;
	}
}

/** Converts a flat postgres row (snake_case keys) to camelCase keys. */
function snakeToCamel(row: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, val] of Object.entries(row)) {
		const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
		out[camel] = val;
	}
	return out;
}
