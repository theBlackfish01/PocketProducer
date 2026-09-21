import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { outputFolder: "../playwright-report", open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:15173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"]
  },
  webServer: [
    {
      command: "node --import tsx apps/api/src/server.ts",
      cwd: "..",
      url: "http://127.0.0.1:18787/api/v1/status",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        APP_ENV: "test", APP_ORIGIN: "http://127.0.0.1:15173", API_PORT: "18787", DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://pocket:pocket_local_only@127.0.0.1:54329/pocket_producer_test",
        OBJECT_STORAGE_LOCAL_ROOT: ".local/test-audio", FIXTURE_MODE: "true", DEV_LOCAL_AUTH: "true", OPENAI_API_KEY: "", GEMINI_API_KEY: "", GOOGLE_API_KEY: "", INITIAL_BUILD_API_BUDGET_USD: "0", MAX_JOB_COST_USD: "0"
      }
    },
    {
      command: "node --import tsx scripts/e2e-worker.ts",
      cwd: "..",
      url: "http://127.0.0.1:18788",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        APP_ENV: "test", APP_ORIGIN: "http://127.0.0.1:15173", API_PORT: "18787", DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://pocket:pocket_local_only@127.0.0.1:54329/pocket_producer_test",
        OBJECT_STORAGE_LOCAL_ROOT: ".local/test-audio", FIXTURE_MODE: "true", DEV_LOCAL_AUTH: "true", OPENAI_API_KEY: "", GEMINI_API_KEY: "", GOOGLE_API_KEY: "", INITIAL_BUILD_API_BUDGET_USD: "0", MAX_JOB_COST_USD: "0"
      }
    },
    {
      command: "node apps/web/node_modules/vite/bin/vite.js apps/web",
      cwd: "..",
      url: "http://127.0.0.1:15173",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
      ...process.env,
      APP_ENV: "test",
      APP_ORIGIN: "http://127.0.0.1:15173",
      API_PORT: "18787",
      WEB_PORT: "15173",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://pocket:pocket_local_only@127.0.0.1:54329/pocket_producer_test",
      OBJECT_STORAGE_LOCAL_ROOT: ".local/test-audio",
      FIXTURE_MODE: "true",
      DEV_LOCAL_AUTH: "true",
      OPENAI_API_KEY: "",
      GEMINI_API_KEY: "",
      GOOGLE_API_KEY: "",
      INITIAL_BUILD_API_BUDGET_USD: "0",
      MAX_JOB_COST_USD: "0"
      }
    }
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
