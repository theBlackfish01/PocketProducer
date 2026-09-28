import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { closePool, getPool } from "./pool.js";

const here = dirname(fileURLToPath(import.meta.url));
const pool = getPool();
const client = await pool.connect();

try {
  await client.query("SELECT pg_advisory_lock(hashtext('pocket-schema-migrations'))");
  await client.query("CREATE TABLE IF NOT EXISTS schema_migration (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const migrationDirectory = join(here, "migrations");
  const names = (await readdir(migrationDirectory)).filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
  for (const name of names) {
    const exists = await client.query<{ name: string }>("SELECT name FROM schema_migration WHERE name = $1", [name]);
    if (exists.rowCount !== 0) {
      process.stdout.write(`Already applied ${name}\n`);
      continue;
    }
    const sql = await readFile(join(migrationDirectory, name), "utf8");
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migration(name) VALUES($1)", [name]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    process.stdout.write(`Applied ${name}\n`);
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(hashtext('pocket-schema-migrations'))");
  client.release();
  await closePool();
}
