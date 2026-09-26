import { defineConfig, devices } from "@playwright/test"

// UI-only network fixtures. No API server, credentials, database or providers.
export default defineConfig({
  globalTeardown: "../scripts/visual-teardown.ts",
  testDir: "./visual", workers: 1, timeout: 45_000,
  outputDir: "../.local/evidence/score-visual-results",
  reporter: "list",
  use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:15174", trace: "on", video: "on", screenshot: "only-on-failure" },
  webServer: { command: "node --import tsx scripts/e2e-web.ts", cwd: "..", url: "http://127.0.0.1:15174", reuseExistingServer: false, env: { WEB_PORT: "15174", OPENAI_API_KEY: "", GEMINI_API_KEY: "", LANGSMITH_TRACING: "false", LANGSMITH_API_KEY: "" }, gracefulShutdown: { signal: "SIGINT", timeout: 3000 } }
})
