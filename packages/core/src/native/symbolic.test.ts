import { describe, expect, it } from "vitest";
import { applyNativeOperations, materializedNotes, nativeOperationSchema, type NativeDocument } from "./model.js";
import { seedNativeDocument } from "./producer.js";
import { compileToolOperations, nativeBatchSchema, sceneOperations } from "./construction-tools.js";
import { nativeFeelSchema, scalePitchClasses } from "./harmony.js";
import { analyzeNativeMusicality, musicalityChecklist } from "./musicality.js";
import { symbolicNativeReview, validateNativeReview } from "./critique.js";
import { NativeCorrectableError } from "./errors.js";
import { validateNativeOffline } from "./adapter.js";

const dMinor = { tonic: "D", mode: "minor" } as const;
const structure = (bars: number, meter = { numerator: 4, denominator: 4 }) => ({ bars, sections: [{ id: "intro", name: "Intro", startBar: 0, endBar: bars / 2 }, { id: "main", name: "Main", startBar: bars / 2, endBar: bars }] , meter });
function room(bars = 8, meter = { numerator: 4, denominator: 4 }): NativeDocument {
  const { meter: m, ...shape } = structure(bars, meter);
  return applyNativeOperations(seedNativeDocument("A groove"), sceneOperations({ stepKey: "base", replaceSeed: true, meter: m, structure: shape,
    parts: [{ id: "keys", name: "Keys", role: "harmony", recipe: "lofi-keys" }, { id: "bass", name: "Bass", role: "bass", recipe: "dusty-bass" }, { id: "drums", name: "Drums", role: "percussion", recipe: "dry-step-kit" }] }));
}

