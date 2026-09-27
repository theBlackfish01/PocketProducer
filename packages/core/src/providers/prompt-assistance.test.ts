import { describe, expect, it } from "vitest";
import { promptAssistanceInstructions, requiredPromptPassages, validatePromptSuggestion } from "./prompt-assistance.js";
import { tokenCostMicrousd } from "./pricing.js";
import { safeAvatarUrl } from "../nexus/profile.js";

describe("musical prompt assistance", () => {
  it.each(["Do not change the bass.", "Keep the melody and bass.", "No drums; only keys.", "Exactly 96 BPM in D minor.", "Use 64 bars. No vocals."])("retains explicit requirements: %s", (original) => {
    expect(requiredPromptPassages(original).length).toBeGreaterThan(0);
    expect(validatePromptSuggestion(original, { prompt: `${original} Let the other voices trade a spacious phrase.` })).toContain(original);
    expect(() => validatePromptSuggestion(original, { prompt: "Add busy drums and change the bass." })).toThrow();
  });
  it("does not force vague ideas into numeric templates", () => {
    expect(requiredPromptPassages("Warm and strange for a late-night drive")).toEqual([]);
    expect(promptAssistanceInstructions).toContain("Keep sparse work sparse");
    expect(promptAssistanceInstructions).toContain("do not summarize");
    expect(() => validatePromptSuggestion("", { prompt: "" })).toThrow();
  });
  it("prices Luna input, cached input and output independently", () => {
    expect(tokenCostMicrousd("openai", "gpt-6-luna", { inputTokens: 1000, cachedInputTokens: 500, outputTokens: 200 })).toBe(155);
  });
  it("accepts only HTTPS Audiotool avatar hosts without credentials", () => {
    expect(safeAvatarUrl("https://www.audiotool.com/user/avatar.webp")).toBeTruthy();
    for (const value of ["https://audiotool.com.evil.test/a", "http://audiotool.com/a", "https://user:pass@audiotool.com/a", "data:image/svg+xml,a", "https://127.0.0.1/a"]) expect(safeAvatarUrl(value)).toBeNull();
  });
});
