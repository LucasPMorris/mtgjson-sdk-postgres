import type { Connection } from "../connection.js";
import type { PriceFormats } from "../types/index.js";
import { collated } from "./_sort-helpers.js";

/**
 * Pricing queries against the change-only schema defined in pricing-schema.sql.
 *
 *   prices_current  - latest price per (uuid, dims). Hot path for card lists.
 *   prices_daily    - change-only history hypertable. Serves card-detail charts.
 *   prices_weekly   - plain materialized view (bucket, avg/min/max price).
 *                     Refreshed at the end of each ingest tick.
 *   prices_monthly  - plain materialized view, same shape, monthly bucket.
 *
 * `dims` is a bit-packed SMALLINT (see pack_dims_ints in pricing-schema.sql);
 * we unpack it in JS rather than calling unpack_dims() per row.
 */

// ── Dim decoding ──────────────────────────────────────────────────────────────

const PROVIDER_NAME: Record<number, string> = { 0: "cardhoarder", 1: "cardkingdom", 2: "cardmarket", 3: "cardsphere", 4: "tcgplayer" };
const PROVIDER_CURRENCY: Record<string, string> = { cardhoarder: "USD", cardkingdom: "USD", cardmarket: "EUR", cardsphere: "USD", tcgplayer: "USD" };
const FINISH_NAME: Record<number, "normal" | "foil" | "etched"> = { 0: "normal", 1: "foil", 2: "etched" };

export interface UnpackedDims { provider: string; format: "paper" | "mtgo"; finish: "normal" | "foil" | "etched"; priceType: "retail" | "buylist"; currency: string; }

export function unpackDims(dims: number): UnpackedDims {
	const provider = PROVIDER_NAME[(dims >> 4) & 7] ?? "unknown";
	const format = ((dims >> 3) & 1) === 0 ? "paper" : "mtgo";
	const finish = FINISH_NAME[(dims >> 1) & 3] ?? "normal";
	const priceType = (dims & 1) === 0 ? "retail" : "buylist";
	return { provider, format, finish, priceType, currency: PROVIDER_CURRENCY[provider] ?? "USD" };
}

// Packs a partial dimension filter into a SQL predicate. Returns empty-string
// fragment and no params when no filter applies.
interface DimsFilter { provider?: string; format?: "paper" | "mtgo"; finish?: "normal" | "foil" | "etched"; priceType?: "retail" | "buylist"; }

function packDimsPartial(filter?: DimsFilter): { mask: number; value: number } | null {
	if (!filter) return null;
	let mask = 0;
	let value = 0;
	if (filter.provider !== undefined) {
		const id = Object.entries(PROVIDER_NAME).find(([, n]) => n === filter.provider)?.[0];
		if (id === undefined) return null; // unknown provider → no rows possible
		mask  |= 7 << 4;
		value |= (Number(id) & 7) << 4;
	}
	if (filter.format !== undefined) {
		mask  |= 1 << 3;
		value |= (filter.format === "mtgo" ? 1 : 0) << 3;
	}
	if (filter.finish !== undefined) {
		const id = filter.finish === "normal" ? 0 : filter.finish === "foil" ? 1 : 2;
		mask  |= 3 << 1;
		value |= (id & 3) << 1;
	}
	if (filter.priceType !== undefined) {
		mask  |= 1;
		value |= filter.priceType === "buylist" ? 1 : 0;
	}
	if (mask === 0) return null;
	return { mask, value };
}

// ── Shapes returned from query methods ────────────────────────────────────────

export interface CurrentPriceRow extends UnpackedDims { uuid: string; price: number; sinceDate: string; }
export interface HistoryPoint { date: string; price: number; }
export interface HistoryRow extends UnpackedDims { uuid: string; points: HistoryPoint[]; }
export interface PriceSummaryRow extends UnpackedDims { uuid: string; current: number; min: number; max: number; avg: number; first: string; last: string; dataPoints: number; }

// ── The class ────────────────────────────────────────────────────────────────

export class PriceQuery {
	private _conn: Connection;
	constructor(conn: Connection) { this._conn = conn; }

	/**
	 * Batch current-price read for card-list rendering. Hot path.
	 * Pass many UUIDs; returns one row per matching (uuid, dims) combo.
	 */
	async getCurrentPrices(uuids: string[], filter?: DimsFilter): Promise<CurrentPriceRow[]> {
		if (uuids.length === 0) return [];
		const parts = ["SELECT uuid::text AS uuid, dims, price, since_date FROM prices_current WHERE uuid = ANY($1::uuid[])"];
		const params: unknown[] = [uuids];
		const dimFilter = packDimsPartial(filter);
		if (dimFilter) {
			parts.push(`AND (dims & $${params.length + 1}::smallint) = $${params.length + 2}::smallint`);
			params.push(dimFilter.mask, dimFilter.value);
		}
		const rows = await this._conn.execute(parts.join(" "), params);
		return rows.map((r) => ({ uuid: r.uuid as string, price: Number(r.price), sinceDate: String(r.sinceDate), ...unpackDims(Number(r.dims)) }));
	}

