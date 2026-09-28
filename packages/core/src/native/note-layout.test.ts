import { createOfflineDocument } from "@audiotool/nexus/node";
import { describe, expect, it } from "vitest";
import { applyNativeSnapshot, nativeMappingVersion, nativeStructuralReadback, toNexusTicks } from "./adapter.js";
import { materializedNotes, nativeDocumentSchema } from "./model.js";
import { seedNativeDocument } from "./producer.js";

function score() {
  const base = seedNativeDocument("A repeating groove with extra fills");
  return nativeDocumentSchema.parse({ ...base, bars: 8,
    sections: [{ id: "first", name: "First", startBar: 0, endBar: 4 }, { id: "second", name: "Second", startBar: 4, endBar: 8 }],
    motifs: [{ id: "pulse", partId: "starting-voice", name: "Main pulse", lengthTicks: 3840,
      notes: [{ id: "hit", startTick: 0, durationTicks: 480, pitch: 60, velocity: 0.7 }, { id: "held", startTick: 2880, durationTicks: 960, pitch: 64, velocity: 0.4 }] }],
    parts: [{ ...base.parts[0], placements: [{ id: "groove", motifId: "pulse", startTick: 0, repeats: 8, transpose: 2 }],
      notes: [{ id: "boundary", startTick: 15000, durationTicks: 960, pitch: 67, velocity: 0.6 },
        { id: "fill", startTick: 22080, durationTicks: 240, pitch: 69, velocity: 0.8 },
        { id: "intentional-unison", startTick: 22080, durationTicks: 240, pitch: 69, velocity: 0.8 }],
      automation: [{ id: "opening", target: "gain", points: [{ tick: 0, value: 0.3 }, { tick: 30719, value: 0.7 }] }]
    }]
  });
}

function expandedNotes(doc: Awaited<ReturnType<typeof createOfflineDocument>>) {
  const result: number[][] = [];
  for (const region of doc.queryEntities.ofTypes("noteRegion").get()) {
    const fields = region.fields.region.fields;
    const notes = doc.queryEntities.ofTypes("note").get().filter(n => n.fields.collection.value.entityId === region.fields.collection.value.entityId);
    for (let offset = 0; offset < fields.durationTicks.value; offset += fields.loopDurationTicks.value) {
      for (const n of notes) result.push([fields.positionTicks.value + offset + n.fields.positionTicks.value, n.fields.durationTicks.value, n.fields.pitch.value, n.fields.velocity.value]);
    }
  }
  return result.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

describe("native note-lane visibility", () => {
  it.each(["heisenberg", "gakki", "pulverisateur"] as const)("keeps %s extra notes off the phrase lane without changing musical events or routing", async type => {
    const document = score();
    document.parts[0]!.device = { type, parameters: {} };
    // Historical Gakki scores are still exportable without introducing a new unpinned kit.
    if (type === "gakki") document.mixSemantics = undefined;
    const original = JSON.stringify(document);
    const doc = await createOfflineDocument({ validated: true });
    await applyNativeSnapshot(doc, document);
    const tracks = doc.queryEntities.ofTypes("noteTrack").get();
    expect(tracks).toHaveLength(2);
    expect(tracks[0]!.fields.player.value).toEqual(tracks[1]!.fields.player.value);
    const regions = doc.queryEntities.ofTypes("noteRegion").get();
    expect(new Set(regions.map(r => r.fields.track.value.entityId)).size).toBe(2);
    expect(doc.queryEntities.ofTypes(type).get()).toHaveLength(1);
    expect(doc.queryEntities.ofTypes("mixerChannel").get()).toHaveLength(1);
    // Nexus stores velocity as float32; integer ticks/pitch remain exact.
    expect(expandedNotes(doc)).toEqual(materializedNotes(document, "starting-voice").map(n => [toNexusTicks(n.startTick), toNexusTicks(n.durationTicks), n.pitch, Math.fround(n.velocity)]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
    expect(tracks.map(t => t.fields.orderAmongTracks.value).sort()).toEqual([0, 0.5]);
    expect(JSON.stringify(document)).toBe(original);
  });

  it("preserves the old checkpoint layout and all non-note routing/automation semantics", async () => {
    const old = await createOfflineDocument({ validated: true });
    const current = await createOfflineDocument({ validated: true });
    const repeat = await createOfflineDocument({ validated: true });
    await applyNativeSnapshot(old, score(), {}, {}, {}, "nexus-native-v8");
    await applyNativeSnapshot(current, score());
    await applyNativeSnapshot(repeat, score());
    expect(old.queryEntities.ofTypes("noteTrack").get()).toHaveLength(1);
    expect(expandedNotes(current)).toEqual(expandedNotes(old));
    const nonNotes = (doc: typeof old) => nativeStructuralReadback(doc).semanticEntities.filter(e => !e.type?.startsWith("note"));
    expect(nonNotes(current)).toEqual(nonNotes(old));
    expect(nativeStructuralReadback(current)).toEqual(nativeStructuralReadback(repeat));
    expect(nativeMappingVersion(null)).toBe("nexus-native-v8");
    expect(() => nativeMappingVersion("unknown-version")).toThrow(/Unsupported/);
  });

  it.each(["phrases", "individual notes"])("retains one note lane for %s alone", async kind => {
    const document = score();
    if (kind === "phrases") document.parts[0]!.notes = [];
    else document.parts[0]!.placements = [];
    const doc = await createOfflineDocument({ validated: true });
    await applyNativeSnapshot(doc, document);
    expect(doc.queryEntities.ofTypes("noteTrack").get()).toHaveLength(1);
  });
});
