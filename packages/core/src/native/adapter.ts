import { createOfflineDocument } from "@audiotool/nexus/node";
import { Ticks } from "@audiotool/nexus/utils";
import type { SyncedDocument } from "@audiotool/nexus";
import type { NexusEntity } from "@audiotool/nexus/document";
import { canonicalHash } from "../domain/hash.js";
import { nativePresetFingerprint, type LibrarySample, type NativePreset } from "./library.js";
import { assertNativeDeviceMapping, materializedNotes, nativeDocumentSchema, type NativeDocument, type NativePart } from "./model.js";

export const NATIVE_MAPPING_VERSION = "nexus-native-v7";
export const NEXUS_TICKS_PER_CANONICAL_TICK = Ticks.Beat / 960;
export function toNexusTicks(canonicalTicks: number): number {
  const value = canonicalTicks * NEXUS_TICKS_PER_CANONICAL_TICK;
  if (!Number.isSafeInteger(value)) throw new Error("Musical time cannot be represented in Nexus ticks");
  return value;
}

type WritableDocument = Pick<SyncedDocument, "modify" | "queryEntities">;
export interface NativeRemoteDocument extends WritableDocument { start(): Promise<void>; stop(): Promise<void>; dawUrl: string }
export interface NativeRemoteClient {
  projects: { createProject(request: { project: { displayName: string } }): Promise<{ project?: { name: string } } | Error> };
  samples: { upload(options: { file: ArrayBuffer; displayName: string; bpm: number; kind: "loop"; visibility: "unlisted"; tags: string[] }, signal?: AbortSignal): Promise<{ uploaded: Promise<unknown>; ready: Promise<{ name: string; durationSeconds?: number } | Error> } | Error> };
  open(project: string): Promise<NativeRemoteDocument>;
}
export type NativeSampleResources = Record<string, { sampleName: string; durationSeconds: number }>;
const drumField = (pitch: number) => pitch === 36 ? "bassdrumIsActive" : pitch === 38 ? "snaredrumIsActive" : pitch === 42 ? "closedHihatIsActive" : pitch === 46 ? "openHihatIsActive" : null;
function nestedDeviceParameters(type: NativePart["device"]["type"], values: Record<string, number>): Record<string, unknown> {
  // The canonical schema is the write allow-list; this function only nests its
  // validated dotted paths into the SDK constructor, never accepts raw SDK JSON.
  const result: Record<string, unknown> = type === "heisenberg" ? { playModeIndex: 4, operatorA: { gain: 0.5 } } : {};
  for (const [path, value] of Object.entries(values)) {
    const segments = path.split(".");
    let owner = result;
    for (const segment of segments.slice(0, -1)) owner = (owner[segment] ??= {}) as Record<string, unknown>;
    owner[segments.at(-1)!] = value;
  }
  return result;
}
function nativeField(root: unknown, path: string): { location: { entityId: string; entityType: string | undefined; fieldIndex: number[] } } | null {
  let value = root;
  for (const segment of path.split(".")) value = ((value as { fields?: Record<string, unknown> }).fields ?? value as Record<string, unknown>)[segment];
  return value && typeof value === "object" && "location" in value ? value as ReturnType<typeof nativeField> : null;
}

