import type { SQLBuilder } from "../sql-builder.js";
import { collated } from "./_sort-helpers.js";

export const KNOWN_FORMATS = new Set([ "alchemy",   "brawl",   "commander",       "duel",  "explorer",  "future",  "gladiator",  "historic",  "historicbrawl",  "legacy",   "modern", 	"oathbreaker",
                                "oldschool", "pauper",  "paupercommander", "penny",	"pioneer",   "predh",   "premodern",  "standard",  "standardbrawl",	 "timeless", "vintage" ]);

type KeywordOperator = "All" | "Any" | "Exact";

// Columns that legitimately differ across card faces (front/back). When a filter targets one of these,
// the WHERE fragment is wrapped so it also matches via OR-EXISTS across the row's other_face_ids.
// `:` is included in the lookbehind so type casts like `$1::text[]` are not rewritten.
const FACE_AWARE_COLUMNS = ["subtypes", "supertypes", "types", "type", "power", "toughness", "mana_value", "colors", "color_identity", "text", "keywords", "artist"] as const;
function faceSensitive(fragment: string): string {
	let aliased = fragment;
	for (const col of FACE_AWARE_COLUMNS) { aliased = aliased.replace(new RegExp(`(?<![\\w.:])${col}\\b`, "g"), `c2.${col}`); }
	return `(${fragment} OR EXISTS (SELECT 1 FROM v_cards c2 WHERE c2.uuid = ANY(other_face_ids) AND ${aliased}))`;
}

export type SortField = "name" | "manaValue" | "power" | "toughness" | "number" | "set" | "priceTcgplayer" | "priceCardkingdom";
export type SortDirection = "ASC" | "DESC";
export type SortOption = SortField | `${SortField}:${SortDirection}`;

// Price-sort dims per finish: provider_id (bits 4..6) | format=paper(0) | finish (bits 1..2) | price_type=retail(0).
// See `scripts/pricing-schema.sql` pack_dims for the encoding contract. Provider ids: cardhoarder=0,
// cardkingdom=1, cardmarket=2, cardsphere=3, tcgplayer=4. Finish codes: normal=0, foil=1, etched=2.
// Three rows per (uuid, provider) are JOINed below so the sort can fall back through normal → foil
// → etched (matching the client-side pickPrice precedence). Foil-only / etched-only printings then
// rank by their available finish instead of sorting to NULLS LAST.
const dimsFor = (providerId: number, finishCode: number) => (providerId << 4) | (finishCode << 1);
const PRICE_DIMS_TCGPLAYER   = { normal: dimsFor(4, 0), foil: dimsFor(4, 1), etched: dimsFor(4, 2) }; // 64, 66, 68
const PRICE_DIMS_CARDKINGDOM = { normal: dimsFor(1, 0), foil: dimsFor(1, 1), etched: dimsFor(1, 2) }; // 16, 18, 20

type PriceJoinSpec = { aliasBase: string; dimsByFinish: { normal: number; foil: number; etched: number } };
type SortFieldDef = { column: string; numeric?: boolean; text?: boolean; priceJoin?: PriceJoinSpec };

export const SORT_FIELD_MAP: Record<SortField, SortFieldDef> = {
	name:             { column: "name",     text: true },
	manaValue:        { column: "mana_value" },
	power:            { column: "power",    numeric: true },
	toughness:        { column: "toughness", numeric: true },
	number:           { column: "number",   text: true },
	set:              { column: "set_code", text: true },
	priceTcgplayer:   { column: "price",    priceJoin: { aliasBase: "pc_tcg", dimsByFinish: PRICE_DIMS_TCGPLAYER   } },
	priceCardkingdom: { column: "price",    priceJoin: { aliasBase: "pc_ck",  dimsByFinish: PRICE_DIMS_CARDKINGDOM } },
};

export type PriceProvider = "tcgplayer" | "cardkingdom";
const PRICE_PROVIDER_MAP: Record<PriceProvider, PriceJoinSpec> = {
	tcgplayer:   { aliasBase: "pc_tcg", dimsByFinish: PRICE_DIMS_TCGPLAYER   },
	cardkingdom: { aliasBase: "pc_ck",  dimsByFinish: PRICE_DIMS_CARDKINGDOM },
};

