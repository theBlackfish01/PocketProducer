import { describe, expect, it } from "vitest";
import { applyNativeOperations, nativeDocumentSchema, nativeMusicHash, pinnedContext } from "./model.js";
import { seedNativeDocument } from "./producer.js";

const voice = (id: string) => ({ id, name: id, role: "melody" as const, device: { type: "heisenberg" as const, parameters: {} }, gain: 0.7, pan: 0, notes: [], placements: [], sourceRegions: [], effects: [], automation: [] });

describe("verified phrase lineage", () => {
  it("retains a root, one-instance variation and an instrument handoff without changing unrelated placements", () => {
    const base = applyNativeOperations(seedNativeDocument("Theme"), [{ kind: "setStructure", bars: 8, sections: [{ id: "first", name: "First", startBar: 0, endBar: 4, intent: "" }, { id: "return", name: "Return", startBar: 4, endBar: 8, intent: "" }] },
      { kind: "removePart", partId: "starting-voice" }, { kind: "addPart", part: voice("lead") }, { kind: "addPart", part: voice("keys") },
      { kind: "defineMotif", motif: { id: "theme", partId: "lead", name: "Theme", lengthTicks: 3840, notes: [{ id: "one", startTick: 0, durationTicks: 960, pitch: 64, velocity: 0.7 }, { id: "two", startTick: 960, durationTicks: 960, pitch: 67, velocity: 0.7 }] } },
      { kind: "placeMotif", partId: "lead", placement: { id: "first-theme", motifId: "theme", startTick: 0, repeats: 1, transpose: 0 } }, { kind: "placeMotif", partId: "lead", placement: { id: "return-theme", motifId: "theme", startTick: 15360, repeats: 1, transpose: 0 } }]);
    const changed = applyNativeOperations(base, [{ kind: "varyMotifInstance", partId: "lead", placementId: "return-theme", newMotifId: "theme-variation", name: "New ending", noteEdits: [{ noteId: "two", pitch: 69 }] },
      { kind: "handoffMotif", sourceMotifId: "theme", targetPartId: "keys", newMotifId: "theme-keys", name: "Keys answer", placementId: "keys-answer", startTick: 19200, repeats: 1, transpose: -12 }]);
    expect(changed.parts.find((part) => part.id === "lead")?.placements[0]?.motifId).toBe("theme");
    expect(changed.parts.find((part) => part.id === "lead")?.placements[1]?.motifId).toBe("theme-variation");
    expect(changed.motifs.map((motif) => [motif.id, motif.familyId ?? motif.id, motif.derivedFromMotifId ?? null])).toEqual([["theme", "theme", null], ["theme-variation", "theme", "theme"], ["theme-keys", "theme", "theme"]]);
    expect((pinnedContext(changed, null).motifs as Array<{ familyId: string }>).every((motif) => motif.familyId === "theme")).toBe(true);
    expect(nativeMusicHash(changed)).not.toBe(nativeMusicHash(base));
  });
  it("cannot invent a family or repair an old document by matching a name", () => {
    const base = seedNativeDocument("Old unlinked motif");
    const root = applyNativeOperations(base, [{ kind: "defineMotif", motif: { id: "first", partId: "starting-voice", name: "Same name", lengthTicks: 960, notes: [{ id: "note", startTick: 0, durationTicks: 480, pitch: 60, velocity: 0.6 }] } }]);
    expect(root.motifs[0]?.familyId).toBeUndefined();
    expect(() => nativeDocumentSchema.parse({ ...root, motifs: [{ ...root.motifs[0], id: "fake", familyId: "first" }] })).toThrow(/family identity/);
    expect(() => nativeDocumentSchema.parse({ ...root, motifs: [{ ...root.motifs[0], id: "fake", familyId: "first", derivedFromMotifId: "missing" }] })).toThrow(/provenance/);
  });
});
