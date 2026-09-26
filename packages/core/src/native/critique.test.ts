import { describe, expect, it } from "vitest";
import { applyNativeOperations } from "./model.js";
import { seedNativeDocument } from "./producer.js";
import { nativePlanEvidenceIssues, symbolicNativeReview, validateNativeReview } from "./critique.js";
import { nativePlanSchema } from "./plan.js";

describe("grounded symbolic editor", () => {
  const document = applyNativeOperations(seedNativeDocument("A quiet answer"), [
    { kind: "replaceNotes", partId: "starting-voice", notes: [{ id: "question", startTick: 0, durationTicks: 960, pitch: 64, velocity: 0.6 }] }
  ]);
  const plan = nativePlanSchema.parse({
    intent: "Sparse phrase and answer", sections: [{ name: "Opening", purpose: "State one phrase" }],
    soundGoals: ["Soft lead"], hardConstraints: ["Sparse"], developmentTasks: ["Write response"],
    creativeState: { identity: "Quiet", evidenceLinks: [{ promise: "Opening phrase", partId: "starting-voice", firstBar: 0, lastBar: 4 }] }
  });

  it("binds findings to real IDs and the exact document hash", () => {
    const summary = symbolicNativeReview(document, plan);
    expect(summary.sections.length).toBeGreaterThan(0);
    expect(summary.evidenceIssues).toEqual([]);
    const review = validateNativeReview({ verdict: "The single phrase leaves room for development.", findings: [{ priority: "medium", sectionId: document.sections[0]!.id, partId: "starting-voice", observation: "The response is absent.", suggestedChange: "Add an answering note in the later bars." }], noChangeReason: null }, document, true);
    expect(review.documentHash).toBe(summary.documentHash);
    expect(review.modelUsed).toBe(true);
    expect(() => validateNativeReview({ ...review, findings: [{ ...review.findings[0], partId: "imaginary" }] }, document, true)).toThrow(/nonexistent part/);
  });

  it("rejects unsupported promise links instead of treating prose as score evidence", () => {
    const bad = nativePlanSchema.parse({ ...plan, creativeState: { ...plan.creativeState, evidenceLinks: [{ promise: "Bass enters", partId: "missing-bass", firstBar: 0, lastBar: document.bars + 1 }] } });
    expect(nativePlanEvidenceIssues(bad, document)).toEqual(expect.arrayContaining([expect.stringContaining("missing part"), expect.stringContaining("invalid bar range")]));
  });
});