/** Idempotently add the three (normal/foil/etched) prices_current LEFT JOINs for a provider.
 *  Filter and sort share the same alias bases via a Set stashed on the SQLBuilder so applying
 *  a price filter and a price sort on the same provider does not collide on alias names.
 *  Scopes SELECT to `${table}.*` so the joined `prices_current.uuid` columns do not shadow the
 *  card's `uuid` (driver returns the last-seen column by name, which is NULL for cards without
 *  an etched price - that is what produced duplicate React keys when the bare `SELECT *` ran). */
function ensurePriceJoins(q: SQLBuilder, table: string, spec: PriceJoinSpec): void {
	const qx = q as unknown as { _priceJoinsAdded?: Set<string>; _select: string[] };
	const joined = qx._priceJoinsAdded ?? (qx._priceJoinsAdded = new Set<string>());
	if (joined.has(spec.aliasBase)) return;
	const { aliasBase, dimsByFinish } = spec;
	// Scope SELECT only when it is the default wildcard. The joined `prices_current.uuid` columns
	// would otherwise shadow the card's `uuid` under `SELECT *` (driver returns the last-seen column
	// by name, NULL for cards without an etched price - which produced duplicate React keys). Skip
	// the rewrite for explicit selects like `COUNT(*)` so count() queries are not corrupted.
	if (qx._select.length === 1 && qx._select[0] === "*") q.select(`${table}.*`);
	q.join(`LEFT JOIN prices_current ${aliasBase}_n ON ${aliasBase}_n.uuid::text = ${table}.uuid AND ${aliasBase}_n.dims = ${dimsByFinish.normal}`);
	q.join(`LEFT JOIN prices_current ${aliasBase}_f ON ${aliasBase}_f.uuid::text = ${table}.uuid AND ${aliasBase}_f.dims = ${dimsByFinish.foil}`);
	q.join(`LEFT JOIN prices_current ${aliasBase}_e ON ${aliasBase}_e.uuid::text = ${table}.uuid AND ${aliasBase}_e.dims = ${dimsByFinish.etched}`);
	joined.add(aliasBase);
}

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
	price?: number;
	priceGte?: number;
	priceLte?: number;
	priceGt?: number;
	priceLt?: number;
	priceProvider?: PriceProvider;
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
			return faceSensitive(`$${idx} = ANY(keywords)`);
		});
		q._where.push(`(${parts.join(" OR ")})`);
	} else if (op === "All") {
		// Each keyword may be satisfied by either face; the union-of-faces semantic is desired (Trample on side a + Flying on side b matches).
		for (const kw of keywords) {
			const idx = q._params.length + 1;
			q._params.push(kw);
			q._where.push(faceSensitive(`$${idx} = ANY(keywords)`));
		}
	} else {
		// Exact: any single face's keywords array must equal the specified set exactly.
		const idx = q._params.length + 1;
		q._params.push(keywords);
		q._where.push(faceSensitive(`keywords @> $${idx}::text[] AND keywords <@ $${idx}::text[]`));
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
	if (opts.manaValue    !== undefined) { const i = q._params.length + 1; q._params.push(opts.manaValue);    q._where.push(faceSensitive(`mana_value = $${i}`));  }
	if (opts.manaValueLte !== undefined) { const i = q._params.length + 1; q._params.push(opts.manaValueLte); q._where.push(faceSensitive(`mana_value <= $${i}`)); }
	if (opts.manaValueGte !== undefined) { const i = q._params.length + 1; q._params.push(opts.manaValueGte); q._where.push(faceSensitive(`mana_value >= $${i}`)); }
	if (opts.manaValueLt  !== undefined) { const i = q._params.length + 1; q._params.push(opts.manaValueLt);  q._where.push(faceSensitive(`mana_value < $${i}`));  }
	if (opts.manaValueGt  !== undefined) { const i = q._params.length + 1; q._params.push(opts.manaValueGt);  q._where.push(faceSensitive(`mana_value > $${i}`));  }
	if (opts.text)      { const i = q._params.length + 1; q._params.push(`%${opts.text}%`); q._where.push(faceSensitive(`LOWER(text) LIKE LOWER($${i})`)); }
	if (opts.textRegex) { const i = q._params.length + 1; q._params.push(opts.textRegex);   q._where.push(faceSensitive(`text ~ $${i}`)); }
	if (opts.types) {
		const types = Array.isArray(opts.types) ? opts.types : [opts.types];
		const parts = types.map(t => { const idx = q._params.length + 1; q._params.push(`%${t}%`); return `type ILIKE $${idx}`; });
		q._where.push(faceSensitive(parts.length === 1 ? parts[0] : `(${parts.join(" OR ")})`));
	}
	if (opts.subtype) {
		const subtypes = Array.isArray(opts.subtype) ? opts.subtype : [opts.subtype];
		const parts = subtypes.map(s => { const idx = q._params.length + 1; q._params.push(s); return `$${idx} = ANY(subtypes)`; });
		q._where.push(faceSensitive(parts.length === 1 ? parts[0] : `(${parts.join(" OR ")})`));
	}
	if (opts.supertype) {
		const supertypes = Array.isArray(opts.supertype) ? opts.supertype : [opts.supertype];
		const parts = supertypes.map(s => { const idx = q._params.length + 1; q._params.push(s); return `$${idx} = ANY(supertypes)`; });
		q._where.push(faceSensitive(parts.length === 1 ? parts[0] : `(${parts.join(" OR ")})`));
	}
	if (opts.power)                      { const i = q._params.length + 1; q._params.push(opts.power);        q._where.push(faceSensitive(`power = $${i}`)); }
	if (opts.powerGte     !== undefined) { const i = q._params.length + 1; q._params.push(opts.powerGte);     q._where.push(faceSensitive(`power ~ '^-?[0-9]+(\\.[0-9]+)?$' AND power::NUMERIC >= $${i}`)); }
	if (opts.powerLte     !== undefined) { const i = q._params.length + 1; q._params.push(opts.powerLte);     q._where.push(faceSensitive(`power ~ '^-?[0-9]+(\\.[0-9]+)?$' AND power::NUMERIC <= $${i}`)); }
	if (opts.powerGt      !== undefined) { const i = q._params.length + 1; q._params.push(opts.powerGt);      q._where.push(faceSensitive(`power ~ '^-?[0-9]+(\\.[0-9]+)?$' AND power::NUMERIC > $${i}`));  }
	if (opts.powerLt      !== undefined) { const i = q._params.length + 1; q._params.push(opts.powerLt);      q._where.push(faceSensitive(`power ~ '^-?[0-9]+(\\.[0-9]+)?$' AND power::NUMERIC < $${i}`));  }
	if (opts.toughness)                  { const i = q._params.length + 1; q._params.push(opts.toughness);    q._where.push(faceSensitive(`toughness = $${i}`)); }
	if (opts.toughnessGte !== undefined) { const i = q._params.length + 1; q._params.push(opts.toughnessGte); q._where.push(faceSensitive(`toughness ~ '^-?[0-9]+(\\.[0-9]+)?$' AND toughness::NUMERIC >= $${i}`)); }
	if (opts.toughnessLte !== undefined) { const i = q._params.length + 1; q._params.push(opts.toughnessLte); q._where.push(faceSensitive(`toughness ~ '^-?[0-9]+(\\.[0-9]+)?$' AND toughness::NUMERIC <= $${i}`)); }
	if (opts.toughnessGt  !== undefined) { const i = q._params.length + 1; q._params.push(opts.toughnessGt);  q._where.push(faceSensitive(`toughness ~ '^-?[0-9]+(\\.[0-9]+)?$' AND toughness::NUMERIC > $${i}`));  }
	if (opts.toughnessLt  !== undefined) { const i = q._params.length + 1; q._params.push(opts.toughnessLt);  q._where.push(faceSensitive(`toughness ~ '^-?[0-9]+(\\.[0-9]+)?$' AND toughness::NUMERIC < $${i}`));  }

	// Price filters compare against COALESCE(normal, foil, etched) for the chosen provider, matching
	// the same finish-fallback precedence used by the price sort. Cards with no row in any finish for
	// the provider are excluded (COALESCE is NULL → comparison is NULL → row dropped). When both a
	// price filter and a price sort target the same provider, ensurePriceJoins dedupes the joins.
	const priceFilterSet = opts.price !== undefined || opts.priceGte !== undefined || opts.priceLte !== undefined || opts.priceGt !== undefined || opts.priceLt !== undefined;
	if (priceFilterSet) {
		const provider: PriceProvider = opts.priceProvider ?? "tcgplayer";
		const spec = PRICE_PROVIDER_MAP[provider];
		ensurePriceJoins(q, table, spec);
		const expr = `COALESCE(${spec.aliasBase}_n.price, ${spec.aliasBase}_f.price, ${spec.aliasBase}_e.price)`;
		if (opts.price    !== undefined) q.where(`${expr} = $1`,  opts.price);
		if (opts.priceGte !== undefined) q.where(`${expr} >= $1`, opts.priceGte);
		if (opts.priceLte !== undefined) q.where(`${expr} <= $1`, opts.priceLte);
		if (opts.priceGt  !== undefined) q.where(`${expr} > $1`,  opts.priceGt);
		if (opts.priceLt  !== undefined) q.where(`${expr} < $1`,  opts.priceLt);
	}

	if (opts.artist?.length) {
		const placeholders: string[] = [];
		for (const v of opts.artist) { const i = q._params.length + 1; placeholders.push(`$${i}`); q._params.push(v); }
		q._where.push(faceSensitive(`artist IN (${placeholders.join(", ")})`));
	}
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
		q._params.push(color);
		q._where.push(faceSensitive(`$${idx} = ANY(colors)`));
	}
	for (const color of opts.colorIdentity ?? []) {
		const idx = q._params.length + 1;
		q._params.push(color);
		q._where.push(faceSensitive(`$${idx} = ANY(color_identity)`));
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

/** Parse sort options and apply ORDER BY clauses to the query builder.
 *  Price sorts (`priceTcgplayer` / `priceCardkingdom`) LEFT JOIN `prices_current` three times per
 *  provider (one row per finish: normal/foil/etched) and ORDER BY COALESCE of those joined prices,
 *  matching the client-side `pickPrice` precedence (normal → foil → etched). Cards with no matching
 *  row in any finish sort last in either direction. The three joins per provider alias are added
 *  once even when the same price field is referenced multiple times in the sort list, or when a
 *  price filter has already added the same provider's joins via applyCardFilters. */
export function applyCardSort(q: SQLBuilder, sort: SortOption | SortOption[] | undefined, table: string): void {
	if (!sort) { q.orderBy(`${collated(`${table}.name`)} ASC`, `${collated(`${table}.number`)} ASC`); return;	}

	const sorts = Array.isArray(sort) ? sort : [sort];
	for (const s of sorts) {
		const [field, dir = "ASC"] = s.split(":") as [SortField, SortDirection?];
		const mapping = SORT_FIELD_MAP[field];
		if (!mapping) continue;
		const direction = dir === "DESC" ? "DESC" : "ASC";

		if (mapping.priceJoin) {
			// `cards.uuid` (and v_cards / v_cards_combined) is TEXT, while `prices_current.uuid` is
			// UUID; ensurePriceJoins handles the cast, dedups against any joins already added by
			// applyCardFilters when filter and sort target the same provider, and scopes SELECT so
			// the joined `prices_current.uuid` does not shadow the card's `uuid`.
			ensurePriceJoins(q, table, mapping.priceJoin);
			const { aliasBase } = mapping.priceJoin;
			q.orderBy(`COALESCE(${aliasBase}_n.price, ${aliasBase}_f.price, ${aliasBase}_e.price) ${direction} NULLS LAST`);
			continue;
		}

		const col = `${table}.${mapping.column}`;
		if (mapping.numeric) {
			const nulls = direction === "ASC" ? "LAST" : "FIRST"; // Cast to numeric for proper ordering, push NULLs/non-numeric to the end
			q.orderBy(`(CASE WHEN ${col} ~ '^-?[0-9]+(\\.[0-9]+)?$' THEN ${col}::NUMERIC END) ${direction} NULLS ${nulls}`);
		} else if (mapping.text) { q.orderBy(`${collated(col)} ${direction}`); }
		else { q.orderBy(`${col} ${direction}`); }
	}
}
