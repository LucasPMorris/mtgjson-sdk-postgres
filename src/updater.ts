/**
 * Incremental update logic: compares SetList.json against the database and
 * downloads/seeds only new sets. Designed to be run daily via cron, or manually
 * via sdk.checkForUpdates() / sdk.update().
 */
import { get as httpsGet } from "node:https";
import postgres from "postgres";
import { CDN_BASE } from "./config.js";
import { seedSingleSet } from "./seeder.js";
import type { Set as MTGSet } from "./types/index.js";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Minimal shape of a SetList.json entry — only what we need for comparison. */
export interface SetListEntry {	code: string; name: string; releaseDate: string | null; type: string;	totalSetSize: number; }

/** Sets present in MTGJSON but absent from the database. */
	/**
	 * Sets already in the database whose release date is in the future and whose
	 * totalSetSize in MTGJSON has grown since we last seeded them. These need a
	 * re-seed to pick up spoiler/preview cards added since the last update.
	 */
export interface UpdateCheckResult { newSets: SetListEntry[]; staleSets: SetListEntry[]; mtgjsonVersion: string; mtgjsonDate: string; }
export interface UpdateProgress {	setCode: string; setName: string; done: number; total: number; cards: number; tokens: number; }

	/** Sets that already existed but had new cards seeded into them (preview/spoiler growth). */
export interface UpdateResult {	addedSets: string[]; updatedSets: string[]; totalCards: number; totalTokens: number; }

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function fetchJson<T>(url: string, timeout = 60_000): Promise<T> {
	return new Promise((resolve, reject) => {
		const req = httpsGet(url, { timeout }, (res) => {
			// Follow one redirect level
			if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
				fetchJson<T>(res.headers.location, timeout).then(resolve, reject);
				return;
			}
			if (res.statusCode && res.statusCode >= 400) {
				reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
				res.resume();
				return;
			}
			const chunks: Buffer[] = [];
			res.on("data", (chunk: Buffer) => chunks.push(chunk));
			res.on("end", () => {
				try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8")) as T); }
				catch (e) { reject(new Error(`JSON parse error for ${url}: ${e}`)); }
			});
			res.on("error", reject);
		});
		req.on("error", reject);
		req.on("timeout", () => { req.destroy(); reject(new Error(`Timeout fetching ${url}`)); });
	});
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch MTGJSON's SetList.json and compare it against the database.
 * Returns set codes that exist in MTGJSON but not yet in the database.
 * Makes a single CDN request (SetList.json is ~50 KB).
 */
export async function checkForSetUpdates(	connectionUrl: string, options?: { timeout?: number } ): Promise<UpdateCheckResult> {
	const timeout = options?.timeout ?? 30_000;

	const setList = await fetchJson<{	meta: { version: string; date: string }; data: SetListEntry[]; }>(`${CDN_BASE}/SetList.json`, timeout);

	const db = postgres(connectionUrl, { max: 1 });
	let dbCodes: Set<string>;
	let futureSetSizes: Map<string, number>; // code → total_set_size for unreleased sets
	try {
		const rows = await db`SELECT code FROM sets`;
		dbCodes = new Set(rows.map((r) => r.code as string));

		// Sets already in the DB whose release date is still in the future.
		// MTGJSON adds spoiler cards to these sets before official release.
		const futureRows = await db`
			SELECT code, total_set_size
			FROM sets
			WHERE release_date > CURRENT_DATE
		`;
		futureSetSizes = new Map(futureRows.map((r) => [r.code as string, r.total_set_size as number]));
	} finally { await db.end(); }

	const newSets   = setList.data.filter((s) => !dbCodes.has(s.code));
	const staleSets = setList.data.filter((s) =>
		futureSetSizes.has(s.code) && s.totalSetSize > (futureSetSizes.get(s.code) ?? 0)
	);

	return { newSets, staleSets, mtgjsonVersion: setList.meta.version, mtgjsonDate: setList.meta.date };
}

/**
 * Download and seed any sets that are present in MTGJSON but absent from the database.
 *
 * Each new set is fetched from `https://mtgjson.com/api/v5/{CODE}.json` and
 * inserted incrementally — no full AllPrintings.json download required.
 *
 * @param options.sets   Explicit list of codes to add; skips the SetList check.
 * @param options.force  Re-seed sets that already exist (useful for corrections).
 */
export async function applySetUpdates(
	connectionUrl: string, options?: { sets?: string[]; force?: boolean; timeout?: number; onProgress?: (progress: UpdateProgress) => void; } ): Promise<UpdateResult> {
	const timeout    = options?.timeout    ?? 120_000;
	const onProgress = options?.onProgress;

	// Determine which sets to add or re-seed
	let toAdd: SetListEntry[];
	let toReseed: SetListEntry[] = [];
	if (options?.sets) { toAdd = options.sets.map((code) => ({ code, name: code, releaseDate: null, type: "unknown", totalSetSize: 0 })); }
  else {
		const check = await checkForSetUpdates(connectionUrl, { timeout });
		toAdd    = check.newSets;
		toReseed = check.staleSets;
	}

	if (toAdd.length === 0 && toReseed.length === 0) return { addedSets: [], updatedSets: [], totalCards: 0, totalTokens: 0 };

	const addedSets:   string[] = [];
	const updatedSets: string[] = [];
	let totalCards  = 0;
	let totalTokens = 0;

	const allEntries = [ ...toAdd.map((e) => ({ ...e, isUpdate: false })), ...toReseed.map((e) => ({ ...e, isUpdate: true })) ];

	for (let i = 0; i < allEntries.length; i++) {
		const entry = allEntries[i];

		// Fetch individual set file from CDN
		const response = await fetchJson<{ meta: Record<string, string>; data: MTGSet }>(`${CDN_BASE}/${entry.code}.json`, timeout );
		const setName = response.data.name ?? entry.name;
		for (const card of response.data.cards) { card.setName = card.setName ?? setName; }
		for (const token of response.data.tokens) { token.setName = token.setName ?? setName; }

		const { cards, tokens } = await seedSingleSet(connectionUrl, response.data);

		if (entry.isUpdate) { updatedSets.push(entry.code); }
		else                 { addedSets.push(entry.code);   }
		totalCards  += cards;
		totalTokens += tokens;

		onProgress?.({ setCode: entry.code, setName, done: i + 1, total: allEntries.length, cards, tokens });
	}

	return { addedSets, updatedSets, totalCards, totalTokens };
}
