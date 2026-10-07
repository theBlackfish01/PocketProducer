import { describe, expect, it } from "vitest";
import { interpretNativeBrief, resolveNativePreservation } from "./intent.js";
import { applyNativeOperations } from "./model.js";
import { assertNativeModelCompletion, nativeCompletionIssues, seedNativeDocument } from "./producer.js";

const part = (id: string, role: "melody" | "bass" | "percussion" | "harmony") => ({ id, name: id, role, device: { type: "heisenberg" as const, parameters: {} }, gain: 0.6, pan: 0, notes: [{ id: `${id}-note`, startTick: 0, durationTicks: 960, pitch: 60, velocity: 0.7 }], placements: [], sourceRegions: [], effects: [], automation: [] });
const melody = applyNativeOperations(seedNativeDocument("A melody"), [{ kind: "removePart", partId: "starting-voice" }, { kind: "addPart", part: part("lead", "melody") }]);

describe("traceable native brief constraints", () => {
  it("keeps bar-list musical instructions advisory without inventing section names", () => {
    const base = structuredClone(melody);
    base.sections = [{ id: "return", name: "Return", startBar: 0, endBar: base.bars, intent: "Closing phrase" }];
    for (const scope of ["bars 13 and 15", "bars 13-15", "bars 13–15", "the missing section"]) {
      const direction = `Add melody in ${scope}`;
      expect(interpretNativeBrief(direction, base).sectionRequirements).toEqual([]);
      expect(nativeCompletionIssues(base, direction, "revision", [], base)).toEqual([]);
      expect(interpretNativeBrief(`No drums in ${scope}`, base)).toMatchObject({ excludedRoles: [], sectionExclusions: [], scopeIssues: [expect.stringContaining("not uniquely identifiable")] });
      const keep = resolveNativePreservation(`Keep melody in ${scope} unchanged`, base);
      expect(keep.namedParts).toEqual([]);
      expect(keep.unresolved).not.toHaveLength(0);
    }
  });
  it("resolves unique exact names and aligned bar spans, never a first substring match", () => {
    const base = structuredClone(melody);
    base.bars = 16;
    base.sections = [{ id: "first", name: "Bars 13", startBar: 0, endBar: 8, intent: "Opening" }, { id: "last", name: "Bars 13 Long", startBar: 8, endBar: 16, intent: "Closing" }];
    for (const scope of ['"Bars 13"', "BARS 13", "bars 1–8"]) {
      expect(resolveNativePreservation(`Keep melody in ${scope} unchanged`, base)).toMatchObject({ namedParts: [{ id: "lead", sectionId: "first" }], unresolved: [] });
    }
    expect(resolveNativePreservation('Keep melody in "Bars 13 Long" unchanged', base).namedParts[0]?.sectionId).toBe("last");
    expect(resolveNativePreservation("Keep melody in bars 13 and 15 unchanged", base).namedParts).toEqual([]);
    base.sections[1]!.name = "Bars 13";
    expect(resolveNativePreservation('Keep melody in "Bars 13" unchanged', base).unresolved).not.toHaveLength(0);
  });
  it("retains real locks when numeric composition guidance is present", () => {
    const changed = structuredClone(melody);
    changed.parts[0]!.notes[0]!.pitch++;
    const direction = "Add harmony in bars 13 and 15; keep melody unchanged";
    expect(nativeCompletionIssues(changed, direction, "revision", [], melody)).toContain("Requested preservation of lead was not met");
  });
  it("accepts actual requested edits for the complete Saffron revision wording", () => {
    const base = structuredClone(melody);
    base.bars = 16;
    base.sections = ["Opening", "Groove", "Lift", "Return"].map((name, i) => ({ id: name.toLowerCase(), name, startBar: i * 4, endBar: (i + 1) * 4, intent: "Musical development" }));
    base.parts.push(part("bass", "bass"), part("chords", "harmony"), part("drums", "percussion"));
    const changed = structuredClone(base);
    for (const id of ["bass", "chords", "lead"]) changed.parts.find(value => value.id === id)!.notes.push({ id: `${id}-ending`, startTick: 12 * 3840, durationTicks: 960, pitch: 69, velocity: 0.5 });
    changed.parts[0]!.notes.push({ id: "lift", startTick: 8 * 3840, durationTicks: 960, pitch: 72, velocity: 0.5 });
    changed.parts.find(value => value.id === "chords")!.gain = 0.5;
    const direction = "The Return section is currently empty. Add a sparse but audible ending in bars 13–16: bass roots on A and a gentle A-minor chord in bars 13 and 15, with a short final melody resolution to A. Also vary two or three melody notes in Lift and brighten its chord tone slightly. Add these things in but keep it coherent. Keep the same four parts and 16-bar structure.";
    expect(nativeCompletionIssues(changed, direction, "revision", [], base)).toEqual([]);
  });
  it("preserves names containing conjunctions and inherited keep directives", () => {
    const base = structuredClone(melody);
    base.parts[0]!.name = "Now and Then";
    expect(resolveNativePreservation('Keep part "Now and Then" unchanged', base).namedParts.map(value => value.id)).toEqual(["lead"]);
    expect(resolveNativePreservation("Keep Now and Then unchanged", base).namedParts.map(value => value.id)).toEqual(["lead"]);
    expect(interpretNativeBrief("Keep bass then melody unchanged").preservedRoles.map(value => value.label)).toEqual(["bass", "lead or melody"]);
  });
  it.each([null, "sketch"])("does not turn conversational coherence into preservation, scope %s", (sectionId) => {
    const direction = "I feel like it seems a little too simple. Maybe there should be a bit more oomph and some variation from section to section. Add more things in but keep it coherent\nConsider the Audiotool sample OFV Glass #1; inspect it before use.";
    expect(resolveNativePreservation(direction, melody, sectionId)).toEqual({ namedParts: [], theme: null, unresolved: [] });
    expect(resolveNativePreservation("Bring more layers in then keep it coherent", melody, sectionId).unresolved).toEqual([]);
  });
  it("permits recognizable-hook development without weakening exact bass or explicit theme locks", () => {
    const base = applyNativeOperations(melody, [{ kind: "addPart", part: part("bass", "bass") }]);
    const changed = applyNativeOperations(base, [{ kind: "replaceNotes", partId: "lead", notes: [{ ...base.parts[0]!.notes[0]!, pitch: 62 }] }]);
    const direction = "Change the lead notes. Keep its recognizable hook, but give the final bar a descending answer. Keep the bass exactly as it is.";
    expect(resolveNativePreservation(direction, base)).toMatchObject({ theme: null, unresolved: [], namedParts: [{ id: "bass" }] });
    expect(nativeCompletionIssues(changed, direction, "revision", [], base)).toEqual([]);
    expect(nativeCompletionIssues(changed, "Keep the hook unchanged", "revision", [], base)).toContain("Requested preservation of lead was not met");
    expect(interpretNativeBrief("Keep the melody recognizable").preservedRoles).toEqual([]);
    const wrongBass = applyNativeOperations(changed, [{ kind: "setMix", partId: "bass", gain: 0.2 }]);
    expect(nativeCompletionIssues(wrongBass, direction, "revision", [], base)).toContain("Requested preservation of bass was not met");
    const locked = applyNativeOperations(base, [{ kind: "protect", partIds: ["lead"], motifIds: [] }]);
    expect(() => applyNativeOperations(locked, [{ kind: "replaceNotes", partId: "lead", notes: changed.parts[0]!.notes }])).toThrow();
  });
  it("resolves trailing unchanged and retains genuine unknown-section errors", () => {
    const base = applyNativeOperations(melody, [{ kind: "setStructure", bars: 4, sections: [{ id: "intro", name: "Intro", startBar: 0, endBar: 4, intent: "" }] }]);
    expect(resolveNativePreservation("Keep the lead in the intro unchanged", base)).toMatchObject({ namedParts: [{ id: "lead", sectionId: "intro" }], unresolved: [] });
    expect(resolveNativePreservation("In the intro, keep the lead unchanged", base)).toMatchObject({ namedParts: [{ id: "lead", sectionId: "intro" }], unresolved: [] });
    expect(resolveNativePreservation("Keep the lead in the missing section unchanged", base, "intro").unresolved).toEqual(["Preserved section missing is not uniquely identifiable"]);
  });
  it("does not mistake explicitly named Identity or Character parts for qualitative guidance", () => {
    const base = applyNativeOperations(melody, [{ kind: "addPart", part: { ...part("identity", "harmony"), name: "Identity" } }, { kind: "addPart", part: { ...part("character", "bass"), name: "Character" } }]);
    expect(resolveNativePreservation('Keep part "Identity"; preserve part "Character"', base).namedParts.map(value => value.id)).toEqual(["identity", "character"]);
    expect(resolveNativePreservation("Keep the lead's character", base).namedParts).toEqual([]);
  });
  it("does not invent a section called four bars for a normal duration phrase", () => {
    const brief = interpretNativeBrief("A melody and bass in four bars");
    expect(brief.sectionRequirements).toEqual([]);
    expect(brief.requiredRoles.map((role) => role.label)).toEqual(["lead or melody", "bass"]);
  });
  it("does not mistake entering chords for a section named chords", () => {
    const brief = interpretNativeBrief("Start with pulse and haze, bring in chords and bass, break for a lead response, then return with a restrained coda");
    expect(brief.sectionRequirements).toEqual([]);
    expect(brief.requiredRoles.map((rule) => rule.label)).toEqual(expect.arrayContaining(["harmony", "bass", "lead or melody"]));
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
  it("applies one directive across coordinated roles and never reverses ordinary negation", () => {
    for (const wording of ["Do not change the bass.", "Don't touch the bass.", "Leave the bass unchanged."]) {
      const parsed = interpretNativeBrief(wording);
      expect(parsed.preservedRoles.map((rule) => rule.label), wording).toEqual(["bass"]);
      expect(parsed.changeRoles, wording).toEqual([]);
    }
    for (const wording of ["Thin the drums, but keep the melody and bass.", "Preserve bass and lead; simplify the drums."]) {
      const parsed = interpretNativeBrief(wording);
      expect(parsed.preservedRoles.map((rule) => rule.label).sort(), wording).toEqual(["bass", "lead or melody"]);
      expect(parsed.changeRoles.map((rule) => rule.label), wording).toEqual(["drums"]);
    }
    expect(interpretNativeBrief("Keep the melody and the bass unchanged.").preservedRoles.map((rule) => rule.label).sort()).toEqual(["bass", "lead or melody"]);
    expect(interpretNativeBrief("No drums or bass; write a melody.").excludedRoles.map((rule) => rule.label)).toEqual(["drums", "bass"]);
    expect(interpretNativeBrief("No drums or bass; write a melody.").requiredRoles.map((rule) => rule.label)).toEqual(["lead or melody"]);
  });
  it("rejects a wrong revised bass and unchanged drums, not just a wrong parse", () => {
    const base = applyNativeOperations(melody, [{ kind: "addPart", part: part("bass", "bass") }, { kind: "addPart", part: { ...part("drums", "percussion"), notes: [
      { id: "kick-one", startTick: 0, durationTicks: 240, pitch: 36, velocity: 0.8 },
      { id: "kick-two", startTick: 960, durationTicks: 240, pitch: 36, velocity: 0.8 },
      { id: "kick-three", startTick: 1920, durationTicks: 240, pitch: 36, velocity: 0.8 }
    ] } }]);
    const direction = "Thin the drums, but keep the melody and bass.";
    const changedBass = applyNativeOperations(base, [{ kind: "replaceNotes", partId: "bass", notes: [{ id: "bass-note", startTick: 0, durationTicks: 960, pitch: 48, velocity: 0.7 }] }]);
    expect(nativeCompletionIssues(changedBass, direction, "revision", [], base)).toEqual(expect.arrayContaining([
      "Requested preservation of bass was not met", "Requested change to drums was not constructed"
    ]));
    const merelyChangedDrumMix = applyNativeOperations(base, [{ kind: "setMix", partId: "drums", gain: 0.5 }]);
    expect(nativeCompletionIssues(merelyChangedDrumMix, direction, "revision", [], base)).toContain("Requested reduction of drums was not constructed");
    const thinner = applyNativeOperations(base, [{ kind: "replaceNotes", partId: "drums", notes: base.parts.find((item) => item.id === "drums")!.notes.slice(0, 2) }]);
    expect(nativeCompletionIssues(thinner, direction, "revision", [], base)).toEqual([]);
  });
  it("resolves an evidenced theme family and demands a local ambience feedback reduction", () => {
    const base = applyNativeOperations(seedNativeDocument("Two main sections"), [
      { kind: "setStructure", bars: 8, sections: [{ id: "first-main", name: "First Main", startBar: 0, endBar: 4, intent: "" }, { id: "second-main", name: "Second Main", startBar: 4, endBar: 8, intent: "" }] },
      { kind: "removePart", partId: "starting-voice" },
      { kind: "addPart", part: { ...part("drums", "percussion"), notes: [{ id: "hit-a", startTick: 15360, durationTicks: 240, pitch: 36, velocity: 0.8 }, { id: "hit-b", startTick: 16320, durationTicks: 240, pitch: 36, velocity: 0.8 }] } },
      { kind: "addPart", part: part("bass", "bass") },
      { kind: "addPart", part: { ...part("theme-lead", "melody"), notes: [], placements: [{ id: "theme-placement", motifId: "theme", startTick: 15360, repeats: 1, transpose: 0 }] } },
      { kind: "addPart", part: { ...part("pad", "harmony"), notes: [{ id: "pad-note", startTick: 15360, durationTicks: 960, pitch: 60, velocity: 0.7 }], effects: [{ id: "wash", type: "stompboxReverb" as const, parameters: { feedbackFactor: 0.8, mix: 0.4 } }] } },
      { kind: "defineMotif", motif: { id: "theme", partId: "theme-lead", name: "Main theme", lengthTicks: 3840, notes: [{ id: "phrase-note", startTick: 0, durationTicks: 960, pitch: 67, velocity: 0.75 }] } }
    ]);
    const direction = "Give this more space. Thin the drums, shorten the ambience, but keep the theme and bass.";
    const thinner = applyNativeOperations(base, [{ kind: "replaceNotes", partId: "drums", notes: base.parts.find((item) => item.id === "drums")!.notes.slice(0, 1) }, { kind: "setSectionEffectFeedback", partId: "pad", sectionId: "second-main", effectId: "wash", feedbackFactor: 0.35 }]);
    expect(nativeCompletionIssues(thinner, direction, "revision", [], base, "second-main")).toEqual([]);
    const wrongTheme = applyNativeOperations(thinner, [{ kind: "replaceMotif", motif: { ...thinner.motifs[0]!, notes: [{ ...thinner.motifs[0]!.notes[0]!, pitch: 68 }] } }]);
    expect(nativeCompletionIssues(wrongTheme, direction, "revision", [], base, "second-main")).toContain("Requested preservation of theme Main theme was not met");
    const noAmbience = applyNativeOperations(base, [{ kind: "replaceNotes", partId: "drums", notes: base.parts.find((item) => item.id === "drums")!.notes.slice(0, 1) }]);
    expect(nativeCompletionIssues(noAmbience, direction, "revision", [], base, "second-main")).toContain("Requested shorter ambience has no evidenced connected reverb/delay control reduction");
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
