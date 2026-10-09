import { describe, expect, it } from "vitest";
import { captureNativeBrief, emptyNativeBrief, jobNativeBrief, nativeBriefChecks, nativeBriefPreservation } from "./brief.js";
import { applyNativeOperations } from "./model.js";
import { assertNativeModelCompletion, nativeCompletionIssues, seedNativeDocument } from "./producer.js";
import { briefKeep, briefRole, briefSection, capturedBrief } from "../test-support.js";

const part = (id: string, role: "melody" | "bass" | "percussion" | "harmony") => ({ id, name: id, role, device: { type: "heisenberg" as const, parameters: {} }, gain: 0.6, pan: 0, notes: [{ id: `${id}-note`, startTick: 0, durationTicks: 960, pitch: 60, velocity: 0.7 }], placements: [], sourceRegions: [], effects: [], automation: [] });
const melody = applyNativeOperations(seedNativeDocument("A melody"), [{ kind: "removePart", partId: "starting-voice" }, { kind: "addPart", part: part("lead", "melody") }]);
const empty = { totalBars: null, tempoBpm: null, meter: null, sections: [], chordProgressions: [], roles: [], keep: [], construction: [], guidance: [] };

describe("captured brief validation", () => {
  it("accepts only the user's own words, written numbers and real identities", () => {
    const base = applyNativeOperations(melody, [{ kind: "setStructure", bars: 8, sections: [{ id: "intro", name: "Intro", startBar: 0, endBar: 4, intent: "" }, { id: "chorus", name: "Chorus", startBar: 4, endBar: 8, intent: "" }] }]);
    const direction = "Keep the lead in the intro unchanged, at 96 BPM, sixteen bars in total.";
    const brief = capturedBrief(direction, {
      tempoBpm: { value: 96, quote: "at 96 BPM" },
      totalBars: { value: 16, quote: "sixteen bars in total" },
      keep: [briefKeep("Keep the lead in the intro unchanged", { partId: "lead" }, "intro")]
    }, base);
    expect(brief).toMatchObject({ tempoBpm: { value: 96 }, totalBars: { value: 16 }, keep: [{ partId: "lead", section: { sectionId: "intro", name: "Intro" } }], rejected: [] });
    const invented = capturedBrief(direction, {
      tempoBpm: { value: 120, quote: "at 96 BPM" },
      meter: { numerator: 3, denominator: 4, quote: "a waltz" },
      keep: [briefKeep("Keep the lead in the intro unchanged", { partId: "pad" }), briefKeep("Keep the bass", { partId: "lead" })]
    }, base);
    expect(invented).toMatchObject({ tempoBpm: null, meter: null, keep: [] });
    expect(invented.rejected.map((item) => item.reason)).toEqual(["120 BPM is not written there", "These words are not in your direction", "This arrangement has no part by that name", "These words are not in your direction"]);
    // An unreadable item is shown with its words; it never discards the rest.
    expect(captureNativeBrief({ ...empty, tempoBpm: { value: 96, quote: "at 96 BPM" }, roles: [{ kind: "keep", role: "bass", quote: "x" }] }, { direction, document: base, baseRevisionId: null, targetSectionId: null, provenance: "scripted" })).toMatchObject({ tempoBpm: { value: 96 }, rejected: [{ quote: "x", reason: "This instruction could not be read as a check" }] });
    expect(() => captureNativeBrief("not an interpretation", { direction, document: base, baseRevisionId: null, targetSectionId: null, provenance: "scripted" })).toThrow();
  });

  it("reads a proposal item by item, so one out-of-range or surplus item never voids the check", () => {
    const direction = "A 300 BPM rush, 32 bars in total, with a vamp: Am, G. Keep it bright, airy, loose, warm, fun, light, gentle, soft, wide, close, clean, crisp, round, deep, dark, odd and short";
    const notes = "bright, airy, loose, warm, fun, light, gentle, soft, wide, close, clean, crisp, round, deep, dark, odd, short".split(", ");
    const brief = capturedBrief(direction, {
      tempoBpm: { value: 300, quote: "A 300 BPM rush" },
      totalBars: { value: 32, quote: "32 bars in total" },
      chordProgressions: [{ chords: ["Am", "G"], quote: "a vamp: Am, G" }],
      guidance: notes.map((word) => ({ quote: word, reason: `${word} `.repeat(60) }))
    });
    expect(brief).toMatchObject({ tempoBpm: null, totalBars: { value: 32 }, chordProgressions: [] });
    expect(brief.guidance).toHaveLength(16);
    expect(brief.guidance.every((item) => item.reason.length <= 200)).toBe(true);
    expect(brief.rejected).toEqual([
      { quote: "A 300 BPM rush", reason: "Only tempos of 40–220 BPM can be checked" },
      { quote: "a vamp: Am, G", reason: "Only progressions of 3–16 named chords can be checked" },
      { quote: "short", reason: "Too many items of this kind to check; this one is not enforced" }
    ]);
  });

  it("stores at most 64 guidance and rejected notes instead of failing the capture", () => {
    const direction = Array.from({ length: 30 }, (_, index) => `keep layer ${index} unchanged`).join(". ");
    // A new piece has nothing to keep: keep and preserve items soften to guidance.
    const keep = Array.from({ length: 24 }, (_, index) => briefKeep(`keep layer ${index} unchanged`, { partId: `layer-${index}` }));
    const roles = Array.from({ length: 24 }, (_, index) => briefRole("preserve", "bass", `keep layer ${index} unchanged`));
    const guidance = Array.from({ length: 16 }, (_, index) => ({ quote: `keep layer ${index} unchanged`, reason: "Soft" }));
    const unreadableRoles = Array.from({ length: 70 }, (_, index) => ({ kind: "keep", role: "bass", quote: `layer ${index}`, section: null, reduceDensity: false }));
    const brief = captureNativeBrief({ ...empty, keep, roles: [...roles, ...unreadableRoles], guidance }, { direction, document: null, baseRevisionId: null, targetSectionId: null, provenance: "scripted" });
    expect(brief.guidance).toHaveLength(64);
    expect(brief.rejected).toHaveLength(64);
  });

  it("turns an unmatched section into a confirmable rejection, never a hidden lock", () => {
    const base = structuredClone(melody);
    base.sections = [{ id: "return", name: "Return", startBar: 0, endBar: base.bars, intent: "Closing phrase" }];
    // The "leave room for the pad" failure: a misread as "keep a section called pad".
    const direction = "Add a soft answer and leave room for the pad";
    const misread = capturedBrief(direction, { keep: [briefKeep("leave room for the pad", { partId: "lead" }, "pad")] }, base);
    expect(misread.keep).toEqual([]);
    expect(misread.rejected).toEqual([{ quote: "leave room for the pad", reason: "This arrangement has no single section by that name" }]);
    expect(nativeCompletionIssues(base, misread, "revision", [], base)).toEqual([]);
    const read = capturedBrief(direction, { guidance: [{ quote: "leave room for the pad", reason: "Space for a part, not a lock" }] }, base);
    expect(read).toMatchObject({ keep: [], rejected: [], guidance: [{ quote: "leave room for the pad" }] });
    for (const scope of ["bars 13 and 15", "the missing section"]) {
      const brief = capturedBrief(`No drums in ${scope}`, { roles: [briefRole("absent", "drums", `No drums in ${scope}`, scope)] }, base);
      expect(brief.roles).toEqual([]);
      expect(brief.rejected).toHaveLength(1);
    }
  });

  it("resolves sections by unique exact name or position and refuses duplicate names", () => {
    const base = structuredClone(melody);
    base.bars = 16;
    base.sections = [{ id: "first", name: "Bars 13", startBar: 0, endBar: 8, intent: "" }, { id: "last", name: "Bars 13 Long", startBar: 8, endBar: 16, intent: "" }];
    expect(capturedBrief('Keep melody in "Bars 13" unchanged', { roles: [briefRole("preserve", "lead", 'Keep melody in "Bars 13" unchanged', "Bars 13")] }, base).roles[0]?.section?.sectionId).toBe("first");
    expect(capturedBrief("Keep melody in the last section unchanged", { roles: [{ ...briefRole("preserve", "lead", "Keep melody in the last section unchanged"), section: { sectionId: null, name: null, position: "last" } }] }, base).roles[0]?.section?.sectionId).toBe("last");
    base.sections[1]!.name = "Bars 13";
    expect(capturedBrief('Keep melody in "Bars 13" unchanged', { roles: [briefRole("preserve", "lead", 'Keep melody in "Bars 13" unchanged', "Bars 13")] }, base).rejected).toHaveLength(1);
  });

  it("accepts a length implied by a written bar span and rejects a contradictory one", () => {
    const base = applyNativeOperations(melody, [{ kind: "setStructure", bars: 12, sections: [{ id: "opening", name: "Opening", startBar: 0, endBar: 4, intent: "" }, { id: "drift", name: "Drift", startBar: 4, endBar: 8, intent: "" }, { id: "return", name: "Return", startBar: 8, endBar: 12, intent: "" }] }]);
    // The live pin wording that was wrongly rejected as "not written".
    const direction = "In Drift, Music Box (bars 5–8): Simpler melody here.";
    const span = (bars: number | null) => ({ section: briefSection("Drift"), bars, startBar: 5, endBar: 8, quote: "Drift, Music Box (bars 5–8)" });
    expect(capturedBrief(direction, { sections: [span(4)] }, base)).toMatchObject({ sections: [{ startBar: 5, endBar: 8, section: { sectionId: "drift" } }], rejected: [] });
    expect(capturedBrief(direction, { sections: [span(null)] }, base).rejected).toEqual([]);
    expect(capturedBrief(direction, { sections: [span(6)] }, base).rejected).toEqual([{ quote: "Drift, Music Box (bars 5–8)", reason: "The section length and its bar span disagree" }]);
    expect(nativeCompletionIssues(base, capturedBrief(direction, { sections: [span(4)] }, base), "revision", [], base)).toEqual([]);
  });

  it("completes a span from a written start and length, and checks the start too", () => {
    const direction = "An 8-bar chorus starting at bar 9; the chorus at bars 9-16";
    const started = { section: briefSection("chorus"), bars: 8, startBar: 9, endBar: null, quote: "An 8-bar chorus starting at bar 9" };
    const spanned = { section: briefSection("chorus"), bars: null, startBar: 9, endBar: 16, quote: "the chorus at bars 9-16" };
    const brief = capturedBrief(direction, { sections: [started, spanned] });
    // Both describe one extent, so neither is a contradiction.
    expect(brief.rejected).toEqual([]);
    expect(brief.sections).toMatchObject([{ bars: 8, startBar: 9, endBar: 16 }, { bars: 8, startBar: 9, endBar: 16 }]);
    const elsewhere = applyNativeOperations(melody, [{ kind: "setStructure", bars: 16, sections: [{ id: "chorus", name: "Chorus", startBar: 0, endBar: 8, intent: "" }, { id: "outro", name: "Outro", startBar: 8, endBar: 16, intent: "" }] }]);
    // An 8-bar chorus in the wrong place does not satisfy a written start bar.
    expect(nativeCompletionIssues(elsewhere, capturedBrief(direction, { sections: [started] }), "generation")).toContain("Requested chorus at bars 9–16 was not constructed");
    // Same length, different start bars: one section cannot sit in two places.
    const moved = capturedBrief("An 8-bar chorus starting at bar 9; the chorus at bars 10-17", { sections: [started, { ...spanned, startBar: 10, endBar: 17, quote: "the chorus at bars 10-17" }] });
    expect(moved.rejected.map((item) => item.reason)).toEqual(["This direction gives this section two different lengths or positions", "This direction gives this section two different lengths or positions"]);
  });

  it("never enforces contradictory section extents or a revision resize the person has not confirmed", () => {
    const base = applyNativeOperations(melody, [{ kind: "setStructure", bars: 8, sections: [{ id: "intro", name: "Intro", startBar: 0, endBar: 4, intent: "" }, { id: "groove", name: "Groove", startBar: 4, endBar: 8, intent: "" }] }]);
    // The live pin wording that paused a revision: one section, two different spans.
    const direction = "In Groove, Late Reply (bars 5–8): fewer notes.\nIn Groove, Dust Steps (bars 5–6): Sparser drums here.";
    const brief = capturedBrief(direction, { sections: [{ section: briefSection("Groove"), bars: null, startBar: 5, endBar: 8, quote: "In Groove, Late Reply (bars 5–8)" }, { section: briefSection("Groove"), bars: null, startBar: 5, endBar: 6, quote: "In Groove, Dust Steps (bars 5–6)" }] }, base);
    expect(brief.sections).toEqual([]);
    expect(brief.rejected.map((item) => item.reason)).toEqual(["This direction gives this section two different lengths or positions", "This direction gives this section two different lengths or positions"]);
    expect(nativeCompletionIssues(base, brief, "revision", [], base)).toEqual([]);
    const resize = capturedBrief("Make the Groove bars 5-6", { sections: [{ section: briefSection("Groove"), bars: null, startBar: 5, endBar: 6, quote: "Groove bars 5-6" }] }, base);
    expect(resize).toMatchObject({ sections: [], rejected: [{ reason: "This would change Groove from bars 5–8" }] });
    // A new piece's stated structure is still enforced once built.
    const fresh = capturedBrief("An 8-bar intro then a 16-bar groove", { sections: [{ section: briefSection("intro"), bars: 8, startBar: null, endBar: null, quote: "An 8-bar intro" }, { section: briefSection("groove"), bars: 16, startBar: null, endBar: null, quote: "a 16-bar groove" }] });
    expect(fresh.sections).toHaveLength(2);
  });

  it("softens what cannot apply and conflicting whole-piece instructions", () => {
    const fresh = capturedBrief("Keep the bass simple; no drums, but add drums later", {
      keep: [briefKeep("Keep the bass simple", { partId: "bass" })],
      roles: [briefRole("absent", "drums", "no drums"), briefRole("required", "drums", "add drums later")]
    });
    expect(fresh).toMatchObject({ keep: [], roles: [], rejected: [] });
    expect(fresh.guidance.map((item) => item.reason)).toEqual(["Conflicting whole-piece drums instructions", "Conflicting whole-piece drums instructions", "Nothing exists yet to keep unchanged"]);
  });

  it("rejects an ambiguous theme with the reason, and keeps one melodic part when no phrase is linked", () => {
    const base = applyNativeOperations(melody, [
      { kind: "addPart", part: { ...part("other-lead", "melody"), notes: [], placements: [{ id: "b", motifId: "second", startTick: 0, repeats: 1, transpose: 0 }] } },
      { kind: "defineMotif", motif: { id: "second", partId: "other-lead", name: "Second", lengthTicks: 3840, notes: [{ id: "x", startTick: 0, durationTicks: 960, pitch: 64, velocity: 0.7 }] } },
      { kind: "replaceNotes", partId: "lead", notes: [] },
      { kind: "addPart", part: { ...part("third-lead", "melody"), notes: [], placements: [{ id: "c", motifId: "third", startTick: 0, repeats: 1, transpose: 0 }] } },
      { kind: "defineMotif", motif: { id: "third", partId: "third-lead", name: "Third", lengthTicks: 3840, notes: [{ id: "y", startTick: 0, durationTicks: 960, pitch: 67, velocity: 0.7 }] } }
    ]);
    const ambiguous = capturedBrief("Keep the theme", { keep: [briefKeep("Keep the theme", { theme: true })] }, base);
    expect(ambiguous.keep).toEqual([]);
    expect(ambiguous.rejected[0]?.reason).toMatch(/Several distinct melodic phrase families/);
    const single = capturedBrief("Keep the hook unchanged", { keep: [briefKeep("Keep the hook unchanged", { theme: true })] }, melody);
    expect(nativeBriefPreservation(single, melody).namedParts).toMatchObject([{ id: "lead" }]);
  });

  it("reads a progression only when its chords can be checked", () => {
    const direction = "Start with Dm9–Bbmaj7–Fmaj9–Cadd9, then an A minor, F, C turn";
    expect(capturedBrief(direction, { chordProgressions: [{ chords: ["Dm9", "Bbmaj7", "Fmaj9", "Cadd9"], quote: "Dm9–Bbmaj7–Fmaj9–Cadd9" }, { chords: ["Am", "F", "C"], quote: "A minor, F, C" }] }).chordProgressions).toHaveLength(2);
    expect(capturedBrief(direction, { chordProgressions: [{ chords: ["Dm9", "Bb13sus", "Fmaj9"], quote: "Dm9–Bbmaj7–Fmaj9–Cadd9" }] }).rejected).toHaveLength(1);
    // Chords written in lower case are still the person's words.
    expect(capturedBrief("Loop am - f - c - g all through", { chordProgressions: [{ chords: ["Am", "F", "C", "G"], quote: "am - f - c - g" }] })).toMatchObject({ chordProgressions: [{ chords: ["Am", "F", "C", "G"] }], rejected: [] });
  });

  it("stores no hard checks when a job captured none, and states checks plainly", () => {
    expect(jobNativeBrief({ direction: "Keep the bass" })).toMatchObject({ provenance: "none", roles: [], keep: [] });
    const brief = capturedBrief("No drums in the intro at 90 BPM", { tempoBpm: { value: 90, quote: "90 BPM" }, roles: [briefRole("absent", "drums", "No drums in the intro", "intro")] });
    expect(jobNativeBrief({ direction: "x", _brief: brief })).toEqual(brief);
    expect(nativeBriefChecks(brief)).toEqual(["90 BPM", "No drums in intro"]);
    expect(nativeBriefChecks(emptyNativeBrief({ provenance: "fixture", direction: "x", baseRevisionId: null, targetSectionId: null }))).toEqual([]);
  });
});

