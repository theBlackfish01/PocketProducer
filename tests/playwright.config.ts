import { defineConfig, devices } from "@playwright/test";

const webPort = Number(process.env.E2E_WEB_PORT ?? 15_173);
const apiPort = Number(process.env.E2E_API_PORT ?? 18_787);
const workerHealthPort = Number(process.env.E2E_WORKER_HEALTH_PORT ?? 18_788);

export default defineConfig({
  testDir: "./e2e",
  globalTeardown: "../scripts/e2e-teardown.ts",
  timeout: 45_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { outputFolder: "../playwright-report", open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"]
  },
  webServer: [
    {
      command: "node --import tsx apps/api/src/server.ts",
      cwd: "..",
      url: `http://127.0.0.1:${apiPort}/api/v1/status`,
      reuseExistingServer: false,
      timeout: 120_000,
      gracefulShutdown: { signal: "SIGINT", timeout: 3_000 },
      env: {
        ...process.env,
        APP_ENV: "test", APP_ORIGIN: `http://127.0.0.1:${webPort}`, API_PORT: String(apiPort), DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://pocket:pocket_local_only@127.0.0.1:54329/pocket_producer_test",
        OBJECT_STORAGE_LOCAL_ROOT: process.env.TEST_OBJECT_STORAGE_LOCAL_ROOT ?? ".local/test-audio", FIXTURE_MODE: "true", DEV_LOCAL_AUTH: "true", OPENAI_API_KEY: "", GEMINI_API_KEY: "", GOOGLE_API_KEY: "", INITIAL_BUILD_API_BUDGET_USD: "0", MAX_JOB_COST_USD: "0", MAX_AUDIO_CRITIQUE_PASSES: "0"
      }
    },
    {
      command: "node --import tsx scripts/e2e-worker.ts",
      cwd: "..",
      url: `http://127.0.0.1:${workerHealthPort}`,
      reuseExistingServer: false,
      timeout: 120_000,
      gracefulShutdown: { signal: "SIGINT", timeout: 3_000 },
      env: {
        ...process.env,
        APP_ENV: "test", APP_ORIGIN: `http://127.0.0.1:${webPort}`, API_PORT: String(apiPort), WORKER_HEALTH_PORT: String(workerHealthPort), DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://pocket:pocket_local_only@127.0.0.1:54329/pocket_producer_test",
        OBJECT_STORAGE_LOCAL_ROOT: process.env.TEST_OBJECT_STORAGE_LOCAL_ROOT ?? ".local/test-audio", FIXTURE_MODE: "true", DEV_LOCAL_AUTH: "true", OPENAI_API_KEY: "", GEMINI_API_KEY: "", GOOGLE_API_KEY: "", INITIAL_BUILD_API_BUDGET_USD: "0", MAX_JOB_COST_USD: "0", MAX_AUDIO_CRITIQUE_PASSES: "0"
      }
    },
    {
      command: "node --import tsx scripts/e2e-web.ts",
      cwd: "..",
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: false,
      timeout: 120_000,
      gracefulShutdown: { signal: "SIGINT", timeout: 3_000 },
      env: {
      ...process.env,
      APP_ENV: "test",
      APP_ORIGIN: `http://127.0.0.1:${webPort}`,
      API_PORT: String(apiPort),
      WEB_PORT: String(webPort),
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://pocket:pocket_local_only@127.0.0.1:54329/pocket_producer_test",
      OBJECT_STORAGE_LOCAL_ROOT: process.env.TEST_OBJECT_STORAGE_LOCAL_ROOT ?? ".local/test-audio",
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