export async function applyNativeSnapshot(doc: WritableDocument, raw: NativeDocument, sourceSamples: NativeSampleResources = {}, presets: Record<string, NativePreset> = {}, librarySamples: Record<string, LibrarySample> = {}): Promise<{ mappedParts: number; noteEntities: number; patternRegions: number; automationEvents: number; unresolvedSources: string[] }> {
  const document = nativeDocumentSchema.parse(raw);
  assertNativeDeviceMapping(document);
  const unresolvedSources: string[] = [];
  let noteEntities = 0;
  let patternRegions = 0;
  let automationEvents = 0;
  // This v1 adapter owns only documents it creates. It never deletes or rewrites
  // unknown entities in an existing Studio document.
  if (doc.queryEntities.ofTypes("note", "noteTrack", "noteRegion", "patternTrack", "patternRegion", "beatbox8", "heisenberg", "pulverisateur", "gakki", "audioRegion", "audioTrack", "audioDevice", "mixerChannel", "mixerGroup", "mixerStripGrouping", "mixerReverbAux", "mixerDelayAux", "mixerAuxRoute", "mixerSideChainCable", "desktopAudioCable", "audioSplitter", "audioMerger", "stompboxDelay", "stompboxReverb", "stompboxCompressor", "stompboxParametricEqualizer", "autoFilter", "stompboxTube", "stompboxChorus", "stompboxPitchDelay", "automationTrack").get().length) throw new Error("Native target is not empty; inspect/reconcile external edits before applying a snapshot");
  await doc.modify((t) => {
    const groove = t.create("groove", { functionIndex: 1, durationTicks: Ticks.Beat * 2, impact: 0, displayName: "Straight" });
    const config = t.entities.ofTypes("config").getOne() ?? t.create("config", { defaultGroove: groove.location });
    t.update(config.fields.tempoBpm, document.tempoBpm);
    t.update(config.fields.signatureNumerator, document.meter.numerator);
    t.update(config.fields.signatureDenominator, document.meter.denominator);
    const duration = toNexusTicks(document.bars * document.meter.numerator * 960 * 4 / document.meter.denominator);
    t.update(config.fields.durationTicks, duration);
    const master = t.entities.ofTypes("mixerMaster").getOne() ?? t.create("mixerMaster", {});
    if (document.master) {
      t.update(master.fields.postGain, document.master.gain);
      t.update(master.fields.panning, document.master.pan);
      t.update(master.fields.limiterEnabled, document.master.limiterEnabled);
    }
    const groups = new Map((document.groups ?? []).map((group) => [group.id, t.create("mixerGroup", { displayParameters: { displayName: group.name }, faderParameters: { postGain: group.gain, panning: group.pan }, ...(group.compressor ? { compressor: group.compressor } : {}) })]));
    for (const group of document.groups ?? []) if (group.parentId) t.create("mixerStripGrouping", { childStrip: groups.get(group.id)!.location, groupStrip: groups.get(group.parentId)!.location });
    const reverbBus = document.reverbBus && t.create("mixerReverbAux", { displayParameters: { displayName: document.reverbBus.name }, roomSizeFactor: document.reverbBus.roomSize, preDelayTimeMs: document.reverbBus.preDelayMs, dampFactor: document.reverbBus.damp });
    const delayBus = document.delayBus && t.create("mixerDelayAux", { displayParameters: { displayName: document.delayBus.name }, feedbackFactor: document.delayBus.feedbackFactor, stepCount: document.delayBus.stepCount, stepLengthIndex: document.delayBus.stepLengthIndex });
    const channels = new Map<string, NexusEntity<"mixerChannel">>();
    for (const [index, part] of document.parts.entries()) {
      const channel = t.create("mixerChannel", { preGain: part.gain, faderParameters: { panning: part.pan } });
      channels.set(part.id, channel);
      if (part.groupId) t.create("mixerStripGrouping", { childStrip: channel.location, groupStrip: groups.get(part.groupId)!.location });
      const sendTargets = new Map<string, unknown>();
      for (const send of part.sends ?? []) {
        const receive = send.busId === document.reverbBus?.id ? reverbBus : send.busId === document.delayBus?.id ? delayBus : null;
        if (!receive) throw new Error(`Unresolved return ${send.busId}`);
        const route = t.create("mixerAuxRoute", { auxSend: channel.fields.auxSend.location, auxReceive: receive.location, gain: send.gain });
        sendTargets.set(send.busId, route.fields.gain);
      }
      const position = { displayName: part.name, positionX: 100 + (index % 4) * 240, positionY: 100 + Math.floor(index / 4) * 220 };
      const parameters = part.device.parameters;
      const deviceFields = nestedDeviceParameters(part.device.type, parameters);
      const instrument = part.device.type === "audio" ? t.create("audioDevice", { ...position, gain: 1, panning: 0 })
        : part.device.type === "heisenberg" ? t.create("heisenberg", { ...position, gain: parameters.gain ?? part.gain, ...deviceFields })
        : part.device.type === "pulverisateur" ? t.create("pulverisateur", { ...position, gain: parameters.gain ?? part.gain, ...deviceFields })
        : part.device.type === "gakki" ? t.create("gakki", { ...position, gain: parameters.gain ?? part.gain, ...deviceFields })
        : t.create("beatbox8", { ...position, gain: parameters.gain ?? part.gain, ...deviceFields });
      if (part.device.preset) {
        const preset = presets[part.device.preset.name];
        if (!preset || preset.entityType !== part.device.type || preset.meta.name !== part.device.preset.name || preset.meta.ownerName !== part.device.preset.ownerName || !part.device.preset.contentHash || nativePresetFingerprint(preset) !== part.device.preset.contentHash) throw new Error(`Preset ${part.device.preset.name} is unresolved, unpinned or its configuration has drifted`);
        t.applyPresetTo(instrument as never, preset);
        for (const [path, value] of Object.entries(parameters)) {
          let field: unknown = instrument.fields;
          for (const segment of path.split(".")) field = ((field as { fields?: Record<string, unknown> }).fields ?? field as Record<string, unknown>)[segment];
          if (!field || typeof field !== "object" || !("location" in field)) throw new Error(`Preset override ${path} does not resolve to a native field`);
          t.update(field as never, value);
        }
      }
      let output = instrument.fields.audioOutput.location;
      let filterTarget: { location: typeof output } | null = null;
      const effectTargets = new Map<string, unknown>();
      for (const [effectIndex, effect] of part.effects.entries()) {
        const fxPosition = { displayName: `${part.name} ${effect.type}`, positionX: position.positionX + 120 + effectIndex * 100, positionY: position.positionY + 80 };
        const fx = effect.type === "stompboxDelay" ? t.create("stompboxDelay", { ...fxPosition, ...effect.parameters })
          : effect.type === "stompboxReverb" ? t.create("stompboxReverb", { ...fxPosition, ...effect.parameters })
          : effect.type === "stompboxCompressor" ? t.create("stompboxCompressor", { ...fxPosition, ...effect.parameters })
          : effect.type === "stompboxParametricEqualizer" ? t.create("stompboxParametricEqualizer", { ...fxPosition, ...effect.parameters })
          : effect.type === "stompboxTube" ? t.create("stompboxTube", { ...fxPosition, ...effect.parameters })
          : effect.type === "stompboxChorus" ? t.create("stompboxChorus", { ...fxPosition, ...effect.parameters })
          : effect.type === "stompboxPitchDelay" ? t.create("stompboxPitchDelay", { ...fxPosition, ...effect.parameters })
          : t.create("autoFilter", { ...fxPosition, ...effect.parameters });
        t.create("desktopAudioCable", { fromSocket: output, toSocket: fx.fields.audioInput.location });
        output = fx.fields.audioOutput.location;
        effectTargets.set(effect.id, fx.fields);
        if (effect.type === "autoFilter") filterTarget = (fx as NexusEntity<"autoFilter">).fields.cutoffFrequencyHz;
      }
      if (part.parallel) {
        const split = t.create("audioSplitter", { displayName: `${part.name} dry/wet split`, blendModeIndex: 1, positionX: position.positionX + 120, positionY: position.positionY + 180 });
        const merge = t.create("audioMerger", { displayName: `${part.name} dry/wet blend`, blendModeIndex: 1, mergeCoords: { x: part.parallel.wetMix, y: (1 - part.parallel.wetMix) / 2 }, positionX: position.positionX + 550, positionY: position.positionY + 180 });
        t.create("desktopAudioCable", { fromSocket: output, toSocket: split.fields.audioInput.location });
        t.create("desktopAudioCable", { fromSocket: split.fields.audioOutputA.location, toSocket: merge.fields.audioInputA.location });
        let wetOutput = split.fields.audioOutputB.location;
        for (const [effectIndex, effect] of part.parallel.effects.entries()) {
          const fxPosition = { displayName: `${part.name} parallel ${effect.type}`, positionX: position.positionX + 240 + effectIndex * 100, positionY: position.positionY + 230 };
          const fx = effect.type === "stompboxDelay" ? t.create("stompboxDelay", { ...fxPosition, ...effect.parameters })
            : effect.type === "stompboxReverb" ? t.create("stompboxReverb", { ...fxPosition, ...effect.parameters })
            : effect.type === "stompboxCompressor" ? t.create("stompboxCompressor", { ...fxPosition, ...effect.parameters })
            : effect.type === "stompboxParametricEqualizer" ? t.create("stompboxParametricEqualizer", { ...fxPosition, ...effect.parameters })
            : effect.type === "stompboxTube" ? t.create("stompboxTube", { ...fxPosition, ...effect.parameters })
            : effect.type === "stompboxChorus" ? t.create("stompboxChorus", { ...fxPosition, ...effect.parameters })
            : effect.type === "stompboxPitchDelay" ? t.create("stompboxPitchDelay", { ...fxPosition, ...effect.parameters })
            : t.create("autoFilter", { ...fxPosition, ...effect.parameters });
          t.create("desktopAudioCable", { fromSocket: wetOutput, toSocket: fx.fields.audioInput.location });
          wetOutput = fx.fields.audioOutput.location;
          effectTargets.set(effect.id, fx.fields);
        }
        t.create("desktopAudioCable", { fromSocket: wetOutput, toSocket: merge.fields.audioInputB.location });
        output = merge.fields.audioOutput.location;
      }
      t.create("desktopAudioCable", { fromSocket: output, toSocket: channel.fields.audioInput.location });
      if (part.device.type === "audio") {
        const device = instrument as NexusEntity<"audioDevice">;
        for (const region of part.sourceRegions) {
          const resource = sourceSamples[region.assetId];
          if (!resource) { unresolvedSources.push(region.id); continue; }
          if (!/^samples\/[a-zA-Z0-9-]{1,120}$/.test(resource.sampleName) || !Number.isFinite(resource.durationSeconds) || resource.durationSeconds <= 0) throw new Error(`Invalid ready sample identity for ${region.assetId}`);
          const rate = region.playbackRate ?? 1;
          const offsetTicks = Math.round(region.sourceStartSeconds / rate * document.tempoBpm / 60 * Ticks.Beat);
          const selectedTicks = Math.round(region.sourceDurationSeconds / rate * document.tempoBpm / 60 * Ticks.Beat);
          const timelineTicks = toNexusTicks(region.durationTicks);
          if (region.sourceStartSeconds + region.sourceDurationSeconds > resource.durationSeconds + 0.001) throw new Error(`Selected interval exceeds ready sample ${region.assetId}`);
          if ((region.playbackMode ?? "once") === "once" && timelineTicks > selectedTicks) throw new Error(`One-shot ${region.id} exceeds its selected source interval`);
          const inserted = t.insertSample({ name: resource.sampleName, durationSeconds: resource.durationSeconds }, {
            attachTo: device,
            sample: { ...(region.playbackRate === undefined ? { bpm: document.tempoBpm } : { musicDurationTicks: Math.max(1, Math.round(resource.durationSeconds / rate * document.tempoBpm / 60 * Ticks.Beat)) }), offsetTicks },
            region: { positionTicks: toNexusTicks(region.startTick), durationTicks: timelineTicks },
            loop: (region.playbackMode ?? "once") === "loop" ? { startTicks: offsetTicks, durationTicks: selectedTicks } : false,
            displayName: `${part.name} · ${region.id}`
          });
          t.update(inserted.fields.gain, region.gain);
          if (region.stretchMode) t.update(inserted.fields.timestretchMode, region.stretchMode === "resample" ? 1 : 2);
          if (region.pitchShiftSemitones !== undefined) t.update(inserted.fields.pitchShiftSemitones, region.pitchShiftSemitones);
        }
        for (const region of part.libraryRegions ?? []) {
          const resource = librarySamples[region.sampleName];
          if (!resource || resource.ownerName !== region.ownerName || Math.abs(resource.durationSeconds - region.durationSeconds) > 0.001) throw new Error(`Library sample ${region.sampleName} is unresolved or changed`);
          const rate = region.playbackRate ?? 1;
          const offsetTicks = Math.round(region.sourceStartSeconds / rate * document.tempoBpm / 60 * Ticks.Beat);
          const selectedTicks = Math.round(region.sourceDurationSeconds / rate * document.tempoBpm / 60 * Ticks.Beat);
          const timelineTicks = toNexusTicks(region.durationTicks);
          if (region.playbackMode === "once" && timelineTicks > selectedTicks) throw new Error(`One-shot library region ${region.id} exceeds its selected interval`);
          const inserted = t.insertSample({ name: resource.name, durationSeconds: resource.durationSeconds, ...(resource.bpm > 0 ? { bpm: resource.bpm } : {}) }, {
            attachTo: device, sample: { ...(region.playbackRate === undefined ? { bpm: document.tempoBpm } : { musicDurationTicks: Math.max(1, Math.round(resource.durationSeconds / rate * document.tempoBpm / 60 * Ticks.Beat)) }), offsetTicks },
            region: { positionTicks: toNexusTicks(region.startTick), durationTicks: timelineTicks },
            loop: region.playbackMode === "loop" ? { startTicks: offsetTicks, durationTicks: selectedTicks } : false,
            displayName: `${part.name} · ${region.displayName}`
          });
          t.update(inserted.fields.gain, region.gain);
          if (region.stretchMode) t.update(inserted.fields.timestretchMode, region.stretchMode === "resample" ? 1 : 2);
          if (region.pitchShiftSemitones !== undefined) t.update(inserted.fields.pitchShiftSemitones, region.pitchShiftSemitones);
        }
      } else if (part.device.type === "beatbox8") {
        const machine = instrument as NexusEntity<"beatbox8">;
        const phrases = document.motifs.filter((value) => value.partId === part.id);
        if (phrases.length > 5) throw new Error(`Beatbox8 part ${part.id} exceeds five native pattern slots`);
        const slotByMotif = new Map<string, number>();
        for (const [slot, phrase] of phrases.entries()) {
          const steps = phrase.lengthTicks / 240;
          if (!Number.isInteger(steps) || steps < 1 || steps > 64) throw new Error(`Beatbox8 motif ${phrase.id} requires 1–64 sixteenth-note steps`);
          const slotLocation = machine.fields.patternSlots.array[slot]?.location;
          if (!slotLocation) throw new Error("Beatbox8 pattern slot unavailable");
          const pattern = t.create("beatbox8Pattern", { slot: slotLocation, length: steps, stepScaleIndex: 3 });
          for (const event of phrase.notes) {
            const step = event.startTick / 240;
            const field = drumField(event.pitch);
            if (!Number.isInteger(step) || step >= steps || !field) throw new Error(`Unsupported beatbox8 event in motif ${phrase.id}; use MIDI 36, 38, 42 or 46 on a sixteenth grid`);
            t.update(pattern.fields.steps.array[step]!.fields[field], true);
          }
          slotByMotif.set(phrase.id, slot);
        }
        const track = t.create("patternTrack", { player: machine.location, orderAmongTracks: index });
        for (const placement of part.placements) {
          const phrase = phrases.find((value) => value.id === placement.motifId)!;
          t.create("patternRegion", { track: track.location, patternIndex: slotByMotif.get(phrase.id)!, restart: true, region: { displayName: phrase.name, positionTicks: toNexusTicks(placement.startTick), durationTicks: toNexusTicks(phrase.lengthTicks * placement.repeats), loopDurationTicks: toNexusTicks(phrase.lengthTicks) } });
          patternRegions += 1;
        }
        if (part.notes.length) throw new Error(`Beatbox8 direct notes are not mapped; use motifs and pattern regions for ${part.id}`);
      } else {
        const track = t.create("noteTrack", { player: instrument.location, orderAmongTracks: index });
        for (const placement of part.placements) {
          const phrase = document.motifs.find((value) => value.id === placement.motifId)!;
          const collection = t.create("noteCollection", {});
          t.create("noteRegion", { track: track.location, collection: collection.location, region: { displayName: phrase.name, positionTicks: toNexusTicks(placement.startTick), durationTicks: toNexusTicks(phrase.lengthTicks * placement.repeats), loopDurationTicks: toNexusTicks(phrase.lengthTicks) } });
          for (const value of phrase.notes) {
            t.create("note", { collection: collection.location, positionTicks: toNexusTicks(value.startTick), durationTicks: toNexusTicks(value.durationTicks), pitch: value.pitch + placement.transpose, velocity: value.velocity });
            noteEntities += 1;
          }
        }
        if (part.notes.length) {
          const collection = t.create("noteCollection", {});
          t.create("noteRegion", { track: track.location, collection: collection.location, region: { displayName: `${part.name} free notes`, positionTicks: 0, durationTicks: duration, loopDurationTicks: duration } });
          for (const value of part.notes) { t.create("note", { collection: collection.location, positionTicks: toNexusTicks(value.startTick), durationTicks: toNexusTicks(value.durationTicks), pitch: value.pitch, velocity: value.velocity }); noteEntities += 1; }
        }
      }
      for (const curve of part.automation) {
        const effectMatch = /^effect\.([a-z][a-z0-9-]{0,63})\.([A-Za-z][A-Za-z0-9]*)$/.exec(curve.target);
        const sendMatch = /^send\.([a-z][a-z0-9-]{0,63})\.gain$/.exec(curve.target);
        const target = curve.target === "gain" ? channel.fields.preGain : curve.target === "pan" ? channel.fields.faderParameters.fields.panning : curve.target === "filter" ? filterTarget
          : curve.target.startsWith("device.") ? nativeField(instrument.fields, curve.target.slice(7))
          : effectMatch ? nativeField(effectTargets.get(effectMatch[1]!), effectMatch[2]!)
          : sendMatch ? sendTargets.get(sendMatch[1]!) : null;
        if (!target || typeof target !== "object" || !("location" in target)) throw new Error(`Automation ${curve.id} has no resolved native parameter target`);
        const automationTrack = t.create("automationTrack", { automatedParameter: target.location as typeof channel.fields.preGain.location, orderAmongTracks: document.parts.length + automationEvents });
        const collection = t.create("automationCollection", {});
        t.create("automationRegion", { track: automationTrack.location, collection: collection.location, region: { displayName: `${part.name} ${curve.target}`, positionTicks: 0, durationTicks: duration, loopDurationTicks: duration } });
        for (const point of curve.points) { t.create("automationEvent", { collection: collection.location, positionTicks: toNexusTicks(point.tick), value: point.value, interpolation: point.interpolation === "step" || !point.interpolation ? 1 : 2, slope: point.interpolation === "sloped" ? point.slope ?? 0 : 0 }); automationEvents += 1; }
      }
    }
    for (const [groupIndex, group] of (document.groups ?? []).entries()) {
      const nativeGroup = groups.get(group.id)!;
      const effectTargets = new Map<string, unknown>();
      let output = nativeGroup.fields.insertOutput.location;
      const createGroupEffect = (effect: NonNullable<NativeDocument["groups"]>[number]["effects"] extends Array<infer E> | undefined ? E : never, index: number, branch: string) => {
        const position = { displayName: `${group.name} ${branch} ${effect.type}`, positionX: 160 + groupIndex * 220 + index * 100, positionY: 750 + groupIndex * 150 + (branch === "wet" ? 60 : 0) };
        const fx = effect.type === "stompboxDelay" ? t.create("stompboxDelay", { ...position, ...effect.parameters })
          : effect.type === "stompboxReverb" ? t.create("stompboxReverb", { ...position, ...effect.parameters })
          : effect.type === "stompboxCompressor" ? t.create("stompboxCompressor", { ...position, ...effect.parameters })
          : effect.type === "stompboxParametricEqualizer" ? t.create("stompboxParametricEqualizer", { ...position, ...effect.parameters })
          : effect.type === "stompboxTube" ? t.create("stompboxTube", { ...position, ...effect.parameters })
          : effect.type === "stompboxChorus" ? t.create("stompboxChorus", { ...position, ...effect.parameters })
          : effect.type === "stompboxPitchDelay" ? t.create("stompboxPitchDelay", { ...position, ...effect.parameters })
          : t.create("autoFilter", { ...position, ...effect.parameters });
        effectTargets.set(effect.id, fx.fields);
        return fx;
      };
      for (const [index, effect] of (group.effects ?? []).entries()) {
        const fx = createGroupEffect(effect, index, "insert");
        t.create("desktopAudioCable", { fromSocket: output, toSocket: fx.fields.audioInput.location });
        output = fx.fields.audioOutput.location;
      }
      let blend: NexusEntity<"audioMerger"> | null = null;
      if (group.parallel) {
        const split = t.create("audioSplitter", { displayName: `${group.name} shared dry/wet split`, blendModeIndex: 1, positionX: 220 + groupIndex * 220, positionY: 830 + groupIndex * 150 });
        blend = t.create("audioMerger", { displayName: `${group.name} shared dry/wet blend`, blendModeIndex: 1, mergeCoords: { x: group.parallel.wetMix, y: (1 - group.parallel.wetMix) / 2 }, positionX: 600 + groupIndex * 220, positionY: 830 + groupIndex * 150 });
        t.create("desktopAudioCable", { fromSocket: output, toSocket: split.fields.audioInput.location });
        t.create("desktopAudioCable", { fromSocket: split.fields.audioOutputA.location, toSocket: blend.fields.audioInputA.location });
        let wet = split.fields.audioOutputB.location;
        for (const [index, effect] of group.parallel.effects.entries()) {
          const fx = createGroupEffect(effect, index, "wet");
          t.create("desktopAudioCable", { fromSocket: wet, toSocket: fx.fields.audioInput.location });
          wet = fx.fields.audioOutput.location;
        }
        t.create("desktopAudioCable", { fromSocket: wet, toSocket: blend.fields.audioInputB.location });
        output = blend.fields.audioOutput.location;
      }
      if ((group.effects?.length ?? 0) || group.parallel) t.create("desktopAudioCable", { fromSocket: output, toSocket: nativeGroup.fields.insertInput.location });
      for (const curve of group.automation ?? []) {
        const effectMatch = /^effect\.([a-z][a-z0-9-]{0,63})\.([A-Za-z][A-Za-z0-9]*)$/.exec(curve.target);
        const target = curve.target === "gain" ? nativeGroup.fields.faderParameters.fields.postGain
          : curve.target === "pan" ? nativeGroup.fields.faderParameters.fields.panning
          : curve.target.startsWith("compressor.") ? nativeField(nativeGroup.fields.compressor, curve.target.slice(11))
          : curve.target === "parallel.wetMix" ? blend?.fields.mergeCoords.fields.x
          : effectMatch ? nativeField(effectTargets.get(effectMatch[1]!), effectMatch[2]!) : null;
        if (!target || typeof target !== "object" || !("location" in target)) throw new Error(`Group automation ${curve.id} has no native target`);
        const track = t.create("automationTrack", { automatedParameter: target.location as typeof nativeGroup.fields.faderParameters.fields.postGain.location, orderAmongTracks: document.parts.length + automationEvents });
        const collection = t.create("automationCollection", {});
        t.create("automationRegion", { track: track.location, collection: collection.location, region: { displayName: `${group.name} ${curve.target}`, positionTicks: 0, durationTicks: duration, loopDurationTicks: duration } });
        for (const point of curve.points) { t.create("automationEvent", { collection: collection.location, positionTicks: toNexusTicks(point.tick), value: point.value, interpolation: point.interpolation === "step" || !point.interpolation ? 1 : 2, slope: point.interpolation === "sloped" ? point.slope ?? 0 : 0 }); automationEvents += 1; }
      }
    }
    for (const group of document.groups ?? []) if (group.sidechainFromPartId) {
      const source = channels.get(group.sidechainFromPartId);
      const destination = groups.get(group.id);
      if (!source || !destination) throw new Error(`Unresolved mixer sidechain for ${group.id}`);
      t.create("mixerSideChainCable", { from: source.fields.sideChainOutput.location, to: destination.fields.compressor.fields.sideChainInput.location });
    }
  });
  const mappedParts = document.parts.filter((part) => part.device.type !== "audio" || part.sourceRegions.every((region) => !unresolvedSources.includes(region.id))).length;
  return { mappedParts, noteEntities, patternRegions, automationEvents, unresolvedSources };
}