describe("symbolic construction shortcuts", () => {
  it("builds recipe parts with their device and full effect chain", () => {
    const doc = room();
    const keys = doc.parts.find((part) => part.id === "keys")!;
    expect(keys.device.type).toBe("heisenberg");
    expect(keys.effects.map((effect) => effect.type)).toEqual(["stompboxChorus", "stompboxTube", "stompboxReverb"]);
    expect(keys.effects.map((effect) => effect.id)).toEqual(["lofi-keys-1", "lofi-keys-2", "lofi-keys-3"]);
    // An applyRecipe edit swaps a part's sound in one operation.
    const swapped = applyNativeOperations(doc, compileToolOperations([{ kind: "applyRecipe", partId: "keys", recipeId: "warm-pad" }], doc));
    expect(swapped.parts.find((part) => part.id === "keys")!.effects.map((effect) => effect.id)).toEqual(["lofi-keys-1", "lofi-keys-2", "lofi-keys-3", "warm-pad-1", "warm-pad-2"]);
    expect(() => sceneOperations({ stepKey: "bad", parts: [{ id: "x", name: "X", role: "lead" }] })).toThrow(NativeCorrectableError);
  });

  it("writes voiced chords and a bass line from chord symbols, in key and validated by the SDK mapping", async () => {
    const doc = room();
    const batch = nativeBatchSchema.parse({ stepKey: "chords", operations: [{ kind: "chordProgression", sectionIds: ["intro", "main"], key: "D minor",
      chords: [{ symbol: "Dm9", bars: 2 }, { symbol: "Bbmaj7", bars: 2 }],
      comp: { partId: "keys", pattern: "broken", extensions: "ninths" }, bass: { partId: "bass", pattern: "syncopated" }, feel: { swing: 0.58, humanizeTicks: 6 } }] });
    const operations = compileToolOperations(batch.operations, doc);
    expect(operations.map((op) => op.kind)).toEqual(["sequenceSectionPattern", "sequenceSectionPattern", "sequenceSectionPattern", "sequenceSectionPattern"]);
    const after = applyNativeOperations(doc, operations);
    const keys = materializedNotes(after, "keys"), bass = materializedNotes(after, "bass");
    expect(keys.length).toBeGreaterThan(20);
    expect(bass.length).toBeGreaterThan(8);
    expect([...keys, ...bass].every((note) => scalePitchClasses(dMinor).includes(note.pitch % 12))).toBe(true);
    // Swing really moved some off-beats; identical input compiles identically.
    expect(keys.some((note) => note.startTick % 480 !== 0)).toBe(true);
    expect(compileToolOperations(batch.operations, doc)).toEqual(operations);
    expect(analyzeNativeMusicality(after).issues.filter((issue) => issue.code === "HARSH_OVER_BASS" || issue.code === "OUT_OF_KEY")).toEqual([]);
    await validateNativeOffline(after);
  });

  it("uses one harmonizeSection for sustained chords and supports 3/4 waltz comping", () => {
    const doc = room(8, { numerator: 3, denominator: 4 });
    const sustain = compileToolOperations([{ kind: "chordProgression", sectionIds: ["intro"], chords: ["Am", "F", "C", "G"].map((symbol) => ({ symbol, bars: 1 })), comp: { partId: "keys", register: "mid", voices: 3 } }], doc);
    expect(sustain).toMatchObject([{ kind: "harmonizeSection", sectionId: "intro", cycleBars: 4 }]);
    // Feel keeps held chords held (two-bar chords stay one chord each) and only varies their velocity.
    const felt = compileToolOperations([{ kind: "chordProgression", sectionIds: ["intro"], chords: [{ symbol: "Am", bars: 2 }, { symbol: "F", bars: 2 }], comp: { partId: "keys", velocity: 0.5 }, feel: { swing: 0.6, humanizeVelocity: 0.1 } }], doc);
    expect(felt).toMatchObject([{ kind: "harmonizeSection", chords: [{ durationBars: 2 }, { durationBars: 2 }] }]);
    const velocities = (felt[0] as Extract<typeof felt[number], { kind: "harmonizeSection" }>).chords.map((chord) => chord.velocity);
    expect(velocities.every((velocity) => Math.abs(velocity - 0.5) <= 0.1)).toBe(true);
    expect(new Set(velocities).size).toBe(2);
    expect(compileToolOperations([{ kind: "chordProgression", sectionIds: ["intro"], chords: [{ symbol: "Am", bars: 2 }, { symbol: "F", bars: 2 }], comp: { partId: "keys", velocity: 0.5 }, feel: { swing: 0.6, humanizeVelocity: 0.1 } }], doc)).toEqual(felt);
    const waltz = applyNativeOperations(doc, compileToolOperations([{ kind: "chordProgression", sectionIds: ["main"], chords: [{ symbol: "Am", bars: 2 }, { symbol: "E7", bars: 2 }], comp: { partId: "keys", pattern: "waltz" } }], doc));
    const bar = 2880, notes = materializedNotes(waltz, "keys");
    expect(new Set(notes.map((note) => (note.startTick % bar) / 960))).toEqual(new Set([0, 1, 2]));
  });

  it("joins a section pattern to existing notes unless replace is set, and leaves old operations' note ids alone", () => {
    const doc = room();
    const stabs = (velocity: number, replace = false, sectionId = "intro") => nativeOperationSchema.parse({ kind: "harmonizeSection", partId: "keys", sectionId, cycleBars: 1, chords: [{ barOffset: 0, durationBars: 0.5, pitches: [53, 62, 69], velocity }], ...(replace ? { replace } : {}) });
    // No flag is added to an operation that did not carry one, so its hash and note ids are unchanged.
    expect("replace" in stabs(0.5)).toBe(false);
    const once = applyNativeOperations(doc, [stabs(0.5)]);
    const inIntro = (document: NativeDocument) => materializedNotes(document, "keys").filter((note) => note.startTick < 4 * 3840);
    expect(inIntro(once)).toHaveLength(12);
    // A second pattern joins the first...
    expect(inIntro(applyNativeOperations(once, [stabs(0.4)]))).toHaveLength(24);
    // ...and with replace it takes its place, in this section only.
    const elsewhere = applyNativeOperations(once, [stabs(0.45, false, "main")]);
    const replaced = applyNativeOperations(elsewhere, [stabs(0.4, true)]);
    expect(inIntro(replaced)).toHaveLength(12);
    expect(inIntro(replaced).every((note) => note.velocity === 0.4)).toBe(true);
    expect(materializedNotes(replaced, "keys")).toHaveLength(24);
    const hits = (replace: boolean) => nativeOperationSchema.parse({ kind: "sequenceSectionPattern", partId: "bass", sectionId: "intro", cycleBars: 1, hits: [{ tick: 0, durationTicks: 480, pitch: 38, velocity: 0.7 }], ...(replace ? { replace } : {}) });
    expect(materializedNotes(applyNativeOperations(applyNativeOperations(doc, [hits(false)]), [hits(true)]), "bass")).toHaveLength(4);
  });

  it("keeps compiled patterns inside the operation limits as correctable replies", () => {
    const sevenFour = room(8, { numerator: 7, denominator: 4 });
    expect(() => compileToolOperations([{ kind: "chordProgression", sectionIds: ["intro"], chords: [{ symbol: "Am", bars: 4 }, { symbol: "F", bars: 4 }], bass: { partId: "bass", pattern: "pulse-eighths" } }], sevenFour))
      .toThrow(/bass needs 112 notes per cycle \(limit 96\)/);
    // A half-bar chord in 3/4 (1.5 beats) never leaks a note into the next chord.
    const waltz = room(8, { numerator: 3, denominator: 4 });
    const ops = compileToolOperations([{ kind: "chordProgression", sectionIds: ["intro"], chords: [{ symbol: "Am", bars: 0.5 }, { symbol: "F", bars: 0.5 }, { symbol: "C", bars: 1 }], comp: { partId: "keys", pattern: "stabs" } }], waltz);
    const hits = (ops[0] as Extract<typeof ops[number], { kind: "sequenceSectionPattern" }>).hits;
    expect(hits.every((hit) => hit.durationTicks >= 60)).toBe(true);
    expect(hits.filter((hit) => hit.tick === 1440)).toHaveLength(0);
  });

  it("refuses misuse with correctable guidance instead of writing questionable notes", () => {
    const doc = room();
    const attempt = (op: Record<string, unknown>) => () => compileToolOperations([{ kind: "chordProgression", sectionIds: ["intro"], chords: [{ symbol: "Am", bars: 4 }], ...op }], doc);
    expect(attempt({ comp: { partId: "drums" } })).toThrow(/cannot play chords/);
    expect(attempt({ chords: [{ symbol: "Xyz", bars: 4 }], comp: { partId: "keys" } })).toThrow(/Unreadable chord symbol/);
    expect(attempt({ chords: [{ symbol: "Am", bars: 1.5 }], comp: { partId: "keys" } })).toThrow(/add up to 1.5 bars/);
    expect(attempt({})).toThrow(/comp part, a bass part or both/);
    const filled = applyNativeOperations(doc, compileToolOperations([{ kind: "chordProgression", sectionIds: ["intro"], chords: [{ symbol: "Am", bars: 4 }], comp: { partId: "keys" } }], doc));
    expect(() => compileToolOperations([{ kind: "chordProgression", sectionIds: ["intro"], chords: [{ symbol: "F", bars: 4 }], comp: { partId: "keys" } }], filled)).toThrow(/already plays in Intro/);
    expect(() => sceneOperations({ stepKey: "feel", patterns: [{ id: "beat", partId: "drums", name: "Beat", lengthTicks: 3840, events: [[0, 240, 36, 1]], feel: { swing: 0.6 } }] }, doc)).toThrow(/Beatbox8/);
  });

  it("composes harmony inside a scene against the parts and sections that scene creates", () => {
    const operations = sceneOperations({ stepKey: "whole", replaceSeed: true, structure: { bars: 4, sections: [{ id: "a", name: "A", startBar: 0, endBar: 4 }] },
      parts: [{ id: "pad", name: "Pad", role: "harmony", recipe: "warm-pad" }],
      harmony: [{ sectionIds: ["a"], chords: [{ symbol: "Cmaj7", bars: 2 }, { symbol: "Am7", bars: 2 }], comp: { partId: "pad" } }] }, seedNativeDocument("Pad"));
    const doc = applyNativeOperations(seedNativeDocument("Pad"), operations);
    expect(materializedNotes(doc, "pad")).toHaveLength(8);
  });

  it("moves phrases in key and grooves notes through the existing variation operations", () => {
    let doc = room();
    doc = applyNativeOperations(doc, sceneOperations({ stepKey: "melody", parts: [{ id: "lead", name: "Lead", role: "lead", recipe: "soft-lead" }],
      patterns: [{ id: "hook", partId: "lead", name: "Hook", lengthTicks: 3840, events: [[0, 960, 69, 0.6], [1440, 480, 72, 0.6], [2880, 960, 65, 0.6]] }],
      placements: [{ partId: "lead", placement: { id: "h1", motifId: "hook", startTick: 0, repeats: 1, transpose: 0 } }, { partId: "lead", placement: { id: "h2", motifId: "hook", startTick: 15360, repeats: 1, transpose: 0 } }] }, doc));
    const lifted = applyNativeOperations(doc, [{ kind: "varyMotifInstance", partId: "lead", placementId: "h2", newMotifId: "hook-up", name: "Hook up", key: "D minor", diatonicSteps: 2 }]);
    expect(lifted.motifs.find((motif) => motif.id === "hook-up")!.notes.map((note) => note.pitch)).toEqual([72, 76, 69]);
    const mirrored = applyNativeOperations(doc, [{ kind: "varyMotifInstance", partId: "lead", placementId: "h2", newMotifId: "hook-mirror", name: "Mirror", key: "D minor", invertAround: 69 }]);
    expect(mirrored.motifs.find((motif) => motif.id === "hook-mirror")!.notes.map((note) => note.pitch % 12).every((pc) => scalePitchClasses(dMinor).includes(pc))).toBe(true);
    expect(() => applyNativeOperations(doc, [{ kind: "varyMotifInstance", partId: "lead", placementId: "h2", newMotifId: "x", name: "X", diatonicSteps: 2 }])).toThrow(/need a key/);
    expect(() => applyNativeOperations(doc, [{ kind: "varyMotifInstance", partId: "lead", placementId: "h2", newMotifId: "x", name: "X", key: "D minor", diatonicSteps: 2, pitchShiftSemitones: 3 }])).toThrow(/not both/);
    const grooved = applyNativeOperations(lifted, [{ kind: "developSectionNotes", partId: "lead", sectionId: "main", feel: nativeFeelSchema.parse({ swing: 0.62, humanizeVelocity: 0.1 }) }]);
    const swung = materializedNotes(grooved, "lead").filter((note) => note.startTick >= 15360);
    expect(swung.find((note) => note.pitch === 76)!.startTick).toBe(15360 + 1440 + 115); // the off-beat 8th, swung
    expect(materializedNotes(grooved, "lead").filter((note) => note.startTick < 15360)).toEqual(materializedNotes(lifted, "lead").filter((note) => note.startTick < 15360));
    expect(() => applyNativeOperations(doc, [{ kind: "developSectionNotes", partId: "drums", sectionId: "main", feel: nativeFeelSchema.parse({ swing: 0.6 }) }])).toThrow(/Beatbox8/);
  });
});

