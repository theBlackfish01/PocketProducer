const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? "postgresql://pocket:pocket_local_only@127.0.0.1:54329/pocket_producer_test";

if (!new URL(testDatabaseUrl).pathname.slice(1).endsWith("_test")) {
  throw new Error("Tests require TEST_DATABASE_URL to name a dedicated *_test database");
}

Object.assign(process.env, {
  APP_ENV: "test",
  DATABASE_URL: testDatabaseUrl,
  OBJECT_STORAGE_LOCAL_ROOT: process.env.TEST_OBJECT_STORAGE_LOCAL_ROOT ?? ".local/test-audio",
  FIXTURE_MODE: "true",
  LANGSMITH_TRACING: "false",
  LANGSMITH_API_KEY: "",
  LANGSMITH_HIDE_INPUTS: "true",
  LANGSMITH_HIDE_OUTPUTS: "true",
  DEV_LOCAL_AUTH: "true",
  OPENAI_API_KEY: "",
  GEMINI_API_KEY: "",
  GOOGLE_API_KEY: "",
  JOB_LEASE_SECONDS: "3",
  // Keys stay cleared and fixture mode remains mandatory. These ceilings only
  // let injected provider mocks exercise the real transactional ledger.
  INITIAL_BUILD_API_BUDGET_USD: "5",
  MAX_JOB_COST_USD: "5"
});
