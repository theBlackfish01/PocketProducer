import { describe, expect, it } from "vitest";
import { interpretNativeBrief } from "./intent.js";
import { applyNativeOperations } from "./model.js";
import { assertNativeModelCompletion, nativeCompletionIssues, seedNativeDocument } from "./producer.js";

const part = (id: string, role: "melody" | "bass" | "percussion" | "harmony") => ({ id, name: id, role, device: { type: "heisenberg" as const, parameters: {} }, gain: 0.6, pan: 0, notes: [{ id: `${id}-note`, startTick: 0, durationTicks: 960, pitch: 60, velocity: 0.7 }], placements: [], sourceRegions: [], effects: [], automation: [] });
const melody = applyNativeOperations(seedNativeDocument("A melody"), [{ kind: "removePart", partId: "starting-voice" }, { kind: "addPart", part: part("lead", "melody") }]);

describe("traceable native brief constraints", () => {
  it("does not invent a section called four bars for a normal duration phrase", () => {
    const brief = interpretNativeBrief("A melody and bass in four bars");
    expect(brief.sectionRequirements).toEqual([]);
    expect(brief.requiredRoles.map((role) => role.label)).toEqual(["lead or melody", "bass"]);
  });
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
    expect(brief.sectionRequirements).toEqual([{ section: "chorus", label: "drums", matches: ["percussion"] }]);
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
  it("distinguishes preservation, conjunction and local scope with traceable evidence", () => {
    const keep = interpretNativeBrief("Make the melody brighter without changing the bass.");
    expect(keep.excludedRoles).toEqual([]);
    expect(keep.preservedRoles).toEqual([{ label: "bass", matches: ["bass"] }]);
    expect(keep.changeRoles).toEqual([{ label: "lead or melody", matches: ["lead", "melody"] }]);
    expect(keep.requirements[1]?.evidence.text).toContain("bass");
    const joined = interpretNativeBrief("Create a melody with no drums, and include bass.");
    expect(joined.excludedRoles).toEqual([{ label: "drums", matches: ["percussion"] }]);
    expect(joined.requiredRoles).toEqual(expect.arrayContaining([{ label: "bass", matches: ["bass"] }, { label: "lead or melody", matches: ["lead", "melody"] }]));
    for (const text of ["In the intro, no drums; bring drums in for the chorus.", "No drums in the intro, keep it quiet; bring drums in for the chorus."]) {
      const parsed = interpretNativeBrief(text);
      expect(parsed.excludedRoles).toEqual([]);
      expect(parsed.sectionExclusions).toEqual([{ section: "intro", label: "drums", matches: ["percussion"] }]);
      expect(parsed.sectionRequirements).toEqual([{ section: "chorus", label: "drums", matches: ["percussion"] }]);
    }
  });
  it("preserves only the requested section of a role while allowing a later change", () => {
    const base = applyNativeOperations(melody, [{ kind: "setStructure", bars: 8, sections: [{ id: "intro", name: "Intro", startBar: 0, endBar: 4, intent: "" }, { id: "chorus", name: "Chorus", startBar: 4, endBar: 8, intent: "" }] }, { kind: "addNotes", partId: "lead", notes: [{ id: "late", startTick: 15360, durationTicks: 960, pitch: 67, velocity: 0.7 }] }]);
    const direction = "Keep the melody in the intro; change the melody in the chorus.";
    expect(interpretNativeBrief(direction).sectionPreservations).toEqual([{ section: "intro", label: "lead or melody", matches: ["lead", "melody"] }]);
    const later = applyNativeOperations(base, [{ kind: "developSectionNotes", partId: "lead", sectionId: "chorus", pitchShiftSemitones: 2 }]);
    expect(nativeCompletionIssues(later, direction, "revision", [], base)).toEqual([]);
    const earlier = applyNativeOperations(later, [{ kind: "developSectionNotes", partId: "lead", sectionId: "intro", pitchShiftSemitones: 2 }]);
    expect(nativeCompletionIssues(earlier, direction, "revision", [], base)).toContain("Requested preservation of lead in Intro was not met");
  });
  it("requires an explicitly spelled chord chain in ordered constructed pitches, not a plan claim", () => {
    const direction = "Start with Dm9–Bbmaj7–Fmaj9–Cadd9, then develop the theme";
    expect(interpretNativeBrief(direction).chordProgressions).toEqual([["Dm9", "Bbmaj7", "Fmaj9", "Cadd9"]]);
    expect(interpretNativeBrief("Maybe a Cadd9 color later").chordProgressions).toEqual([]);
    const pitches = [[62, 65, 72, 76], [58, 62, 69], [53, 57, 64, 67], [60, 64, 74]];
    const notes = pitches.flatMap((chord, bar) => chord.map((pitch, index) => ({ id: `chord-${bar}-${index}`, startTick: bar * 3840, durationTicks: 2880, pitch, velocity: 0.65 })));
    const built = applyNativeOperations(melody, [{ kind: "addPart", part: part("chords", "harmony") }, { kind: "replaceNotes", partId: "chords", notes }]);
    expect(nativeCompletionIssues(built, direction, "generation")).toEqual([]);
    const wrong = applyNativeOperations(built, [{ kind: "replaceNotes", partId: "chords", notes: notes.map((note) => note.id === "chord-2-2" ? { ...note, pitch: 63 } : note) }]);
    expect(nativeCompletionIssues(wrong, direction, "generation")).toContain("Requested chord progression Dm9–Bbmaj7–Fmaj9–Cadd9 is not evidenced in ordered harmony/bass pitches");
  });
  it("rejects incomplete model turns before partial tool arguments are dispatched", () => {
    expect(() => assertNativeModelCompletion({ response_metadata: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }, tool_calls: [{ name: "apply_native_batch" }] })).toThrow("OPENAI_INCOMPLETE_RESPONSE");
    expect(() => assertNativeModelCompletion({ response_metadata: { finish_reason: "stop" } })).not.toThrow();
  });
});