describe("chord progression endings", () => {
  // Notes without their ids, in a stable order: the last section's notes are written explicitly, so only their ids differ from the looped ones.
  const bare = (notes: ReturnType<typeof materializedNotes>) => notes.map(({ startTick, durationTicks, pitch, velocity }) => ({ startTick, durationTicks, pitch, velocity })).sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch);
  const classes = (notes: ReturnType<typeof materializedNotes>) => [...new Set(notes.map((note) => note.pitch % 12))].sort((a, b) => a - b);

  it.each(["stabs", "sustain"] as const)("lands a looping progression on a final chord in the last section only (%s)", async (pattern) => {
    const doc = room(), bar = 3840, finalBar = 7 * bar, end = 8 * bar;
    const loop = { kind: "chordProgression", sectionIds: ["intro", "main"], key: "D minor", chords: ["Dm7", "Bbmaj7", "Fmaj7", "C7"].map((symbol) => ({ symbol, bars: 1 })), comp: { partId: "keys", pattern }, bass: { partId: "bass", pattern: "roots" } };
    const looped = compileToolOperations([loop], doc), operations = compileToolOperations([{ ...loop, ending: { symbol: "Dm9", bars: 1 } }], doc);
    // Without an ending nothing changes: cycle operations only. With one, the first section still compiles to exactly those operations.
    expect(looped.map((op) => op.kind)).toEqual([pattern === "sustain" ? "harmonizeSection" : "sequenceSectionPattern", pattern === "sustain" ? "harmonizeSection" : "sequenceSectionPattern", "sequenceSectionPattern", "sequenceSectionPattern"]);
    expect(operations.filter((op) => op.kind !== "addNotes")).toEqual(looped.filter((op) => "sectionId" in op && op.sectionId === "intro"));
    expect(operations.flatMap((op) => op.kind === "addNotes" ? [op.partId] : [])).toEqual(["keys", "bass"]);
    expect(compileToolOperations([{ ...loop, ending: { symbol: "Dm9", bars: 1 } }], doc)).toEqual(operations);
    const after = applyNativeOperations(doc, operations), before = applyNativeOperations(doc, looped);
    for (const partId of ["keys", "bass"]) {
      const notes = materializedNotes(after, partId), plain = materializedNotes(before, partId);
      expect(notes.filter((note) => note.startTick < 4 * bar)).toEqual(plain.filter((note) => note.startTick < 4 * bar));
      // Up to the final bar the last section plays the same looped notes, and nothing rings past it.
      expect(bare(notes.filter((note) => note.startTick >= 4 * bar && note.startTick < finalBar))).toEqual(bare(plain.filter((note) => note.startTick >= 4 * bar && note.startTick < finalBar)));
      expect(notes.every((note) => note.startTick + note.durationTicks <= (note.startTick < finalBar ? finalBar : end))).toBe(true);
      expect(new Set(notes.map((note) => note.id)).size).toBe(notes.length);
    }
    const closing = (document: NativeDocument, partId: string) => materializedNotes(document, partId).filter((note) => note.startTick >= finalBar);
    // The final bar holds Dm9 (D F A C E) over a D bass until the section ends.
    expect(closing(after, "keys")).toHaveLength(4);
    expect(closing(after, "keys").every((note) => [2, 5, 9, 0, 4].includes(note.pitch % 12) && note.startTick === finalBar && note.durationTicks === bar && note.velocity === 0.55)).toBe(true);
    expect(closing(after, "bass").map((note) => [note.startTick, note.durationTicks, note.pitch % 12, note.velocity])).toEqual([[finalBar, bar, 2, 0.7]]);
    // C7's own tones (G and Bb; its C and E also belong to Dm9) and its root in the bass no longer start there.
    expect(classes(closing(before, "keys"))).toEqual([0, 4, 7, 10]);
    expect(classes(closing(before, "bass"))).toEqual([0]);
    expect(classes(closing(after, "keys")).some((pitchClass) => pitchClass === 7 || pitchClass === 10)).toBe(false);
    expect(classes(closing(after, "bass"))).not.toContain(0);
    await validateNativeOffline(after);
  });

  it("shortens a held chord at a two-bar ending in 3/4 and keeps feel on the looped notes", async () => {
    const doc = room(8, { numerator: 3, denominator: 4 }), bar = 2880, endingStart = 6 * bar, end = 8 * bar;
    const loop = { kind: "chordProgression", sectionIds: ["intro", "main"], key: "A minor", chords: [{ symbol: "Am", bars: 1 }, { symbol: "G", bars: 3 }], comp: { partId: "keys", voices: 3 }, bass: { partId: "bass", pattern: "syncopated" }, feel: { swing: 0.6, humanizeVelocity: 0.08 } };
    const operations = compileToolOperations([{ ...loop, ending: { symbol: "Am", bars: 2 } }], doc);
    expect(compileToolOperations([{ ...loop, ending: { symbol: "Am", bars: 2 } }], doc)).toEqual(operations);
    const after = applyNativeOperations(doc, operations), before = applyNativeOperations(doc, compileToolOperations([loop], doc));
    for (const partId of ["keys", "bass"]) {
      const notes = materializedNotes(after, partId), plain = materializedNotes(before, partId);
      expect(notes.filter((note) => note.startTick < 4 * bar)).toEqual(plain.filter((note) => note.startTick < 4 * bar));
      // The looped notes keep their swung ticks and humanized velocities; one that would cross the ending stops at it.
      expect(bare(notes.filter((note) => note.startTick >= 4 * bar && note.startTick < endingStart))).toEqual(bare(plain.filter((note) => note.startTick >= 4 * bar && note.startTick < endingStart).map((note) => ({ ...note, durationTicks: Math.min(note.durationTicks, endingStart - note.startTick) }))));
      expect(notes.every((note) => note.startTick + note.durationTicks <= end)).toBe(true);
    }
    const keys = materializedNotes(after, "keys"), bass = materializedNotes(after, "bass");
    // The three-bar G is held for one bar here instead of ringing through the ending.
    expect(materializedNotes(before, "keys").filter((note) => note.startTick === 5 * bar).map((note) => note.durationTicks)).toEqual([3 * bar, 3 * bar, 3 * bar]);
    expect(keys.filter((note) => note.startTick === 5 * bar).map((note) => note.durationTicks)).toEqual([bar, bar, bar]);
    expect(keys.filter((note) => note.startTick >= endingStart).map((note) => [note.startTick, note.durationTicks])).toEqual([[endingStart, 2 * bar], [endingStart, 2 * bar], [endingStart, 2 * bar]]);
    expect(classes(keys.filter((note) => note.startTick >= endingStart))).toEqual([0, 4, 9]);
    expect(bass.filter((note) => note.startTick >= endingStart).map((note) => [note.startTick, note.durationTicks, note.pitch % 12])).toEqual([[endingStart, 2 * bar, 9]]);
    expect(bass.some((note) => note.startTick >= 4 * bar && note.startTick < endingStart && note.startTick % 480 !== 0)).toBe(true);
    await validateNativeOffline(after);
    // A replaced downbeat that humanizing pulls just ahead of the ending does not sound before it.
    const loose = { ...loop, comp: { partId: "keys", pattern: "waltz" }, feel: { humanizeTicks: 30 } };
    const early = (operation: Record<string, unknown>) => { const document = applyNativeOperations(doc, compileToolOperations([operation], doc)); return ["keys", "bass"].flatMap((partId) => materializedNotes(document, partId)).filter((note) => note.startTick >= endingStart - 30 && note.startTick < endingStart); };
    expect(early(loose).length).toBeGreaterThan(0);
    expect(early({ ...loose, ending: { symbol: "Am", bars: 2 } })).toEqual([]);
  });

  it("refuses an unreadable or oversized ending as a correctable edit, and accepts one that fills the section", () => {
    const doc = room(4), bar = 3840;
    const loop = { sectionIds: ["intro", "main"], chords: [{ symbol: "Am", bars: 1 }, { symbol: "G", bars: 1 }], comp: { partId: "keys" }, bass: { partId: "bass" } };
    const attempt = (ending: Record<string, unknown>) => () => compileToolOperations([{ kind: "chordProgression", ...loop, ending }], doc);
    for (const [ending, message] of [[{ symbol: "Xyz" }, /Unreadable chord symbol "Xyz"/], [{ symbol: "Am", bars: 3 }, /ending lasts 3 bars but Main has only 2/]] as const) {
      expect(attempt(ending)).toThrow(NativeCorrectableError);
      expect(attempt(ending)).toThrow(expect.objectContaining({ code: "SYMBOLIC_EDIT_INVALID", message: expect.stringMatching(message) }));
    }
    // A scene's harmony takes the same ending; here it fills the whole last section, which then holds only the final chord.
    const whole = applyNativeOperations(doc, sceneOperations({ stepKey: "close", harmony: [{ ...loop, ending: { symbol: "Am", bars: 2 } }] }, doc));
    expect(materializedNotes(whole, "keys").filter((note) => note.startTick >= 2 * bar).map((note) => [note.startTick, note.durationTicks])).toEqual([[2 * bar, 2 * bar], [2 * bar, 2 * bar], [2 * bar, 2 * bar], [2 * bar, 2 * bar]]);
    expect(materializedNotes(whole, "bass").filter((note) => note.startTick >= 2 * bar).map((note) => [note.startTick, note.durationTicks, note.pitch % 12])).toEqual([[2 * bar, 2 * bar, 9]]);
    expect(materializedNotes(whole, "keys").filter((note) => note.startTick < 2 * bar)).toHaveLength(8);
  });
});

