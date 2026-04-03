import type { Connection } from "../connection.js";
import type { CardType, CardTypes, Keywords } from "../types/index.js";

export class EnumQuery {
	private _conn: Connection;
	constructor(conn: Connection) { this._conn = conn; }

	async keywords(): Promise<Keywords> {
		const rows = await this._conn.execute("SELECT name, values FROM catalogs WHERE category = $1", ["keywords"]);
		const result: Record<string, string[]> = {};
		for (const row of rows) result[row.name as string] = row.values as string[];
		return result as unknown as Keywords;
	}

	async cardTypes(): Promise<CardTypes> {
		const rows = await this._conn.execute("SELECT name, values FROM catalogs WHERE category = $1", ["cardTypes"]);
		const result: Record<string, CardType> = {};
		for (const row of rows) {
			const [typeName, field] = (row.name as string).split(".");
			if (!result[typeName]) result[typeName] = { subTypes: [], superTypes: [] };
			if (field === "subTypes") result[typeName].subTypes = row.values as string[];
			else if (field === "superTypes") result[typeName].superTypes = row.values as string[];
		}
		return result as unknown as CardTypes;
	}

	async enumValues(): Promise<Record<string, unknown>> {
		const rows = await this._conn.execute("SELECT category, name, values FROM catalogs");
		const result: Record<string, Record<string, string[]>> = {};
		for (const row of rows) {
			const category = row.category as string;
			const name = row.name as string;
			if (!result[category]) result[category] = {};
			result[category][name] = row.values as string[];
		}
		return result;
	}
}
