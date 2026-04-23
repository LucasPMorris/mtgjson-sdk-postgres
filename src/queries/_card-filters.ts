import type { SQLBuilder } from "../sql-builder.js";
import { collated } from "./_sort-helpers.js";

export const KNOWN_FORMATS = new Set([ "alchemy",   "brawl",   "commander",       "duel",  "explorer",  "future",  "gladiator",  "historic",  "historicbrawl",  "legacy",   "modern", 	"oathbreaker",
                                "oldschool", "pauper",  "paupercommander", "penny",	"pioneer",   "predh",   "premodern",  "standard",  "standardbrawl",	 "timeless", "vintage" ]);

type KeywordOperator = "All" | "Any" | "Exact";

export type SortField = "name" | "manaValue" | "power" | "toughness" | "number" | "set";
export type SortDirection = "ASC" | "DESC";
export type SortOption = SortField | `${SortField}:${SortDirection}`;

export const SORT_FIELD_MAP: Record<SortField, { column: string; numeric?: boolean; text?: boolean }> = {
	name:      { column: "name",     text: true },
	manaValue: { column: "mana_value" },
	power:     { column: "power",    numeric: true },
	toughness: { column: "toughness", numeric: true },
	number:    { column: "number",   text: true },
	set:       { column: "set_code", text: true },
};

export type SearchOptions = {
	artist?: string[];
	availability?: string;
	colors?: string[];
	colorIdentity?: string[];
	isPromo?: boolean | 'only';
	isOversized?: boolean | 'only';
	isOnlineOnly?: boolean | 'only';
	isToken?: boolean | 'only';
	isArtSeries?: boolean | 'only';
	isTimeshifted?: boolean | 'only';
  keywordAbilities?: string[];
	keywordActions?: string[];
	keywordOperator?: KeywordOperator;
	language?: string;
	layout?: string;
  legalIn?: string | string[];
	limit?: number;
	localizedName?: string;
  manaValue?: number;
	manaValueLte?: number;
	manaValueGte?: number;
	manaValueLt?: number;
	manaValueGt?: number;
 	name?: string;
	offset?: number;
	originalPrintsOnly?: boolean;
  power?: string;
	powerGte?: number;
	powerLte?: number;
	powerGt?: number;
	powerLt?: number;
  rarity?: string | string[];
	rollupVariations?: boolean;
  setCode?: string | string[];
	setType?: string;
	sort?: SortOption | SortOption[];
  subtype?: string | string[];
	supertype?: string | string[];
	text?: string;
	textRegex?: string;
 	toughness?: string;
	toughnessGte?: number;
	toughnessLte?: number;
	toughnessGt?: number;
	toughnessLt?: number;
 	types?: string | string[];
};

function applyKeywordFilter(q: SQLBuilder, keywords: string[], op: KeywordOperator): void {
	if (keywords.length === 0) return;
	if (op === "Any") {
		const parts = keywords.map(kw => {
			const idx = q._params.length + 1;
			q._params.push(kw);
			return `$${idx} = ANY(keywords)`;
		});
		q._where.push(`(${parts.join(" OR ")})`);
	} else if (op === "All") {
		for (const kw of keywords) {
			const idx = q._params.length + 1;
			q._params.push(kw);
			q._where.push(`$${idx} = ANY(keywords)`);
		}
	} else {
		// Exact: keywords array must contain exactly the specified values
		const idx = q._params.length + 1;
		q._params.push(keywords);
		q._where.push(`keywords @> $${idx}::text[] AND keywords <@ $${idx}::text[]`);
	}
}

/** Applies all card search filter conditions to the given SQLBuilder.
 *  @param table  Base table/view name used for qualified column references (default: "v_cards").
 */
