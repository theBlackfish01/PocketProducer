import pg from "pg";

const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? "postgresql://pocket:pocket_local_only@127.0.0.1:54329/pocket_producer_test";
const parsed = new URL(testDatabaseUrl);
const databaseName = parsed.pathname.slice(1);

if (!/^[a-z0-9_]+$/.test(databaseName) || !databaseName.endsWith("_test")) {
  throw new Error("Refusing to prepare a database that is not a simple *_test name");
}

const adminUrl = new URL(testDatabaseUrl);
adminUrl.pathname = "/postgres";
const client = new pg.Client({ connectionString: adminUrl.toString() });
await client.connect();
try {
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname=$1", [databaseName]);
  if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${databaseName}"`);
} finally {
  await client.end();
}

Object.assign(process.env, {
  APP_ENV: "test",
  DATABASE_URL: testDatabaseUrl,
  OBJECT_STORAGE_LOCAL_ROOT: ".local/test-audio",
  FIXTURE_MODE: "true",
  DEV_LOCAL_AUTH: "true",
  OPENAI_API_KEY: "",
  GEMINI_API_KEY: "",
  GOOGLE_API_KEY: "",
  INITIAL_BUILD_API_BUDGET_USD: "0",
  MAX_JOB_COST_USD: "0"
});

await import("./migrate.js");
