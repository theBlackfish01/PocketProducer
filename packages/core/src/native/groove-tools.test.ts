import { describe, expect, it } from "vitest";
import { applyNativeOperations, materializedNotes, nativeDocumentSchema, type NativeDocument } from "./model.js";
import { seedNativeDocument } from "./producer.js";
import { sceneOperations } from "./construction-tools.js";
import { compileDrumGroove } from "./groove-tools.js";
import { gmDrums } from "./grooves.js";
import { analyzeNativeMusicality } from "./musicality.js";
import { analyzeNativeRichness } from "./richness.js";
import { NativeCorrectableError } from "./errors.js";
import { validateNativeOffline } from "./adapter.js";

const kitPreset = { name: "presets/test-brush-kit", displayName: "Brush Drum Kit", ownerName: "users/audiotool", contentHash: "a".repeat(64) };
/** Sixteen bars in two sections with a Gakki kit, a Beatbox8 and a synth, all silent. */
function room(meter = { numerator: 4, denominator: 4 }): NativeDocument {
  const base = applyNativeOperations(seedNativeDocument("A groove"), sceneOperations({ stepKey: "base", replaceSeed: true, meter, structure: { bars: 16, sections: [{ id: "a", name: "A", startBar: 0, endBar: 8 }, { id: "b", name: "B", startBar: 8, endBar: 16 }] },
    parts: [{ id: "steps", name: "Steps", role: "percussion", recipe: "dry-step-kit" }, { id: "keys", name: "Keys", role: "harmony", recipe: "lofi-keys" }] }));
  return nativeDocumentSchema.parse({ ...base, parts: [...base.parts, { ...base.parts[0]!, id: "kit", name: "Kit", device: { type: "gakki", preset: kitPreset, parameters: {} }, effects: [] }] });
}
/** The drum voices of one bar in order of nominal sixteenth, ignoring swing and humanize nudges. */
const pitchesByBar = (notes: Array<{ startTick: number; pitch: number }>, barTicks: number) => (index: number) => notes.filter((note) => note.startTick + 120 >= index * barTicks && note.startTick + 120 < (index + 1) * barTicks)
  .map((note) => `${Math.round((note.startTick - index * barTicks) / 240)}:${note.pitch}`).sort().join(" ");
const groove = (overrides: Record<string, unknown> = {}) => ({ partId: "kit", sectionIds: ["a", "b"], style: "boom-bap", ...overrides }) as Parameters<typeof compileDrumGroove>[0];

