import { describe, expect, it } from "vitest";
import { assertNativeModelCompletion, nativeCompletionDiagnostic, nativeOutputRecoveryBlocked } from "./model-completion.js";
import { nativePhaseOutputTokens, nativeRunLimits } from "./profile.js";

describe("response envelope and recovery", () => {
  it("uses the captured allowance before and after music, including explicit extensions", () => {
    for (const profile of ["standard", "extended"] as const) for (const maxOutputTokens of [16384, 32768, 65536]) {
      const limits = { ...nativeRunLimits(profile), maxOutputTokens };
      expect(nativePhaseOutputTokens(limits, false)).toBe(maxOutputTokens);
      expect(nativePhaseOutputTokens(limits, true)).toBe(maxOutputTokens);
    }
  });
  it("keeps bounded failure evidence without retaining content and requires a genuinely larger retry envelope", () => {
    const response = { content: "private response", response_metadata: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }, usage_metadata: { input_tokens: 400, output_tokens: 32768, total_tokens: 33168, output_token_details: { reasoning: 32000 } } };
    const diagnostic = nativeCompletionDiagnostic(response, 32768);
    expect(diagnostic).toEqual({ incomplete: true, reason: "max_output_tokens", outputLimit: 32768, outputTokens: 32768, reasoningTokens: 32000 });
    let stop = "";
    try { assertNativeModelCompletion(response, 32768); } catch (error) { stop = (error as Error).message; }
    expect(stop).toContain("output_limit=32768");
    expect(stop).not.toContain("private response");
    const limits = { ...nativeRunLimits("standard"), maxOutputTokens: 32768 };
    expect(nativeOutputRecoveryBlocked(stop, limits, true)).toBe(true);
    expect(nativeOutputRecoveryBlocked(stop, { ...limits, maxOutputTokens: 65536 }, true)).toBe(false);
    expect(nativeOutputRecoveryBlocked(stop.replace("max_output_tokens", "content_filter"), { ...limits, maxOutputTokens: 65536 }, true)).toBe(true);
    expect(nativeOutputRecoveryBlocked(stop.replace("output_limit=32768", "output_limit=unknown"), limits, true)).toBe(true);
  });
  it("offers explicit recovery from the known old hidden cap, not arbitrary unknown failures", () => {
    const stop = "OPENAI_INCOMPLETE_RESPONSE: increase the captured output allowance before continuing this confirmed draft";
    const limits = { ...nativeRunLimits("standard"), maxOutputTokens: 16384 };
    expect(nativeOutputRecoveryBlocked(stop, limits, true)).toBe(false);
    expect(nativeOutputRecoveryBlocked(stop, { ...limits, maxOutputTokens: 8192 }, true)).toBe(true);
    expect(nativeOutputRecoveryBlocked("OPENAI_INCOMPLETE_RESPONSE: unknown", limits, true)).toBe(true);
    expect(nativeOutputRecoveryBlocked("Other stop", limits, true)).toBe(false);
  });
  it("distinguishes length, content filtering and unknown incomplete responses", () => {
    expect(nativeCompletionDiagnostic({ response_metadata: { finish_reason: "length" } }).reason).toBe("max_output_tokens");
    expect(nativeCompletionDiagnostic({ response_metadata: { status: "incomplete", incomplete_details: { reason: "content_filter" } } }).reason).toBe("content_filter");
    expect(nativeCompletionDiagnostic({ response_metadata: { status: "incomplete" } }).reason).toBe("unknown");
    expect(() => assertNativeModelCompletion({ response_metadata: { status: "completed" } })).not.toThrow();
  });
});
