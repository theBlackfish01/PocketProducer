import { describe, expect, it } from "vitest";
import { applyNativeOperations, nativeDocumentSchema, type NativeDocument } from "./model.js";
import { seedNativeDocument } from "./producer.js";
import { sceneOperations } from "./construction-tools.js";
import { analyzeNativeRichness, richnessChecklist } from "./richness.js";
import { analyzeNativeMusicality } from "./musicality.js";
import { NativeCorrectableError } from "./errors.js";

const codes = (document: NativeDocument, depth: "focused" | "detailed" = "focused") => analyzeNativeRichness(document, depth).gaps.map((gap) => gap.code);
const part = (id: string, role: string, recipe: string, gain = 0.6) => ({ id, name: id, role, recipe, gain, pan: 0 });
const loop = (id: string, partId: string, pitch: number, velocity = 0.7) => ({ id, partId, name: id, lengthTicks: 3840, events: [[0, 480, pitch, velocity], [960, 480, pitch + 3, velocity], [1920, 480, pitch + 7, velocity], [2880, 480, pitch + 3, velocity]] });
const place = (partId: string, motifId: string, startBar: number, repeats: number, id = `${motifId}-${startBar}`) => ({ partId, placement: { id, motifId, startTick: startBar * 3840, repeats, transpose: 0 } });

/** Sixteen bars in two sections; every part loops one bar throughout. */
function looped(parts: Array<{ id: string; role: string; recipe: string }>): NativeDocument {
  return applyNativeOperations(seedNativeDocument("A groove"), sceneOperations({ stepKey: "base", replaceSeed: true, structure: { bars: 16, sections: [{ id: "a", name: "A", startBar: 0, endBar: 8 }, { id: "b", name: "B", startBar: 8, endBar: 16 }] },
    parts: parts.map((item) => part(item.id, item.role, item.recipe)), patterns: parts.map((item, index) => loop(`${item.id}-loop`, item.id, 48 + index * 7)), placements: parts.map((item) => place(item.id, `${item.id}-loop`, 0, 16)) }));
}

describe("the starting sketch", () => {
  it("cannot be removed on its own, but can be replaced in one batch", () => {
    const seed = seedNativeDocument("A groove");
    const only = seed.parts[0]!.id;
    let thrown: unknown;
    try { applyNativeOperations(seed, [{ kind: "removePart", partId: only }]); } catch (error) { thrown = error; }
    expect(thrown).toBeInstanceOf(NativeCorrectableError);
    expect((thrown as NativeCorrectableError).toolText()).toMatch(/^Error \[LAST_PART_REQUIRED\]: .*replaceSeed:true/);
    const replaced = applyNativeOperations(seed, [{ kind: "removePart", partId: only }, { kind: "addPart", part: { ...seed.parts[0]!, id: "keys", name: "Keys" } }]);
    expect(replaced.parts.map((item) => item.id)).toEqual(["keys"]);
  });
});