describe("drum groove shortcut", () => {
  it("writes a swung, dynamic kit groove with a fill closing each section", () => {
    const doc = room();
    const ops = compileDrumGroove(groove(), doc);
    expect(ops.every((op) => op.kind === "addNotes")).toBe(true);
    expect(compileDrumGroove(groove(), doc)).toEqual(ops);
    const after = applyNativeOperations(doc, ops), notes = materializedNotes(after, "kit");
    expect(notes.length).toBeGreaterThan(100);
    expect(notes.every((note) => Object.values(gmDrums).includes(note.pitch as never) && note.startTick >= 0 && note.startTick + note.durationTicks <= 16 * 3840)).toBe(true);
    // Dynamics and swing: several velocity levels, and some hits off the straight sixteenth grid.
    expect(new Set(notes.map((note) => Math.round(note.velocity * 10))).size).toBeGreaterThanOrEqual(4);
    expect(notes.some((note) => note.startTick % 240 !== 0)).toBe(true);
    // The last bar of each section differs from the loop: a fill marks the change and the ending.
    const bar = pitchesByBar(notes, 3840);
    expect(bar(7)).not.toBe(bar(5));
    expect(bar(15)).not.toBe(bar(13));
    expect(bar(4)).toBe(bar(2));
    const richness = analyzeNativeRichness(after, "focused");
    expect(richness.boundaries).toEqual({ marked: 1, total: 1 });
    expect(richness.endingWritten).toBe(true);
    expect(analyzeNativeMusicality(after).issues.map((issue) => issue.code)).not.toContain("MECHANICAL_DRUMS");
  });

  it("projects the same groove onto Beatbox8 as two reusable step patterns", async () => {
    const doc = room();
    const ops = compileDrumGroove(groove({ partId: "steps", style: "four-on-the-floor", bars: 2 }), doc);
    expect(ops.map((op) => op.kind)).toEqual(["defineMotif", "placeMotif", "defineMotif", "placeMotif", "placeMotif", "placeMotif"]);
    const after = applyNativeOperations(doc, ops), notes = materializedNotes(after, "steps");
    expect(after.motifs.filter((motif) => motif.partId === "steps")).toHaveLength(2);
    expect(notes.every((note) => [36, 38, 42, 46].includes(note.pitch) && note.startTick % 240 === 0 && note.durationTicks === 240 && note.velocity === 1)).toBe(true);
    // Kick on every beat of the first bar.
    expect(notes.filter((note) => note.pitch === 36 && note.startTick < 3840).map((note) => note.startTick)).toEqual([0, 960, 1920, 2880]);
    // The offline SDK mapping accepts the step patterns (the fixture's unresolved kit part is left out).
    await validateNativeOffline(nativeDocumentSchema.parse({ ...after, parts: after.parts.filter((item) => item.id !== "kit") }));
  });

  it("fits odd section lengths and other meters, and honours fill none", () => {
    const waltz = room({ numerator: 3, denominator: 4 });
    const ops = compileDrumGroove(groove({ style: "brushed-waltz", fill: "none", bars: 4 }), waltz);
    const notes = materializedNotes(applyNativeOperations(waltz, ops), "kit");
    expect(notes.every((note) => note.startTick < 16 * 2880)).toBe(true);
    const bar = pitchesByBar(notes, 2880);
    expect(bar(7)).toBe(bar(3));
    // A five-bar section cannot hold a two-bar cycle: the groove falls back to one bar.
    const odd = nativeDocumentSchema.parse({ ...room(), sections: [{ id: "a", name: "A", startBar: 0, endBar: 5 }, { id: "b", name: "B", startBar: 5, endBar: 16 }] });
    expect(() => compileDrumGroove(groove({ sectionIds: ["a"] }), odd)).not.toThrow();
  });

  it("composes a kit groove, harmony and shared reverb in one scene", () => {
    const seed = seedNativeDocument("A groove");
    const scene = { stepKey: "all", replaceSeed: true, structure: { bars: 8, sections: [{ id: "a", name: "A", startBar: 0, endBar: 4 }, { id: "b", name: "B", startBar: 4, endBar: 8 }] },
      parts: [{ id: "drums", name: "Drums", role: "percussion", kit: "brush-kit", device: { type: "gakki", preset: kitPreset, parameters: {} }, gain: 0.7, pan: 0 },
        { id: "keys", name: "Keys", role: "harmony", recipe: "lofi-keys", gain: 0.6, pan: 0 }, { id: "bass", name: "Bass", role: "bass", recipe: "dusty-bass", gain: 0.7, pan: 0 }],
      harmony: [{ sectionIds: ["a", "b"], key: "D minor", chords: [{ symbol: "Dm9", bars: 2 }, { symbol: "Bbmaj7", bars: 2 }], comp: { partId: "keys" }, bass: { partId: "bass", pattern: "syncopated" }, ending: { symbol: "Dm9", bars: 1 } }],
      grooves: [{ partId: "drums", sectionIds: ["a", "b"], style: "boom-bap" }], space: "room" };
    const ops = sceneOperations(scene, seed);
    expect(sceneOperations(scene, seed)).toEqual(ops);
    const after = applyNativeOperations(seed, ops);
    expect(materializedNotes(after, "drums").length).toBeGreaterThan(40);
    expect(after.reverbBus).toMatchObject({ id: "shared-room" });
    // Sends by role: drums a little, keys more, bass none.
    const send = (partId: string) => after.parts.find((item) => item.id === partId)!.sends?.[0]?.gain;
    expect([send("drums"), send("keys"), send("bass")]).toEqual([0.06, 0.16, undefined]);
    const richness = analyzeNativeRichness(after, "focused");
    expect(richness.gaps.map((gap) => gap.code)).not.toContain("STATIC_SOUND");
    expect(richness.gaps.map((gap) => gap.code)).not.toContain("NO_ENDING");
    expect(richness.gaps.map((gap) => gap.code)).not.toContain("NO_TRANSITIONS");
    // A later scene with space only adds what is missing: a new part gets its send, nothing is duplicated.
    const later = applyNativeOperations(after, sceneOperations({ stepKey: "more", parts: [{ id: "lead", name: "Lead", role: "lead", recipe: "soft-lead", gain: 0.5, pan: 0.1 }], space: "hall" }, after));
    expect(later.reverbBus).toMatchObject({ id: "shared-room" });
    expect(later.parts.find((item) => item.id === "lead")!.sends).toEqual([{ busId: "shared-room", gain: 0.2 }]);
    expect(later.parts.find((item) => item.id === "keys")!.sends).toHaveLength(1);
    // A kit that was never resolved (no library) is a correctable reply, not a bare Gakki.
    expect(() => sceneOperations({ stepKey: "bare", parts: [{ id: "kit2", name: "Kit", role: "percussion", kit: "jazz-kit", gain: 0.7, pan: 0 }] }, after)).toThrow(/was not resolved/);
  });

  it("refuses misuse with correctable guidance", () => {
    const doc = room();
    expect(() => compileDrumGroove(groove({ partId: "keys" }), doc)).toThrow(/not a drum instrument/);
    const written = applyNativeOperations(doc, compileDrumGroove(groove({ sectionIds: ["a"] }), doc));
    let thrown: unknown;
    try { compileDrumGroove(groove({ sectionIds: ["a"] }), written); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(NativeCorrectableError);
    expect((thrown as NativeCorrectableError).toolText()).toContain("already plays in A");
    expect(() => compileDrumGroove(groove({ sectionIds: ["missing"] }), doc)).toThrow(/Unknown section/);
    // A pinned Gakki sound on a pitched role is an instrument, not a kit.
    const piano = nativeDocumentSchema.parse({ ...doc, parts: doc.parts.map((item) => item.id === "kit" ? { ...item, role: "harmony" } : item) });
    expect(() => compileDrumGroove(groove(), piano)).toThrow(/not a drum instrument/);
    // A groove that would overflow the part is refused with a way forward, not a schema error.
    const long = nativeDocumentSchema.parse({ ...doc, bars: 128, meter: { numerator: 12, denominator: 4 }, sections: [{ id: "a", name: "A", startBar: 0, endBar: 64, intent: "" }, { id: "b", name: "B", startBar: 64, endBar: 128, intent: "" }] });
    let overflow: unknown;
    try { compileDrumGroove(groove({ density: "busy" }), long); } catch (error) { overflow = error; }
    expect(overflow).toBeInstanceOf(NativeCorrectableError);
    expect((overflow as NativeCorrectableError).toolText()).toMatch(/a part holds 4,096.*Next: Use a lower density/);
  });

  it("leaves a protected part's mix alone when adding shared space, and says when there is nothing to add", () => {
    const doc = room();
    const locked = applyNativeOperations(doc, [{ kind: "protect", partIds: ["keys"], motifIds: [] }]);
    const after = applyNativeOperations(locked, sceneOperations({ stepKey: "space", space: "room" }, locked));
    expect(after.reverbBus).toMatchObject({ id: "shared-room" });
    expect(after.parts.find((item) => item.id === "keys")!.sends ?? []).toEqual([]);
    expect(after.parts.find((item) => item.id === "kit")!.sends).toEqual([{ busId: "shared-room", gain: 0.06 }]);
    let nothing: unknown;
    try { sceneOperations({ stepKey: "again", space: "room" }, after); } catch (error) { nothing = error; }
    expect(nothing).toBeInstanceOf(NativeCorrectableError);
    expect((nothing as NativeCorrectableError).toolText()).toContain("This scene changes nothing");
  });
});
