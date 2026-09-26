import { describe, expect, it } from "vitest";
import { canonicalHash } from "../domain/composition.js";
import { applyNativeOperations, materializedNotes } from "./model.js";
import { nativeFormOperations, nativeFormSchema } from "./form.js";
import { seedNativeDocument } from "./producer.js";
import { validateNativeOffline } from "./adapter.js";

const phrase = (pitch: number) => ({ id: "phrase", name: "Quiet call", lengthBeats: 12, notes: [
  { beat: 0, durationBeats: 1.5, pitch, velocity: 0.52 },
  { beat: 4, durationBeats: 2, pitch: pitch + 3, velocity: 0.67 },
  { beat: 8, durationBeats: 1.5, pitch: pitch + 7, velocity: 0.61 }
] });

describe("model-directed native form", () => {
  it("normalizes floating-point noise without quantizing genuinely off-grid beats", () => {
    const base = nativeFormSchema.parse({ title: "Tick fidelity", tempoBpm: 120, meter: { numerator: 4, denominator: 4 },
      sections: [{ id: "whole", name: "Whole", bars: 4 }], parts: [{ id: "hook", name: "Hook", role: "melody", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0,
        motifs: [{ id: "theme", name: "Theme", lengthBeats: 4, notes: [{ beat: 1.025, durationBeats: 0.375, pitch: 64, velocity: 0.7 }] }], placements: [{ id: "first", motifId: "theme", startBar: 0, repeats: 1 }] }] });
    const operations = nativeFormOperations(base, []);
    const document = applyNativeOperations(seedNativeDocument("Tick fidelity"), operations);
    expect(document.motifs[0]!.notes[0]).toMatchObject({ startTick: 984, durationTicks: 360 });
    expect(nativeFormOperations(base, [])).toEqual(operations);
    const offGrid = structuredClone(base); offGrid.parts[0]!.motifs[0]!.notes[0]!.beat = 1.02;
    expect(() => nativeFormOperations(offGrid, [])).toThrow(/parts\[0\]\.motifs\[0\]\.notes\[0\]\.beat=1\.02.*1\/960 beat/);
    const triplet = structuredClone(base); triplet.parts[0]!.motifs[0]!.notes[0]!.beat = 1 / 3;
    expect(applyNativeOperations(seedNativeDocument("Triplet"), nativeFormOperations(triplet, [])).motifs[0]!.notes[0]!.startTick).toBe(320);
    const zeroDuration = structuredClone(base); zeroDuration.parts[0]!.motifs[0]!.notes[0]!.durationBeats = 0;
    expect(() => nativeFormOperations(zeroDuration, [])).toThrow();
    const crosses = structuredClone(base); crosses.parts[0]!.motifs[0]!.notes[0]!.beat = 3.5; crosses.parts[0]!.motifs[0]!.notes[0]!.durationBeats = 1;
    expect(() => applyNativeOperations(seedNativeDocument("Cross"), nativeFormOperations(crosses, []))).toThrow();
  });
  it("builds a non-template 3/4 form with intentional instrument settings and readback", async () => {
    const form = nativeFormSchema.parse({ title: "Three rooms", tempoBpm: 74, meter: { numerator: 3, denominator: 4 },
      sections: [{ id: "arrival", name: "Arrival", bars: 8, intent: "Unaccompanied call" }, { id: "answer", name: "Answer", bars: 8, intent: "Piano counterline" }, { id: "leave", name: "Leave", bars: 8, intent: "Thin to one voice" }],
      parts: [{ id: "glass", name: "Glass voice", role: "melody", device: { type: "heisenberg", parameters: { "operatorA.gain": 0.23, "filter.cutoffFrequencyHz": 1470 } }, gain: 0.58, pan: -0.12,
        motifs: [phrase(64)], placements: [{ id: "call", motifId: "phrase", startBar: 0, repeats: 2 }, { id: "return", motifId: "phrase", startBar: 16, repeats: 2 }],
        effects: [{ id: "room", type: "stompboxReverb", parameters: { roomSizeFactor: 0.64, mix: 0.22 } }],
        automation: [{ id: "fade", target: "gain", points: [{ tick: 0, value: 0.4 }, { tick: 46080, value: 0.68 }, { tick: 69120, value: 0.25 }] }] }] });
    const document = applyNativeOperations(seedNativeDocument("Three-room chamber sketch"), nativeFormOperations(form, []));
    expect(document.bars).toBe(24);
    expect(document.meter).toEqual({ numerator: 3, denominator: 4 });
    expect(document.parts).toHaveLength(1);
    expect(materializedNotes(document, "glass")).toHaveLength(12);
    const mapped = await validateNativeOffline(document);
    const text = JSON.stringify(mapped.structuralReadback);
    expect(text).toContain("1470");
    expect(text).toContain("0.23");
    expect(text).toContain("0.64");
    expect(mapped.readback.noteEntities).toBe(6);
    expect(canonicalHash(mapped.structuralReadback)).toMatch(/^[a-f0-9]{64}$/);
  }, 60_000);

  it("preserves server-owned source provenance and maps a nonzero selected interval", async () => {
    const assetId = "11111111-1111-4111-8111-111111111111";
    const source = { assetId, assetHash: "a".repeat(64), durationSeconds: 12, rights: "User-owned fixture" };
    const form = nativeFormSchema.parse({ title: "Found-sound study", tempoBpm: 96, meter: { numerator: 4, denominator: 4 },
      sections: [{ id: "intro", name: "Intro", bars: 4 }, { id: "body", name: "Body", bars: 8 }],
      parts: [{ id: "field", name: "Field cut", role: "source", device: { type: "audio", parameters: {} }, gain: 0.5, pan: 0,
        motifs: [], placements: [], sources: [{ id: "late-interval", assetId, startBar: 4, durationBars: 2, sourceStartSeconds: 5, sourceDurationSeconds: 3, playbackMode: "loop", gain: 0.7 }] }] });
    const document = applyNativeOperations(seedNativeDocument("Use the later source event"), nativeFormOperations(form, [source]));
    expect(document.parts[0]!.sourceRegions[0]).toMatchObject({ assetId, assetHash: source.assetHash, sourceStartSeconds: 5, sourceDurationSeconds: 3, startTick: 15360, durationTicks: 7680, rights: source.rights });
    const local = await validateNativeOffline(document);
    expect(local.unresolvedSources).toEqual(["late-interval"]);
    const mapped = await validateNativeOffline(document, { [assetId]: { sampleName: "samples/11111111-1111-4111-8111-111111111111", durationSeconds: 12 } });
    expect(mapped.unresolvedSources).toEqual([]);
    expect(mapped.structuralReadback.semanticEntities.some((value) => value.type === "audioRegion")).toBe(true);
    expect(JSON.stringify(mapped.structuralReadback)).toContain("samples/11111111-1111-4111-8111-111111111111");
    expect(JSON.stringify(mapped.structuralReadback)).toContain("30720");
    expect(() => nativeFormOperations(form, [])).toThrow(/not an owned source/);
    expect(() => nativeFormOperations(form, [{ ...source, durationSeconds: 6 }])).toThrow(/exceeds owned source/);
  });
});
