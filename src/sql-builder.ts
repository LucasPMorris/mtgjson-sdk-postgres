/** SQL builder with parameterized query construction. */

export class SQLBuilder {
	private _select: string[] = ["*"];
	private _distinct = false;
	private _from: string;
	private _joins: string[] = [];
	/** WHERE clauses (public for direct manipulation by query modules). */
	_where: string[] = [];
	/** Bound parameter values (public for direct manipulation by query modules). */
	_params: unknown[] = [];
	private _groupBy: string[] = [];
	private _having: string[] = [];
	private _orderBy: string[] = [];
	private _limit: number | null = null;
	private _offset: number | null = null;

	constructor(baseTable: string) { this._from = baseTable;}

	select(...columns: string[]): this {
		this._select = columns;
		return this;
	}

	distinct(): this {
		this._distinct = true;
		return this;
	}

	join(clause: string): this {
		this._joins.push(clause);
		return this;
	}

	where(condition: string, ...params: unknown[]): this {
		const offset = this._params.length;
		let remapped = condition;
		for (let i = params.length; i >= 1; i--) {
			remapped = remapped.replaceAll(`$${i}`, `$${offset + i}`);
		}
		this._where.push(remapped);
		this._params.push(...params);
		return this;
	}

	whereLike(column: string, value: string): this {
		const idx = this._params.length + 1;
		this._where.push(`LOWER(${column}) LIKE LOWER($${idx})`);
		this._params.push(value);
		return this;
	}

	whereIn(column: string, values: unknown[]): this {
		if (values.length === 0) {
			this._where.push("FALSE");
			return this;
		}
		const placeholders: string[] = [];
		for (const v of values) {
			const idx = this._params.length + 1;
			placeholders.push(`$${idx}`);
			this._params.push(v);
		}
		this._where.push(`${column} IN (${placeholders.join(", ")})`);
		return this;
	}

	whereEq(column: string, value: unknown): this {
		const idx = this._params.length + 1;
		this._where.push(`${column} = $${idx}`);
		this._params.push(value);
		return this;
	}

	whereGte(column: string, value: unknown): this {
		const idx = this._params.length + 1;
		this._where.push(`${column} >= $${idx}`);
		this._params.push(value);
		return this;
	}

	whereLte(column: string, value: unknown): this {
		const idx = this._params.length + 1;
		this._where.push(`${column} <= $${idx}`);
		this._params.push(value);
		return this;
	}

	whereRegex(column: string, pattern: string): this {
		const idx = this._params.length + 1;
		this._where.push(`${column} ~ $${idx}`);
		this._params.push(pattern);
		return this;
	}

	whereOr(...conditions: [string, unknown][]): this {
		if (conditions.length === 0) return this;
		const orParts: string[] = [];
		for (const [cond, param] of conditions) {
			const idx = this._params.length + 1;
			const remapped = cond.replaceAll("$1", `$${idx}`);
			orParts.push(remapped);
			this._params.push(param);
		}
		this._where.push(`(${orParts.join(" OR ")})`);
		return this;
	}

	groupBy(...columns: string[]): this {
		this._groupBy.push(...columns);
		return this;
	}

	having(condition: string, ...params: unknown[]): this {
		const offset = this._params.length;
		let remapped = condition;
		for (let i = params.length; i >= 1; i--) {
			remapped = remapped.replaceAll(`$${i}`, `$${offset + i}`);
		}
		this._having.push(remapped);
		this._params.push(...params);
		return this;
	}

	orderBy(...clauses: string[]): this {
		this._orderBy.push(...clauses);
		return this;
	}

	limit(n: number): this {
		if (!Number.isInteger(n) || n < 0) { throw new TypeError(`limit must be a non-negative integer, got ${n}`); }
		this._limit = n;
		return this;
	}

	offset(n: number): this {
		if (!Number.isInteger(n) || n < 0) { throw new TypeError(`offset must be a non-negative integer, got ${n}`); }
		this._offset = n;
		return this;
	}

	build(): [string, unknown[]] {
		const distinctStr = this._distinct ? "DISTINCT " : "";
		const parts = [ `SELECT ${distinctStr}${this._select.join(", ")}`, `FROM ${this._from}`];

		for (const j of this._joins) { parts.push(j); }
		if (this._where.length > 0) { parts.push(`WHERE ${this._where.join(" AND ")}`);	}
		if (this._groupBy.length > 0) {	parts.push(`GROUP BY ${this._groupBy.join(", ")}`);	}
		if (this._having.length > 0) { parts.push(`HAVING ${this._having.join(" AND ")}`); }
		if (this._orderBy.length > 0) { parts.push(`ORDER BY ${this._orderBy.join(", ")}`); }
		if (this._limit !== null) {	parts.push(`LIMIT ${this._limit}`); }
		if (this._offset !== null) { parts.push(`OFFSET ${this._offset}`);}

		return [parts.join("\n"), this._params];
	}
}
