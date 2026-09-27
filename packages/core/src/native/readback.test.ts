import { createOfflineDocument } from "@audiotool/nexus/node";
import { describe, expect, it } from "vitest";
import { canonicalHash } from "../domain/hash.js";
import { applyNativeSnapshot, nativeStructuralReadback, toNexusTicks } from "./adapter.js";
import { nativePresetFingerprint, type NativePreset } from "./library.js";
import { applyNativeOperations } from "./model.js";
import { seedNativeDocument } from "./producer.js";

async function mapped(automationTarget: "gain" | "pan" = "gain") {
  const base = seedNativeDocument("A small sound-design probe");
  const document = applyNativeOperations(base, [
    { kind: "setDevice", partId: "starting-voice", device: { type: "heisenberg", parameters: { "filter.cutoffFrequencyHz": 850, "operatorA.gain": 0.72 } } },
    { kind: "addNotes", partId: "starting-voice", notes: [{ id: "note-a", startTick: 0, durationTicks: 480, pitch: 60, velocity: 0.7 }] },
    { kind: "addEffect", partId: "starting-voice", effect: { id: "delay-a", type: "stompboxDelay", parameters: { feedbackFactor: 0.3, mix: 0.24 } } },
    { kind: "addAutomation", partId: "starting-voice", automation: { id: "gain-arc", target: automationTarget, points: [{ tick: 0, value: 0.2 }, { tick: 3840, value: 0.8 }] } }
  ]);
  const offline = await createOfflineDocument({ validated: true });
  await applyNativeSnapshot(offline, document);
  return offline;
}