export async function validateNativeOffline(document: NativeDocument, sourceSamples: NativeSampleResources = {}, presets: Record<string, NativePreset> = {}, librarySamples: Record<string, LibrarySample> = {}) {
  const offline = await createOfflineDocument({ validated: true });
  const mapped = await applyNativeSnapshot(offline, document, sourceSamples, presets, librarySamples);
  return {
    mappingVersion: NATIVE_MAPPING_VERSION, nexusTicksPerBeat: Ticks.Beat,
    ...mapped,
    readback: {
      synths: offline.queryEntities.ofTypes("heisenberg", "pulverisateur", "gakki").get().length,
      drumMachines: offline.queryEntities.ofTypes("beatbox8").get().length,
      noteEntities: offline.queryEntities.ofTypes("note").get().length,
      patternRegions: offline.queryEntities.ofTypes("patternRegion").get().length,
      effectDevices: offline.queryEntities.ofTypes("stompboxDelay", "stompboxReverb", "stompboxCompressor", "stompboxParametricEqualizer", "autoFilter", "stompboxTube", "stompboxChorus", "stompboxPitchDelay").get().length,
      automationEvents: offline.queryEntities.ofTypes("automationEvent").get().length
    },
    structuralReadback: nativeStructuralReadback(offline)
  };
}

