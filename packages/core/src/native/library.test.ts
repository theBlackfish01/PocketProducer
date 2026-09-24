import { describe, expect, it } from "vitest";
import { createNativeLibrary, NativeLibraryError, resolveNativeSamples, type NativeLibraryClient } from "./library.js";
import { applyNativeOperations } from "./model.js";
import { seedNativeDocument } from "./producer.js";

const sample = { name: "samples/example", displayName: "Soft texture", ownerName: "users/example", durationSeconds: 12, bpm: 96, kind: "loop", visibility: "public", tags: ["texture"] };
const preset = { entityType: "heisenberg", meta: { name: "presets/example", displayName: "Soft glass", ownerName: "users/artist", tags: ["glass"] }, data: {} };
function fixture(overrides: { samples?: Partial<{ list: () => Promise<unknown>; get: () => Promise<unknown> }>; presets?: Partial<{ search: () => Promise<unknown>; get: () => Promise<unknown> }> } = {}) {
  return createNativeLibrary({
    samples: { list: () => Promise.resolve({ samples: [sample], nextPageToken: "" }), get: () => Promise.resolve(sample), ...overrides.samples },
    presets: { search: () => Promise.resolve([preset]), get: () => Promise.resolve(preset), ...overrides.presets }
  } as unknown as NativeLibraryClient);
}

describe("Audiotool resource boundary", () => {
  it("returns real-adapter metadata with separate identity, owner and usage uncertainty", async () => {
    const library = fixture();
    expect(await library.searchSamples("texture")).toMatchObject({ samples: [{ name: sample.name, ownerName: sample.ownerName, durationSeconds: 12 }], provenance: expect.stringContaining("rights are not inferred") });
    expect(await library.searchPresets("heisenberg", "glass")).toMatchObject({ presets: [{ name: preset.meta.name, ownerName: preset.meta.ownerName, deviceType: "heisenberg" }] });
    expect((await library.getPreset(preset.meta.name)).metadata.displayName).toBe("Soft glass");
  });
  it("distinguishes no connection, empty result, missing resource and changed metadata", async () => {
    await expect(createNativeLibrary(null).searchSamples("texture")).rejects.toMatchObject({ code: "unavailable" });
    expect((await fixture({ samples: { list: () => Promise.resolve({ samples: [], nextPageToken: "" }) } }).searchSamples("missing")).samples).toEqual([]);
    await expect(fixture({ samples: { get: () => Promise.resolve(new Error("removed")) } }).getSample(sample.name)).rejects.toMatchObject({ code: "not-found" });
    const document = applyNativeOperations(seedNativeDocument("A library source"), [
      { kind: "removePart", partId: "starting-voice" },
      { kind: "addPart", part: { id: "audio", name: "Audio", role: "source", device: { type: "audio", parameters: {} }, gain: 0.6, pan: 0, notes: [], placements: [], sourceRegions: [], libraryRegions: [{ id: "r", sampleName: sample.name, displayName: sample.displayName, ownerName: sample.ownerName, durationSeconds: 12, bpm: 96, startTick: 0, durationTicks: 960, sourceStartSeconds: 3, sourceDurationSeconds: 2, playbackMode: "once", gain: 0.6, provenance: "audiotool-library" }], effects: [], automation: [] } }
    ]);
    expect((await resolveNativeSamples(document, fixture()))[sample.name]?.durationSeconds).toBe(12);
    await expect(resolveNativeSamples(document, fixture({ samples: { get: () => Promise.resolve({ ...sample, durationSeconds: 10 }) } }))).rejects.toMatchObject({ code: "invalid" });
  });
  it("rejects fabricated identifiers before reaching provider methods", async () => {
    const library = fixture();
    await expect(library.getSample("not-an-id")).rejects.toBeInstanceOf(NativeLibraryError);
    await expect(library.getPreset("presets/not/a-name")).rejects.toMatchObject({ code: "invalid" });
  });
});
