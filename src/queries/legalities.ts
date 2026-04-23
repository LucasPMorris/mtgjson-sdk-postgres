import type { Connection } from "../connection.js";
import type { CardSet } from "../types/index.js";
import { collated } from "./_sort-helpers.js";

export class LegalityQuery {
	private _conn: Connection;
	private _knownFormats: Set<string> | null = null;

	constructor(conn: Connection) { this._conn = conn; }

	/** Load known format names from the catalogs table, cached after first call. */
	async getKnownFormats(): Promise<Set<string>> {
		if (this._knownFormats) return this._knownFormats;
		const rows = await this._conn.execute(
			"SELECT values FROM catalogs WHERE category = $1 AND name = $2",
			["legalities", "formats"],
		);
		const formats = (rows[0]?.values as string[]) ?? [];
		this._knownFormats = new Set(formats);
		return this._knownFormats;
	}

	/**
	 * Returns all format→status pairs for a card.
	 * Uses jsonb_each_text to pivot the wide table into key-value pairs.
	 */
	async formatsForCard(uuid: string): Promise<Record<string, string>> {
		const rows = await this._conn.execute(
			`SELECT key AS format, value AS status
			 FROM card_legalities cl,
			      jsonb_each_text(to_jsonb(cl) - 'uuid')
			 WHERE cl.uuid = $1 AND value IS NOT NULL`,
			[uuid],
		);
		const result: Record<string, string> = {};
		for (const r of rows) { result[r.format as string] = r.status as string; }
		return result;
	}

	async legalIn(formatName: string, options?: { limit?: number; offset?: number }	): Promise<CardSet[]> {
		const fmt = formatName.toLowerCase();
		const known = await this.getKnownFormats();
		if (!known.has(fmt)) return [];
		const limit = options?.limit ?? 100;
		const offset = options?.offset ?? 0;
		const sql = `SELECT DISTINCT c.* FROM cards c
		             JOIN card_legalities cl ON c.uuid = cl.uuid
		             WHERE cl.${fmt} = 'Legal'
		             ORDER BY ${collated("c.name")} ASC
		             LIMIT ${limit} OFFSET ${offset}`;
		return (await this._conn.execute(sql)) as CardSet[];
	}

	async isLegal(uuid: string, formatName: string): Promise<boolean> {
		const fmt = formatName.toLowerCase();
		const known = await this.getKnownFormats();
		if (!known.has(fmt)) return false;
		const result = await this._conn.executeScalar( `SELECT COUNT(*) FROM card_legalities WHERE uuid = $1 AND ${fmt} = 'Legal'`,	[uuid] );
		return ((result as number) ?? 0) > 0;
	}

	async bannedIn(	formatName: string,	options?: { limit?: number; offset?: number }	): Promise<Record<string, unknown>[]> { return this._cardsByStatus(formatName, "Banned", options); }
	async restrictedIn(	formatName: string,	options?: { limit?: number; offset?: number }	): Promise<Record<string, unknown>[]> { return this._cardsByStatus(formatName, "Restricted", options); }
	async suspendedIn(	formatName: string,	options?: { limit?: number; offset?: number }	): Promise<Record<string, unknown>[]> { return this._cardsByStatus(formatName, "Suspended", options); }
	async notLegalIn(	formatName: string, options?: { limit?: number; offset?: number }	): Promise<Record<string, unknown>[]> {	return this._cardsByStatus(formatName, "Not Legal", options);	}

	private async _cardsByStatus(	formatName: string, status: string, options?: { limit?: number; offset?: number }	): Promise<Record<string, unknown>[]> {
		const fmt = formatName.toLowerCase();
		const known = await this.getKnownFormats();
		if (!known.has(fmt)) return [];
		const limit = options?.limit ?? 100;
		const offset = options?.offset ?? 0;
		return this._conn.execute(
			`SELECT c.name, c.uuid FROM cards c
			 JOIN card_legalities cl ON c.uuid = cl.uuid
			 WHERE cl.${fmt} = $1
			 ORDER BY ${collated("c.name")} ASC
			 LIMIT ${limit} OFFSET ${offset}`,
			[status],
		);
	}
}
