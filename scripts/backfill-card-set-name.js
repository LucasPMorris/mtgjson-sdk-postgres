import postgres from "postgres";

const connectionUrl = process.argv[2] ?? process.env.DATABASE_URL;

if (!connectionUrl) {
	console.error("Usage: node scripts/backfill-card-set-name.js <postgres-connection-url>");
	console.error("Or set DATABASE_URL in the environment.");
	process.exit(1);
}

const db = postgres(connectionUrl, { max: 1 });

try {
	const result = await db`
		UPDATE cards AS c
		SET set_name = s.name
		FROM sets AS s
		WHERE s.code = c.set_code
		  AND (c.set_name IS NULL OR c.set_name <> s.name)
	`;

	const updatedRows = Array.isArray(result) && "count" in result ? Number(result.count) : 0;
	console.log(`Updated ${updatedRows} card rows.`);
} catch (error) {
	console.error("Failed to backfill cards.set_name:", error);
	process.exitCode = 1;
} finally {
	await db.end();
}