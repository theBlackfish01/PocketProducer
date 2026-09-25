import { describe, expect, it } from "vitest";
import { interpretNativeBrief } from "./intent.js";
import { applyNativeOperations } from "./model.js";
import { assertNativeModelCompletion, nativeCompletionIssues, seedNativeDocument } from "./producer.js";

const part = (id: string, role: "melody" | "bass" | "percussion") => ({ id, name: id, role, device: { type: "heisenberg" as const, parameters: {} }, gain: 0.6, pan: 0, notes: [{ id: `${id}-note`, startTick: 0, durationTicks: 960, pitch: 60, velocity: 0.7 }], placements: [], sourceRegions: [], effects: [], automation: [] });
const melody = applyNativeOperations(seedNativeDocument("A melody"), [{ kind: "removePart", partId: "starting-voice" }, { kind: "addPart", part: part("lead", "melody") }]);

describe("traceable native brief constraints", () => {
  it("accepts explicit exclusions without requesting the excluded roles", () => {
    expect(interpretNativeBrief("Do not use drums; write a 4-bar melody").requiredRoles).toEqual([{ label: "lead or melody", matches: ["lead", "melody"] }]);
    expect(interpretNativeBrief("Make a 4-bar melody with no drums and no bass")).toMatchObject({ totalBars: 4, excludedRoles: [{ label: "drums" }, { label: "bass" }] });
    expect(nativeCompletionIssues(melody, "Make a 4-bar melody with no drums and no bass", "generation")).toEqual([]);
    const forbidden = applyNativeOperations(melody, [{ kind: "addPart", part: part("drums", "percussion") }]);
    expect(nativeCompletionIssues(forbidden, "A melody without drums", "generation")).toContain("Excluded drums has constructed material");
  });
  it("keeps a localized intro exclusion separate from a later positive request", () => {
    const brief = interpretNativeBrief("No drums in intro; bring drums in chorus");
    expect(brief.excludedRoles).toEqual([]);
    expect(brief.sectionExclusions).toEqual([{ section: "intro", label: "drums", matches: ["percussion"] }]);
    expect(brief.requiredRoles).toEqual([{ label: "drums", matches: ["percussion"] }]);
    const structure = [{ id: "intro", name: "Intro", startBar: 0, endBar: 1, intent: "Quiet" }, { id: "chorus", name: "Chorus", startBar: 1, endBar: 4, intent: "Drums arrive" }];
    const introDrums = applyNativeOperations(melody, [{ kind: "setStructure", bars: 4, sections: structure }, { kind: "addPart", part: part("drums", "percussion") }]);
    expect(nativeCompletionIssues(introDrums, "No drums in intro; bring drums in chorus", "generation")).toContain("Excluded drums has constructed material in Intro");
    const chorusDrums = applyNativeOperations(introDrums, [{ kind: "replaceNotes", partId: "drums", notes: [{ id: "chorus-hit", startTick: 3840, durationTicks: 960, pitch: 36, velocity: 0.7 }] }]);
    expect(nativeCompletionIssues(chorusDrums, "No drums in intro; bring drums in chorus", "generation")).toEqual([]);
  });
  it("distinguishes total duration from section lengths and leaves ambiguous totals advisory", () => {
    const long = applyNativeOperations(melody, [{ kind: "setStructure", bars: 32, sections: [{ id: "intro", name: "Intro", startBar: 0, endBar: 4, intent: "Quiet" }, { id: "body", name: "Body", startBar: 4, endBar: 32, intent: "Develop" }] }]);
    expect(interpretNativeBrief("Start with a 4-bar intro, then develop a 32-bar melody in total").totalBars).toBe(32);
    expect(nativeCompletionIssues(long, "Start with a 4-bar intro, then develop a 32-bar melody in total", "generation")).toEqual([]);
    expect(interpretNativeBrief("A 4-bar intro and an 8-bar verse")).toMatchObject({ totalBars: null, advisory: [expect.stringContaining("Several section lengths")] });
  });
  it("requires a positive ensemble, treats optional roles as optional and keeps the empty-sketch guard", () => {
    expect(nativeCompletionIssues(melody, "A 4-bar melody with bass and drums", "generation")).toEqual(expect.arrayContaining(["Requested bass has no constructed material", "Requested drums has no constructed material"]));
    expect(nativeCompletionIssues(melody, "A melody, maybe add bass if useful", "generation")).toEqual([]);
    expect(nativeCompletionIssues(melody, "Something intimate and evolving", "generation")).toEqual([]);
    expect(nativeCompletionIssues(seedNativeDocument("Something intimate"), "Something intimate", "generation")).toContain("The starting sketch was not replaced");
    expect(nativeCompletionIssues(melody, "Simplify the drums", "revision")).toEqual([]);
  });
  it("rejects incomplete model turns before partial tool arguments are dispatched", () => {
    expect(() => assertNativeModelCompletion({ response_metadata: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }, tool_calls: [{ name: "apply_native_batch" }] })).toThrow("OPENAI_INCOMPLETE_RESPONSE");
    expect(() => assertNativeModelCompletion({ response_metadata: { finish_reason: "stop" } })).not.toThrow();
  });
});
