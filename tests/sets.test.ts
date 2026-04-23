import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Connection } from "../src/connection.js";
import { SetQuery } from "../src/queries/sets.js";
import { createTestConnection } from "./setup.js";

let conn: Connection;
let sets: SetQuery;

beforeAll(async () => {
	conn = await createTestConnection();
	sets = new SetQuery(conn);
});

afterAll(async () => {
	await conn.close();
});

describe("SetQuery", () => {
	it("get by code", async () => {
		const set = await sets.get("A25");
		expect(set).not.toBeNull();
		expect(set!.name).toBe("Masters 25");
	});

	it("get by code case insensitive", async () => {
		const set = await sets.get("a25");
		expect(set).not.toBeNull();
		expect(set!.code).toBe("A25");
	});

	it("get returns null for missing", async () => {
		const set = await sets.get("NONEXISTENT");
		expect(set).toBeNull();
	});

	it("list all", async () => {
		const results = await sets.list();
		expect(results).toHaveLength(2);
	});

	it("list by type", async () => {
		const results = await sets.list({ setType: "Masters" });
		expect(results).toHaveLength(1);
		expect(results[0].code).toBe("A25");
	});

	it("search by name", async () => {
		const results = await sets.search({ name: "Modern" });
		expect(results).toHaveLength(1);
		expect(results[0].code).toBe("MH2");
	});

	it("count", async () => {
		const total = await sets.count();
		expect(total).toBe(2);
	});

	it("financial summary returns null without prices", async () => {
		const summary = await sets.getFinancialSummary("A25");
		expect(summary).toBeNull();
	});
});
