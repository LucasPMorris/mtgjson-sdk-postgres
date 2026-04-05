/**
 * Incremental update logic: compares SetList.json against the database and
 * downloads/seeds only new sets. Designed to be run daily via cron, or manually
 * via sdk.checkForUpdates() / sdk.update().
 */
import { get as httpsGet } from "node:https";
import postgres from "postgres";
import { CDN_BASE } from "./config.js";
import { seedCatalogs, seedSingleSet } from "./seeder.js";
import type { Set as MTGSet } from "./types/index.js";

/** Minimal shape of a SetList.json entry — only what we need for comparison. */
export interface SetListEntry { code: string; name: string; releaseDate: string | null; type: string; tokenSetCode?: string; totalSetSize: number; }

/** Per-set status combining MTGJSON and database state. */
export interface SetUpdateStatus { code: string; tokenSetCode?: string; existsInSets: boolean; hasCards: boolean; existsInTokens: boolean;
                                   publishedTokenCount?: number;	databaseTokenCount?: number; needsUpdate: boolean;	reason: string; }

export interface UpdateCheckSummary { missingFromSetsTable: number; missingCards: number;	missingTokenData: number; TokenCountMismatch: number;	upToDate: number; }

export interface UpdateCheckResult { newSets: SetListEntry[]; staleSets: SetListEntry[]; mtgjsonVersion: string; mtgjsonDate: string; setStatuses: SetUpdateStatus[];	summary: UpdateCheckSummary; }
export interface UpdateProgress { setCode: string; setName: string; done: number; total: number; cards: number; tokens: number; }
export interface UpdateResult { addedSets: string[]; updatedSets: string[]; totalCards: number; totalTokens: number; } /** Sets that already existed but had new cards seeded into them (preview/spoiler growth). */

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
export async function checkForSetUpdates(connectionUrl: string, options?: { timeout?: number }): Promise<UpdateCheckResult> {
	const timeout = options?.timeout ?? 30_000;

	const setList = await fetchJson<{ meta: { version: string; date: string }; data: SetListEntry[]; }>(`${CDN_BASE}/SetList.json`, timeout);

	// Query all relevant database state in one connection
	const db = postgres(connectionUrl, { max: 1 });
	let dbSetCodes: Set<string>;
	let dbCardCodes: Set<string>;
	let dbTokenCountMap: Map<string, number>;
	let futureSetSizes: Map<string, number>;
	try {
		const [setRows, cardRows, tokenRows, futureRows] = await Promise.all([
			db`SELECT code FROM sets`,
			db`SELECT DISTINCT set_code FROM cards`,
			db`SELECT set_code, COUNT(*) AS count FROM tokens GROUP BY set_code`,
			db`SELECT code, total_set_size FROM sets WHERE CAST(release_date AS DATE) > CURRENT_DATE`,
		]);
		dbSetCodes      = new Set(setRows.map((r) => r.code as string));
		dbCardCodes     = new Set(cardRows.map((r) => r.set_code as string));
		dbTokenCountMap = new Map(tokenRows.map((r) => [r.set_code as string, Number(r.count)]));
		futureSetSizes  = new Map(futureRows.map((r) => [r.code as string, r.total_set_size as number]));
	} finally { await db.end(); }

	// Fetch published token counts for all unique token set codes (deduplicated, in parallel)
	const tokenSetSizeMap = new Map<string, number>();
	const uniqueTokenSetCodes = [...new Set(
		setList.data.map((s) => s.tokenSetCode).filter((c): c is string => !!c)
	)];
	await Promise.all(uniqueTokenSetCodes.map(async (tokenSetCode) => {
		try {
			const tokenSet = await fetchJson<{ meta: Record<string, string>; data: MTGSet }>(`${CDN_BASE}/${tokenSetCode}.json`, timeout);
			tokenSetSizeMap.set(tokenSetCode, Array.isArray(tokenSet.data.tokens) ? tokenSet.data.tokens.length : 0);
		} catch { /* skip if token set file is unavailable */ }
	}));

	const newSets: SetListEntry[]        = [];
	const staleSets: SetListEntry[]      = [];
	const setStatuses: SetUpdateStatus[] = [];

	for (const s of setList.data) {
		const existsInSets = dbSetCodes.has(s.code);
		const hasCards     = dbCardCodes.has(s.code);

		let existsInTokens      = false;
		let publishedTokenCount: number | undefined;
		let databaseTokenCount: number | undefined;

		if (s.tokenSetCode) {
			// Tokens are stored in the DB under the token set code (e.g. 'TTMT'), per set.tokenSetCode
			existsInTokens      = dbTokenCountMap.has(s.tokenSetCode);
			publishedTokenCount = tokenSetSizeMap.get(s.tokenSetCode);
			databaseTokenCount  = dbTokenCountMap.get(s.tokenSetCode) ?? 0;
		}

		const tokenCountStale =
			s.tokenSetCode != null &&
			publishedTokenCount !== undefined &&
			databaseTokenCount !== undefined &&
			publishedTokenCount > databaseTokenCount;

		const needsUpdate = !existsInSets || (s.tokenSetCode != null && (!existsInTokens || tokenCountStale))
			|| (futureSetSizes.has(s.code) && s.totalSetSize > (futureSetSizes.get(s.code) ?? 0));

		let reason = 'up-to-date';
		if (!existsInSets) { reason = 'missing from sets table'; }
    else if (s.tokenSetCode && !existsInTokens) {	reason = `token set ${s.tokenSetCode} has no rows in tokens table`; }
    else if (tokenCountStale) {	reason = `token set ${s.tokenSetCode} has ${databaseTokenCount} tokens in DB but ${publishedTokenCount} published`; }
    else if (futureSetSizes.has(s.code) && s.totalSetSize > (futureSetSizes.get(s.code) ?? 0)) { reason = `preview set grew: DB has totalSetSize=${futureSetSizes.get(s.code)}, MTGJSON has ${s.totalSetSize}`; }

		setStatuses.push({ code: s.code, tokenSetCode: s.tokenSetCode, existsInSets, hasCards, existsInTokens, publishedTokenCount, databaseTokenCount, needsUpdate, reason });

		// Main set is missing from the sets table — truly new, needs full seed
		if (!existsInSets) {
			newSets.push(s);
			continue;
		}

		// Set exists but tokens are missing or stale — needs re-seed
		if (s.tokenSetCode && !existsInTokens) {
			if (!staleSets.find((ss) => ss.code === s.code)) staleSets.push(s);
			continue;
		}

		// Future set whose totalSetSize has grown (spoiler/preview cards added)
		if (futureSetSizes.has(s.code) && s.totalSetSize > (futureSetSizes.get(s.code) ?? 0)) { if (!staleSets.find((ss) => ss.code === s.code)) staleSets.push(s); }

		// Token set is behind published count
		if (tokenCountStale) { if (!staleSets.find((ss) => ss.code === s.code)) staleSets.push(s); }
	}

	const summary: UpdateCheckSummary = {
		missingFromSetsTable: setStatuses.filter((s) => !s.existsInSets).length,
		missingCards:         setStatuses.filter((s) => s.existsInSets && !s.hasCards).length,
		missingTokenData:     setStatuses.filter((s) => s.tokenSetCode && !s.existsInTokens).length,
		TokenCountMismatch:   setStatuses.filter((s) => s.tokenSetCode && s.existsInTokens &&
			s.publishedTokenCount !== undefined && s.databaseTokenCount !== undefined &&
			s.publishedTokenCount > s.databaseTokenCount).length,
		upToDate:             setStatuses.filter((s) => !s.needsUpdate).length,
	};

	return { newSets, staleSets, mtgjsonVersion: setList.meta.version, mtgjsonDate: setList.meta.date, setStatuses, summary };
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

	// Refresh catalogs (keywords, card types, enum values)
	const db = (await import("postgres")).default(connectionUrl);
	try { await seedCatalogs(db, { timeout }); }
	finally { await db.end(); }

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

		// If set has tokenSetCode, fetch and seed the token set
		if (response.data.tokenSetCode) {
			try {
				const tokenSetResp = await fetchJson<{ meta: Record<string, string>; data: MTGSet }>(`${CDN_BASE}/${response.data.tokenSetCode}.json`, timeout);
				const tokenSetName = tokenSetResp.data.name ?? response.data.tokenSetCode;
				for (const token of tokenSetResp.data.tokens) { token.setName = token.setName ?? tokenSetName; }
				const tokenResult = await seedSingleSet(connectionUrl, tokenSetResp.data);
				totalTokens += tokenResult.tokens;
				if (entry.isUpdate) { updatedSets.push(response.data.tokenSetCode); }
				else { addedSets.push(response.data.tokenSetCode); }
			} catch (err) {
				console.warn(`Failed to fetch or seed token set ${response.data.tokenSetCode}:`, err);
			}
		}

		if (entry.isUpdate) { updatedSets.push(entry.code); }
		else                 { addedSets.push(entry.code);   }
		totalCards  += cards;

		onProgress?.({ setCode: entry.code, setName, done: i + 1, total: allEntries.length, cards, tokens });
	}

	return { addedSets, updatedSets, totalCards, totalTokens };
}
