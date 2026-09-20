import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { outputFolder: "../playwright-report", open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"]
  },
  webServer: {
    command: "pnpm dev",
    cwd: "..",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { ...process.env, APP_ENV: "test", FIXTURE_MODE: "true", DEV_LOCAL_AUTH: "true", INITIAL_BUILD_API_BUDGET_USD: "0", MAX_JOB_COST_USD: "0" }
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
