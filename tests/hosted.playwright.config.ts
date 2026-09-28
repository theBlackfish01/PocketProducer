import { defineConfig, devices } from "@playwright/test";
const database = process.env.TEST_DATABASE_URL ?? "postgresql://pocket:pocket_local_only@127.0.0.1:54329/pocket_producer_test";
if (!new URL(database).pathname.endsWith("_test")) throw new Error("Hosted fixture tests require a *_test database");
Object.assign(process.env, {
  APP_ENV: "test", HOSTED_AUTH_MODE: "invite", APP_ORIGIN: "http://127.0.0.1:19280", PORT: "19280", DEV_LOCAL_AUTH: "false", SERVE_WEB: "true", HOSTED_MAINTENANCE: "false",
  DATABASE_URL: database, OBJECT_STORAGE_LOCAL_ROOT: ".local/hosted-test-audio", FIXTURE_MODE: "true",
  OPENAI_API_KEY: "", GEMINI_API_KEY: "", GOOGLE_API_KEY: "", AI_GATEWAY_API_KEY: "", VERCEL_AI_GATEWAY_API_KEY: "", LANGSMITH_API_KEY: "", LANGSMITH_TRACING: "false",
  AUDIOTOOL_CLIENT_ID: "", AUDIOTOOL_SESSION_KEY: "", SOL_POOL_BUDGET_USD: "", LUNA_POOL_BUDGET_USD: "", INITIAL_BUILD_API_BUDGET_USD: "0", MAX_JOB_COST_USD: "0", JOB_LEASE_SECONDS: "45"
});
export default defineConfig({
  testDir: "./hosted", workers: 1, timeout: 90_000, reporter: "list", globalTeardown: "../scripts/hosted-test-teardown.ts",
  use: { baseURL: "http://127.0.0.1:19280", ...devices["Desktop Chrome"], viewport: { width: 1600, height: 1000 }, screenshot: "only-on-failure" },
  // Test-mode cookies work on HTTP loopback. Integration tests separately assert
  // the real production cookie attributes and HTTPS configuration guards.
  webServer: { command: "node --import tsx scripts/start-hosted.ts", cwd: "..", url: "http://127.0.0.1:19280/healthz", timeout: 120_000, reuseExistingServer: false, env: Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), gracefulShutdown: { signal: "SIGTERM", timeout: 12_000 } }
});
