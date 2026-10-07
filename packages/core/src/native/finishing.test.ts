import { expect, it } from "vitest";
import { needsNativeReviewResponse } from "./finishing.js";
import type { NativeReview } from "./critique.js";

const review: NativeReview = { documentHash: "a".repeat(64), musicHash: "b".repeat(64), modelUsed: true, verdict: "Review the ending", noChangeReason: null, findings: [{ priority: "high", sectionId: "return", partId: null, observation: "The requested final phrase is missing", suggestedChange: "Return the motif in the ending" }] };
it("requires a response once, with durable evidence surviving replay and metadata edits", () => {
  expect(needsNativeReviewResponse(review, [review], review.musicHash!)).toBe(true);
  const metadataReview = { ...review, documentHash: "c".repeat(64) };
  expect(needsNativeReviewResponse(metadataReview, [review, metadataReview], review.musicHash!)).toBe(true);
  const refined = { ...review, documentHash: "d".repeat(64), musicHash: "e".repeat(64) };
  expect(needsNativeReviewResponse(refined, [review, metadataReview, refined], refined.musicHash)).toBe(false);
});
it("does not invent a silence veto and retains the clean/low-priority fast path", () => {
  expect(needsNativeReviewResponse({ ...review, findings: [] }, [review], review.musicHash!)).toBe(false);
  expect(needsNativeReviewResponse({ ...review, findings: review.findings.map(value => ({ ...value, priority: "low" })) }, [review], review.musicHash!)).toBe(false);
  expect(needsNativeReviewResponse({ ...review, modelUsed: false }, [], review.musicHash!)).toBe(false);
});
