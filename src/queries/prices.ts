import type { Connection } from "../connection.js";

export class PriceQuery {
	private _conn: Connection;

	constructor(conn: Connection) { this._conn = conn; }

	private async _ensure(): Promise<void> { await this._conn.ensureViews("all_prices_today"); }

	async get(uuid: string): Promise<Record<string, unknown> | null> {
		await this._ensure();
		const rows = await this._conn.execute("SELECT * FROM all_prices_today WHERE uuid = $1 ORDER BY source, provider, price_type, finish, date", [uuid] );
		if (rows.length === 0) return null;
		const result: Record<string, unknown> = {};
		for (const r of rows) {
			const srcKey = r.source as string;
			if (!result[srcKey]) result[srcKey] = {};
			const src = result[srcKey] as Record<string, unknown>;

			const provKey = r.provider as string;
			if (!src[provKey]) src[provKey] = { currency: r.currency ?? "USD" };
			const prov = src[provKey] as Record<string, unknown>;

			const catKey = r.price_type as string;
			if (!prov[catKey]) prov[catKey] = {};
			const cat = prov[catKey] as Record<string, unknown>;

			const finKey = r.finish as string;
			if (!cat[finKey]) cat[finKey] = {};
			const fin = cat[finKey] as Record<string, unknown>;

			fin[r.date as string] = r.price;
		}
		return result;
	}

	async today( uuid: string, options?: {	provider?: string; finish?: string; priceType?: string; } ): Promise<Record<string, unknown>[]> {
		await this._ensure();
		const parts = ["SELECT * FROM all_prices_today", "WHERE uuid = $1", "AND date = (SELECT MAX(p2.date) FROM all_prices_today p2 WHERE p2.uuid = $1)" ];
		const params: unknown[] = [uuid];
		let idx = 2;
		if (options?.provider) {
			parts.push(`AND provider = $${idx}`);
			params.push(options.provider);
			idx++;
		}
		if (options?.finish) {
			parts.push(`AND finish = $${idx}`);
			params.push(options.finish);
			idx++;
		}
		if (options?.priceType) {
			parts.push(`AND price_type = $${idx}`);
			params.push(options.priceType);
			idx++;
		}
		return this._conn.execute(parts.join(" "), params);
	}

	async history( uuid: string,	options?: { provider?: string; finish?: string; priceType?: string; dateFrom?: string; dateTo?: string; } ): Promise<Record<string, unknown>[]> {
		await this._conn.ensureViews("all_prices");
		const parts = ["SELECT * FROM all_prices WHERE uuid = $1"];
		const params: unknown[] = [uuid];
		let idx = 2;
		if (options?.provider) {
			parts.push(`AND provider = $${idx}`);
			params.push(options.provider);
			idx++;
		}
		if (options?.finish) {
			parts.push(`AND finish = $${idx}`);
			params.push(options.finish);
			idx++;
		}
		if (options?.priceType) {
			parts.push(`AND price_type = $${idx}`);
			params.push(options.priceType);
			idx++;
		}
		if (options?.dateFrom) {
			parts.push(`AND date >= $${idx}`);
			params.push(options.dateFrom);
			idx++;
		}
		if (options?.dateTo) {
			parts.push(`AND date <= $${idx}`);
			params.push(options.dateTo);
			idx++;
		}
		parts.push("ORDER BY date ASC");
		return this._conn.execute(parts.join(" "), params);
	}

	async priceTrend( uuid: string, options?: {	provider?: string; finish?: string;	priceType?: string;	}	): Promise<Record<string, unknown> | null> {
		await this._conn.ensureViews("all_prices");
		const priceType = options?.priceType ?? "retail";
		const parts = [
			"SELECT",
			"  MIN(price) AS min_price,",
			"  MAX(price) AS max_price,",
			"  ROUND(AVG(price), 2) AS avg_price,",
			"  MIN(date) AS first_date,",
			"  MAX(date) AS last_date,",
			"  COUNT(*) AS data_points",
			"FROM all_prices",
			"WHERE uuid = $1 AND price_type = $2",
		];
		const params: unknown[] = [uuid, priceType];
		let idx = 3;
		if (options?.provider) {
			parts.push(`AND provider = $${idx}`);
			params.push(options.provider);
			idx++;
		}
		if (options?.finish) {
			parts.push(`AND finish = $${idx}`);
			params.push(options.finish);
			idx++;
		}
		const rows = await this._conn.execute(parts.join(" "), params);
		if (!rows.length || (rows[0].data_points as number) === 0) return null;
		return rows[0];
	}