describe("arrangement richness scorecard", () => {
  const trio = [{ id: "keys", role: "harmony", recipe: "lofi-keys" }, { id: "bass", role: "bass", recipe: "dusty-bass" }, { id: "lead", role: "lead", recipe: "soft-lead" }];

  it("names what is thin in a looped three-part piece", () => {
    const thin = looped(trio);
    const analysis = analyzeNativeRichness(thin, "focused");
    expect(analysis.layers).toMatchObject({ fullest: 3, target: 4, bySection: { a: 3, b: 3 } });
    expect(analysis.contrasts).toEqual([{ from: "a", to: "b", changed: [] }]);
    expect(analysis.gaps.map((gap) => gap.code)).toEqual(["THIN_ARRANGEMENT", "FLAT_SECTIONS", "NO_TRANSITIONS", "NO_ENDING", "STATIC_SOUND"]);
    const checklist = richnessChecklist(analysis);
    // Codes and one next step: this form rides on every request.
    expect(checklist.stillThin).toEqual(["THIN_ARRANGEMENT", "FLAT_SECTIONS", "NO_TRANSITIONS", "NO_ENDING", "STATIC_SOUND"]);
    expect(checklist.next).toBe(analysis.gaps[0]!.next);
    expect(JSON.stringify(checklist).length).toBeLessThan(420);
    expect(checklist.note).toContain("the brief wins");
    expect(JSON.stringify(richnessChecklist(analyzeNativeRichness(thin, "detailed"))).length).toBeLessThan(420);
  });

  it("clears each gap when the arrangement gains a layer, contrast, a fill, an ending and movement", () => {
    const thin = looped(trio);
    // A fourth layer that enters in B, with a busier, higher phrase there.
    const fuller = applyNativeOperations(thin, sceneOperations({ stepKey: "arp", parts: [part("arp", "texture", "pluck-arp")],
      patterns: [{ id: "arp-b", partId: "arp", name: "Arp", lengthTicks: 3840, events: Array.from({ length: 8 }, (_, i) => [i * 480, 240, 72 + (i % 3) * 4, 0.6]) }], placements: [place("arp", "arp-b", 8, 8)] }, thin));
    expect(codes(fuller)).not.toContain("THIN_ARRANGEMENT");
    expect(analyzeNativeRichness(fuller, "focused").contrasts[0]!.changed).toEqual(["parts"]);
    // The lead rises in B: a second difference clears FLAT_SECTIONS.
    const lifted = applyNativeOperations(fuller, [{ kind: "developSectionNotes", partId: "lead", sectionId: "b", key: "C minor", diatonicSteps: 4 }]);
    expect(analyzeNativeRichness(lifted, "focused").contrasts[0]!.changed).toEqual(["parts", "register", "material"]);
    expect(codes(lifted)).toEqual(["NO_TRANSITIONS", "NO_ENDING", "STATIC_SOUND"]);
    // A pickup in the last bar of A marks the change; a held last note ends the piece.
    const marked = applyNativeOperations(lifted, [{ kind: "addNotes", partId: "bass", notes: [{ id: "pickup", startTick: 7 * 3840 + 3360, durationTicks: 240, pitch: 46, velocity: 0.7 }, { id: "last", startTick: 15 * 3840 + 3600, durationTicks: 240, pitch: 36, velocity: 0.8 }] }]);
    expect(analyzeNativeRichness(marked, "focused")).toMatchObject({ boundaries: { marked: 1, total: 1 }, endingWritten: true });
    expect(codes(marked)).toEqual(["STATIC_SOUND"]);
    const moving = applyNativeOperations(marked, [{ kind: "addAutomation", partId: "keys", automation: { id: "open", target: "device.filter.cutoffFrequencyHz", points: [{ tick: 30720, value: 0.3, interpolation: "linear" }, { tick: 61439, value: 0.7 }] } }]);
    expect(codes(moving)).toEqual([]);
  });

  it("asks more of a detailed arrangement, and nothing of a short sketch", () => {
    const thin = looped(trio);
    expect(codes(thin, "detailed")).toEqual(["THIN_ARRANGEMENT", "FLAT_SECTIONS", "NO_TRANSITIONS", "NO_ENDING", "STATIC_SOUND"]);
    // One curve satisfies focused movement but not detailed, which wants shared space too.
    const oneCurve = applyNativeOperations(thin, [{ kind: "addAutomation", partId: "keys", automation: { id: "open", target: "gain", points: [{ tick: 0, value: 0.4, interpolation: "linear" }, { tick: 61439, value: 0.6 }] } }]);
    expect(codes(oneCurve)).not.toContain("STATIC_SOUND");
    expect(codes(oneCurve, "detailed")).toContain("STATIC_SOUND");
    // Two roles on one identical patch only matters at detailed depth.
    const twins = looped([{ id: "keys", role: "harmony", recipe: "lofi-keys" }, { id: "lead", role: "lead", recipe: "lofi-keys" }]);
    expect(codes(twins)).not.toContain("SHARED_PATCH");
    expect(codes(twins, "detailed")).toContain("SHARED_PATCH");
    const sketch = nativeDocumentSchema.parse({ ...thin, bars: 4, sections: [{ id: "a", name: "A", startBar: 0, endBar: 4 }], parts: thin.parts.map((item) => ({ ...item, placements: item.placements.map((value) => ({ ...value, repeats: 4 })) })) });
    expect(codes(sketch)).toEqual([]);
  });

  it("flags a mix where every part plays softly at a low gain", () => {
    const quiet = applyNativeOperations(seedNativeDocument("A sketch"), sceneOperations({ stepKey: "quiet", replaceSeed: true, structure: { bars: 8, sections: [{ id: "a", name: "A", startBar: 0, endBar: 8 }] },
      parts: [part("pulse", "texture", "pluck-arp", 0.4), part("bell", "lead", "glass-bell", 0.38)], patterns: [loop("pulse-loop", "pulse", 57, 0.33), loop("bell-loop", "bell", 69, 0.43)], placements: [place("pulse", "pulse-loop", 0, 8), place("bell", "bell-loop", 0, 8)] }));
    const issue = analyzeNativeMusicality(quiet).issues.find((item) => item.code === "QUIET_MIX");
    expect(issue).toMatchObject({ severity: "medium", partId: "bell" });
    expect(issue!.detail).toContain("16%");
    const audible = applyNativeOperations(quiet, [{ kind: "setMix", partId: "bell", gain: 0.6 }]);
    expect(analyzeNativeMusicality(audible).issues.map((item) => item.code)).not.toContain("QUIET_MIX");
  });

  it("counts an audio clip as a layer where it plays, and does not judge the level of a mix that has one", () => {
    const quiet = applyNativeOperations(seedNativeDocument("A sketch"), sceneOperations({ stepKey: "quiet", replaceSeed: true, structure: { bars: 16, sections: [{ id: "a", name: "A", startBar: 0, endBar: 8 }, { id: "b", name: "B", startBar: 8, endBar: 16 }] },
      parts: [part("pad", "harmony", "warm-pad", 0.4)], patterns: [loop("pad-loop", "pad", 57, 0.33)], placements: [place("pad", "pad-loop", 0, 16)] }));
    expect(analyzeNativeRichness(quiet, "focused").layers.bySection).toEqual({ a: 1, b: 1 });
    expect(analyzeNativeMusicality(quiet).issues.map((item) => item.code)).toContain("QUIET_MIX");
    // An owned recording that plays through the second section only.
    const withClip = applyNativeOperations(quiet, [{ kind: "addPart", part: { id: "field", name: "Field recording", role: "source", device: { type: "audio", parameters: {} }, gain: 0.9, pan: 0, notes: [], placements: [], effects: [], automation: [],
      sourceRegions: [{ id: "take", assetId: "00000000-0000-4000-8000-000000000001", assetHash: "a".repeat(64), startTick: 8 * 3840, durationTicks: 8 * 3840, sourceStartSeconds: 0, sourceDurationSeconds: 8, playbackMode: "once", gain: 0.9, rights: "Owned test sound" }] } }]);
    const scored = analyzeNativeRichness(withClip, "focused");
    expect(scored.layers).toMatchObject({ fullest: 2, bySection: { a: 1, b: 2 } });
    expect(scored.contrasts[0]!.changed).toContain("parts");
    expect(analyzeNativeMusicality(withClip).issues.map((item) => item.code)).not.toContain("QUIET_MIX");
    // A piece made only of clips has layers too.
    const clipsOnly = applyNativeOperations(withClip, [{ kind: "removePart", partId: "pad" }]);
    expect(analyzeNativeRichness(clipsOnly, "focused").layers.bySection).toEqual({ a: 0, b: 1 });
  });
});
