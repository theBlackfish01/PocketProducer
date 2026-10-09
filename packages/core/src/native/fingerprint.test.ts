import { expect, it } from "vitest";
import { activityPayloadSchema } from "./activity.js";
import { nativeFingerprint, revisionFingerprint } from "./fingerprint.js";
import type { NativeDocument } from "./model.js";

const part = (id: string, role: string, extra: Partial<NativeDocument["parts"][number]> = {}): NativeDocument["parts"][number] => ({ id, name: id, role, device: { type: "heisenberg", parameters: {} }, gain: .7, pan: 0, notes: [], placements: [], sourceRegions: [], effects: [], automation: [], ...extra } as NativeDocument["parts"][number]);
const document = (parts: NativeDocument["parts"], motifs: NativeDocument["motifs"] = []): NativeDocument => ({
  schemaVersion: 2, ppq: 960, title: "Outline", direction: "x", currentObjective: "x", assumptions: [], tempoBpm: 120, meter: { numerator: 4, denominator: 4 }, bars: 8,
  sections: [{ id: "all", name: "All", startBar: 0, endBar: 8, intent: "" }], parts, motifs, protectedPartIds: [], protectedMotifIds: [], sourceAssetIds: [], audio: { state: "deferred", revisionId: null, assetHash: null }
});

it("outlines stored pitch per column within each part's own range and marks rests", () => {
  // 8 bars over 32 columns: each bar spans four columns.
  const value = nativeFingerprint(document([part("lead", "melody", { notes: [{ id: "low", startTick: 0, durationTicks: 3840, pitch: 60, velocity: .5 }, { id: "high", startTick: 3840 * 7, durationTicks: 3840, pitch: 72, velocity: .5 }] })]));
  expect(value).toMatchObject({ version: 1, columns: 32 });
  const cells = value.lanes[0]!.cells;
  expect(cells.slice(0, 4)).toEqual([0, 0, 0, 0]);
  expect(cells.slice(4, 28).every((cell) => cell === -1)).toBe(true);
  expect(cells.slice(28)).toEqual([100, 100, 100, 100]);
});

it("expands transposed motif placements, keeps clip-only activity and omits silent parts", () => {
  const value = nativeFingerprint(document([
    part("theme", "lead", { placements: [{ id: "p", motifId: "m", startTick: 0, repeats: 2, transpose: 12 }] }),
    part("silent", "harmony"),
    part("clips", "source", { sourceRegions: [{ id: "r", assetId: "00000000-0000-4000-8000-000000000001", assetHash: "a".repeat(64), rights: "Owned", startTick: 3840, durationTicks: 3840, sourceStartSeconds: 0, sourceDurationSeconds: 2, gain: .5 }] })
  ], [{ id: "m", partId: "theme", name: "Theme", lengthTicks: 3840, notes: [{ id: "a", startTick: 0, durationTicks: 960, pitch: 60, velocity: .5 }, { id: "b", startTick: 1920, durationTicks: 960, pitch: 64, velocity: .5 }] }]));
  expect(value.lanes.map((lane) => lane.role)).toEqual(["lead", "source"]);
  expect(value.lanes[0]!.cells.slice(0, 8)).toEqual([0, -1, 100, -1, 0, -1, 100, -1]);
  expect(value.lanes[1]!.cells.slice(4, 8)).toEqual([50, 50, 50, 50]);
});

it("keeps the six most active parts in document order and caches immutable revisions", () => {
  const parts = Array.from({ length: 8 }, (_, index) => part(`p${index}`, "melody", { notes: Array.from({ length: index + 1 }, (_, note) => ({ id: `n${note}`, startTick: note * 960, durationTicks: 480, pitch: 60 + note, velocity: .5 })) }));
  const source = document(parts);
  expect(nativeFingerprint(source).lanes).toHaveLength(6);
  const first = revisionFingerprint("00000000-0000-4000-8000-0000000000aa", source);
  expect(revisionFingerprint("00000000-0000-4000-8000-0000000000aa", document([part("other", "bass", { notes: [{ id: "x", startTick: 0, durationTicks: 960, pitch: 30, velocity: .5 }] })]))).toBe(first);
});

it("allows public part and section identities on music activity, but not arbitrary payloads", () => {
  expect(activityPayloadSchema.safeParse({ version: 1, kind: "music", text: "Updated Bass.", partIds: ["bass"], sectionIds: ["opening"] }).success).toBe(true);
  expect(activityPayloadSchema.safeParse({ version: 1, kind: "music", text: "Updated Bass.", partIds: Array.from({ length: 33 }, (_, index) => `p${index}`) }).success).toBe(false);
});
