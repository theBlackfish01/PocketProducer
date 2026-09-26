import { describe, expect, it } from "vitest";
import { analyzeNativeSection, applyNativeOperations, canonicalHash, discoverNativeCapabilities, fixtureConstruct, fixtureRevise, inspectNativeCapability, materializedNotes, nativeCompletionIssues, nativeDiff, nativeMusicHash, NativeToolSession, pinnedContext, protectedPartHash, seedNativeDocument, toNexusTicks, validateNativeOffline, type JobRecord } from "@pocket/core";

function session(direction: string) { return new NativeToolSession({} as JobRecord, seedNativeDocument(direction), false); }

describe("native construction contracts", () => {
  it("maps one shared group dry/wet compressor and saturator path through actual insert sockets", async () => {
    const built = applyNativeOperations(seedNativeDocument("Shared drum bus"), [
      { kind: "addNotes", partId: "starting-voice", notes: [{ id: "hit", startTick: 0, durationTicks: 240, pitch: 36, velocity: 0.8 }] },
      { kind: "upsertGroup", group: { id: "drum-bus", name: "Drum bus", gain: 0.8, pan: 0, parallel: { wetMix: 0.32, effects: [{ id: "squeeze", type: "stompboxCompressor", parameters: { thresholdDb: -12, ratio: 0.5 } }, { id: "warmth", type: "stompboxTube", parameters: { drive: 2.4, tone: 0, postGain: 0.7 } }] }, automation: [{ id: "drive-rise", target: "effect.warmth.postGain", points: [{ tick: 0, value: 0.25 }, { tick: 3840, value: 0.6 }] }] } },
      { kind: "routePart", partId: "starting-voice", groupId: "drum-bus" }
    ]);
    const verified = await validateNativeOffline(built);
    expect(verified.structuralReadback.parallelSplits).toBe(1);
    expect(verified.structuralReadback.parallelMerges).toBe(1);
    expect(verified.structuralReadback.groupLinks).toBe(1);
    expect(verified.structuralReadback.automationTracks).toBe(1);
    const cables = verified.structuralReadback.semanticEntities.filter((entity) => entity.type === "desktopAudioCable");
    expect(cables.length).toBeGreaterThanOrEqual(6);
    expect(JSON.stringify(cables)).toContain("mixerGroup:0");
    expect(JSON.stringify(verified.structuralReadback.semanticEntities)).toContain("2.4");
    expect(() => applyNativeOperations(built, [{ kind: "removeGroup", groupId: "drum-bus" }])).toThrow();
    const protectedVersion = applyNativeOperations(built, [{ kind: "protect", partIds: ["starting-voice"], motifIds: [] }]);
    expect(() => applyNativeOperations(protectedVersion, [{ kind: "upsertGroup", group: { ...protectedVersion.groups![0]!, parallel: { wetMix: 0.8, effects: protectedVersion.groups![0]!.parallel!.effects } } }])).toThrow(/Protected part/);
  });
  it("edits, orders and removes shared processing without bypassing a kept part", async () => {
    const base = applyNativeOperations(seedNativeDocument("A shared drum group"), [
      { kind: "addNotes", partId: "starting-voice", notes: [{ id: "beat", startTick: 0, durationTicks: 240, pitch: 36, velocity: 0.8 }] },
      { kind: "upsertGroup", group: { id: "drum-bus", name: "Drums", gain: 0.8, pan: 0 } },
      { kind: "routePart", partId: "starting-voice", groupId: "drum-bus" }
    ]);
    const edited = applyNativeOperations(base, [
      { kind: "addGroupEffect", groupId: "drum-bus", effect: { id: "warmth", type: "stompboxTube", parameters: { drive: 2 } } },
      { kind: "addGroupEffect", groupId: "drum-bus", effect: { id: "eq", type: "stompboxParametricEqualizer", parameters: { frequencyHz: 120 } }, beforeEffectId: "warmth" },
      { kind: "moveGroupEffect", groupId: "drum-bus", effectId: "warmth", beforeEffectId: "eq" },
      { kind: "replaceGroupEffect", groupId: "drum-bus", effect: { id: "warmth", type: "stompboxTube", parameters: { drive: 3 } } },
      { kind: "setGroupParallel", groupId: "drum-bus", parallel: { wetMix: 0.3, effects: [{ id: "squeeze", type: "stompboxCompressor", parameters: { thresholdDb: -12 } }] } },
      { kind: "setGroupAutomation", groupId: "drum-bus", automation: { id: "blend-rise", target: "parallel.wetMix", points: [{ tick: 0, value: 0.2 }, { tick: 3840, value: 0.45 }] } }
    ]);
    expect(edited.groups?.[0]?.effects?.map((effect) => effect.id)).toEqual(["warmth", "eq"]);
    expect((await validateNativeOffline(edited)).structuralReadback.parallelSplits).toBe(1);
    expect(() => applyNativeOperations(edited, [{ kind: "removeGroupParallel", groupId: "drum-bus" }])).toThrow(/unsupported target|no parallel blend/);
    const withoutCurve = applyNativeOperations(edited, [{ kind: "removeGroupAutomation", groupId: "drum-bus", automationId: "blend-rise" }, { kind: "removeGroupParallel", groupId: "drum-bus" }, { kind: "removeGroupEffect", groupId: "drum-bus", effectId: "eq" }]);
    expect(withoutCurve.groups?.[0]?.effects?.map((effect) => effect.id)).toEqual(["warmth"]);
    const kept = applyNativeOperations(edited, [{ kind: "protect", partIds: ["starting-voice"], motifIds: [] }]);
    expect(() => applyNativeOperations(kept, [{ kind: "replaceGroupEffect", groupId: "drum-bus", effect: { id: "warmth", type: "stompboxTube", parameters: { drive: 4 } } }])).toThrow(/Protected part/);
  });
  it("rejects a wrong tempo, meter or section span even when a plan says complete", () => {
    const document = applyNativeOperations(seedNativeDocument("A 12-bar song in 3/4 at 86 BPM, intro 1-4, chorus 5-12"), [
      { kind: "setStructure", bars: 12, sections: [{ id: "intro", name: "Intro", startBar: 0, endBar: 6, intent: "" }, { id: "chorus", name: "Chorus", startBar: 6, endBar: 12, intent: "" }] },
      { kind: "addNotes", partId: "starting-voice", notes: [{ id: "theme", startTick: 0, durationTicks: 960, pitch: 62, velocity: 0.7 }] }
    ]);
    expect(nativeCompletionIssues(document, document.direction, "generation")).toEqual(expect.arrayContaining([expect.stringContaining("86 BPM"), expect.stringContaining("3/4"), expect.stringContaining("intro at bars 1–4") ]));
  });
  it("reports sounding notes crossing a section boundary separately from new onsets", () => {
    const base = seedNativeDocument("A held transition over the boundary");
    const document = applyNativeOperations(base, [
      { kind: "setStructure", bars: 8, sections: [{ id: "opening", name: "Opening", startBar: 0, endBar: 4, intent: "Hold" }, { id: "arrival", name: "Arrival", startBar: 4, endBar: 8, intent: "Enter" }] },
      { kind: "addNotes", partId: "starting-voice", notes: [{ id: "held", startTick: 14400, durationTicks: 3840, pitch: 67, velocity: 0.72 }] }
    ]);
    const arrival = analyzeNativeSection(document, "arrival", "starting-voice").parts[0]!;
    expect(arrival.soundingNotes).toBe(1);
    expect(arrival.newOnsets).toBe(0);
    expect(arrival.noteRange).toEqual([67, 67]);
    expect(arrival.notePreview).toHaveLength(1);
  });
  it("develops one motif instance without rewriting its shared source or kept material", async () => {
    const base = seedNativeDocument("Let the returning phrase answer the opening");
    const built = applyNativeOperations(base, [
      { kind: "setStructure", bars: 8, sections: [{ id: "opening", name: "Opening", startBar: 0, endBar: 4, intent: "Introduce" }, { id: "return", name: "Return", startBar: 4, endBar: 8, intent: "Answer" }] },
      { kind: "defineMotif", motif: { id: "call", partId: "starting-voice", name: "Call", lengthTicks: 3840, notes: [{ id: "a", startTick: 0, durationTicks: 480, pitch: 60, velocity: 0.7 }, { id: "b", startTick: 960, durationTicks: 480, pitch: 64, velocity: 0.8 }] } },
      { kind: "placeMotif", partId: "starting-voice", placement: { id: "first", motifId: "call", startTick: 0, repeats: 1, transpose: 0 } },
      { kind: "placeMotif", partId: "starting-voice", placement: { id: "answer", motifId: "call", startTick: 15360, repeats: 1, transpose: 0 } },
      { kind: "protect", partIds: [], motifIds: ["call"] }
    ]);
    const varied = applyNativeOperations(built, [{ kind: "varyMotifInstance", partId: "starting-voice", placementId: "answer", newMotifId: "answer-variation", name: "Answer variation", pitchShiftSemitones: 5, timeShiftTicks: 240, durationFactor: 0.75, velocityFactor: 0.9 }]);
    expect(varied.motifs.find((value) => value.id === "call")?.notes).toEqual(built.motifs.find((value) => value.id === "call")?.notes);
    expect(varied.parts[0]?.placements.map((value) => value.motifId)).toEqual(["call", "answer-variation"]);
    expect(materializedNotes(varied, "starting-voice").map((value) => value.pitch)).toEqual([60, 64, 65, 69]);
    expect(nativeMusicHash(varied)).not.toBe(nativeMusicHash(built));
    expect((await validateNativeOffline(varied)).readback.noteEntities).toBe(4);
    expect(() => applyNativeOperations(built, [{ kind: "varyMotifInstance", partId: "starting-voice", placementId: "answer", newMotifId: "bad", name: "Bad", velocityFactor: 1.5 }])).toThrow(/velocity range/);
    const kept = applyNativeOperations(built, [{ kind: "protect", partIds: ["starting-voice"], motifIds: [] }]);
    expect(() => applyNativeOperations(kept, [{ kind: "varyMotifInstance", partId: "starting-voice", placementId: "answer", newMotifId: "forbidden", name: "Forbidden", pitchShiftSemitones: 2 }])).toThrow(/Protected part/);
  });
  it("develops notes across a section boundary without changing the preceding phrase or held note", async () => {
    const built = applyNativeOperations(seedNativeDocument("Make the arrival rise"), [
      { kind: "setStructure", bars: 8, sections: [{ id: "opening", name: "Opening", startBar: 0, endBar: 4, intent: "Quiet" }, { id: "arrival", name: "Arrival", startBar: 4, endBar: 8, intent: "Rise" }] },
      { kind: "defineMotif", motif: { id: "theme", partId: "starting-voice", name: "Theme", lengthTicks: 3840, notes: [{ id: "motif-note", startTick: 0, durationTicks: 960, pitch: 60, velocity: 0.7 }] } },
      { kind: "placeMotif", partId: "starting-voice", placement: { id: "crossing-instance", motifId: "theme", startTick: 11520, repeats: 3, transpose: 0 } },
      { kind: "addNotes", partId: "starting-voice", notes: [{ id: "held", startTick: 15000, durationTicks: 960, pitch: 67, velocity: 0.6 }] },
      { kind: "protect", partIds: [], motifIds: ["theme"] }
    ]);
    const revisionJob = { kind: "native-revision", request: { targetPartId: "starting-voice", targetSectionId: "arrival" } } as unknown as JobRecord;
    const edit = new NativeToolSession(revisionJob, built, false);
    await edit.apply("raise-arrival", [{ kind: "developSectionNotes", partId: "starting-voice", sectionId: "arrival", pitchShiftSemitones: 5 }]);
    const before = materializedNotes(built, "starting-voice");
    const after = materializedNotes(edit.document, "starting-voice");
    expect(before.some((value) => value.startTick === 11520 && value.pitch === 60)).toBe(true);
    expect(after.some((value) => value.startTick === 11520 && value.pitch === 60)).toBe(true);
    expect(after.some((value) => value.startTick === 15360 && value.pitch === 65)).toBe(true);
    expect(after.some((value) => value.startTick === 15360 && value.pitch === 72 && value.durationTicks === 600)).toBe(true);
    expect(after.some((value) => value.startTick === 15000 && value.pitch === 67 && value.durationTicks === 360)).toBe(true);
    expect(edit.document.motifs.find((value) => value.id === "theme")).toEqual(built.motifs.find((value) => value.id === "theme"));
    const kept = applyNativeOperations(built, [{ kind: "protect", partIds: ["starting-voice"], motifIds: [] }]);
    expect(() => applyNativeOperations(kept, [{ kind: "developSectionNotes", partId: "starting-voice", sectionId: "arrival", pitchShiftSemitones: 5 }])).toThrow(/Protected part/);
  });
  it("keeps developed note identities bounded even when legal placement and source IDs are long", async () => {
    const placementId = `p${"a".repeat(39)}`;
    const noteId = `n${"b".repeat(34)}`;
    const built = applyNativeOperations(seedNativeDocument("Develop a long-identity motif"), [
      { kind: "setStructure", bars: 8, sections: [{ id: "intro", name: "Intro", startBar: 0, endBar: 4, intent: "" }, { id: "arrival", name: "Arrival", startBar: 4, endBar: 8, intent: "" }] },
      { kind: "defineMotif", motif: { id: "theme", partId: "starting-voice", name: "Theme", lengthTicks: 3840, notes: [{ id: noteId, startTick: 0, durationTicks: 960, pitch: 62, velocity: 0.6 }] } },
      { kind: "placeMotif", partId: "starting-voice", placement: { id: placementId, motifId: "theme", startTick: 11520, repeats: 3, transpose: 0 } }
    ]);
    const developed = applyNativeOperations(built, [{ kind: "developSectionNotes", partId: "starting-voice", sectionId: "arrival", pitchShiftSemitones: 2 }]);
    expect(developed.parts[0]?.notes.every((event) => event.id.length <= 64)).toBe(true);
    expect(new Set(developed.parts[0]?.notes.map((event) => event.id)).size).toBe(developed.parts[0]?.notes.length);
    expect((await validateNativeOffline(developed)).readback.noteEntities).toBe(3);
  });
  it("changes one motif ending precisely while other placements retain the original phrase", async () => {
    const base = applyNativeOperations(seedNativeDocument("A theme that returns with a changed answer"), [
      { kind: "setStructure", bars: 8, sections: [{ id: "first", name: "First", startBar: 0, endBar: 4, intent: "Theme" }, { id: "return", name: "Return", startBar: 4, endBar: 8, intent: "New ending" }] },
      { kind: "defineMotif", motif: { id: "call", partId: "starting-voice", name: "Call", lengthTicks: 3840, notes: [{ id: "opening", startTick: 0, durationTicks: 480, pitch: 62, velocity: 0.7 }, { id: "ending", startTick: 2880, durationTicks: 480, pitch: 65, velocity: 0.55 }] } },
      { kind: "placeMotif", partId: "starting-voice", placement: { id: "first-call", motifId: "call", startTick: 0, repeats: 1, transpose: 0 } },
      { kind: "placeMotif", partId: "starting-voice", placement: { id: "return-call", motifId: "call", startTick: 15360, repeats: 1, transpose: 0 } }
    ]);
    const varied = applyNativeOperations(base, [{ kind: "varyMotifInstance", partId: "starting-voice", placementId: "return-call", newMotifId: "call-with-answer", name: "Answer", noteEdits: [{ noteId: "ending", startTick: 2640, durationTicks: 720, pitch: 69, velocity: 0.63 }] }]);
    expect(varied.motifs.find((motif) => motif.id === "call")?.notes.find((note) => note.id === "ending")?.pitch).toBe(65);
    expect(varied.parts[0]?.placements.map((placement) => placement.motifId)).toEqual(["call", "call-with-answer"]);
    expect(materializedNotes(varied, "starting-voice").map((note) => note.pitch)).toEqual([62, 65, 62, 69]);
    expect((await validateNativeOffline(varied)).readback.noteEntities).toBe(4);
    expect(() => applyNativeOperations(base, [{ kind: "varyMotifInstance", partId: "starting-voice", placementId: "return-call", newMotifId: "bad-answer", name: "Bad", noteEdits: [{ noteId: "missing", pitch: 69 }] }])).toThrow(/distinct notes/);
    expect(() => applyNativeOperations(base, [{ kind: "varyMotifInstance", partId: "starting-voice", placementId: "return-call", newMotifId: "unchanged-answer", name: "Same", noteEdits: [{ noteId: "ending", pitch: 65 }] }])).toThrow(/must change musical material/);
  });
  it("silences a section of a crossing one-shot clip while retaining its exact outside source offsets", async () => {
    const base = seedNativeDocument("Let the recorded texture stop during the arrival");
    const built = applyNativeOperations(base, [
      { kind: "setStructure", bars: 8, tempoBpm: 120, sections: [{ id: "opening", name: "Opening", startBar: 0, endBar: 4, intent: "Texture" }, { id: "arrival", name: "Arrival", startBar: 4, endBar: 8, intent: "Space" }] },
      { kind: "removePart", partId: "starting-voice" },
      { kind: "addPart", part: { id: "texture", name: "Texture", role: "source", device: { type: "audio", parameters: {} }, gain: 0.7, pan: 0, notes: [], placements: [], sourceRegions: [], libraryRegions: [{ id: "crossing-clip", sampleName: "samples/texture", displayName: "Texture", ownerName: "users/fixture", durationSeconds: 8, bpm: 120, startTick: 11520, durationTicks: 7680, sourceStartSeconds: 1, sourceDurationSeconds: 4, playbackMode: "once", gain: 0.6, provenance: "audiotool-library" }], effects: [], automation: [] } }
    ]);
    const job = { kind: "native-revision", request: { targetPartId: "texture", targetSectionId: "arrival" } } as unknown as JobRecord;
    const edit = new NativeToolSession(job, built, false);
    await edit.apply("silence-arrival", [{ kind: "silenceSectionClips", partId: "texture", sectionId: "arrival" }]);
    expect(edit.document.parts[0]?.libraryRegions).toMatchObject([{ startTick: 11520, durationTicks: 3840, sourceStartSeconds: 1, sourceDurationSeconds: 2 }]);
    const loop = applyNativeOperations(built, [{ kind: "replaceLibrarySample", partId: "texture", region: { ...built.parts[0]!.libraryRegions![0]!, playbackMode: "loop" } }, { kind: "silenceSectionClips", partId: "texture", sectionId: "arrival" }]);
    expect(loop.parts[0]?.libraryRegions).toMatchObject([{ startTick: 11520, durationTicks: 3840, sourceStartSeconds: 1, sourceDurationSeconds: 4, playbackMode: "loop" }]);
  });
  it("changes only the middle of a looped clip, retaining source phase on both sides", async () => {
    const built = applyNativeOperations(seedNativeDocument("A twelve-bar loop with a quieter middle"), [
      { kind: "setStructure", bars: 12, tempoBpm: 120, sections: [{ id: "opening", name: "Opening", startBar: 0, endBar: 4, intent: "" }, { id: "middle", name: "Middle", startBar: 4, endBar: 8, intent: "" }, { id: "ending", name: "Ending", startBar: 8, endBar: 12, intent: "" }] },
      { kind: "addPart", part: { id: "texture", name: "Texture", role: "source", device: { type: "audio", parameters: {} }, gain: 0.7, pan: 0, notes: [], placements: [], sourceRegions: [], libraryRegions: [{ id: "long-loop", sampleName: "samples/texture", displayName: "Texture", ownerName: "users/fixture", durationSeconds: 5, bpm: 120, startTick: 0, durationTicks: 46080, sourceStartSeconds: 1, sourceDurationSeconds: 3, playbackMode: "loop", gain: 0.6, provenance: "audiotool-library" }], effects: [], automation: [] } }
    ]);
    const edit = new NativeToolSession({ kind: "native-revision", request: { targetPartId: "texture", targetSectionId: "middle" } } as unknown as JobRecord, built, false);
    await edit.apply("quiet-middle", [{ kind: "setSectionClipGain", partId: "texture", sectionId: "middle", gain: 0.3 }]);
    const regions = edit.document.parts.find((part) => part.id === "texture")!.libraryRegions!;
    expect(regions.some((region) => region.startTick === 15360 && region.gain === 0.3)).toBe(true);
    expect(regions.filter((region) => region.startTick >= 30720).map((region) => region.sourceStartSeconds)).toContain(2);
    expect((await validateNativeOffline(edit.document, {}, {}, { "samples/texture": { name: "samples/texture", ownerName: "users/fixture", durationSeconds: 5, bpm: 120 } as never })).structuralReadback.semanticEntities.filter((entity) => entity.type === "audioRegion").length).toBeGreaterThanOrEqual(3);
    expect(() => applyNativeOperations(edit.document, [{ kind: "setSectionClipGain", partId: "texture", sectionId: "middle", gain: 0.3 }])).toThrow(/No clip gain changes/);
  });
  it("targets one crossing clip without touching its neighbor and moves a contained clip only within its section", async () => {
    const built = applyNativeOperations(seedNativeDocument("Keep one texture in place while shifting another"), [
      { kind: "setStructure", bars: 12, tempoBpm: 120, sections: [{ id: "opening", name: "Opening", startBar: 0, endBar: 4, intent: "" }, { id: "middle", name: "Middle", startBar: 4, endBar: 8, intent: "" }, { id: "ending", name: "Ending", startBar: 8, endBar: 12, intent: "" }] },
      { kind: "addPart", part: { id: "texture", name: "Texture", role: "source", device: { type: "audio", parameters: {} }, gain: 0.7, pan: 0, notes: [], placements: [], sourceRegions: [], libraryRegions: [
        { id: "crossing", sampleName: "samples/texture", displayName: "Texture", ownerName: "users/fixture", durationSeconds: 8, bpm: 120, startTick: 11520, durationTicks: 23040, sourceStartSeconds: 1, sourceDurationSeconds: 3, playbackMode: "loop", gain: 0.6, provenance: "audiotool-library" },
        { id: "contained", sampleName: "samples/texture", displayName: "Texture", ownerName: "users/fixture", durationSeconds: 8, bpm: 120, startTick: 19200, durationTicks: 1920, sourceStartSeconds: 0, sourceDurationSeconds: 1, playbackMode: "once", gain: 0.5, provenance: "audiotool-library" }
      ], effects: [], automation: [] } }
    ]);
    const job = { kind: "native-revision", request: { targetPartId: "texture", targetSectionId: "middle" } } as unknown as JobRecord;
    const edit = new NativeToolSession(job, built, false);
    await edit.apply("quieter-crossing", [{ kind: "setSectionClipGain", partId: "texture", sectionId: "middle", regionId: "crossing", gain: 0.25 }]);
    expect(edit.document.parts[1]?.libraryRegions?.find((region) => region.id === "contained")).toEqual(built.parts[1]?.libraryRegions?.find((region) => region.id === "contained"));
    expect(edit.document.parts[1]?.libraryRegions?.some((region) => region.gain === 0.25 && region.startTick >= 15360 && region.startTick < 30720)).toBe(true);
    await edit.apply("shift-contained", [{ kind: "moveSectionClip", partId: "texture", sectionId: "middle", regionId: "contained", startTick: 20160 }]);
    expect(edit.document.parts[1]?.libraryRegions?.find((region) => region.id === "contained")).toMatchObject({ startTick: 20160, sourceStartSeconds: 0, sourceDurationSeconds: 1 });
    await expect(edit.apply("reject-crossing-move", [{ kind: "moveSectionClip", partId: "texture", sectionId: "middle", regionId: "r-missing", startTick: 21000 }])).rejects.toThrow(/exactly one region/);
    expect(() => applyNativeOperations(built, [{ kind: "moveSectionClip", partId: "texture", sectionId: "middle", regionId: "crossing", startTick: 20160 }])).toThrow(/crosses/);
    expect(() => applyNativeOperations(built, [{ kind: "moveSectionClip", partId: "texture", sectionId: "middle", regionId: "contained", startTick: 30000 }])).toThrow(/would leave/);
    expect((await validateNativeOffline(edit.document, {}, {}, { "samples/texture": { name: "samples/texture", ownerName: "users/fixture", durationSeconds: 8, bpm: 120 } as never })).structuralReadback.semanticEntities.filter((entity) => entity.type === "audioRegion").length).toBeGreaterThanOrEqual(4);
  });
  it("shifts only the selected section of crossing loop and one-shot clips while preserving outside source time", async () => {
    const built = applyNativeOperations(seedNativeDocument("Move the middle textures without moving the opening or ending"), [
      { kind: "setStructure", bars: 12, tempoBpm: 120, sections: [{ id: "opening", name: "Opening", startBar: 0, endBar: 4, intent: "" }, { id: "middle", name: "Middle", startBar: 4, endBar: 8, intent: "" }, { id: "ending", name: "Ending", startBar: 8, endBar: 12, intent: "" }] },
      { kind: "addPart", part: { id: "texture", name: "Texture", role: "source", device: { type: "audio", parameters: {} }, gain: 0.7, pan: 0, notes: [], placements: [], sourceRegions: [], libraryRegions: [
        { id: "loop", sampleName: "samples/texture", displayName: "Texture", ownerName: "users/fixture", durationSeconds: 30, bpm: 120, startTick: 0, durationTicks: 46080, sourceStartSeconds: 1, sourceDurationSeconds: 3, playbackMode: "loop", gain: 0.5, provenance: "audiotool-library" },
        { id: "once", sampleName: "samples/texture", displayName: "Texture", ownerName: "users/fixture", durationSeconds: 30, bpm: 120, startTick: 11520, durationTicks: 23040, sourceStartSeconds: 0, sourceDurationSeconds: 12, playbackMode: "once", gain: 0.5, provenance: "audiotool-library" }
      ], effects: [], automation: [] } }
    ]);
    const edit = new NativeToolSession({ kind: "native-revision", request: { targetPartId: "texture", targetSectionId: "middle" } } as unknown as JobRecord, built, false);
    await edit.apply("late-middle-loop", [{ kind: "shiftSectionClip", partId: "texture", sectionId: "middle", regionId: "loop", deltaTicks: 960 }]);
    await edit.apply("early-middle-once", [{ kind: "shiftSectionClip", partId: "texture", sectionId: "middle", regionId: "once", deltaTicks: -480 }]);
    const regions = edit.document.parts.find((part) => part.id === "texture")!.libraryRegions!;
    expect(regions.some((region) => region.startTick === 16320 && region.gain === 0.5 && region.playbackMode === "once")).toBe(true);
    expect(regions.some((region) => region.startTick === 15360 && region.sourceStartSeconds === 2.25 && region.playbackMode === "once")).toBe(true);
    expect(regions.some((region) => region.startTick === 30720 && region.sourceStartSeconds === 2 && region.playbackMode === "once")).toBe(true);
    expect((await validateNativeOffline(edit.document, {}, {}, { "samples/texture": { name: "samples/texture", ownerName: "users/fixture", durationSeconds: 30, bpm: 120 } as never })).structuralReadback.semanticEntities.filter((entity) => entity.type === "audioRegion").length).toBeGreaterThanOrEqual(7);
    expect(() => applyNativeOperations(built, [{ kind: "shiftSectionClip", partId: "texture", sectionId: "middle", regionId: "loop", deltaTicks: 0 }])).toThrow();
  });
  it("edits a crossing gain ramp only in one section and rejects outside or sloped changes", async () => {
    const built = applyNativeOperations(seedNativeDocument("Shape the middle only"), [
      { kind: "setStructure", bars: 12, sections: [{ id: "opening", name: "Opening", startBar: 0, endBar: 4, intent: "" }, { id: "middle", name: "Middle", startBar: 4, endBar: 8, intent: "" }, { id: "ending", name: "Ending", startBar: 8, endBar: 12, intent: "" }] },
      { kind: "addNotes", partId: "starting-voice", notes: [{ id: "note", startTick: 0, durationTicks: 960, pitch: 60, velocity: 0.7 }] },
      { kind: "addAutomation", partId: "starting-voice", automation: { id: "gain-ramp", target: "gain", points: [{ tick: 0, value: 0.2, interpolation: "linear" }, { tick: 46080, value: 0.8 }] } }
    ]);
    const job = { kind: "native-revision", request: { targetPartId: "starting-voice", targetSectionId: "middle" } } as unknown as JobRecord;
    const edit = new NativeToolSession(job, built, false);
    await edit.apply("middle-swell", [{ kind: "editSectionAutomation", partId: "starting-voice", sectionId: "middle", automationId: "gain-ramp", points: [{ tick: 15360, value: 0.4, interpolation: "linear" }, { tick: 23040, value: 0.9, interpolation: "linear" }, { tick: 30720, value: 0.6, interpolation: "linear" }] }]);
    expect(edit.document.parts[0]?.automation[0]?.points).toHaveLength(5);
    expect((await validateNativeOffline(edit.document)).readback.automationEvents).toBe(5);
    await expect(new NativeToolSession(job, built, false).apply("outside-ramp", [{ kind: "replaceAutomation", partId: "starting-voice", automation: { id: "gain-ramp", target: "gain", points: [{ tick: 0, value: 0.1, interpolation: "linear" }, { tick: 46080, value: 0.8 }] } }])).rejects.toThrow(/outside that section/);
    await expect(new NativeToolSession(job, built, false).apply("bad-boundary", [{ kind: "editSectionAutomation", partId: "starting-voice", sectionId: "middle", automationId: "gain-ramp", points: [{ tick: 15360, value: 0.8 }, { tick: 30720, value: 0.6 }] }])).rejects.toThrow(/Start boundary/);
    const sloped = applyNativeOperations(built, [{ kind: "replaceAutomation", partId: "starting-voice", automation: { id: "gain-ramp", target: "gain", points: [{ tick: 0, value: 0.2, interpolation: "sloped", slope: 0.3 }, { tick: 46080, value: 0.8 }] } }]);
    expect(() => applyNativeOperations(sloped, [{ kind: "editSectionAutomation", partId: "starting-voice", sectionId: "middle", automationId: "gain-ramp", points: [{ tick: 15360, value: 0.4 }, { tick: 30720, value: 0.6 }] }])).toThrow(/Sloped automation/);
  });
  it("preserves loop phase after silencing a middle section of one shared source clip", async () => {
    const built = applyNativeOperations(seedNativeDocument("A looping texture with a silent middle"), [
      { kind: "setStructure", bars: 12, tempoBpm: 120, sections: [{ id: "opening", name: "Opening", startBar: 0, endBar: 4, intent: "" }, { id: "middle", name: "Middle", startBar: 4, endBar: 8, intent: "" }, { id: "ending", name: "Ending", startBar: 8, endBar: 12, intent: "" }] },
      { kind: "removePart", partId: "starting-voice" },
      { kind: "addPart", part: { id: "texture", name: "Texture", role: "source", device: { type: "audio", parameters: {} }, gain: 0.7, pan: 0, notes: [], placements: [], sourceRegions: [], libraryRegions: [{ id: "long-loop", sampleName: "samples/texture", displayName: "Texture", ownerName: "users/fixture", durationSeconds: 5, bpm: 120, startTick: 0, durationTicks: 46080, sourceStartSeconds: 1, sourceDurationSeconds: 3, playbackMode: "loop", gain: 0.5, provenance: "audiotool-library" }], effects: [], automation: [] } }
    ]);
    const job = { kind: "native-revision", request: { targetPartId: "texture", targetSectionId: "middle" } } as unknown as JobRecord;
    const edit = new NativeToolSession(job, built, false);
    await edit.apply("mute-middle-loop", [{ kind: "silenceSectionClips", partId: "texture", sectionId: "middle" }]);
    expect(edit.document.parts[0]?.libraryRegions).toMatchObject([{ startTick: 0, durationTicks: 15360, sourceStartSeconds: 1, sourceDurationSeconds: 3 }, { startTick: 30720, durationTicks: 3840, sourceStartSeconds: 2, sourceDurationSeconds: 2, playbackMode: "once" }, { startTick: 34560, durationTicks: 11520, sourceStartSeconds: 1, sourceDurationSeconds: 3, playbackMode: "loop" }]);
    expect((await validateNativeOffline(edit.document, {}, {}, { "samples/texture": { name: "samples/texture", ownerName: "users/fixture", durationSeconds: 5, bpm: 120 } as never })).structuralReadback.semanticEntities.filter((entity) => entity.type === "audioRegion")).toHaveLength(3);
  });
  it("keeps generated editorial titles on a word boundary", () => {
    const title = seedNativeDocument("Build an evolving 64-bar ambient journey with a slow lead and spacious transitions into a final release").title;
    expect(title.length).toBeLessThanOrEqual(42);
    expect(title).not.toMatch(/transitio…$/);
  });
  it("rejects device or effect values that the pinned mapper would silently drop", () => {
    const base = seedNativeDocument("A small motif");
    expect(() => applyNativeOperations(base, [{ kind: "setDevice", partId: "starting-voice", device: { type: "heisenberg", parameters: { imaginaryCutoff: 1200 } } }])).toThrow(/mapped native parameters/);
    expect(() => applyNativeOperations(base, [{ kind: "addEffect", partId: "starting-voice", effect: { id: "space", type: "stompboxReverb", parameters: { imaginaryDecay: 0.7 } } }])).toThrow(/mapped native parameters/);
  });
  it("maps FM operator links and three contrasting effects into an offline editable Nexus document", async () => {
    const document = applyNativeOperations(seedNativeDocument("An FM pluck with saturated delay throws"), [
      { kind: "setDevice", partId: "starting-voice", device: { type: "heisenberg", parameters: { "operatorA.waveformIndex": 1, "operatorC.waveformIndex": 5, "operatorC.modulationFactorA": 0.45, "operatorC.envelope2AmplitudeModulationDepth": 0.6, "lfo1.rateNormalized": 0.4 } } },
      { kind: "addNotes", partId: "starting-voice", notes: [{ id: "pluck", startTick: 0, durationTicks: 480, pitch: 74, velocity: 0.76 }] },
      { kind: "addEffect", partId: "starting-voice", effect: { id: "warmth", type: "stompboxTube", parameters: { drive: 2.5, tone: 0, postGain: 0.6 } } },
      { kind: "addEffect", partId: "starting-voice", effect: { id: "width", type: "stompboxChorus", parameters: { delayTimeMs: 25, lfoFrequencyHz: 0.8, spreadFactor: 0.6 } } },
      { kind: "addEffect", partId: "starting-voice", effect: { id: "throw", type: "stompboxPitchDelay", parameters: { stepCount: 2, stepLengthIndex: 3, feedbackFactor: 0.3, tuneFactor: 0.2, mix: 0.25 } } }
    ]);
    const mapped = await validateNativeOffline(document);
    expect(mapped.readback.noteEntities).toBe(1);
    expect(mapped.readback.effectDevices).toBe(3);
    expect(mapped.structuralReadback.effects).toBe(3);
  });
  it("develops repeated exact chord voicings and expressive drum hits within chosen sections", async () => {
    const base = applyNativeOperations(seedNativeDocument("A dark-to-hopeful song with a light offbeat groove"), [
      { kind: "setStructure", bars: 12, sections: [{ id: "intro", name: "Intro", startBar: 0, endBar: 4, intent: "No drums" }, { id: "body", name: "Body", startBar: 4, endBar: 12, intent: "Lift" }] },
      { kind: "addPart", part: { id: "chords", name: "Warm chords", role: "harmony", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, notes: [], placements: [], sourceRegions: [], effects: [], automation: [] } },
      { kind: "addPart", part: { id: "kit", name: "Offbeat kit", role: "percussion", device: { type: "gakki", parameters: {} }, gain: 0.6, pan: 0, notes: [], placements: [], sourceRegions: [], effects: [], automation: [] } }
    ]);
    const piece = applyNativeOperations(base, [
      { kind: "harmonizeSection", partId: "chords", sectionId: "body", cycleBars: 2, chords: [{ barOffset: 0, durationBars: 1, pitches: [50, 57, 60, 64], velocity: 0.64, strumTicks: 20 }, { barOffset: 1, durationBars: 1, pitches: [46, 53, 57, 60], velocity: 0.6, strumTicks: 20 }] },
      { kind: "sequenceSectionPattern", partId: "kit", sectionId: "body", cycleBars: 1, hits: [{ tick: 0, durationTicks: 240, pitch: 36, velocity: 0.8, timingOffsetTicks: 0 }, { tick: 960, durationTicks: 240, pitch: 38, velocity: 0.45, timingOffsetTicks: 35 }, { tick: 1440, durationTicks: 120, pitch: 42, velocity: 0.19, timingOffsetTicks: 25 }] }
    ]);
    expect(piece.parts.find((part) => part.id === "chords")?.notes).toHaveLength(32);
    expect(piece.parts.find((part) => part.id === "kit")?.notes).toHaveLength(24);
    expect(analyzeNativeSection(piece, "intro").parts.find((part) => part.id === "kit")?.soundingNotes).toBe(0);
    expect((await validateNativeOffline(piece)).readback.noteEntities).toBe(56);
    const guarded = applyNativeOperations(piece, [{ kind: "protect", partIds: ["chords"], motifIds: [] }]);
    expect(() => applyNativeOperations(guarded, [{ kind: "harmonizeSection", partId: "chords", sectionId: "body", cycleBars: 1, chords: [{ barOffset: 0, durationBars: 1, pitches: [50, 57], velocity: 0.5, strumTicks: 0 }] }])).toThrow(/Protected part/);
  });
  it("builds a real dry/wet split, processed branch and merger without changing protected routing", async () => {
    const dry = applyNativeOperations(seedNativeDocument("A restrained groove with parallel drum warmth"), [{ kind: "addNotes", partId: "starting-voice", notes: [{ id: "pulse", startTick: 0, durationTicks: 240, pitch: 36, velocity: 0.7 }] }]);
    const wet = applyNativeOperations(dry, [{ kind: "setParallelChain", partId: "starting-voice", parallel: { wetMix: 0.28, effects: [{ id: "tube", type: "stompboxTube", parameters: { drive: 3, tone: 0, postGain: 0.6 } }, { id: "squeeze", type: "stompboxCompressor", parameters: { thresholdDb: -12, ratio: 0.5 } }] } }]);
    const mapped = await validateNativeOffline(wet);
    expect(mapped.structuralReadback.parallelSplits).toBe(1);
    expect(mapped.structuralReadback.parallelMerges).toBe(1);
    expect(mapped.structuralReadback.effects).toBe(2);
    expect(mapped.structuralReadback.cables).toBeGreaterThanOrEqual(6);
    const merger = mapped.structuralReadback.semanticEntities.find((entity) => entity.type === "audioMerger")?.fields as { mergeCoords: { x: number; y: number } };
    const tube = mapped.structuralReadback.semanticEntities.find((entity) => entity.type === "stompboxTube")?.fields as { drive: number };
    expect(merger.mergeCoords).toEqual({ x: 0.28, y: 0.36 });
    expect(tube.drive).toBe(3);
    expect(nativeMusicHash(wet)).not.toBe(nativeMusicHash(dry));
    expect(nativeDiff(dry, wet).partChanges[0]?.fields).toContain("parallel");
    const protectedWet = applyNativeOperations(wet, [{ kind: "protect", partIds: ["starting-voice"], motifIds: [] }]);
    expect(() => applyNativeOperations(protectedWet, [{ kind: "removeParallelChain", partId: "starting-voice" }])).toThrow(/Protected part/);
  });
  it("discovers pinned SDK entities and their actual field ranges", async () => {
    const result = await discoverNativeCapabilities("instrument", 32);
    expect(result.totalEntities).toBeGreaterThan(60);
    expect(result.matches.some((value) => value.type === "heisenberg")).toBe(true);
    expect((await discoverNativeCapabilities("audioRegion")).matches[0]?.writableInPocketProducer).toBe(true);
    expect((await discoverNativeCapabilities("audioRegion")).matches[0]?.operationContract.prerequisite).toMatch(/Owned ready WAV/);
    const detail = await inspectNativeCapability("/beatbox8Pattern/length");
    await expect(inspectNativeCapability("/beatbox8Pattern/notReal")).rejects.toThrow("Field is not in the pinned Nexus schema");
    expect(detail.schema.type).toBe("primitive");
    expect(toNexusTicks(960)).toBe(3840);
  });

  it("constructs two materially different directions through the same tool executor", async () => {
    const ambient = session("Build an evolving 64-bar ambient journey with a slow lead and spacious transitions");
    const club = session("Build a driving club track with a sharp hook and a break");
    await fixtureConstruct(ambient, ambient.document.direction, []);
    await fixtureConstruct(club, club.document.direction, []);
    expect(ambient.document.bars).toBe(64);
    expect(ambient.document.parts.length).toBeGreaterThanOrEqual(8);
    expect(ambient.document.motifs.length).toBeGreaterThanOrEqual(16);
    expect(ambient.document.parts.some((part) => part.automation.length > 0)).toBe(true);
    expect(club.document.bars).toBe(32);
    expect(ambient.document.tempoBpm).not.toBe(club.document.tempoBpm);
    expect(canonicalHash(ambient.document)).not.toBe(canonicalHash(club.document));
    expect(pinnedContext(ambient.document, "revision-a").parts.length).toBe(ambient.document.parts.length);
    const offline = await validateNativeOffline(ambient.document);
    expect(offline.readback.synths).toBeGreaterThanOrEqual(4);
    expect(offline.readback.drumMachines).toBeGreaterThanOrEqual(2);
    expect(offline.readback.noteEntities).toBeGreaterThan(100);
    expect(offline.readback.patternRegions).toBeGreaterThan(0);
    expect(offline.readback.effectDevices).toBeGreaterThan(0);
    expect(offline.readback.automationEvents).toBeGreaterThan(0);
  }, 120_000);

  it("makes localized structural revisions without changing a protected part", async () => {
    const draft = session("An evolving 64-bar ambient journey");
    await fixtureConstruct(draft, draft.document.direction, []);
    const protectedId = "lead";
    const protectedBefore = protectedPartHash(draft.document, protectedId);
    draft.document = applyNativeOperations(draft.document, [{ kind: "protect", partIds: [protectedId], motifIds: [] }]);
    const before = structuredClone(draft.document);
    await fixtureRevise(draft, "Vary the rhythmic phrase in the later section", "soft-pulse", "section-4");
    expect(protectedPartHash(draft.document, protectedId)).toBe(protectedBefore);
    expect(nativeDiff(before, draft.document).changedParts).toContain("soft-pulse");
    expect(materializedNotes(draft.document, "soft-pulse").length).toBeGreaterThan(0);
    await expect(fixtureRevise(draft, "Change the instrument", protectedId, "section-4")).rejects.toThrow(/Protected part/);
  }, 30_000);

  it("distinguishes real motif edits from objective-only text changes", async () => {
    const draft = session("A compact rhythmic sketch");
    await fixtureConstruct(draft, draft.document.direction, []);
    const base = draft.document;
    const objectiveOnly = applyNativeOperations(base, [{ kind: "setObjective", objective: "Say this differently" }]);
    expect(nativeMusicHash(objectiveOnly)).toBe(nativeMusicHash(base));
    const labelsOnly = applyNativeOperations(base, [{ kind: "setTitle", title: "New label" }, { kind: "setStructure", bars: base.bars, sections: base.sections.map((section) => ({ ...section, name: `${section.name} renamed`, intent: "New annotation" })) }]);
    expect(nativeMusicHash(labelsOnly)).toBe(nativeMusicHash(base));
    const motif = base.motifs.find((value) => value.partId === "bass-drive")!;
    const changed = applyNativeOperations(base, [{ kind: "replaceMotif", motif: { ...motif, notes: motif.notes.map((value, index) => index === 0 ? { ...value, pitch: value.pitch + 1 } : value) } }]);
    expect(nativeMusicHash(changed)).not.toBe(nativeMusicHash(base));
    expect(nativeDiff(base, changed).changedParts).toContain("bass-drive");
  });

  it("rejects Beatbox8 changes the boolean-step mapper cannot faithfully express", async () => {
    const draft = session("A driving rhythmic sketch");
    await fixtureConstruct(draft, draft.document.direction, []);
    const base = draft.document;
    const part = base.parts.find((value) => value.id === "kick-grid")!;
    const motif = base.motifs.find((value) => value.partId === part.id)!;
    expect(() => applyNativeOperations(base, [{ kind: "replacePlacements", partId: part.id, placements: part.placements.map((placement, index) => index === 0 ? { ...placement, transpose: 2 } : placement) }])).toThrow(/Beatbox8/);
    expect(() => applyNativeOperations(base, [{ kind: "replaceMotif", motif: { ...motif, notes: motif.notes.map((note, index) => index === 0 ? { ...note, velocity: 0.5 } : note) } }])).toThrow(/Beatbox8/);
    expect(() => applyNativeOperations(base, [{ kind: "replaceMotif", motif: { ...motif, notes: motif.notes.map((note, index) => index === 0 ? { ...note, pitch: 40 } : note) } }])).toThrow(/Beatbox8/);
  });
});
