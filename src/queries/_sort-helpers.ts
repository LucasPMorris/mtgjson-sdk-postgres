/**
 * Collation used for text ORDER BY / DISTINCT ON to keep sort order locale-independent
 * across Postgres installations (e.g. local `C.UTF-8` vs Render's `en_US.UTF-8`).
 *
 * Default: `"C"` (byte-wise, available on every Postgres). Pass `null` to opt out
 * and fall back to the database's default collation.
 */
let _nameCollation: string | null = "C";

export function setNameCollation(collation: string | null): void { _nameCollation = collation; }
export function getNameCollation(): string | null { return _nameCollation; }

/** Append `COLLATE "<collation>"` to a text column reference, e.g. `collated("v.name")` → `v.name COLLATE "C"`. */
export function collated(column: string): string {
	const c = _nameCollation;
	return c ? `${column} COLLATE "${c}"` : column;
}