	/** Convenience single-UUID variant of `getCurrentPrices`. */
	async getCurrentPrice(uuid: string, filter?: DimsFilter): Promise<CurrentPriceRow[]> {
		return this.getCurrentPrices([uuid], filter);
	}

	/**
	 * Full price history for one card. Routes to daily / weekly / monthly
	 * depending on the requested resolution.
	 *
	 *   resolution 'daily'   → prices_daily   (change-only rows, exact)
	 *   resolution 'weekly'  → prices_weekly  (plain MV, avg per week)
	 *   resolution 'monthly' → prices_monthly (plain MV, avg per month)
	 *
	 * Defaults to daily when omitted. Grouped by dims so the caller gets one
	 * series per (provider, format, finish, priceType).
	 */
	async getPriceHistory(uuid: string, options?: { resolution?: "daily" | "weekly" | "monthly"; dateFrom?: string; dateTo?: string; filter?: DimsFilter; }): Promise<HistoryRow[]> {
		const resolution = options?.resolution ?? "daily";
		const { table, dateCol, priceCol } = resolution === "weekly"
			? { table: "prices_weekly",  dateCol: "bucket",         priceCol: "avg_price" }
			: resolution === "monthly"
				? { table: "prices_monthly", dateCol: "bucket",         priceCol: "avg_price" }
				: { table: "prices_daily",   dateCol: "effective_date", priceCol: "price"     };

		const parts = [`SELECT dims, ${dateCol} AS bucket, ${priceCol} AS price FROM ${table} WHERE uuid = $1::uuid`];
		const params: unknown[] = [uuid];
		const dimFilter = packDimsPartial(options?.filter);
		if (dimFilter) {
			parts.push(`AND (dims & $${params.length + 1}::smallint) = $${params.length + 2}::smallint`);
			params.push(dimFilter.mask, dimFilter.value);
		}
		if (options?.dateFrom) { parts.push(`AND ${dateCol} >= $${params.length + 1}::date`); params.push(options.dateFrom); }
		if (options?.dateTo)   { parts.push(`AND ${dateCol} <= $${params.length + 1}::date`); params.push(options.dateTo);   }
		parts.push(`ORDER BY dims, ${dateCol} ASC`);

		const rows = await this._conn.execute(parts.join(" "), params);

		const grouped = new Map<number, HistoryPoint[]>();
		for (const r of rows) {
			const dims = Number(r.dims);
			const points = grouped.get(dims) ?? [];
			const dateValue = r.bucket;
			const date = dateValue instanceof Date ? dateValue.toISOString().slice(0, 10) : String(dateValue).slice(0, 10);
			points.push({ date, price: Number(r.price) });
			if (!grouped.has(dims)) grouped.set(dims, points);
		}
		return [...grouped.entries()].map(([dims, points]) => ({ uuid, points, ...unpackDims(dims) }));
	}

	/**
	 * Stats over a card's history: current price, min/max/avg, first/last dates,
	 * change-row count. Reads from prices_weekly for speed on larger windows,
	 * falls back to prices_daily when the window is <=90 days.
	 */
	async getPriceSummary(uuid: string, options?: { dateFrom?: string; dateTo?: string; filter?: DimsFilter; }): Promise<PriceSummaryRow[]> {
		const parts = [
			"SELECT p.dims,",
			"  MIN(p.price) AS min_price,",
			"  MAX(p.price) AS max_price,",
			"  ROUND(AVG(p.price), 4)::NUMERIC(10,4) AS avg_price,",
			"  MIN(p.effective_date) AS first_date,",
			"  MAX(p.effective_date) AS last_date,",
			"  COUNT(*)::INT AS data_points,",
			"  (SELECT c.price FROM prices_current c WHERE c.uuid = p.uuid AND c.dims = p.dims) AS current_price",
			"FROM prices_daily p",
			"WHERE p.uuid = $1::uuid",
		];
		const params: unknown[] = [uuid];
		const dimFilter = packDimsPartial(options?.filter);
		if (dimFilter) {
			parts.push(`AND (p.dims & $${params.length + 1}::smallint) = $${params.length + 2}::smallint`);
			params.push(dimFilter.mask, dimFilter.value);
		}
		if (options?.dateFrom) { parts.push(`AND p.effective_date >= $${params.length + 1}::date`); params.push(options.dateFrom); }
		if (options?.dateTo)   { parts.push(`AND p.effective_date <= $${params.length + 1}::date`); params.push(options.dateTo);   }
		parts.push("GROUP BY p.dims, p.uuid");

		const rows = await this._conn.execute(parts.join(" "), params);
		return rows.map((r) => ({
			uuid,
			current:    Number(r.currentPrice ?? r.current_price ?? 0),
			min:        Number(r.minPrice),
			max:        Number(r.maxPrice),
			avg:        Number(r.avgPrice),
			first:      String(r.firstDate).slice(0, 10),
			last:       String(r.lastDate).slice(0, 10),
			dataPoints: Number(r.dataPoints),
			...unpackDims(Number(r.dims)),
		}));
	}

