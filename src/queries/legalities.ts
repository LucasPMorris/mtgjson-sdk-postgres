import type { Connection } from "../connection.js";
import type { CardSet } from "../types/index.js";

/**
 * Valid format column names in the card_legalities wide table.
 * Values: 'Legal' | 'Banned' | 'Restricted' | 'Not Legal' | null
 */
const KNOWN_FORMATS = new Set([
	"alchemy", "brawl", "commander", "duel", "explorer", "future",
	"gladiator", "historic", "historicbrawl", "legacy", "modern",
	"oathbreaker", "oldschool", "pauper", "paupercommander", "penny",
	"pioneer", "predh", "premodern", "standard", "standardbrawl",
	"timeless", "vintage",
]);

export class LegalityQuery {
	private _conn: Connection;

	constructor(conn: Connection) { this._conn = conn; }

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

	async legalIn(formatName: string, options?: { limit?: number; offset?: number }	): Promise<CardSet[]> { const fmt = formatName.toLowerCase();
    if (!KNOWN_FORMATS.has(fmt)) return [];
		const limit = options?.limit ?? 100;
		const offset = options?.offset ?? 0;
		const sql = `SELECT DISTINCT c.* FROM cards c
		             JOIN card_legalities cl ON c.uuid = cl.uuid
		             WHERE cl.${fmt} = 'Legal'
		             ORDER BY c.name ASC
		             LIMIT ${limit} OFFSET ${offset}`;
		return (await this._conn.execute(sql)) as CardSet[];
	}

	async isLegal(uuid: string, formatName: string): Promise<boolean> {
		const fmt = formatName.toLowerCase();
		if (!KNOWN_FORMATS.has(fmt)) return false;
		const result = await this._conn.executeScalar( `SELECT COUNT(*) FROM card_legalities WHERE uuid = $1 AND ${fmt} = 'Legal'`,	[uuid] );
		return ((result as number) ?? 0) > 0;
	}

	async bannedIn(	formatName: string,	options?: { limit?: number; offset?: number }	): Promise<Record<string, unknown>[]> { return this._cardsByStatus(formatName, "Banned", options); }
	async restrictedIn(	formatName: string,	options?: { limit?: number; offset?: number }	): Promise<Record<string, unknown>[]> { return this._cardsByStatus(formatName, "Restricted", options); }
	async suspendedIn(	formatName: string,	options?: { limit?: number; offset?: number }	): Promise<Record<string, unknown>[]> { return this._cardsByStatus(formatName, "Suspended", options); }
	async notLegalIn(	formatName: string, options?: { limit?: number; offset?: number }	): Promise<Record<string, unknown>[]> {	return this._cardsByStatus(formatName, "Not Legal", options);	}

	private async _cardsByStatus(	formatName: string, status: string, options?: { limit?: number; offset?: number }	): Promise<Record<string, unknown>[]> {
		const fmt = formatName.toLowerCase();
		if (!KNOWN_FORMATS.has(fmt)) return [];
		const limit = options?.limit ?? 100;
		const offset = options?.offset ?? 0;
		return this._conn.execute(
			`SELECT c.name, c.uuid FROM cards c
			 JOIN card_legalities cl ON c.uuid = cl.uuid
			 WHERE cl.${fmt} = $1
			 ORDER BY c.name ASC
			 LIMIT ${limit} OFFSET ${offset}`,
			[status],
		);
	}
}
