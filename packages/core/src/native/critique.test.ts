import { describe, expect, it } from "vitest";
import { applyNativeOperations } from "./model.js";
import { seedNativeDocument } from "./producer.js";
import { nativeArcEvidence, nativePlanEvidenceIssues, symbolicNativeReview, validateNativeReview } from "./critique.js";
import { nativePlanSchema } from "./plan.js";
import { readNativeExample } from "./examples.js";
import { nativeFormOperations } from "./form.js";
import { nativeCompletionIssues } from "./producer.js";
import { compactNativeReviewEvidence } from "./review-evidence.js";
import { capturedBrief } from "../test-support.js";

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
  it("reports section-local automation even when a ramp has no point inside the section", () => {
    const score = structuredClone(document);
    score.sections = [
      { id: "opening", name: "Opening", startBar: 0, endBar: 1, intent: "Start" },
      { id: "middle", name: "Middle", startBar: 1, endBar: 2, intent: "Open tone" },
      { id: "end", name: "End", startBar: 2, endBar: score.bars, intent: "Return" }
    ];
    score.parts[0]!.automation = [{ id: "tone", target: "gain", points: [{ tick: 0, value: 0.1, interpolation: "linear" }, { tick: 11520, value: 0.7 }] }];
    const middle = symbolicNativeReview(score, null).sections[1]!.parts[0]!.automation[0]!;
    expect(middle.first).toBeCloseTo(0.3);
    expect(middle.last).toBeCloseTo(0.5, 3);
    expect(middle.points.map((point) => point.tick)).toEqual([0, 11520]);
    expect(middle.exactBoundaryValues).toBe(true);
    score.parts[0]!.automation[0]!.points[0]!.interpolation = "sloped";
    const sloped = symbolicNativeReview(score, null).sections[1]!.parts[0]!.automation[0]!;
    expect(sloped.first).toBeNull();
    expect(sloped.exactBoundaryValues).toBe(false);
    // A step exactly at the next section belongs to that section, not this one.
    score.parts[0]!.automation[0]!.points = [{ tick: 0, value: 0.2 }, { tick: 7680, value: 0.8 }];
    expect(symbolicNativeReview(score, null).sections[1]!.parts[0]!.automation[0]!.last).toBe(0.2);
  });
  it("labels partial previews and supplies complete bounded drum timing across both bars", () => {
    const score = structuredClone(document);
    score.meter = { numerator: 3, denominator: 4 };
    const part = score.parts[0]!;
    part.role = "percussion";
    part.notes = Array.from({ length: 12 }, (_, i) => ({ id: `hit-${i}`, startTick: i * 480, durationTicks: 240, pitch: i % 3 === 2 ? 38 : 42, velocity: 1 }));
    const summary = symbolicNativeReview(score, null);
    const facts = summary.sections[0]!.parts[0]!;
    expect(summary.timing).toMatchObject({ meter: { numerator: 3, denominator: 4 }, ticksPerQuarter: 960, ticksPerBar: 2880 });
    expect(facts.onsetPreview).toHaveLength(8);
    expect(facts.omittedPreviewOnsets).toBe(4);
    expect(facts.finalOnsets.at(-1)).toEqual([5280, 38, 1, 240]);
    expect(facts.rhythmWindow).toMatchObject({ startTick: 0, endTick: 5760, totalOnsets: 12, omittedOnsets: 0 });
    expect(facts.rhythmWindow!.notes.filter(note => note[1] === 38).map(note => note[0])).toEqual([960, 2400, 3840, 5280]);
    // Dense excerpts remain bounded and explicitly incomplete, never claimed
    // as a full pattern. Tail duplication is called out in the wire contract.
    part.notes = Array.from({ length: 48 }, (_, i) => ({ id: `dense-${i}`, startTick: i * 120, durationTicks: 120, pitch: 42, velocity: 1 }));
    const dense = symbolicNativeReview(score, null).sections[0]!.parts[0]!;
    expect(dense.rhythmWindow!.notes).toHaveLength(32);
    expect(dense.rhythmWindow!.omittedOnsets).toBe(16);
    expect(summary.timing.previewCoverage).toContain("not additional notes");
  });
  it("distinguishes crossing source clips and sustained notes from automation-only activity at every evidence tier", () => {
    const score = structuredClone(document);
    score.sections = [{ id: "opening", name: "Opening", startBar: 0, endBar: 1, intent: "" }, { id: "middle", name: "Middle", startBar: 1, endBar: 2, intent: "" }, { id: "end", name: "End", startBar: 2, endBar: 4, intent: "" }];
    score.parts[0]!.notes[0]!.durationTicks = 6000;
    score.parts.push({ ...structuredClone(score.parts[0]!), id: "recording", name: "Recording", role: "source", device: { type: "audio", parameters: {} }, notes: [], sourceRegions: [{ id: "slice", assetId: "00000000-0000-4000-8000-000000000001", assetHash: "a".repeat(64), startTick: 3000, durationTicks: 1800, sourceStartSeconds: 1.5, sourceDurationSeconds: 0.375, gain: 0.2, rights: "Owned", playbackMode: "once" }] });
    score.parts[0]!.automation = [{ id: "gain", target: "gain", points: [{ tick: 0, value: 0.5 }, { tick: 15359, value: 0.5 }] }];
    const review = symbolicNativeReview(score, null);
    const middle = review.sections[1]!;
    expect(middle.parts.find(part => part.id === "starting-voice")).toMatchObject({ newOnsets: 0, soundingNotes: 1 });
    const clip = middle.parts.find(part => part.id === "recording")!;
    expect(clip).toMatchObject({ newOnsets: 0, clips: 1, clipIntervals: [{ id: "slice", startTick: -840, endTick: 960, sourceStartSeconds: 1.5 }], omittedClipIntervals: 0 });
    expect(review.emptySections).toEqual(["end"]);
    expect(review.sections[2]!.parts.some(part => part.id === "recording")).toBe(false);
    for (const minimal of [false, true]) {
      const compact = compactNativeReviewEvidence(review, minimal);
      const row = compact.sections[1]!.parts.find(part => part[0] === "recording")!;
      expect(row[compact.evidenceLayout.part.indexOf("clipIntervals")]).toEqual(clip.clipIntervals);
      expect(compact.timing.clipTiming).toContain("Clips need no MIDI onsets");
    }
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
    const captured = capturedBrief(brief, { construction: [{ kind: "rise", quote: "a middle upswing and a payoff" }] });
    expect(nativeCompletionIssues(repeated, captured, "generation")).toEqual(expect.arrayContaining([expect.stringContaining("no independently evidenced middle contrast")]));
    const study = readNativeExample("disco-rise-study");
    const developed = applyNativeOperations(seedNativeDocument(brief), nativeFormOperations(study.form, []));
    expect(nativeArcEvidence(developed).symbolicArcEvidenced).toBe(true);
    expect(nativeCompletionIssues(developed, captured, "generation")).not.toEqual(expect.arrayContaining([expect.stringContaining("no independently evidenced middle contrast")]));
  });
});