	/**
	 * Reshape current prices for one card into the nested MTGJSON PriceFormats
	 * shape. Convenience for callers that already work in that format.
	 */
	async getPriceFormats(uuid: string): Promise<PriceFormats | null> {
		const rows = await this.getCurrentPrices([uuid]);
		if (rows.length === 0) return null;
		const out: PriceFormats = {};
		for (const r of rows) {
			const fmt = (out[r.format] ??= {} as never) as Record<string, { currency: string; buylist?: Record<string, Record<string, number>>; retail?: Record<string, Record<string, number>> }>;
			const prov = (fmt[r.provider] ??= { currency: r.currency });
			const bucket = (prov[r.priceType] ??= {}) as Record<string, Record<string, number>>;
			const finishMap = (bucket[r.finish] ??= {});
			finishMap[r.sinceDate] = r.price;
		}
		return out;
	}

	/**
	 * Find the cheapest current printing of a card by name. Joins cards
	 * against prices_current with optional dim filters.
	 */
	async cheapestPrinting(name: string, filter?: DimsFilter): Promise<{ uuid: string; setCode: string; number: string; price: number } | null> {
		const effective: DimsFilter = { provider: "tcgplayer", format: "paper", finish: "normal", priceType: "retail", ...filter };
		const dimFilter = packDimsPartial(effective);
		if (!dimFilter) return null;
		const sql = [
			"SELECT c.uuid::text AS uuid, c.set_code AS \"setCode\", c.number, p.price",
			"FROM cards c",
			"JOIN prices_current p ON p.uuid = c.uuid",
			"WHERE c.name = $1 AND (p.dims & $2::smallint) = $3::smallint",
			"ORDER BY p.price ASC LIMIT 1",
		].join(" ");
		const rows = await this._conn.execute(sql, [name, dimFilter.mask, dimFilter.value]);
		if (rows.length === 0) return null;
		const r = rows[0];
		return { uuid: String(r.uuid), setCode: String(r.setCode), number: String(r.number), price: Number(r.price) };
	}

	async cheapestPrintings(options?: DimsFilter & { limit?: number; offset?: number }): Promise<Array<{ name: string; uuid: string; setCode: string; number: string; price: number }>> {
		const effective: DimsFilter = { provider: "tcgplayer", format: "paper", finish: "normal", priceType: "retail", ...options };
		return this._rankedPrintings("ASC", effective, options?.limit ?? 100, options?.offset ?? 0);
	}

	async mostExpensivePrintings(options?: DimsFilter & { limit?: number; offset?: number }): Promise<Array<{ name: string; uuid: string; setCode: string; number: string; price: number }>> {
		const effective: DimsFilter = { provider: "tcgplayer", format: "paper", finish: "normal", priceType: "retail", ...options };
		return this._rankedPrintings("DESC", effective, options?.limit ?? 100, options?.offset ?? 0);
	}

	private async _rankedPrintings(order: "ASC" | "DESC", filter: DimsFilter, limit: number, offset: number): Promise<Array<{ name: string; uuid: string; setCode: string; number: string; price: number }>> {
		const dimFilter = packDimsPartial(filter);
		if (!dimFilter) return [];
		const nameCol = collated("c.name");
		const sql = [
			`SELECT DISTINCT ON (${nameCol})`,
			"  c.name, c.uuid::text AS uuid, c.set_code AS \"setCode\", c.number, p.price",
			"FROM cards c",
			"JOIN prices_current p ON p.uuid = c.uuid",
			"WHERE (p.dims & $1::smallint) = $2::smallint",
			`ORDER BY ${nameCol}, p.price ${order}`,
			"LIMIT $3 OFFSET $4",
		].join(" ");
		const rows = await this._conn.execute(sql, [dimFilter.mask, dimFilter.value, limit, offset]);
		return rows.map((r) => ({ name: String(r.name), uuid: String(r.uuid), setCode: String(r.setCode), number: String(r.number), price: Number(r.price) }));
	}
}