	async cheapestPrinting( name: string,	options?: {	provider?: string; finish?: string; priceType?: string;	} ): Promise<Record<string, unknown> | null> {
		await this._ensure();
		await this._conn.ensureViews("cards");
		const provider = options?.provider ?? "tcgplayer";
		const finish = options?.finish ?? "normal";
		const priceType = options?.priceType ?? "retail";
		const sql =
			"SELECT c.uuid, c.setCode, c.number, p.price, p.date " +
			"FROM cards c " +
			"JOIN all_prices_today p ON c.uuid = p.uuid " +
			"WHERE c.name = $1 AND p.provider = $2 " +
			"AND p.finish = $3 AND p.price_type = $4 " +
			"AND p.date = (SELECT MAX(p2.date) FROM all_prices_today p2 " +
			"WHERE p2.uuid = c.uuid AND p2.provider = $2 " +
			"AND p2.finish = $3 AND p2.price_type = $4) " +
			"ORDER BY p.price ASC " +
			"LIMIT 1";
		const rows = await this._conn.execute(sql, [name, provider, finish, priceType, ]);
		return rows[0] ?? null;
	}

	async cheapestPrintings(options?: { provider?: string; finish?: string; priceType?: string; limit?: number; offset?: number; }): Promise<Record<string, unknown>[]> {
		await this._ensure();
		await this._conn.ensureViews("cards");
		const provider = options?.provider ?? "tcgplayer";
		const finish = options?.finish ?? "normal";
		const priceType = options?.priceType ?? "retail";
		const limit = options?.limit ?? 100;
		const offset = options?.offset ?? 0;
		const sql = `SELECT c.name,   arg_min(c.setCode, p.price) AS cheapest_set,   arg_min(c.number, p.price) AS cheapest_number,   arg_min(c.uuid, p.price) AS cheapest_uuid,   MIN(p.price) AS min_price FROM cards c JOIN all_prices_today p ON c.uuid = p.uuid WHERE p.provider = $1 AND p.finish = $2 AND p.price_type = $3 AND p.date = (SELECT MAX(date) FROM all_prices_today) GROUP BY c.name ORDER BY min_price ASC LIMIT ${limit} OFFSET ${offset}`;
		return this._conn.execute(sql, [provider, finish, priceType]);
	}

	async mostExpensivePrintings(options?: {provider?: string; finish?: string; priceType?: string; limit?: number; offset?: number; }): Promise<Record<string, unknown>[]> {
		await this._ensure();
		await this._conn.ensureViews("cards");
		const provider = options?.provider ?? "tcgplayer";
		const finish = options?.finish ?? "normal";
		const priceType = options?.priceType ?? "retail";
		const limit = options?.limit ?? 100;
		const offset = options?.offset ?? 0;
		const sql = `SELECT c.name,   arg_max(c.setCode, p.price) AS priciest_set,   arg_max(c.number, p.price) AS priciest_number,   arg_max(c.uuid, p.price) AS priciest_uuid,   MAX(p.price) AS max_price FROM cards c JOIN all_prices_today p ON c.uuid = p.uuid WHERE p.provider = $1 AND p.finish = $2 AND p.price_type = $3 AND p.date = (SELECT MAX(date) FROM all_prices_today) GROUP BY c.name ORDER BY max_price DESC LIMIT ${limit} OFFSET ${offset}`;
		return this._conn.execute(sql, [provider, finish, priceType]);
	}
}
