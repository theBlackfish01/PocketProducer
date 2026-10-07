import type { NativeReview } from "./critique.js";

// Review history is append-only and survives plan/metadata edits and restarts.
// Only an actual musical change after actionable feedback consumes the one
// refinement opportunity. Old reviews without music hashes remain readable;
// they can be explicitly accepted but cannot prove that refinement happened.
export function needsNativeReviewResponse(review: NativeReview, history: NativeReview[], musicHash: string): boolean {
  if (!review.modelUsed || !review.findings.some(finding => finding.priority !== "low")) return false;
  const first = history.find(value => value.modelUsed && value.findings.some(finding => finding.priority !== "low"));
  return !first?.musicHash || first.musicHash === musicHash;
}

export const nativeReviewResponseGuidance = "Respond to the current review: correct the most important requested omission in one focused edit, then finish for a fresh review; or call finish_native_arrangement with acceptRemainingSuggestions:true to save this reviewed version as best effort. Preserve deliberate silence and existing protections. Do not repeat inspections or polish indefinitely.";
