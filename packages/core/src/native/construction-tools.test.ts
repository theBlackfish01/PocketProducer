import { describe, expect, it } from "vitest";
import { applyNativeOperations, nativeDocumentSchema, protectedPartHash } from "./model.js";
import { seedNativeDocument } from "./producer.js";
import { inspectEditableSound, NativeInspectionCache, sceneOperations, themeDevelopmentSchema, sectionSoundSchema } from "./construction-tools.js";
import { discoverNativeCapabilities } from "./catalog.js";
import { validateNativeOffline } from "./adapter.js";
import { searchNativeResources } from "./resources.js";

const scene = { stepKey: "scene", replaceSeed: true, title: "Exact timing", structure: { bars: 4, sections: [{ id: "first", name: "First", startBar: 0, endBar: 2 }, { id: "last", name: "Last", startBar: 2, endBar: 4 }] },
  parts: [{ id: "lead", name: "Lead", role: "melody", device: { type: "heisenberg", parameters: { "filter.cutoffFrequencyHz": 1200 } }, gain: 0.6, pan: 0 }],
  motifs: [{ id: "theme", partId: "lead", name: "Theme", lengthTicks: 3840, notes: [{ id: "n", startTick: 691, durationTicks: 1201, pitch: 64, velocity: 0.7 }] }],
  placements: [{ partId: "lead", placement: { id: "one", motifId: "theme", startTick: 0, repeats: 2, transpose: 0 } }, { partId: "lead", placement: { id: "two", motifId: "theme", startTick: 7680, repeats: 2, transpose: 0 } }] };
const built = () => applyNativeOperations(seedNativeDocument("Original melody"), sceneOperations(scene));