export function nativeStructuralReadback(doc: Pick<SyncedDocument, "queryEntities">) {
  const config = doc.queryEntities.ofTypes("config").getOne();
  const notes = doc.queryEntities.ofTypes("note").get().map((value) => [value.fields.positionTicks.value, value.fields.durationTicks.value, value.fields.pitch.value, value.fields.velocity.value]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const patterns = doc.queryEntities.ofTypes("beatbox8Pattern").get().map((value) => ({ length: value.fields.length.value, steps: value.fields.steps.array.map((step, index) => ({ index, bass: step.fields.bassdrumIsActive.value, snare: step.fields.snaredrumIsActive.value, closedHat: step.fields.closedHihatIsActive.value, openHat: step.fields.openHihatIsActive.value })).filter((step) => step.bass || step.snare || step.closedHat || step.openHat) })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const automation = doc.queryEntities.ofTypes("automationEvent").get().map((value) => [value.fields.positionTicks.value, value.fields.value.value]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  // Nexus allocates different IDs and returns a different entity enumeration
  // order after reopening a remote project. A type-local enumeration ordinal
  // therefore cannot identify a pointer across offline/live documents. Hash
  // each entity's typed fields and then its referenced neighbours in bounded
  // rounds; compare a sorted multiset of those signatures. Socket indexes are
  // retained so routing ends and automation targets remain distinguishable.
  // UI positions, labels and colors are not music.
  const semanticTypes = ["config", "groove", "mixerMaster", "mixerChannel", "mixerGroup", "mixerStripGrouping", "mixerReverbAux", "mixerDelayAux", "mixerAuxRoute", "mixerSideChainCable", "desktopAudioCable", "audioSplitter", "audioMerger", "heisenberg", "pulverisateur", "gakki", "beatbox8", "beatbox8Pattern", "noteTrack", "noteCollection", "noteRegion", "note", "patternTrack", "patternRegion", "stompboxDelay", "stompboxReverb", "stompboxCompressor", "stompboxParametricEqualizer", "autoFilter", "stompboxTube", "stompboxChorus", "stompboxPitchDelay", "automationTrack", "automationRegion", "automationCollection", "automationEvent", "audioDevice", "audioTrack", "audioRegion", "sample"] as const;
  const entities = doc.queryEntities.ofTypes(...semanticTypes).get();
  const ignored = new Set(["positionX", "positionY", "colorIndex", "displayName", "orderAmongStrips"]);
  const normalize = (value: unknown, labels: Map<string, string>): unknown => {
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "number") return Math.round(value * 1_000_000) / 1_000_000;
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map((child) => normalize(child, labels));
    const record = value as Record<string, unknown>;
    if (typeof record.entityId === "string" && Array.isArray(record.fieldIndex)) {
      return { ref: record.entityId ? labels.get(record.entityId) ?? `${String(record.entityType)}:outside-mapping` : null, socket: record.fieldIndex };
    }
    if ("value" in record && "location" in record) return normalize(record.value, labels);
    if (Array.isArray(record.array)) return record.array.map((child: unknown) => normalize(child, labels));
    if (record.fields && typeof record.fields === "object") return normalize(record.fields, labels);
    return Object.fromEntries(Object.entries(record).filter(([key]) => !ignored.has(key)).map(([key, child]) => [key, normalize(child, labels)]));
  };
  let labels = new Map(entities.map((entity) => [entity.location.entityId, String(entity.location.entityType)]));
  for (let round = 0; round < 8; round += 1) {
    labels = new Map(entities.map((entity) => [entity.location.entityId, canonicalHash({ type: entity.location.entityType, fields: normalize(entity.fields, labels) })]));
  }
  const semanticEntities = entities.map((entity) => ({ type: entity.location.entityType, identity: labels.get(entity.location.entityId), fields: normalize(entity.fields, labels) }))
    .sort((a, b) => canonicalHash(a).localeCompare(canonicalHash(b)));
  return {
    tempoBpm: config?.fields.tempoBpm.value ?? null,
    signature: config ? [config.fields.signatureNumerator.value, config.fields.signatureDenominator.value] : null,
    durationTicks: config?.fields.durationTicks.value ?? null,
    instruments: {
      heisenberg: doc.queryEntities.ofTypes("heisenberg").get().length,
      pulverisateur: doc.queryEntities.ofTypes("pulverisateur").get().length,
      gakki: doc.queryEntities.ofTypes("gakki").get().length,
      beatbox8: doc.queryEntities.ofTypes("beatbox8").get().length
    },
    channels: doc.queryEntities.ofTypes("mixerChannel").get().length,
    groups: doc.queryEntities.ofTypes("mixerGroup").get().length,
    groupLinks: doc.queryEntities.ofTypes("mixerStripGrouping").get().length,
    sends: doc.queryEntities.ofTypes("mixerAuxRoute").get().length,
    cables: doc.queryEntities.ofTypes("desktopAudioCable").get().length,
    parallelSplits: doc.queryEntities.ofTypes("audioSplitter").get().length,
    parallelMerges: doc.queryEntities.ofTypes("audioMerger").get().length,
    effects: doc.queryEntities.ofTypes("stompboxDelay", "stompboxReverb", "stompboxCompressor", "stompboxParametricEqualizer", "autoFilter", "stompboxTube", "stompboxChorus", "stompboxPitchDelay").get().length,
    noteRegions: doc.queryEntities.ofTypes("noteRegion").get().length,
    patternRegions: doc.queryEntities.ofTypes("patternRegion").get().length,
    automationTracks: doc.queryEntities.ofTypes("automationTrack").get().length,
    notes, patterns, automation, semanticEntities
  };
}

export function requiresUnresolvedSourceMapping(document: NativeDocument): boolean { return document.parts.some((part: NativePart) => part.sourceRegions.length > 0); }
export function structuralNoteCount(document: NativeDocument): number { return document.parts.reduce((sum, part) => sum + materializedNotes(document, part.id).length, 0); }
