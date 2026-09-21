import { spawn } from "node:child_process";

const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? "postgresql://pocket:pocket_local_only@127.0.0.1:54329/pocket_producer_test";
if (!new URL(testDatabaseUrl).pathname.slice(1).endsWith("_test")) throw new Error("E2E setup requires a dedicated *_test database");
Object.assign(process.env, {
  APP_ENV: "test", DATABASE_URL: testDatabaseUrl, OBJECT_STORAGE_LOCAL_ROOT: ".local/test-audio", FIXTURE_MODE: "true", DEV_LOCAL_AUTH: "true",
  OPENAI_API_KEY: "", GEMINI_API_KEY: "", GOOGLE_API_KEY: "", INITIAL_BUILD_API_BUDGET_USD: "0", MAX_JOB_COST_USD: "0"
});

const { closePool, getPool } = await import("@pocket/core");

const run = (script: string) => new Promise<void>((resolve, reject) => {
  const child = spawn(process.execPath, ["--import", "tsx", script], { cwd: process.cwd(), env: process.env, stdio: "inherit" });
  child.once("error", reject);
  child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${script} exited with code ${code ?? "unknown"}`)));
});

await getPool().query("TRUNCATE TABLE app_user RESTART IDENTITY CASCADE");
await getPool().query("INSERT INTO app_user(provider_subject,display_name) VALUES('dev-loopback','Local listener')");
await closePool();
await run("scripts/generate-fixtures.ts");
await run("scripts/seed-demo.ts");
