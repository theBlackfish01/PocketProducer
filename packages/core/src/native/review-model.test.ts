import { expect, it } from "vitest";
import { parseNativeReview, nativeReviewResponseFormat } from "./review-model.js";
import { seedNativeDocument } from "./producer.js";
import { nativePlanSchema, nativeReviewPlanHash } from "./plan.js";

it("publishes the critic's existing field limits as a strict response contract", () => {
  const schema = nativeReviewResponseFormat.json_schema.schema as { additionalProperties: boolean; required: string[]; properties: Record<string, { maxLength?: number; items?: { properties: Record<string, { maxLength: number }> } }> };
  expect(nativeReviewResponseFormat.json_schema.strict).toBe(true);
  expect(schema.additionalProperties).toBe(false);
  expect(schema.required).toEqual(["verdict", "findings", "noChangeReason"]);
  expect(schema.properties.verdict!.maxLength).toBe(360);
  expect(schema.properties.findings!.items!.properties.observation!.maxLength).toBe(300);
  const document = seedNativeDocument("A quiet motif");
  expect(parseNativeReview(JSON.stringify({ verdict: "Specific assessment", findings: [], noChangeReason: "x".repeat(301) }), document, "stop").diagnostic?.paths).toContain("noChangeReason");
});

it("diagnoses format, truncation and invalid musical references without blessing fallback", () => {
  const document = seedNativeDocument("A quiet motif");
  const good = { verdict: "A sparse symbolic score.", findings: [], noChangeReason: "The intended space is present." };
  expect(parseNativeReview("```json\n" + JSON.stringify(good) + "\n```", document, "stop").review?.modelUsed).toBe(true);
  expect(parseNativeReview("{", document, "stop").diagnostic?.code).toBe("invalid_json");
  expect(parseNativeReview(JSON.stringify({ ...good, noChangeReason: null }), document, "stop").diagnostic).toMatchObject({ code: "invalid_schema", paths: ["noChangeReason"] });
  expect(parseNativeReview(JSON.stringify(good), document, "length").diagnostic?.code).toBe("truncated");
  expect(parseNativeReview(JSON.stringify({ verdict: "Valid words" }), document, "stop").diagnostic).toMatchObject({ code: "invalid_schema", paths: ["findings", "noChangeReason"] });
  expect(parseNativeReview(JSON.stringify({ ...good, findings: [{ priority: "high", partId: "invented", sectionId: null, observation: "Needs change", suggestedChange: "Change notes" }] }), document, "stop").diagnostic?.code).toBe("invalid_reference");
});

it("distinguishes review-relevant intent from task and discovery bookkeeping", () => {
  const plan = nativePlanSchema.parse({ intent: "A sparse phrase", sections: [{ name: "Opening", purpose: "State the motif" }], soundGoals: ["Warm lead"], hardConstraints: ["Keep bass"], developmentTasks: ["A lower answer"], creativeState: { identity: "Quiet" } });
  const bookkeeping = nativePlanSchema.parse({ ...plan, creativeState: { ...plan.creativeState, guidanceRefs: ["one"], unfinishedTasks: [], definiteFailures: ["lookup failed"], evidenceLinks: [{ promise: "Motif" }] } });
  expect(nativeReviewPlanHash(bookkeeping)).toBe(nativeReviewPlanHash(plan));
  const withoutState = { ...plan, creativeState: undefined };
  const newlyIndexed = nativePlanSchema.parse({ ...withoutState, creativeState: { guidanceRefs: ["read"] } });
  expect(nativeReviewPlanHash(newlyIndexed)).toBe(nativeReviewPlanHash(withoutState));
  expect(nativeReviewPlanHash({ ...plan, hardConstraints: ["No bass"] })).not.toBe(nativeReviewPlanHash(plan));
  expect(nativeReviewPlanHash(nativePlanSchema.parse({ ...plan, creativeState: { ...plan.creativeState, decisions: ["Double the density"] } }))).not.toBe(nativeReviewPlanHash(plan));
});