describe("review citations", () => {
  it("names the chord a finding's cited notes spell, so a misnamed inversion is recognisable", () => {
    const doc = room();
    // The live misreading: F3 D4 A4 C5 over a D bass reported as "an Fmaj7 voicing".
    const built = applyNativeOperations(doc, [
      { kind: "addNotes", partId: "keys", notes: [53, 62, 69, 72].map((pitch, voice) => ({ id: `end-${pitch}`, startTick: 7 * 3840 + voice * 8, durationTicks: 3000, pitch, velocity: 0.5 })) },
      { kind: "addNotes", partId: "bass", notes: [{ id: "end-bass", startTick: 7 * 3840, durationTicks: 3000, pitch: 38, velocity: 0.7 }] }]);
    const cite = (pitches: number[]) => pitches.map((pitch, voice) => ({ tick: 3 * 3840 + voice * 8, pitch }));
    const review = validateNativeReview({ verdict: "The ending is not D minor", noChangeReason: null, findings: [
      { priority: "medium", sectionId: "main", partId: "keys", observation: "The final chord is an Fmaj7 voicing", suggestedChange: "Revoice as Dm7", evidence: cite([53, 62, 69, 72]) },
      { priority: "low", sectionId: "main", partId: "keys", observation: "The top note is thin", suggestedChange: "Double it", evidence: cite([72]) }] }, built, true);
    expect(review.findings.map((finding) => finding.citedChord)).toEqual(["Dm7", undefined]);
    // Notes cited from different moments are not one chord.
    const apart = validateNativeReview({ verdict: "Spread", noChangeReason: null, findings: [{ priority: "low", sectionId: "main", partId: "keys", observation: "Three separate notes", suggestedChange: "Vary them",
      evidence: [{ tick: 3 * 3840, pitch: 53 }, { tick: 3 * 3840 + 8, pitch: 62 }, { tick: 3 * 3840 + 1000, pitch: 69 }] }] }, built, true);
    expect(apart.findings[0]!.citedChord).toBeUndefined();
  });

  it("discards a finding whose cited notes are not in the score and keeps verified ones", () => {
    const doc = room(8, { numerator: 3, denominator: 4 });
    const built = applyNativeOperations(doc, compileToolOperations([{ kind: "chordProgression", sectionIds: ["intro"], key: "C major", chords: ["Am", "F"].map((symbol) => ({ symbol, bars: 2 })), bass: { partId: "bass", pattern: "roots" } }], doc));
    const bass = materializedNotes(built, "bass").sort((a, b) => a.startTick - b.startTick);
    const fRoot = bass.find((note) => note.startTick === 5760)!.pitch;
    expect(fRoot % 12).toBe(5);
    const finding = (pitch: number, observation: string) => ({ priority: "medium" as const, sectionId: "intro", partId: "bass", observation, suggestedChange: "Change it", evidence: [{ tick: 5760, pitch }] });
    // The October 9 misreading: the evidence said F2 (41) and the reviewer reported A2 (45).
    const misread = validateNativeReview({ verdict: "The bass misses the F", findings: [finding(fRoot + 4, "The bass plays A under F")], noChangeReason: null }, built, true);
    expect(misread.findings).toEqual([]);
    expect(misread.discardedFindings).toEqual([{ observation: "The bass plays A under F", reason: `Cites MIDI ${fRoot + 4} at section tick 5760; the score has MIDI ${fRoot} there` }]);
    expect(misread.noChangeReason).toMatch(/discarded/);
    const kept = validateNativeReview({ verdict: "One real finding", findings: [finding(fRoot, "The F root could move"), finding(fRoot + 4, "The bass plays A under F")], noChangeReason: null }, built, true);
    expect(kept.findings.map((item) => item.observation)).toEqual(["The F root could move"]);
    expect(kept.noChangeReason).toBeNull();
    // A finding about another part may cite the bass note it sits over.
    const over = validateNativeReview({ verdict: "Melody over the F", findings: [{ ...finding(fRoot, "The keys clash with the F root"), partId: "keys" }], noChangeReason: null }, built, true);
    expect(over.findings).toHaveLength(1);
    // Findings without citations (older reviews, the symbolic fallback) are unchanged.
    const plain = validateNativeReview({ verdict: "Plain", findings: [{ priority: "low", sectionId: "intro", partId: "bass", observation: "General", suggestedChange: "Vary it" }], noChangeReason: null }, built, true);
    expect(plain.findings).toHaveLength(1);
    expect(plain.discardedFindings).toBeUndefined();
  });
});

