import { describe, expect, it } from "vitest";
import { nativeRunLimits, nativeRunLimitsSchema, nativeSampleAnalysisLimit } from "./profile.js";

describe("captured source-listening allowance", () => {
  it("keeps a short Standard shortlist and a bounded Extended allowance", () => {
    const standard = nativeRunLimits("standard");
    const extended = nativeRunLimits("extended");
    expect(nativeSampleAnalysisLimit(standard)).toBe(2);
    expect(nativeSampleAnalysisLimit(extended)).toBe(3);
    expect(nativeSampleAnalysisLimit(nativeRunLimitsSchema.parse({ ...standard, maxSampleAnalyses: undefined }))).toBe(2);
    expect(() => nativeRunLimitsSchema.parse({ ...standard, maxSampleAnalyses: 7 })).toThrow();
  });
});
