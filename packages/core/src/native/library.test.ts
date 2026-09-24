import { describe, expect, it } from "vitest";
import { createOfflineDocument } from "@audiotool/nexus/node";
import { applyNativeSnapshot } from "./adapter.js";
import { createNativeLibrary, nativePresetFingerprint, NativeLibraryError, resolveNativePresets, resolveNativeSamples, type NativeLibraryClient, type NativePreset } from "./library.js";
import { applyNativeOperations, protectedPartHash, setNativeProtections } from "./model.js";
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
  it("pins actual preset configuration across protection and requires explicit adoption of historical references", async () => {
    const name = "presets/stable-sound";
    const meta = { name, displayName: "Stable sound", ownerName: "users/fixture", tags: [] };
    const withGain = async (gain: number): Promise<NativePreset> => {
      const source = await createOfflineDocument({ validated: true });
      let data: unknown;
      await source.modify((t) => { data = t.createPresetFor(t.create("heisenberg", { operatorA: { gain } })); });
      return { entityType: "heisenberg", _presetName: name, data, meta } as unknown as NativePreset;
    };
    const original = await withGain(0.2), changed = await withGain(0.85);
    expect(nativePresetFingerprint(original)).not.toBe(nativePresetFingerprint(changed));
    const library = (current: NativePreset) => createNativeLibrary({ samples: { list: () => Promise.resolve({ samples: [], nextPageToken: "" }), get: () => Promise.resolve(new Error("missing")) }, presets: { search: () => Promise.resolve([current]), get: () => Promise.resolve(current) } } as unknown as NativeLibraryClient);
    const reference = { name, displayName: meta.displayName, ownerName: meta.ownerName, contentHash: nativePresetFingerprint(original) };
    const pinned = applyNativeOperations(seedNativeDocument("A kept lead"), [{ kind: "setDevice", partId: "starting-voice", device: { type: "heisenberg", parameters: {}, preset: reference } }, { kind: "protect", partIds: ["starting-voice"], motifIds: [] }]);
    const acceptedHash = protectedPartHash(pinned, "starting-voice");
    const resolved = await resolveNativePresets(pinned, library(original));
    const mapped = await createOfflineDocument({ validated: true });
    await applyNativeSnapshot(mapped, pinned, {}, resolved);
    expect(mapped.queryEntities.ofTypes("heisenberg").getOne()!.fields.operatorA.fields.gain.value).toBeCloseTo(0.2);
    await expect(resolveNativePresets(pinned, library(changed))).rejects.toThrow(/configuration changed/);
    await expect(applyNativeSnapshot(await createOfflineDocument({ validated: true }), pinned, {}, { [name]: changed })).rejects.toThrow(/drifted/);
    expect(protectedPartHash(pinned, "starting-voice")).toBe(acceptedHash);
    expect(() => applyNativeOperations(pinned, [{ kind: "setDevice", partId: "starting-voice", device: { type: "heisenberg", parameters: {}, preset: { ...reference, contentHash: nativePresetFingerprint(changed) } } }])).toThrow(/Protected part/);
    const unlocked = setNativeProtections(pinned, ["starting-voice"], []);
    const updated = applyNativeOperations(unlocked, [{ kind: "setDevice", partId: "starting-voice", device: { type: "heisenberg", parameters: {}, preset: { ...reference, contentHash: nativePresetFingerprint(changed) } } }]);
    expect(protectedPartHash(updated, "starting-voice")).not.toBe(acceptedHash);
    expect(await resolveNativePresets(updated, library(changed))).toHaveProperty(name);
    const historical = applyNativeOperations(seedNativeDocument("Historical sound"), [{ kind: "setDevice", partId: "starting-voice", device: { type: "heisenberg", parameters: {}, preset: { name, displayName: meta.displayName, ownerName: meta.ownerName } } }]);
    await expect(resolveNativePresets(historical, library(original))).rejects.toThrow(/Historical preset/);
  });
  it("includes a Gakki soundfont pointer in the accepted preset fingerprint", async () => {
    const soundfontPreset = async (soundfontId: string): Promise<NativePreset> => {
      const source = await createOfflineDocument({ validated: true });
      let data: unknown;
      await source.modify((t) => { data = t.createPresetFor(t.create("gakki", { soundfontId, gain: 0.6 })); });
      return { entityType: "gakki", _presetName: "presets/gakki-pointer", data, meta: { name: "presets/gakki-pointer", displayName: "Gakki", ownerName: "users/fixture", tags: [] } } as unknown as NativePreset;
    };
    expect(nativePresetFingerprint(await soundfontPreset("11111111-1111-4111-8111-111111111111"))).not.toBe(nativePresetFingerprint(await soundfontPreset("22222222-2222-4222-8222-222222222222")));
  });
  it("uses the SDK's named GM helper instead of assuming a catalog ID is a preset fetch URL", async () => {
    const sound = { id: "catalog-identifier", slug: "glass-keys", displayName: "Glass keys", category: "Keys", program: 11, tags: ["bright"] };
    const returned = { entityType: "gakki", _presetName: "presets/resolved-gm", meta: { name: "presets/resolved-gm", displayName: "Glass keys", ownerName: "users/audiotool", tags: [] }, data: {} } as unknown as NativePreset;
    let selectedSlug = "";
    const library = createNativeLibrary({ samples: { list: () => Promise.resolve({ samples: [], nextPageToken: "" }), get: () => Promise.resolve(new Error("missing")) }, presets: {
      gmInstruments: [sound], gmDrums: [], getInstrument: (item: { slug: string }) => { selectedSlug = item.slug; return Promise.resolve(returned); },
      get: () => Promise.reject(new Error("Generic preset lookup must not be used")), search: () => Promise.resolve([])
    } } as unknown as NativeLibraryClient);
    expect((await library.searchGmSounds("glass", "instrument")).sounds[0]?.slug).toBe("glass-keys");
    expect((await library.getGmSound("glass-keys", "instrument")).metadata).toMatchObject({ name: "presets/resolved-gm", deviceType: "gakki", contentHash: nativePresetFingerprint(returned) });
    expect(selectedSlug).toBe("glass-keys");
  });
});
