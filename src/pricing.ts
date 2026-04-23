/**
 * Pricing ingestion for MTGJSON SDK.
 *
 * Writes to prices_daily using the change-only model: one row per price change,
 * not per day. Flat runs of identical prices collapse to one row.
 *
 * Two entry points:
 *   - updatePricingFull:  seeds from MTGJSON's AllPrices.json (90-day history).
 *     Emits all change rows discovered per (uuid, dims) combo.
 *   - updatePricingToday: daily delta from MTGJSON's AllPricesToday.json.
 *     Compares each combo's new price against prices_current; inserts only on change.
 *
 * Both are idempotent via `INSERT ... ON CONFLICT DO NOTHING` on
 * (uuid, dims, effective_date).
 */
import { createReadStream, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { chain } from "stream-chain";
import parser from "stream-json";
import Pick from "stream-json/filters/Pick.js";
import StreamObject from "stream-json/streamers/StreamObject.js";
import { CacheManager, type ProgressCallback } from "./cache.js";
import type { PriceFormats } from "./types/index.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UpdatePricingOptions { cacheDir?: string; offline?: boolean; timeout?: number; onProgress?: ProgressCallback; }
export interface UpdatePricingResult { uuidsProcessed: number; rowsInserted: number; rowsSkipped: number; }

// ── Dimension encoding (mirrors pack_dims_ints in pricing-schema.sql) ─────────

const PROVIDER_ID: Record<string, number> = { cardhoarder: 0, cardkingdom: 1, cardmarket:  2, cardsphere:  3, tcgplayer:   4 };
const FORMAT_BIT: Record<string, number> = { paper: 0, mtgo: 1 };
const FINISH_ID:  Record<string, number> = { normal: 0, foil: 1, etched: 2 };
const PRICE_TYPE_ID: Record<string, number> = { retail: 0, buylist: 1 };

function packDims(provider: string, format: string, finish: string, priceType: string): number | null {
	const p = PROVIDER_ID[provider];
	const f = FORMAT_BIT[format];
	const fn = FINISH_ID[finish];
	const pt = PRICE_TYPE_ID[priceType];
	if (p === undefined || f === undefined || fn === undefined || pt === undefined) return null;
	return ((p & 7) << 4) | ((f & 1) << 3) | ((fn & 3) << 1) | (pt & 1);
}

// ── Schema bootstrap ──────────────────────────────────────────────────────────

function defaultSchemaDir(): string {
	const here = typeof __dirname !== "undefined"
		? __dirname
		: dirname(fileURLToPath(import.meta.url));
	return join(here, "..", "scripts");
}

export async function ensurePricingSchema(connectionUrl: string, schemaDir?: string): Promise<void> {
	const dir = schemaDir ?? defaultSchemaDir();
	const sql = readFileSync(join(dir, "pricing-schema.sql"), "utf-8");
	const db = postgres(connectionUrl);
	try {	await db.unsafe(sql);	}
  finally {	await db.end(); }
}

// ── Change-row enumeration from a MTGJSON PriceFormats blob ───────────────────

interface ChangeRow { uuid: string; dims: number; effective_date: string; price: number; }

/**
 * Walk a single card's PriceFormats blob and emit change rows. For each
 * (provider, format, finish, priceType) combo, dates are sorted ascending and
 * only the first row plus each subsequent price-change row is kept.
 *
 * Used by updatePricingFull; not needed for today-only ingest.
 */
function *enumerateChangeRows(uuid: string, formats: PriceFormats): Generator<ChangeRow> {
	for (const [format, providers] of Object.entries(formats)) {
		if (!providers) continue;
		for (const [provider, list] of Object.entries(providers as Record<string, unknown>)) {
			if (!list || typeof list !== "object") continue;
			const priceList = list as { buylist?: Record<string, Record<string, number>>; retail?: Record<string, Record<string, number>> };
			for (const priceType of ["retail", "buylist"] as const) {
				const finishes = priceList[priceType];
				if (!finishes) continue;
				for (const [finish, dateMap] of Object.entries(finishes)) {
					if (!dateMap) continue;
					const dims = packDims(provider, format, finish, priceType);
					if (dims === null) continue; // unsupported dim combo (e.g. manapool, or unknown finish)
					const dates = Object.keys(dateMap).sort();
					let prev: number | null = null;
					for (const date of dates) {
						const price = dateMap[date];
						if (typeof price !== "number") continue;
						if (prev === null || price !== prev) { yield { uuid, dims, effective_date: date, price }; }
						prev = price;
					}
				}
			}
		}
	}
}

/**
 * Walk a single card's PriceFormats blob looking for today's prices only.
 * Returns the flat rows; caller compares to prices_current before inserting.
 */
function *enumerateTodayRows(uuid: string, formats: PriceFormats, today: string): Generator<ChangeRow> {
	for (const [format, providers] of Object.entries(formats)) {
		if (!providers) continue;
		for (const [provider, list] of Object.entries(providers as Record<string, unknown>)) {
			if (!list || typeof list !== "object") continue;
			const priceList = list as { buylist?: Record<string, Record<string, number>>; retail?: Record<string, Record<string, number>> };
			for (const priceType of ["retail", "buylist"] as const) {
				const finishes = priceList[priceType];
				if (!finishes) continue;
				for (const [finish, dateMap] of Object.entries(finishes)) {
					if (!dateMap) continue;
					const dims = packDims(provider, format, finish, priceType);
					if (dims === null) continue;
					const price = dateMap[today];
					if (typeof price !== "number") continue;
					yield { uuid, dims, effective_date: today, price };
				}
			}
		}
	}
}

// ── Batch insert with PK conflict ignore ──────────────────────────────────────

const BATCH_SIZE = 2000;

// biome-ignore lint/suspicious/noExplicitAny: postgres.js needs any for the dynamic column shape
async function insertBatch(db: any, rows: ChangeRow[]): Promise<number> {
	if (rows.length === 0) return 0;
	const result = await db`INSERT INTO prices_daily ${db(rows, "uuid", "dims", "effective_date", "price")} ON CONFLICT DO NOTHING`;
	return result.count ?? rows.length;
}

// ── Public entry points ───────────────────────────────────────────────────────

/**
 * Seed/refresh pricing from MTGJSON's AllPrices.json (90-day history).
 *
 * Streams the file so peak memory stays bounded regardless of file size.
 * Writes change-only rows to prices_daily; the trigger keeps prices_current in sync.
 * Re-runnable: PK conflicts are ignored.
 */
export async function updatePricingFull( connectionUrl: string,	options?: UpdatePricingOptions ): Promise<UpdatePricingResult> {
	await ensurePricingSchema(connectionUrl);

	const cache = new CacheManager({ cacheDir: options?.cacheDir,	offline: options?.offline, timeout: options?.timeout,	onProgress: options?.onProgress });
	await cache.init();
	const jsonPath = await cache.ensureJson("all_prices");

	const db = postgres(connectionUrl);
	let uuidsProcessed = 0;
	let rowsInserted = 0;
	let rowsSkipped = 0;

	try {
		const pipeline = chain([ createReadStream(jsonPath),	parser(), new Pick({ filter: "data" }), new StreamObject() ]);

		let buffer: ChangeRow[] = [];
		for await (const entry of pipeline as AsyncIterable<{ key: string; value: PriceFormats }>) {
			uuidsProcessed++;
			for (const row of enumerateChangeRows(entry.key, entry.value)) {
				buffer.push(row);
				if (buffer.length >= BATCH_SIZE) {
					const inserted = await insertBatch(db, buffer);
					rowsInserted += inserted;
					rowsSkipped += buffer.length - inserted;
					buffer = [];
				}
			}
		}
		if (buffer.length > 0) {
			const inserted = await insertBatch(db, buffer);
			rowsInserted += inserted;
			rowsSkipped += buffer.length - inserted;
		}
	} finally {	await db.end(); }

	return { uuidsProcessed, rowsInserted, rowsSkipped };
}

/**
 * Daily delta ingest from MTGJSON's AllPricesToday.json.
 *
 * Reads the current-price cache into memory (one row per uuid×dims, ~500k max)
 * and inserts into prices_daily only for combos whose price changed (or is new).
 * Flat-day combos are skipped entirely — no wasted writes.
 */
export async function updatePricingToday(	connectionUrl: string, options?: UpdatePricingOptions,
): Promise<UpdatePricingResult> { await ensurePricingSchema(connectionUrl);

	const cache = new CacheManager({ cacheDir: options?.cacheDir, offline: options?.offline, timeout: options?.timeout, onProgress: options?.onProgress });
	await cache.init();
	cache.invalidateMemoryCache();
	const jsonPath = await cache.ensureJson("all_prices_today");

	// The "today" date is whatever MTGJSON has published — read it from the meta block.
	// We stream-parse the meta first, then the data block, to avoid loading the whole file.
	const todayDate = await readMetaDate(jsonPath);

	const db = postgres(connectionUrl);
	let uuidsProcessed = 0;
	let rowsInserted = 0;
	let rowsSkipped = 0;

	try {
		// Load current prices into memory so we can diff in Node without round-tripping per row.
		// Key: `${uuid}:${dims}` → price. Size: ~500k × (36+2+8 bytes) ≈ 25 MB.
		const currentMap = new Map<string, number>();
		const currentRows = await db`SELECT uuid::text AS uuid, dims, price FROM prices_current` as Array<{ uuid: string; dims: number; price: string }>;
		for (const r of currentRows) { currentMap.set(`${r.uuid}:${r.dims}`, Number(r.price)); }

		const pipeline = chain([ createReadStream(jsonPath), parser(), new Pick({ filter: "data" }), new StreamObject() ]);

		let buffer: ChangeRow[] = [];
		for await (const entry of pipeline as AsyncIterable<{ key: string; value: PriceFormats }>) {
			uuidsProcessed++;
			for (const row of enumerateTodayRows(entry.key, entry.value, todayDate)) {
				const key = `${row.uuid}:${row.dims}`;
				const previous = currentMap.get(key);
				if (previous === row.price) {
					rowsSkipped++;
					continue;
				}
				buffer.push(row);
				if (buffer.length >= BATCH_SIZE) {
					const inserted = await insertBatch(db, buffer);
					rowsInserted += inserted;
					rowsSkipped += buffer.length - inserted;
					buffer = [];
				}
			}
		}
		if (buffer.length > 0) {
			const inserted = await insertBatch(db, buffer);
			rowsInserted += inserted;
			rowsSkipped += buffer.length - inserted;
		}
	} finally {
		await db.end();
	}

	return { uuidsProcessed, rowsInserted, rowsSkipped };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function readMetaDate(jsonPath: string): Promise<string> {
	const pipeline = chain([ createReadStream(jsonPath), parser(), new Pick({ filter: "meta" }),	new StreamObject() ]);
	for await (const entry of pipeline as AsyncIterable<{ key: string; value: unknown }>) {
  	if (entry.key === "date" && typeof entry.value === "string") return entry.value;
	}
	throw new Error("AllPricesToday.json is missing meta.date");
}
