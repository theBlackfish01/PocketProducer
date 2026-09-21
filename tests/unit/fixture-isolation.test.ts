import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("fixture provider isolation", () => {
  it("blocks OpenAI and Gemini transports with ambient placeholder keys", () => {
    const output = execFileSync(
      process.execPath,
      ["--import", "tsx", resolve("tests/fixtures/fixture-provider-guard.ts")],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 20_000,
        env: {
          ...process.env,
          APP_ENV: "test",
          FIXTURE_MODE: "true",
          DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/pocket_fixture_guard_test",
          OBJECT_STORAGE_LOCAL_ROOT: ".local/fixture-guard-audio",
          OPENAI_API_KEY: "sk-placeholder-must-not-dispatch",
          GEMINI_API_KEY: "placeholder-must-not-dispatch",
          GOOGLE_API_KEY: ""
        }
      }
    );
    expect(output).toContain("fixture-provider-guard:ok");
  }, 20_000);
});