describe("completion checks from a captured brief", () => {
  it("retains a real lock alongside numeric composition guidance", () => {
    const changed = structuredClone(melody);
    changed.parts[0]!.notes[0]!.pitch++;
    const direction = "Add harmony in bars 13 and 15; keep melody unchanged";
    const brief = capturedBrief(direction, { roles: [briefRole("preserve", "lead", "keep melody unchanged")], guidance: [{ quote: "Add harmony in bars 13 and 15", reason: "Bar list, not a section" }] }, melody);
    expect(nativeCompletionIssues(changed, brief, "revision", [], melody)).toContain("Requested preservation of lead was not met");
  });

  it("accepts the requested edits for the complete Saffron revision", () => {
    const base = structuredClone(melody);
    base.bars = 16;
    base.sections = ["Opening", "Groove", "Lift", "Return"].map((name, i) => ({ id: name.toLowerCase(), name, startBar: i * 4, endBar: (i + 1) * 4, intent: "Musical development" }));
    base.parts.push(part("bass", "bass"), part("chords", "harmony"), part("drums", "percussion"));
    const changed = structuredClone(base);
    for (const id of ["bass", "chords", "lead"]) changed.parts.find(value => value.id === id)!.notes.push({ id: `${id}-ending`, startTick: 12 * 3840, durationTicks: 960, pitch: 69, velocity: 0.5 });
    changed.parts[0]!.notes.push({ id: "lift", startTick: 8 * 3840, durationTicks: 960, pitch: 72, velocity: 0.5 });
    const direction = "The Return section is currently empty. Add a sparse but audible ending in bars 13–16. Also vary two or three melody notes in Lift. Add these things in but keep it coherent.";
    const brief = capturedBrief(direction, { roles: [briefRole("change", "lead", "vary two or three melody notes in Lift", "Lift")], guidance: [{ quote: "keep it coherent", reason: "Qualitative" }] }, base);
    expect(nativeCompletionIssues(changed, brief, "revision", [], base)).toEqual([]);
  });

  it("keeps named parts, including names with conjunctions or role words", () => {
    const base = applyNativeOperations(melody, [{ kind: "addPart", part: { ...part("identity", "harmony"), name: "Identity" } }]);
    base.parts[0]!.name = "Now and Then";
    const brief = capturedBrief('Keep part "Now and Then" unchanged; preserve part "Identity"', { keep: [briefKeep('Keep part "Now and Then" unchanged', { partId: "lead" }), briefKeep('preserve part "Identity"', { partId: "identity" })] }, base);
    expect(nativeBriefPreservation(brief, base).namedParts.map((value) => value.id)).toEqual(["lead", "identity"]);
    const changed = applyNativeOperations(base, [{ kind: "setMix", partId: "identity", gain: 0.2 }]);
    expect(nativeCompletionIssues(changed, brief, "revision", [], base)).toContain("Requested preservation of Identity was not met");
  });

  it("permits recognizable-hook development without weakening an exact bass or theme lock", () => {
    const base = applyNativeOperations(melody, [{ kind: "addPart", part: part("bass", "bass") }]);
    const changed = applyNativeOperations(base, [{ kind: "replaceNotes", partId: "lead", notes: [{ ...base.parts[0]!.notes[0]!, pitch: 62 }] }]);
    const direction = "Change the lead notes. Keep its recognizable hook, but give the final bar a descending answer. Keep the bass exactly as it is.";
    const brief = capturedBrief(direction, { roles: [briefRole("change", "lead", "Change the lead notes"), briefRole("preserve", "bass", "Keep the bass exactly as it is")], guidance: [{ quote: "Keep its recognizable hook", reason: "Qualitative" }] }, base);
    expect(nativeCompletionIssues(changed, brief, "revision", [], base)).toEqual([]);
    const hook = capturedBrief("Keep the hook unchanged", { keep: [briefKeep("Keep the hook unchanged", { theme: true })] }, base);
    expect(nativeCompletionIssues(changed, hook, "revision", [], base)).toContain("Requested preservation of lead was not met");
    const wrongBass = applyNativeOperations(changed, [{ kind: "setMix", partId: "bass", gain: 0.2 }]);
    expect(nativeCompletionIssues(wrongBass, brief, "revision", [], base)).toContain("Requested preservation of bass was not met");
  });

  it("checks exclusions, positive ensembles and the empty-sketch guard for new music", () => {
    const none = capturedBrief("Make a 4-bar melody with no drums and no bass", { totalBars: { value: 4, quote: "4-bar melody" }, roles: [briefRole("absent", "drums", "no drums"), briefRole("absent", "bass", "no bass"), briefRole("required", "lead", "melody")] });
    expect(nativeCompletionIssues(melody, none, "generation")).toEqual([]);
    const forbidden = applyNativeOperations(melody, [{ kind: "addPart", part: part("drums", "percussion") }]);
    expect(nativeCompletionIssues(forbidden, none, "generation")).toContain("Excluded drums has constructed material");
    const ensemble = capturedBrief("A 4-bar melody with bass and drums", { roles: [briefRole("required", "bass", "with bass and drums"), briefRole("required", "drums", "with bass and drums")] });
    expect(nativeCompletionIssues(melody, ensemble, "generation")).toEqual(expect.arrayContaining(["Requested bass has no constructed material", "Requested drums has no constructed material"]));
    const optional = capturedBrief("A melody, maybe add bass if useful", { guidance: [{ quote: "maybe add bass if useful", reason: "Optional" }] });
    expect(nativeCompletionIssues(melody, optional, "generation")).toEqual([]);
    expect(nativeCompletionIssues(seedNativeDocument("Something intimate"), optional, "generation").some((issue) => issue.includes("starting sketch part (id starting-voice)"))).toBe(true);
  });

  it("keeps a localized intro exclusion separate from a later positive request", () => {
    const direction = "No drums in intro; bring drums in chorus";
    const brief = capturedBrief(direction, { roles: [briefRole("absent", "drums", "No drums in intro", "intro"), briefRole("required", "drums", "bring drums in chorus", "chorus")] });
    const structure = [{ id: "intro", name: "Intro", startBar: 0, endBar: 1, intent: "Quiet" }, { id: "chorus", name: "Chorus", startBar: 1, endBar: 4, intent: "Drums arrive" }];
    const introDrums = applyNativeOperations(melody, [{ kind: "setStructure", bars: 4, sections: structure }, { kind: "addPart", part: part("drums", "percussion") }]);
    expect(nativeCompletionIssues(introDrums, brief, "generation")).toContain("Excluded drums has constructed material in Intro");
    const chorusDrums = applyNativeOperations(introDrums, [{ kind: "replaceNotes", partId: "drums", notes: [{ id: "chorus-hit", startTick: 3840, durationTicks: 960, pitch: 36, velocity: 0.7 }] }]);
    expect(nativeCompletionIssues(chorusDrums, brief, "generation")).toEqual([]);
  });

  it("checks total length and section lengths separately", () => {
    const long = applyNativeOperations(melody, [{ kind: "setStructure", bars: 32, sections: [{ id: "intro", name: "Intro", startBar: 0, endBar: 4, intent: "Quiet" }, { id: "body", name: "Body", startBar: 4, endBar: 32, intent: "Develop" }] }]);
    const direction = "Start with a 4-bar intro, then develop a 32-bar melody in total";
    const brief = capturedBrief(direction, { totalBars: { value: 32, quote: "32-bar melody in total" }, sections: [{ section: briefSection("intro"), bars: 4, startBar: null, endBar: null, quote: "a 4-bar intro" }] });
    expect(nativeCompletionIssues(long, brief, "generation")).toEqual([]);
    const short = applyNativeOperations(long, [{ kind: "setStructure", bars: 32, sections: [{ id: "intro", name: "Intro", startBar: 0, endBar: 8, intent: "" }, { id: "body", name: "Body", startBar: 8, endBar: 32, intent: "" }] }]);
    expect(nativeCompletionIssues(short, brief, "generation")).toContain("Requested 4-bar intro was not constructed");
  });

  it("rejects a wrong revised bass and unchanged drums, not just a wrong reading", () => {
    const base = applyNativeOperations(melody, [{ kind: "addPart", part: part("bass", "bass") }, { kind: "addPart", part: { ...part("drums", "percussion"), notes: [
      { id: "kick-one", startTick: 0, durationTicks: 240, pitch: 36, velocity: 0.8 },
      { id: "kick-two", startTick: 960, durationTicks: 240, pitch: 36, velocity: 0.8 },
      { id: "kick-three", startTick: 1920, durationTicks: 240, pitch: 36, velocity: 0.8 }
    ] } }]);
    const direction = "Thin the drums, but keep the melody and bass.";
    const brief = capturedBrief(direction, { roles: [briefRole("change", "drums", "Thin the drums", null, true), briefRole("preserve", "lead", "keep the melody and bass"), briefRole("preserve", "bass", "keep the melody and bass")] }, base);
    const changedBass = applyNativeOperations(base, [{ kind: "replaceNotes", partId: "bass", notes: [{ id: "bass-note", startTick: 0, durationTicks: 960, pitch: 48, velocity: 0.7 }] }]);
    expect(nativeCompletionIssues(changedBass, brief, "revision", [], base)).toEqual(expect.arrayContaining(["Requested preservation of bass was not met", "Requested change to drums was not constructed"]));
    const merelyChangedDrumMix = applyNativeOperations(base, [{ kind: "setMix", partId: "drums", gain: 0.5 }]);
    expect(nativeCompletionIssues(merelyChangedDrumMix, brief, "revision", [], base)).toContain("Requested reduction of drums was not constructed");
    const thinner = applyNativeOperations(base, [{ kind: "replaceNotes", partId: "drums", notes: base.parts.find((item) => item.id === "drums")!.notes.slice(0, 2) }]);
    expect(nativeCompletionIssues(thinner, brief, "revision", [], base)).toEqual([]);
  });

  it("resolves an evidenced theme family and demands a local ambience reduction", () => {
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
    const brief = capturedBrief(direction, {
      roles: [briefRole("change", "drums", "Thin the drums", null, true), briefRole("preserve", "bass", "keep the theme and bass")],
      keep: [briefKeep("keep the theme and bass", { theme: true })],
      construction: [{ kind: "shorter-ambience", quote: "shorten the ambience" }]
    }, base, "second-main");
    const thinner = applyNativeOperations(base, [{ kind: "replaceNotes", partId: "drums", notes: base.parts.find((item) => item.id === "drums")!.notes.slice(0, 1) }, { kind: "setSectionEffectFeedback", partId: "pad", sectionId: "second-main", effectId: "wash", feedbackFactor: 0.35 }]);
    expect(nativeCompletionIssues(thinner, brief, "revision", [], base, "second-main")).toEqual([]);
    const wrongTheme = applyNativeOperations(thinner, [{ kind: "replaceMotif", motif: { ...thinner.motifs[0]!, notes: [{ ...thinner.motifs[0]!.notes[0]!, pitch: 68 }] } }]);
    expect(nativeCompletionIssues(wrongTheme, brief, "revision", [], base, "second-main")).toContain("Requested preservation of theme Main theme was not met");
    const noAmbience = applyNativeOperations(base, [{ kind: "replaceNotes", partId: "drums", notes: base.parts.find((item) => item.id === "drums")!.notes.slice(0, 1) }]);
    expect(nativeCompletionIssues(noAmbience, brief, "revision", [], base, "second-main")).toContain("Requested shorter ambience has no evidenced connected reverb/delay control reduction");
  });

  it("preserves only the requested section of a role while allowing a later change", () => {
    const base = applyNativeOperations(melody, [{ kind: "setStructure", bars: 8, sections: [{ id: "intro", name: "Intro", startBar: 0, endBar: 4, intent: "" }, { id: "chorus", name: "Chorus", startBar: 4, endBar: 8, intent: "" }] }, { kind: "addNotes", partId: "lead", notes: [{ id: "late", startTick: 15360, durationTicks: 960, pitch: 67, velocity: 0.7 }] }]);
    const direction = "Keep the melody in the intro; change the melody in the chorus.";
    const brief = capturedBrief(direction, { roles: [briefRole("preserve", "lead", "Keep the melody in the intro", "intro"), briefRole("change", "lead", "change the melody in the chorus", "chorus")] }, base);
    const later = applyNativeOperations(base, [{ kind: "developSectionNotes", partId: "lead", sectionId: "chorus", pitchShiftSemitones: 2 }]);
    expect(nativeCompletionIssues(later, brief, "revision", [], base)).toEqual([]);
    const earlier = applyNativeOperations(later, [{ kind: "developSectionNotes", partId: "lead", sectionId: "intro", pitchShiftSemitones: 2 }]);
    expect(nativeCompletionIssues(earlier, brief, "revision", [], base)).toContain("Requested preservation of lead in Intro was not met");
  });

  it("requires a captured chord chain in ordered constructed pitches, not a plan claim", () => {
    const direction = "Start with Dm9–Bbmaj7–Fmaj9–Cadd9, then develop the theme";
    const brief = capturedBrief(direction, { chordProgressions: [{ chords: ["Dm9", "Bbmaj7", "Fmaj9", "Cadd9"], quote: "Dm9–Bbmaj7–Fmaj9–Cadd9" }] });
    const pitches = [[62, 65, 72, 76], [58, 62, 69], [53, 57, 64, 67], [60, 64, 74]];
    const notes = pitches.flatMap((chord, bar) => chord.map((pitch, index) => ({ id: `chord-${bar}-${index}`, startTick: bar * 3840, durationTicks: 2880, pitch, velocity: 0.65 })));
    const built = applyNativeOperations(melody, [{ kind: "addPart", part: part("chords", "harmony") }, { kind: "replaceNotes", partId: "chords", notes }]);
    expect(nativeCompletionIssues(built, brief, "generation")).toEqual([]);
    const wrong = applyNativeOperations(built, [{ kind: "replaceNotes", partId: "chords", notes: notes.map((note) => note.id === "chord-2-2" ? { ...note, pitch: 63 } : note) }]);
    expect(nativeCompletionIssues(wrong, brief, "generation")).toContain("Requested chord progression Dm9–Bbmaj7–Fmaj9–Cadd9 is not evidenced in ordered harmony/bass pitches");
  });

  it("rejects incomplete model turns before partial tool arguments are dispatched", () => {
    expect(() => assertNativeModelCompletion({ response_metadata: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }, tool_calls: [{ name: "apply_native_batch" }] })).toThrow("OPENAI_INCOMPLETE_RESPONSE");
    expect(() => assertNativeModelCompletion({ response_metadata: { finish_reason: "stop" } })).not.toThrow();
  });
});
