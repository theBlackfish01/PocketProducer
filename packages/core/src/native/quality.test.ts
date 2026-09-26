import { describe, expect, it } from "vitest";
import { nativeQualityCases, evaluateNativeQuality } from "./quality.js";
import { readNativeExample } from "./examples.js";
import { applyNativeOperations } from "./model.js";
import { nativeFormOperations } from "./form.js";
import { seedNativeDocument } from "./producer.js";

describe("fixed native quality-evaluation harness", () => {
  it("keeps distinct creative briefs and an explicit human-review gap", () => {
    expect(new Set(nativeQualityCases.map((item) => item.id)).size).toBe(7);
    expect(nativeQualityCases.map((item) => item.category)).toEqual(expect.arrayContaining(["sparse", "vague-with-arc", "sample-led", "detailed", "revision", "resource-constraint", "resource-fallback"]));
    const selected = nativeQualityCases.find((item) => item.id === "sparse-baseline")!;
    const example = readNativeExample("spare-answer");
    const document = applyNativeOperations(seedNativeDocument(selected.brief), nativeFormOperations(example.form, []));
    const report = evaluateNativeQuality({ caseId: selected.id, direction: selected.brief, document });
    expect(report.caseMatch).toBe(true);
    expect(report.documentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(report.structure.sections).toBeGreaterThan(1);
    expect(Object.values(report.humanReview)).toEqual([null, null, null, null, null]);
    expect(evaluateNativeQuality({ caseId: selected.id, direction: "Different direction", document }).caseMatch).toBe(false);
  });
});
