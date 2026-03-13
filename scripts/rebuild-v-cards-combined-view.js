import postgres from "postgres";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const connectionUrl = process.argv[2] ?? process.env.DATABASE_URL;

if (!connectionUrl) {
	console.error("Usage: node scripts/rebuild-v-cards-combined-view.js <postgres-connection-url>");
	console.error("Or set DATABASE_URL in the environment.");
	process.exit(1);
}

const db = postgres(connectionUrl, { max: 1 });

// Extract the v_cards_combined view definition from relations.sql.
const __dir = dirname(fileURLToPath(import.meta.url));
const relationsSQL = readFileSync(join(__dir, "relations.sql"), "utf-8");
const startMarker = "CREATE MATERIALIZED VIEW v_cards_combined AS";
const startIdx = relationsSQL.indexOf(startMarker);
if (startIdx === -1) { console.error("Could not find v_cards_combined view definition in relations.sql"); process.exit(1); }
const viewSQL = relationsSQL.slice(startIdx);

const SQL = `DROP MATERIALIZED VIEW IF EXISTS v_cards_combined CASCADE;\n\n${viewSQL}`;

try {
	await db.unsafe(SQL);
	console.log("Rebuilt v_cards_combined materialized view.");
} catch (error) {
	console.error("Failed to rebuild v_cards_combined:", error);
	process.exitCode = 1;
} finally {
	await db.end();
}