describe("semantic native readback", () => {
  it("refuses to write over an externally added mixer group", async () => {
    const offline = await createOfflineDocument({ validated: true });
    await offline.modify((t) => { t.create("mixerGroup", { displayParameters: { displayName: "Studio edit" } }); });
    await expect(applyNativeSnapshot(offline, seedNativeDocument("Do not overwrite Studio routing"))).rejects.toThrow(/not empty/);
  });
  it("maps group hierarchy and reverb send levels and protects shared returns", async () => {
    const base = seedNativeDocument("Route the lead through a group and shared room");
    const routed = applyNativeOperations(base, [
      { kind: "upsertGroup", group: { id: "voices", name: "Voices", gain: 0.62, pan: -0.2 } },
      { kind: "setReverbBus", bus: { id: "room", name: "Shared room", roomSize: 0.78, preDelayMs: 90, damp: 0.32 } },
      { kind: "routePart", partId: "starting-voice", groupId: "voices" },
      { kind: "setSend", partId: "starting-voice", busId: "room", gain: 0.27 },
      { kind: "addNotes", partId: "starting-voice", notes: [{ id: "a", startTick: 0, durationTicks: 960, pitch: 60, velocity: 0.7 }] },
      { kind: "protect", partIds: ["starting-voice"], motifIds: [] }
    ]);
    const offline = await createOfflineDocument({ validated: true });
    await applyNativeSnapshot(offline, routed);
    const group = offline.queryEntities.ofTypes("mixerGroup").getOne()!;
    const channel = offline.queryEntities.ofTypes("mixerChannel").getOne()!;
    const reverb = offline.queryEntities.ofTypes("mixerReverbAux").getOne()!;
    const grouping = offline.queryEntities.ofTypes("mixerStripGrouping").getOne()!;
    const send = offline.queryEntities.ofTypes("mixerAuxRoute").getOne()!;
    expect(group.fields.faderParameters.fields.postGain.value).toBeCloseTo(0.62);
    expect(grouping.fields.childStrip.value).toEqual(channel.location);
    expect(grouping.fields.groupStrip.value).toEqual(group.location);
    expect(reverb.fields.roomSizeFactor.value).toBeCloseTo(0.78);
    expect(send.fields.auxSend.value).toEqual(channel.fields.auxSend.location);
    expect(send.fields.auxReceive.value).toEqual(reverb.location);
    expect(send.fields.gain.value).toBeCloseTo(0.27);
    expect(() => applyNativeOperations(routed, [{ kind: "upsertGroup", group: { id: "voices", name: "Voices", gain: 0.8, pan: -0.2 } }])).toThrow(/Protected part/);
    expect(() => applyNativeOperations(routed, [{ kind: "setReverbBus", bus: { id: "room", name: "Shared room", roomSize: 0.2, preDelayMs: 90, damp: 0.32 } }])).toThrow(/Protected part/);
    expect(() => applyNativeOperations(base, [{ kind: "routePart", partId: "starting-voice", groupId: "missing" }])).toThrow();
  });
  it("routes a bounded group sidechain and master strip with protected shared dependencies", async () => {
    const base = seedNativeDocument("A ducked pad over a pulse");
    const pulse = { id: "pulse", name: "Pulse", role: "bass" as const, device: { type: "pulverisateur" as const, parameters: {} }, gain: 0.6, pan: 0, notes: [{ id: "onset", startTick: 0, durationTicks: 480, pitch: 36, velocity: 0.9 }], placements: [], sourceRegions: [], effects: [], automation: [] };
    const compressor = { thresholdDb: -22, ratio: 3, attackMs: 8, releaseMs: 180, makeupGainDb: 1, detectionModeIndex: 2 as const, isActive: true };
    const routed = applyNativeOperations(base, [
      { kind: "addPart", part: pulse },
      { kind: "upsertGroup", group: { id: "pad-bus", name: "Pad bus", gain: 0.78, pan: 0, compressor, sidechainFromPartId: "pulse" } },
      { kind: "routePart", partId: "starting-voice", groupId: "pad-bus" },
      { kind: "setMaster", master: { gain: 0.82, pan: 0.1, limiterEnabled: true } },
      { kind: "protect", partIds: ["starting-voice"], motifIds: [] }
    ]);
    const offline = await createOfflineDocument({ validated: true });
    await applyNativeSnapshot(offline, routed);
    const group = offline.queryEntities.ofTypes("mixerGroup").getOne()!;
    const master = offline.queryEntities.ofTypes("mixerMaster").getOne()!;
    const cable = offline.queryEntities.ofTypes("mixerSideChainCable").getOne()!;
    expect(group.fields.compressor.fields.thresholdDb.value).toBeCloseTo(-22);
    expect(group.fields.compressor.fields.ratio.value).toBeCloseTo(3);
    expect(cable.fields.to.value).toEqual(group.fields.compressor.fields.sideChainInput.location);
    expect(master.fields.postGain.value).toBeCloseTo(0.82);
    expect(master.fields.limiterEnabled.value).toBe(true);
    expect(() => applyNativeOperations(routed, [{ kind: "setMaster", master: { gain: 0.5, pan: 0, limiterEnabled: false } }])).toThrow(/Protected part/);
    expect(() => applyNativeOperations(routed, [{ kind: "addNotes", partId: "pulse", notes: [{ id: "extra", startTick: 960, durationTicks: 480, pitch: 36, velocity: 0.9 }] }])).toThrow(/Protected part/);
    expect(() => applyNativeOperations(base, [{ kind: "upsertGroup", group: { id: "self", name: "Self", gain: 0.7, pan: 0, compressor, sidechainFromPartId: "starting-voice" } }, { kind: "routePart", partId: "starting-voice", groupId: "self" }])).toThrow(/cannot be sidechained/);
  });
  it("maps distinct shared room and delay returns with independent send automation", async () => {
    const base = seedNativeDocument("A lead with shared space and echoes");
    const routed = applyNativeOperations(base, [
      { kind: "setReverbBus", bus: { id: "room", name: "Room", roomSize: 0.64, preDelayMs: 45, damp: 0.4 } },
      { kind: "setDelayBus", bus: { id: "echo", name: "Echo", feedbackFactor: 0.4, stepCount: 3, stepLengthIndex: 2 } },
      { kind: "setSend", partId: "starting-voice", busId: "room", gain: 0.2 },
      { kind: "setSend", partId: "starting-voice", busId: "echo", gain: 0.35 },
      { kind: "addAutomation", partId: "starting-voice", automation: { id: "echo-rise", target: "send.echo.gain", points: [{ tick: 0, value: 0.1 }, { tick: 3840, value: 0.8 }] } }
    ]);
    const doc = await createOfflineDocument({ validated: true });
    await applyNativeSnapshot(doc, routed);
    expect(doc.queryEntities.ofTypes("mixerReverbAux").get()).toHaveLength(1);
    const echo = doc.queryEntities.ofTypes("mixerDelayAux").getOne()!;
    expect(echo.fields.feedbackFactor.value).toBeCloseTo(0.4);
    expect(echo.fields.stepCount.value).toBe(3);
    expect(doc.queryEntities.ofTypes("mixerAuxRoute").get()).toHaveLength(2);
    expect(doc.queryEntities.ofTypes("automationTrack").get()).toHaveLength(1);
    expect(() => applyNativeOperations(routed, [{ kind: "removeDelayBus" }])).toThrow(/unavailable return/);
    const kept = applyNativeOperations(routed, [{ kind: "protect", partIds: ["starting-voice"], motifIds: [] }]);
    expect(() => applyNativeOperations(kept, [{ kind: "setDelayBus", bus: { id: "echo", name: "Echo", feedbackFactor: 0.7, stepCount: 3, stepLengthIndex: 2 } }])).toThrow(/Protected part/);
  });
  it("maps device, effect and send automation to their SDK parameters with curve shape", async () => {
    const base = seedNativeDocument("Develop an animated routed voice");
    const document = applyNativeOperations(base, [
      { kind: "setReverbBus", bus: { id: "room", name: "Room", roomSize: 0.6, preDelayMs: 60, damp: 0.3 } },
      { kind: "setSend", partId: "starting-voice", busId: "room", gain: 0.3 },
      { kind: "addEffect", partId: "starting-voice", effect: { id: "filter-a", type: "autoFilter", parameters: { cutoffFrequencyHz: 2100, mix: 0.5 } } },
      { kind: "addAutomation", partId: "starting-voice", automation: { id: "tone-rise", target: "device.filter.cutoffFrequencyHz", points: [{ tick: 0, value: 0.1, interpolation: "linear" }, { tick: 3840, value: 0.8, interpolation: "sloped", slope: -0.4 }] } },
      { kind: "addAutomation", partId: "starting-voice", automation: { id: "filter-shape", target: "effect.filter-a.cutoffFrequencyHz", points: [{ tick: 0, value: 0.7 }, { tick: 3840, value: 0.2 }] } },
      { kind: "addAutomation", partId: "starting-voice", automation: { id: "room-swell", target: "send.room.gain", points: [{ tick: 0, value: 0.1 }, { tick: 3840, value: 0.9 }] } }
    ]);
    const offline = await createOfflineDocument({ validated: true });
    await applyNativeSnapshot(offline, document);
    const targets = offline.queryEntities.ofTypes("automationTrack").get().map((track) => track.fields.automatedParameter.value);
    expect(targets).toContainEqual(offline.queryEntities.ofTypes("heisenberg").getOne()!.fields.filter.fields.cutoffFrequencyHz.location);
    expect(targets).toContainEqual(offline.queryEntities.ofTypes("autoFilter").getOne()!.fields.cutoffFrequencyHz.location);
    expect(targets).toContainEqual(offline.queryEntities.ofTypes("mixerAuxRoute").getOne()!.fields.gain.location);
    const sloped = offline.queryEntities.ofTypes("automationEvent").get().find((event) => Math.abs(event.fields.slope.value + 0.4) < 0.0001);
    expect(sloped?.fields.interpolation.value).toBe(2);
    expect(() => applyNativeOperations(base, [{ kind: "addAutomation", partId: "starting-voice", automation: { id: "orphan-send", target: "send.room.gain", points: [{ tick: 0, value: 0.5 }, { tick: 960, value: 0.8 }] } }])).toThrow(/dangling target/);
  });
  it("maps source gain, pan, processing and gain automation through one routed audio device", async () => {
    const assetId = "11111111-1111-4111-8111-111111111111";
    const base = seedNativeDocument("Process an owned source");
    const source = applyNativeOperations(base, [
      { kind: "removePart", partId: "starting-voice" },
      { kind: "addPart", part: { id: "field", name: "Field recording", role: "source", device: { type: "audio", parameters: {} }, gain: 0.1, pan: -0.8, notes: [], placements: [], sourceRegions: [{ id: "later-cut", assetId, assetHash: "a".repeat(64), startTick: 3840, durationTicks: 3840, sourceStartSeconds: 2, sourceDurationSeconds: 5, playbackMode: "once", gain: 0.7, rights: "Owned test sound" }], effects: [{ id: "room", type: "stompboxReverb", parameters: { mix: 0.31 } }], automation: [{ id: "fade", target: "gain", points: [{ tick: 0, value: 0.1 }, { tick: 7680, value: 0.8 }] }] } }
    ]);
    const sample = { [assetId]: { sampleName: "samples/owned-test", durationSeconds: 20 } };
    const offline = await createOfflineDocument({ validated: true });
    const mapped = await applyNativeSnapshot(offline, source, sample);
    expect(mapped).toMatchObject({ mappedParts: 1, unresolvedSources: [], automationEvents: 2 });
    expect(offline.queryEntities.ofTypes("audioRegion").get()).toHaveLength(1);
    expect(offline.queryEntities.ofTypes("audioDevice").get()).toHaveLength(1);
    expect(offline.queryEntities.ofTypes("mixerChannel").getOne()!.fields.preGain.value).toBeCloseTo(0.1);
    expect(offline.queryEntities.ofTypes("mixerChannel").getOne()!.fields.faderParameters.fields.panning.value).toBeCloseTo(-0.8);
    expect(offline.queryEntities.ofTypes("stompboxReverb").getOne()!.fields.mix.value).toBeCloseTo(0.31);
    expect(offline.queryEntities.ofTypes("automationTrack").getOne()!.fields.automatedParameter.value).toEqual(offline.queryEntities.ofTypes("mixerChannel").getOne()!.fields.preGain.location);
    const firstHash = canonicalHash(nativeStructuralReadback(offline));
    const changed = applyNativeOperations(source, [{ kind: "setMix", partId: "field", gain: 0.7, pan: 0.4 }]);
    const second = await createOfflineDocument({ validated: true });
    await applyNativeSnapshot(second, changed, sample);
    expect(canonicalHash(nativeStructuralReadback(second))).not.toBe(firstHash);
  });

  it("maps bounded source speed and stretch mode through SDK sample insertion", async () => {
    const assetId = "11111111-1111-4111-8111-111111111111";
    const base = seedNativeDocument("Speed up an owned clip");
    const region = { id: "sped-clip", assetId, assetHash: "a".repeat(64), startTick: 0, durationTicks: 3840, sourceStartSeconds: 2, sourceDurationSeconds: 5, playbackMode: "once" as const, playbackRate: 2, stretchMode: "resample" as const, gain: 0.7, rights: "Owned test sound" };
    const document = applyNativeOperations(base, [{ kind: "removePart", partId: "starting-voice" }, { kind: "addPart", part: { id: "clip", name: "Clip", role: "source", device: { type: "audio", parameters: {} }, gain: 0.8, pan: 0, notes: [], placements: [], sourceRegions: [region], effects: [], automation: [] } }]);
    const source = { [assetId]: { sampleName: "samples/owned-test", durationSeconds: 10 } };
    const sped = await createOfflineDocument({ validated: true });
    await applyNativeSnapshot(sped, document, source);
    expect(sped.queryEntities.ofTypes("audioRegion").getOne()!.fields.timestretchMode.value).toBe(1);
    const normal = await createOfflineDocument({ validated: true });
    const unchanged = applyNativeOperations(document, [{ kind: "replaceSource", partId: "clip", region: { ...region, playbackRate: 1, stretchMode: "preservePitch" } }]);
    await applyNativeSnapshot(normal, unchanged, source);
    expect(normal.queryEntities.ofTypes("audioRegion").getOne()!.fields.timestretchMode.value).toBe(2);
    const spedEnd = Math.max(...sped.queryEntities.ofTypes("automationEvent").get().map((event) => event.fields.positionTicks.value));
    const normalEnd = Math.max(...normal.queryEntities.ofTypes("automationEvent").get().map((event) => event.fields.positionTicks.value));
    expect(spedEnd).toBeLessThan(normalEnd);
    expect(canonicalHash(nativeStructuralReadback(sped))).not.toBe(canonicalHash(nativeStructuralReadback(normal)));
    expect(() => applyNativeOperations(document, [{ kind: "replaceSource", partId: "clip", region: { ...region, stretchMode: "resample", pitchShiftSemitones: 3 } }])).toThrow(/Pitch shifting needs preservePitch/);
  });

  it("maps a resolved library sample's later interval and rejects an unresolved identity", async () => {
    const base = seedNativeDocument("Use a later library texture");
    const region = { id: "later-texture", sampleName: "samples/library-texture", displayName: "Texture", ownerName: "users/fixture", durationSeconds: 14, bpm: 0, startTick: 3840, durationTicks: 1920, sourceStartSeconds: 4, sourceDurationSeconds: 3, playbackMode: "once" as const, gain: 0.35, provenance: "audiotool-library" as const };
    const document = applyNativeOperations(base, [
      { kind: "removePart", partId: "starting-voice" },
      { kind: "addPart", part: { id: "texture", name: "Texture", role: "source", device: { type: "audio", parameters: {} }, gain: 0.6, pan: 0.2, notes: [], placements: [], sourceRegions: [], libraryRegions: [region], effects: [], automation: [] } }
    ]);
    const sample = { kind: "sample" as const, name: region.sampleName, displayName: region.displayName, ownerName: region.ownerName, durationSeconds: 14, bpm: 0, sampleKind: "one-shot" as const, visibility: "public" as const, tags: [] };
    const offline = await createOfflineDocument({ validated: true });
    await applyNativeSnapshot(offline, document, {}, {}, { [sample.name]: sample });
    const audioRegion = offline.queryEntities.ofTypes("audioRegion").getOne()!;
    expect(audioRegion.fields.region.fields.positionTicks.value).toBe(toNexusTicks(3840));
    expect(audioRegion.fields.region.fields.durationTicks.value).toBe(toNexusTicks(1920));
    expect(audioRegion.fields.gain.value).toBeCloseTo(0.35);
    const unready = await createOfflineDocument({ validated: true });
    await expect(applyNativeSnapshot(unready, document)).rejects.toThrow(/unresolved/);
  });

  it("rejects an audio clip on an instrument instead of reporting it fully mapped", () => {
    const base = seedNativeDocument("Invalid source machine");
    expect(() => applyNativeOperations(base, [{ kind: "placeSource", partId: "starting-voice", region: { id: "wrong", assetId: "11111111-1111-4111-8111-111111111111", assetHash: "a".repeat(64), startTick: 0, durationTicks: 960, sourceStartSeconds: 0, sourceDurationSeconds: 2, gain: 0.7, rights: "Owned test sound" } }])).toThrow(/Instrument part.*cannot carry source clips/);
  });
  it("normalizes independently allocated SDK IDs while retaining real parameter intent", async () => {
    const a = await mapped();
    const b = await mapped();
    expect(canonicalHash(nativeStructuralReadback(a))).toBe(canonicalHash(nativeStructuralReadback(b)));
    const synth = a.queryEntities.ofTypes("heisenberg").getOne()!;
    const delay = a.queryEntities.ofTypes("stompboxDelay").getOne()!;
    expect(synth.fields.filter.fields.cutoffFrequencyHz.value).toBeCloseTo(850, 3);
    expect(synth.fields.operatorA.fields.gain.value).toBeCloseTo(0.72, 3);
    expect(delay.fields.feedbackFactor.value).toBeCloseTo(0.3, 3);
  });

  it("treats a reordered SDK entity enumeration as the same remote music", async () => {
    const offline = await mapped();
    const reordered = {
      queryEntities: {
        ofTypes: (...types: string[]) => {
          const query = (offline.queryEntities.ofTypes as (...names: string[]) => { get(): unknown[]; getOne(): unknown })(...types);
          return { get: () => [...query.get()].reverse(), getOne: () => query.getOne() };
        }
      }
    } as unknown as Parameters<typeof nativeStructuralReadback>[0];
    expect(canonicalHash(nativeStructuralReadback(reordered))).toBe(canonicalHash(nativeStructuralReadback(offline)));
  });

  it("retains multi-operator, envelope and playing-mode edits at actual SDK fields", async () => {
    const base = seedNativeDocument("Shape an expressive voice");
    const settings = { playModeIndex: 2, glideMs: 175, velocityFactor: 0.62, unisonoCount: 3, unisonoDetuneSemitones: 0.14, "operatorB.gain": 0.42, "operatorB.waveformIndex": 7, "envelopeMain.releaseTimeNormalized": 0.76, "filter.resonance": 1.31 };
    const document = applyNativeOperations(base, [{ kind: "setDevice", partId: "starting-voice", device: { type: "heisenberg", parameters: settings } }]);
    const offline = await createOfflineDocument({ validated: true });
    await applyNativeSnapshot(offline, document);
    const synth = offline.queryEntities.ofTypes("heisenberg").getOne()!;
    expect(synth.fields.playModeIndex.value).toBe(2);
    expect(synth.fields.glideMs.value).toBeCloseTo(175);
    expect(synth.fields.unisonoCount.value).toBe(3);
    expect(synth.fields.operatorB.fields.gain.value).toBeCloseTo(0.42);
    expect(synth.fields.operatorB.fields.waveformIndex.value).toBe(7);
    expect(synth.fields.envelopeMain.fields.releaseTimeNormalized.value).toBeCloseTo(0.76);
    expect(synth.fields.filter.fields.resonance.value).toBeCloseTo(1.31);
    expect(() => applyNativeOperations(base, [{ kind: "setDevice", partId: "starting-voice", device: { type: "heisenberg", parameters: { unisonoCount: 1, unisonoDetuneSemitones: 0.5 } } }])).toThrow();
  });
  it("maps drum-machine voice shaping while keeping its step grid boolean", async () => {
    const base = seedNativeDocument("A shaped drum pulse");
    const document = applyNativeOperations(base, [{ kind: "setDevice", partId: "starting-voice", device: { type: "beatbox8", parameters: { accentAmount: 0.32, "bassdrum.tone": 0.21, "bassdrum.decay": 0.7, "snaredrum.snappy": 0.43 } } }]);
    const offline = await createOfflineDocument({ validated: true });
    await applyNativeSnapshot(offline, document);
    const drums = offline.queryEntities.ofTypes("beatbox8").getOne()!;
    expect(drums.fields.accentAmount.value).toBeCloseTo(0.32);
    expect(drums.fields.bassdrum.fields.tone.value).toBeCloseTo(0.21);
    expect(drums.fields.bassdrum.fields.decay.value).toBeCloseTo(0.7);
    expect(drums.fields.snaredrum.fields.snappy.value).toBeCloseTo(0.43);
  });

  it("applies an SDK preset then retains an explicit canonical parameter override", async () => {
    const source = await createOfflineDocument({ validated: true });
    let data: unknown;
    await source.modify((t) => { const synth = t.create("heisenberg", { operatorA: { gain: 0.28 } }); data = t.createPresetFor(synth); });
    const name = "presets/fixture-sound";
    const preset = { entityType: "heisenberg", _presetName: name, data, meta: { name, displayName: "Fixture sound", ownerName: "users/fixture", tags: [] } } as unknown as NativePreset;
    const base = seedNativeDocument("Use a chosen synth sound");
    const document = applyNativeOperations(base, [{ kind: "setDevice", partId: "starting-voice", device: { type: "heisenberg", parameters: { "operatorA.gain": 0.81 }, preset: { name, displayName: "Fixture sound", ownerName: "users/fixture", contentHash: nativePresetFingerprint(preset) } } }]);
    const offline = await createOfflineDocument({ validated: true });
    await applyNativeSnapshot(offline, document, {}, { [name]: preset });
    const synth = offline.queryEntities.ofTypes("heisenberg").getOne()!;
    expect(synth.fields.presetName.value).toBe(name);
    expect(synth.fields.operatorA.fields.gain.value).toBeCloseTo(0.81);
    const unresolved = await createOfflineDocument({ validated: true });
    await expect(applyNativeSnapshot(unresolved, document)).rejects.toThrow(/unresolved/);
  });

  it("changes when a region moves or mixer gain changes", async () => {
    const doc = await mapped();
    const before = canonicalHash(nativeStructuralReadback(doc));
    const region = doc.queryEntities.ofTypes("noteRegion").getOne()!;
    await doc.modify((t) => t.update(region.fields.region.fields.positionTicks, toNexusTicks(3840)));
    const moved = canonicalHash(nativeStructuralReadback(doc));
    expect(moved).not.toBe(before);
    const channel = doc.queryEntities.ofTypes("mixerChannel").getOne()!;
    await doc.modify((t) => t.update(channel.fields.preGain, 0.01));
    expect(canonicalHash(nativeStructuralReadback(doc))).not.toBe(moved);
  });

  it("tracks loop length, pan, effect setting and automation target/value rather than counts", async () => {
    const doc = await mapped();
    const initial = canonicalHash(nativeStructuralReadback(doc));
    const region = doc.queryEntities.ofTypes("noteRegion").getOne()!;
    await doc.modify((t) => t.update(region.fields.region.fields.loopDurationTicks, toNexusTicks(1920)));
    const looped = canonicalHash(nativeStructuralReadback(doc));
    expect(looped).not.toBe(initial);
    const channel = doc.queryEntities.ofTypes("mixerChannel").getOne()!;
    await doc.modify((t) => t.update(channel.fields.faderParameters.fields.panning, 0.42));
    const panned = canonicalHash(nativeStructuralReadback(doc));
    expect(panned).not.toBe(looped);
    const delay = doc.queryEntities.ofTypes("stompboxDelay").getOne()!;
    await doc.modify((t) => t.update(delay.fields.feedbackFactor, 0.64));
    const effected = canonicalHash(nativeStructuralReadback(doc));
    expect(effected).not.toBe(panned);
    const event = doc.queryEntities.ofTypes("automationEvent").getOne()!;
    await doc.modify((t) => t.update(event.fields.value, 0.3));
    expect(canonicalHash(nativeStructuralReadback(doc))).not.toBe(effected);
    const encoded = JSON.stringify(nativeStructuralReadback(doc));
    expect(encoded).toContain("desktopAudioCable");
    expect(encoded).toContain("automationTrack");
  });

  it("tracks cable endpoints and automation parameter targets", async () => {
    const doc = await mapped();
    const before = canonicalHash(nativeStructuralReadback(doc));
    const cable = doc.queryEntities.ofTypes("desktopAudioCable").get()[0]!;
    const delay = doc.queryEntities.ofTypes("stompboxDelay").getOne()!;
    await doc.modify((t) => t.update(cable.fields.fromSocket, delay.fields.audioOutput.location));
    const rerouted = canonicalHash(nativeStructuralReadback(doc));
    expect(rerouted).not.toBe(before);
    const panTarget = await mapped("pan");
    const gainTarget = await mapped("gain");
    expect(canonicalHash(nativeStructuralReadback(panTarget))).not.toBe(canonicalHash(nativeStructuralReadback(gainTarget)));
  });
});
