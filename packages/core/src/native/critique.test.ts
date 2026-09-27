import { describe, expect, it } from "vitest";
import { applyNativeOperations } from "./model.js";
import { seedNativeDocument } from "./producer.js";
import { nativeArcEvidence, nativePlanEvidenceIssues, symbolicNativeReview, validateNativeReview } from "./critique.js";
import { nativePlanSchema } from "./plan.js";
import { readNativeExample } from "./examples.js";
import { nativeFormOperations } from "./form.js";
import { nativeCompletionIssues } from "./producer.js";

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
  it("shows unresolved kit identity and repeated default tonal cores to the reviewer", () => {
    const weak = applyNativeOperations(seedNativeDocument("Synth and disco"), [
      ...["bass", "chords"].map((id) => ({ kind: "addPart" as const, part: { id, name: id, role: id === "bass" ? "bass" as const : "harmony" as const, device: { type: "heisenberg" as const, parameters: { "filter.cutoffFrequencyHz": id === "bass" ? 300 : 3000 } }, gain: 0.6, pan: 0, notes: [], placements: [], sourceRegions: [], effects: [], automation: [] } })),
    ]);
    // Pre-pinning historic scores remain readable even though new edits may
    // no longer introduce an unidentified Gakki sound.
    weak.parts.push({ ...weak.parts[0]!, id: "unresolved-kit", name: "Unresolved kit", role: "percussion", device: { type: "gakki", parameters: {} } });
    const review = symbolicNativeReview(weak, null);
    expect(review.soundWarnings).toEqual(expect.arrayContaining([expect.stringContaining("Unresolved Gakki"), expect.stringContaining("tonal core is identical")]));
    expect(review.soundEvidence.find((part) => part.id === "chords")?.patchParameters).toMatchObject({ "filter.cutoffFrequencyHz": 3000 });
  });
  it("does not let a repeated valid phrase satisfy a requested middle rise", () => {
    const brief = "Make a groove with a middle upswing and a payoff";
    const repeated = applyNativeOperations(seedNativeDocument(brief), [
      { kind: "setStructure", bars: 12, tempoBpm: 112, sections: [{ id: "opening", name: "Opening", startBar: 0, endBar: 4, intent: "Pulse" }, { id: "middle", name: "Middle", startBar: 4, endBar: 8, intent: "Rise" }, { id: "end", name: "End", startBar: 8, endBar: 12, intent: "Payoff" }] },
      { kind: "removePart", partId: "starting-voice" },
      { kind: "addPart", part: { id: "lead", name: "Lead", role: "lead", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, notes: [0, 4, 8].map((bar) => ({ id: `note-${bar}`, startTick: bar * 3840, durationTicks: 480, pitch: 60, velocity: 0.7 })), placements: [], sourceRegions: [], effects: [], automation: [] } }
    ]);
    expect(nativeArcEvidence(repeated).symbolicArcEvidenced).toBe(false);
    expect(nativeCompletionIssues(repeated, brief, "generation")).toEqual(expect.arrayContaining([expect.stringContaining("no independently evidenced middle contrast")]));
    const study = readNativeExample("disco-rise-study");
    const developed = applyNativeOperations(seedNativeDocument(brief), nativeFormOperations(study.form, []));
    expect(nativeArcEvidence(developed).symbolicArcEvidenced).toBe(true);
    expect(nativeCompletionIssues(developed, brief, "generation")).not.toEqual(expect.arrayContaining([expect.stringContaining("no independently evidenced middle contrast")]));
  });
});