describe("focused construction tools", () => {
  it("expands compact patterns exactly with stable bounded note IDs and ordinary validation", async () => {
    const { motifs, ...base } = scene;
    const pattern = { ...motifs[0], id: "m".repeat(64), events: [[691, 1201, 64, 0.7], [2160, 240, 67, 0.5]] };
    const compact = { ...base, patterns: [pattern], placements: [{ partId: "lead", placement: { id: "first", motifId: pattern.id, startTick: 0, repeats: 1, transpose: 0 } }] };
    const operations = sceneOperations(compact);
    expect(sceneOperations(compact)).toEqual(operations);
    const doc = applyNativeOperations(seedNativeDocument("Original"), operations);
    expect(doc.motifs[0]!.notes.map(({ startTick, durationTicks, pitch, velocity }) => [startTick, durationTicks, pitch, velocity])).toEqual(pattern.events);
    expect(new Set(doc.motifs[0]!.notes.map((n) => n.id)).size).toBe(2);
    expect(doc.motifs[0]!.notes.every((n) => n.id.length <= 64)).toBe(true);
    expect(() => sceneOperations({ ...compact, patterns: [{ ...pattern, events: [[0.5, 20, 64, 0.7]] }] })).toThrow();
    expect(() => applyNativeOperations(doc, sceneOperations({ patterns: [pattern], stepKey: "duplicate" }))).toThrow();
    expect((await validateNativeOffline(doc)).readback.noteEntities).toBeGreaterThan(0);
  });
  it("ranks normal multiword recipe queries and pages sound controls without invented values", () => {
    expect(searchNativeResources("warm soft synth bass lead chords", []).presetRecipes.length).toBeGreaterThan(0);
    expect(searchNativeResources("unknownxyznothing", []).presetRecipes).toEqual([]);
    const first = inspectEditableSound(built(), "lead");
    expect(first.device.controls.length).toBeLessThanOrEqual(12);
    expect(first.device.nextOffset).toBe(12);
    const next = inspectEditableSound(built(), "lead", "", 12);
    expect(next.device.controls.some((c) => first.device.controls.some((a) => a.parameter === c.parameter))).toBe(false);
    expect(inspectEditableSound(built(), "lead", "filter").device.controls.every((c) => c.parameter.includes("filter"))).toBe(true);
  });
  it("maps the exact-tick scene through the pinned offline Nexus validator", async () => {
    const result = await validateNativeOffline(built());
    expect(result.readback.noteEntities).toBeGreaterThan(0);
  });
  it("constructs exact off-grid tick music without rounding or implicit form", () => {
    const document = built();
    expect(document.motifs[0]?.notes[0]).toMatchObject({ startTick: 691, durationTicks: 1201 });
    expect(document.sections.map((s) => s.endBar)).toEqual([2, 4]);
    expect(document.parts[0]?.placements).toHaveLength(2);
    expect(() => sceneOperations({ ...scene, motifs: [{ ...scene.motifs[0], lengthTicks: 0.72 }] })).toThrow();
  });
  it("develops only a named instance with genuine family lineage and lock enforcement", () => {
    const base = built();
    const args = themeDevelopmentSchema.parse({ stepKey: "develop", operations: [{ kind: "varyMotifInstance", partId: "lead", placementId: "two", newMotifId: "answer", name: "Answer", pitchShiftSemitones: 7 }] });
    const after = applyNativeOperations(base, args.operations);
    expect(after.parts[0]?.placements[0]?.motifId).toBe("theme");
    expect(after.motifs.find((m) => m.id === "answer")).toMatchObject({ familyId: "theme", derivedFromMotifId: "theme" });
    expect(after.motifs.find((m) => m.id === "answer")?.notes[0]?.pitch).toBe(71);
    expect(() => applyNativeOperations({ ...base, protectedPartIds: ["lead"] }, args.operations)).toThrow();
    expect(protectedPartHash(base, "lead")).toBe(protectedPartHash(built(), "lead"));
  });
  it("shapes a section with retained outside curves; rejects unrelated operations", () => {
    const base = applyNativeOperations(built(), [{ kind: "addAutomation", partId: "lead", automation: { id: "tone", target: "device.filter.cutoffFrequencyHz", points: [{ tick: 0, value: 0.2 }, { tick: 15360, value: 0.2 }] } }]);
    const args = sectionSoundSchema.parse({ stepKey: "shape", operations: [{ kind: "editSectionAutomation", partId: "lead", sectionId: "last", automationId: "tone", points: [{ tick: 7680, value: 0.2, interpolation: "linear" }, { tick: 15000, value: 0.6 }, { tick: 15360, value: 0.2 }] }] });
    const after = applyNativeOperations(base, args.operations);
    expect(after.parts[0]?.automation[0]?.points[0]).toEqual(base.parts[0]?.automation[0]?.points[0]);
    expect(after.parts[0]?.automation[0]?.points.at(-1)?.value).toBe(0.2);
    expect(() => sectionSoundSchema.parse({ stepKey: "bad", operations: [{ kind: "removePart", partId: "lead" }] })).toThrow();
  });
  it("returns only canonical writable sound controls without inventing defaults", () => {
    const result = inspectEditableSound(built(), "lead");
    expect(result.device.controls.find((c) => c.parameter === "filter.cutoffFrequencyHz")).toMatchObject({ value: 1200, unit: "Hz", automationTarget: "device.filter.cutoffFrequencyHz" });
    expect(inspectEditableSound(built(), "lead", "operatorA.waveformIndex").device.controls.find((c) => c.parameter === "operatorA.waveformIndex")?.value).toBeNull();
    expect(result.editExample.device).toEqual(built().parts[0]?.device);
  });
  it("caches only within a document hash and a producer instance", () => {
    const cache = new NativeInspectionCache(), base = built();
    const scope = { sectionIds: ["first"], soundPartIds: ["lead"] };
    const first = cache.read(base, scope);
    expect(cache.read(base, scope).sounds[0]).toBe(first.sounds[0]);
    const after = nativeDocumentSchema.parse({ ...base, title: "Changed" });
    expect(cache.read(after, scope).sounds[0]).not.toBe(first.sounds[0]);
    expect(new NativeInspectionCache().read(base, scope).sounds[0]).not.toBe(first.sounds[0]);
  });
  it.each(["heisenberg parameter ranges", "Beatbox8 drum note mapping", "automation target Heisenberg device filter cutoff frequency"])("discovers useful controls for %s", async (query) => {
    const result = await discoverNativeCapabilities(query);
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches[0]?.writableInPocketProducer).toBe(true);
    expect(result.guidance).toContain("inspect_editable_sound");
  });
  it("gives a useful empty search response without claiming an unsupported match", async () => {
    const result = await discoverNativeCapabilities("xyzunknownsynth");
    expect(result.matches).toEqual([]);
    expect(result.guidance).toContain("No matching capability");
  });
});
