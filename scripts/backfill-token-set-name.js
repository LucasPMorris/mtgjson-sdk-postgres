import postgres from "postgres";

const connectionUrl = process.argv[2] ?? process.env.DATABASE_URL;

if (!connectionUrl) {
	console.error("Usage: node scripts/backfill-token-set-name.js <postgres-connection-url>");
	console.error("Or set DATABASE_URL in the environment.");
	process.exit(1);
}

const db = postgres(connectionUrl, { max: 1 });

try {
	const result = await db`
		UPDATE tokens AS t
		SET set_name = s.name
		FROM sets AS s
		WHERE s.code = t.set_code
		  AND (t.set_name IS NULL OR t.set_name <> s.name)
	`;

	const updatedRows = Array.isArray(result) && "count" in result ? Number(result.count) : 0;
	console.log(`Updated ${updatedRows} token rows.`);
} catch (error) {
	console.error("Failed to backfill tokens.set_name:", error);
	process.exitCode = 1;
} finally {
	await db.end();
}