describe("musicality analysis", () => {
  function softCorner(transpose: number) {
    const doc = room(16);
    return applyNativeOperations(doc, sceneOperations({ stepKey: "sc", parts: [{ id: "rhodes", name: "Rhodes", role: "melody", recipe: "lofi-keys" }],
      patterns: [{ id: "bassline", partId: "bass", name: "Bass", lengthTicks: 7680, events: [[0, 1440, 38, 0.66], [1440, 480, 33, 0.6], [1920, 960, 38, 0.66], [2880, 960, 36, 0.6], [3840, 1440, 34, 0.66], [5280, 480, 41, 0.6], [5760, 960, 33, 0.66], [6720, 960, 36, 0.6]] },
        { id: "hook", partId: "rhodes", name: "Hook", lengthTicks: 7680, events: [[0, 1440, 69, 0.4], [1920, 960, 72, 0.4], [2880, 960, 65, 0.4], [3840, 1440, 74, 0.4], [5760, 1920, 69, 0.4]] }],
      placements: [{ partId: "bass", placement: { id: "b", motifId: "bassline", startTick: 0, repeats: 8, transpose: 0 } },
        { partId: "rhodes", placement: { id: "r1", motifId: "hook", startTick: 0, repeats: 4, transpose: 0 } }, { partId: "rhodes", placement: { id: "r2", motifId: "hook", startTick: 30720, repeats: 4, transpose } }] }, doc));
  }

  it("flags a chromatically transposed melody clashing with the bass, and passes the in-key version", () => {
    const clashing = analyzeNativeMusicality(softCorner(3));
    expect(clashing.key?.label).toMatch(/D minor|F major/);
    expect(clashing.issues[0]).toMatchObject({ code: "HARSH_OVER_BASS", severity: "high", partId: "rhodes", sectionId: "main" });
    expect(clashing.issues.some((issue) => issue.code === "OUT_OF_KEY" && issue.partId === "rhodes")).toBe(true);
    expect(clashing.issues.some((issue) => issue.code === "LOOPED_PART" && issue.partId === "bass")).toBe(true);
    const clean = analyzeNativeMusicality(softCorner(0));
    expect(clean.issues.filter((issue) => issue.code === "HARSH_OVER_BASS" || issue.code === "OUT_OF_KEY")).toEqual([]);
    expect(clean.sections.map((section) => section.layers)).toEqual([2, 2]);
  });

  it("names each bar's chord and tells a key from its relative by the opening bass note", () => {
    const doc = room();
    const cycle = (chords: string[], ending?: string) => applyNativeOperations(doc, compileToolOperations(nativeBatchSchema.parse({ stepKey: "chords", operations: [{ kind: "chordProgression", sectionIds: ["intro", "main"], key: "D minor",
      chords: chords.map((symbol) => ({ symbol, bars: 1 })), ...(ending ? { ending: { symbol: ending, bars: 1 } } : {}), comp: { partId: "keys" }, bass: { partId: "bass" } }] }).operations, doc));
    // A live review read this cycle's Dm7 as "not Dm7" and its key as F major.
    const copper = analyzeNativeMusicality(cycle(["Dm7", "Bbmaj7", "Fmaj7", "C7"], "Dm9"));
    expect(copper.chords).toEqual([{ sectionId: "intro", bars: ["Dm7", "Bbmaj7", "Fmaj7", "C7"] }, { sectionId: "main", bars: ["Dm7", "Bbmaj7", "Fmaj7", "Dm9"] }]);
    expect(copper.finalChord).toBe("Dm9");
    expect(copper.key).toMatchObject({ label: "D minor", relative: "F major" });
    // The same notes opening on F stay in F major.
    expect(analyzeNativeMusicality(cycle(["Fmaj7", "C7", "Dm7", "Bbmaj7"])).key).toMatchObject({ label: "F major", relative: "D minor" });
    const evidence = symbolicNativeReview(cycle(["Dm7", "Dm7", "Bbmaj7", "C7"]), null).musicality;
    expect(evidence.chordsByBar).toEqual({ intro: "Dm7 x2 | Bbmaj7 | C7", main: "Dm7 x2 | Bbmaj7 | C7" });
    expect(evidence.finalChord).toBe("C7");
    expect(musicalityChecklist(copper).finalChord).toBe("Dm9");
    // Two chords in a bar are named separately, not as the chord their notes would spell together.
    const halves = analyzeNativeMusicality(applyNativeOperations(doc, compileToolOperations(nativeBatchSchema.parse({ stepKey: "halves", operations: [{ kind: "chordProgression", sectionIds: ["intro"], key: "C major",
      chords: ["C", "F", "G", "Am"].map((symbol) => ({ symbol, bars: 0.5 })), comp: { partId: "keys" }, bass: { partId: "bass" } }] }).operations, doc)));
    expect(halves.chords[0]!.bars.slice(0, 2)).toEqual(["C F", "G Am"]);
    expect(halves.finalChord).toBe("Am");
    // Drums alone name no chords.
    const drums = analyzeNativeMusicality(room());
    expect(drums.chords).toEqual([]);
    expect(drums.finalChord).toBeNull();
  });

  it("reaches the producer checklist compactly and the reviewer's evidence in full", () => {
    const doc = softCorner(3);
    const checklist = musicalityChecklist(analyzeNativeMusicality(doc));
    expect(checklist.notes[0]).toMatch(/^HARSH_OVER_BASS: Rhodes/);
    expect(checklist.notes.length).toBeLessThanOrEqual(6);
    expect(JSON.stringify(checklist).length).toBeLessThan(2500);
    expect(symbolicNativeReview(doc, null).musicality.issues.map((issue) => issue.code)).toContain("HARSH_OVER_BASS");
  });
});