export function applyCardFilters(q: SQLBuilder, opts: SearchOptions, table = "v_cards"): void {
	if (opts.name) {
		if (opts.name.includes("%")) {q.whereLike("name", opts.name); }
      else { q.whereEq("name", opts.name); }
	}

	if (opts.setCode) Array.isArray(opts.setCode) ? q.whereIn("set_code", opts.setCode) : q.whereEq("set_code", opts.setCode);
	if (opts.rarity) Array.isArray(opts.rarity) ? q.whereIn("rarity", opts.rarity) : q.whereEq("rarity", opts.rarity);
	if (opts.manaValue !== undefined) q.whereEq("mana_value", opts.manaValue);
	if (opts.manaValueLte !== undefined) q.whereLte("mana_value", opts.manaValueLte);
	if (opts.manaValueGte !== undefined) q.whereGte("mana_value", opts.manaValueGte);
	if (opts.manaValueLt  !== undefined) q.where("mana_value < $1", opts.manaValueLt);
	if (opts.manaValueGt  !== undefined) q.where("mana_value > $1", opts.manaValueGt);
	if (opts.text) q.whereLike("text", `%${opts.text}%`);
	if (opts.textRegex) q.whereRegex("text", opts.textRegex);
	if (opts.types) {
		const types = Array.isArray(opts.types) ? opts.types : [opts.types];
		const parts = types.map(t => { const idx = q._params.length + 1; q._params.push(`%${t}%`); return `type ILIKE $${idx}`; });
		if (parts.length === 1) q._where.push(parts[0]);
		else q._where.push(`(${parts.join(" OR ")})`);
	}
	if (opts.subtype) {
		const subtypes = Array.isArray(opts.subtype) ? opts.subtype : [opts.subtype];
		const parts = subtypes.map(s => { const idx = q._params.length + 1; q._params.push(s); return `$${idx} = ANY(subtypes)`; });
		if (parts.length === 1) q._where.push(parts[0]);
		else q._where.push(`(${parts.join(" OR ")})`);
	}
	if (opts.supertype) {
		const supertypes = Array.isArray(opts.supertype) ? opts.supertype : [opts.supertype];
		const parts = supertypes.map(s => { const idx = q._params.length + 1; q._params.push(s); return `$${idx} = ANY(supertypes)`; });
		if (parts.length === 1) q._where.push(parts[0]);
		else q._where.push(`(${parts.join(" OR ")})`);
	}
	if (opts.power) q.whereEq("power", opts.power);
	if (opts.powerGte !== undefined) q.where(`power ~ '^-?[0-9]+(\\.[0-9]+)?$' AND power::NUMERIC >= $1`, opts.powerGte);
	if (opts.powerLte !== undefined) q.where(`power ~ '^-?[0-9]+(\\.[0-9]+)?$' AND power::NUMERIC <= $1`, opts.powerLte);
	if (opts.powerGt  !== undefined) q.where(`power ~ '^-?[0-9]+(\\.[0-9]+)?$' AND power::NUMERIC > $1`,  opts.powerGt);
	if (opts.powerLt  !== undefined) q.where(`power ~ '^-?[0-9]+(\\.[0-9]+)?$' AND power::NUMERIC < $1`,  opts.powerLt);
	if (opts.toughness) q.whereEq("toughness", opts.toughness);
	if (opts.toughnessGte !== undefined) q.where(`toughness ~ '^-?[0-9]+(\\.[0-9]+)?$' AND toughness::NUMERIC >= $1`, opts.toughnessGte);
	if (opts.toughnessLte !== undefined) q.where(`toughness ~ '^-?[0-9]+(\\.[0-9]+)?$' AND toughness::NUMERIC <= $1`, opts.toughnessLte);
	if (opts.toughnessGt  !== undefined) q.where(`toughness ~ '^-?[0-9]+(\\.[0-9]+)?$' AND toughness::NUMERIC > $1`,  opts.toughnessGt);
	if (opts.toughnessLt  !== undefined) q.where(`toughness ~ '^-?[0-9]+(\\.[0-9]+)?$' AND toughness::NUMERIC < $1`,  opts.toughnessLt);
	if (opts.artist?.length) q.whereIn("artist", opts.artist);
	if (opts.language) q.whereEq("language", opts.language);
	if (opts.layout) q.whereEq("layout", opts.layout);
	// Boolean include filters:
	//   undefined / false → exclude (default)
	//   true              → lift the exclusion (include alongside other results)
	//   'only'            → positive inclusion (WHERE field = true); multiple 'only' values are OR'd
	const onlyConditions: string[] = [];

	if (opts.isPromo === 'only')      onlyConditions.push("is_promo = true");
	else if (opts.isPromo !== true)    q._where.push("(is_promo IS NULL OR is_promo = FALSE)");

	if (opts.isOversized === 'only')      onlyConditions.push("is_oversized = true");
	else if (opts.isOversized !== true)    q._where.push("(is_oversized IS NULL OR is_oversized = FALSE)");

	if (opts.isOnlineOnly === 'only')      onlyConditions.push("is_online_only = true");
	else if (opts.isOnlineOnly !== true)    q._where.push("(is_online_only IS NULL OR is_online_only = FALSE)");

	if (opts.isTimeshifted === 'only')      onlyConditions.push("is_timeshifted = true");
	else if (opts.isTimeshifted !== true)    q._where.push("(is_timeshifted IS NULL OR is_timeshifted = FALSE)");

	// Layout-based include filters — excluded by default; only applied when layout is not explicitly set
	if (!opts.layout) {
		if (opts.isToken === 'only')        onlyConditions.push("layout = 'token'");
		if (opts.isArtSeries === 'only')    onlyConditions.push("layout = 'art_series'");

		const layoutExcludes: string[] = [];
		if (opts.isToken !== true && opts.isToken !== 'only')          layoutExcludes.push("token");
		if (opts.isArtSeries !== true && opts.isArtSeries !== 'only')  layoutExcludes.push("art_series");
		if (layoutExcludes.length > 0) {
			const placeholders = layoutExcludes.map((_, i) => `$${q._params.length + i + 1}`).join(", ");
			q._where.push(`layout NOT IN (${placeholders})`);
			q._params.push(...layoutExcludes);
		}
	}

	if (onlyConditions.length > 0) { q._where.push(`(${onlyConditions.join(" OR ")})`);	}

	for (const color of opts.colors ?? []) {
		const idx = q._params.length + 1;
		q._where.push(`$${idx} = ANY(colors)`);
		q._params.push(color);
	}
	for (const color of opts.colorIdentity ?? []) {
		const idx = q._params.length + 1;
		q._where.push(`$${idx} = ANY(color_identity)`);
		q._params.push(color);
	}

	// Keyword filters with operator support
	const op: KeywordOperator = opts.keywordOperator ?? "Any";
	applyKeywordFilter(q, opts.keywordAbilities ?? [], op);
	applyKeywordFilter(q, opts.keywordActions ?? [], op);

	if (opts.availability) {
		const idx = q._params.length + 1;
		q._where.push(`$${idx} = ANY(availability)`);
		q._params.push(opts.availability);
	}

	if (opts.localizedName) {
		q.select(`${table}.*`);
		q.join(`JOIN card_foreign_data cfd ON ${table}.uuid = cfd.uuid`);
		if (opts.localizedName.includes("%")) {	q.whereLike("cfd.name", opts.localizedName); }
		else { q.whereEq("cfd.name", opts.localizedName); }
	}

	if (opts.legalIn) {
		const formats = (Array.isArray(opts.legalIn) ? opts.legalIn : [opts.legalIn]).map(f => f.toLowerCase()).filter(f => KNOWN_FORMATS.has(f));
		if (formats.length === 1) { q._where.push(`legalities->>'${formats[0]}' = 'Legal'`); }
		else if (formats.length > 1) { q._where.push(`(${formats.map(f => `legalities->>'${f}' = 'Legal'`).join(" OR ")})`); }
	}

	if (opts.setType) {
		q.select(`${table}.*`);
		q.join(`JOIN sets s ON ${table}.set_code = s.code`);
		q.whereEq("s.type", opts.setType);
	}

	if (opts.originalPrintsOnly) { q._where.push(`${table}.first_print = TRUE`); }
	if (opts.rollupVariations)   { q._where.push(`${table}.is_rollup_canonical = TRUE`); }
}

/** Parse sort options and apply ORDER BY clauses to the query builder. */
export function applyCardSort(q: SQLBuilder, sort: SortOption | SortOption[] | undefined, table: string): void {
	if (!sort) { q.orderBy(`${collated(`${table}.name`)} ASC`, `${collated(`${table}.number`)} ASC`); return;	}

	const sorts = Array.isArray(sort) ? sort : [sort];
	for (const s of sorts) {
		const [field, dir = "ASC"] = s.split(":") as [SortField, SortDirection?];
		const mapping = SORT_FIELD_MAP[field];
		if (!mapping) continue;
		const col = `${table}.${mapping.column}`;
		const direction = dir === "DESC" ? "DESC" : "ASC";
		if (mapping.numeric) {
			const nulls = direction === "ASC" ? "LAST" : "FIRST"; // Cast to numeric for proper ordering, push NULLs/non-numeric to the end
			q.orderBy(`(CASE WHEN ${col} ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN ${col}::NUMERIC END) ${direction} NULLS ${nulls}`);
		} else if (mapping.text) { q.orderBy(`${collated(col)} ${direction}`); }
		else { q.orderBy(`${col} ${direction}`); }
	}
}
