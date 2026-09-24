import { createOfflineDocument } from "@audiotool/nexus/node";
import { Ticks } from "@audiotool/nexus/utils";
import type { SyncedDocument } from "@audiotool/nexus";
import type { NexusEntity } from "@audiotool/nexus/document";
import { assertNativeDeviceMapping, materializedNotes, nativeDocumentSchema, type NativeDocument, type NativePart } from "./model.js";

export const NATIVE_MAPPING_VERSION = "nexus-native-v2";
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

export async function applyNativeSnapshot(doc: WritableDocument, raw: NativeDocument, sourceSamples: NativeSampleResources = {}): Promise<{ mappedParts: number; noteEntities: number; patternRegions: number; automationEvents: number; unresolvedSources: string[] }> {
  const document = nativeDocumentSchema.parse(raw);
  assertNativeDeviceMapping(document);
  const unresolvedSources: string[] = [];
  let noteEntities = 0;
  let patternRegions = 0;
  let automationEvents = 0;
  // This v1 adapter owns only documents it creates. It never deletes or rewrites
  // unknown entities in an existing Studio document.
  if (doc.queryEntities.ofTypes("note", "beatbox8", "heisenberg", "pulverisateur", "gakki", "audioRegion", "audioDevice").get().length) throw new Error("Native target is not empty; inspect/reconcile external edits before applying a snapshot");
  await doc.modify((t) => {
    const groove = t.create("groove", { functionIndex: 1, durationTicks: Ticks.Beat * 2, impact: 0, displayName: "Straight" });
    const config = t.entities.ofTypes("config").getOne() ?? t.create("config", { defaultGroove: groove.location });
    t.update(config.fields.tempoBpm, document.tempoBpm);
    t.update(config.fields.signatureNumerator, document.meter.numerator);
    t.update(config.fields.signatureDenominator, document.meter.denominator);
    const duration = toNexusTicks(document.bars * document.meter.numerator * 960 * 4 / document.meter.denominator);
    t.update(config.fields.durationTicks, duration);
    if (!t.entities.ofTypes("mixerMaster").getOne()) t.create("mixerMaster", {});
    for (const [index, part] of document.parts.entries()) {
      if (part.device.type === "audio") {
        for (const region of part.sourceRegions) {
          const resource = sourceSamples[region.assetId];
          if (!resource) { unresolvedSources.push(region.id); continue; }
          if (!/^samples\/[a-zA-Z0-9-]{1,120}$/.test(resource.sampleName) || !Number.isFinite(resource.durationSeconds) || resource.durationSeconds <= 0) throw new Error(`Invalid ready sample identity for ${region.assetId}`);
          const offsetTicks = Math.round(region.sourceStartSeconds * document.tempoBpm / 60 * Ticks.Beat);
          const selectedTicks = Math.round(region.sourceDurationSeconds * document.tempoBpm / 60 * Ticks.Beat);
          const timelineTicks = toNexusTicks(region.durationTicks);
          if (region.sourceStartSeconds + region.sourceDurationSeconds > resource.durationSeconds + 0.001) throw new Error(`Selected interval exceeds ready sample ${region.assetId}`);
          if ((region.playbackMode ?? "once") === "once" && timelineTicks > selectedTicks) throw new Error(`One-shot ${region.id} exceeds its selected source interval`);
          const inserted = t.insertSample({ name: resource.sampleName, durationSeconds: resource.durationSeconds }, {
            sample: { bpm: document.tempoBpm, offsetTicks },
            region: { positionTicks: toNexusTicks(region.startTick), durationTicks: timelineTicks },
            loop: { startTicks: offsetTicks, durationTicks: selectedTicks },
            displayName: `${part.name} · ${region.id}`
          });
          t.update(inserted.fields.gain, region.gain);
        }
        continue;
      }
      const channel = t.create("mixerChannel", { preGain: part.gain, faderParameters: { panning: part.pan } });
      const position = { displayName: part.name, positionX: 100 + (index % 4) * 240, positionY: 100 + Math.floor(index / 4) * 220 };
      const parameters = part.device.parameters;
      const instrument = part.device.type === "heisenberg" ? t.create("heisenberg", { ...position, gain: parameters.gain ?? part.gain, operatorA: { gain: parameters["operatorA.gain"] ?? 0.5 }, playModeIndex: 4,
        ...(parameters.unisonoCount !== undefined ? { unisonoCount: parameters.unisonoCount } : {}),
        ...(parameters["filter.cutoffFrequencyHz"] !== undefined ? { filter: { cutoffFrequencyHz: parameters["filter.cutoffFrequencyHz"] } } : {}),
        ...(parameters["envelopeMain.attackTimeNormalized"] !== undefined ? { envelopeMain: { attackTimeNormalized: parameters["envelopeMain.attackTimeNormalized"] } } : {}) })
        : part.device.type === "pulverisateur" ? t.create("pulverisateur", { ...position, gain: parameters.gain ?? part.gain,
          ...(parameters["filter.cutoffFrequencyHz"] !== undefined || parameters["filter.resonance"] !== undefined ? { filter: { ...(parameters["filter.cutoffFrequencyHz"] !== undefined ? { cutoffFrequencyHz: parameters["filter.cutoffFrequencyHz"] } : {}), ...(parameters["filter.resonance"] !== undefined ? { resonance: parameters["filter.resonance"] } : {}) } } : {}) })
        : part.device.type === "gakki" ? t.create("gakki", { ...position, gain: parameters.gain ?? part.gain })
        : t.create("beatbox8", { ...position, gain: parameters.gain ?? part.gain });
      let output = instrument.fields.audioOutput.location;
      let filterTarget: { location: typeof output } | null = null;
      for (const [effectIndex, effect] of part.effects.entries()) {
        const fxPosition = { displayName: `${part.name} ${effect.type}`, positionX: position.positionX + 120 + effectIndex * 100, positionY: position.positionY + 80 };
        const fx = effect.type === "stompboxDelay" ? t.create("stompboxDelay", { ...fxPosition, ...effect.parameters })
          : effect.type === "stompboxReverb" ? t.create("stompboxReverb", { ...fxPosition, ...effect.parameters })
          : effect.type === "stompboxCompressor" ? t.create("stompboxCompressor", { ...fxPosition, ...effect.parameters })
          : effect.type === "stompboxParametricEqualizer" ? t.create("stompboxParametricEqualizer", { ...fxPosition, ...effect.parameters })
          : t.create("autoFilter", { ...fxPosition, ...effect.parameters });
        t.create("desktopAudioCable", { fromSocket: output, toSocket: fx.fields.audioInput.location });
        output = fx.fields.audioOutput.location;
        if (effect.type === "autoFilter") filterTarget = (fx as NexusEntity<"autoFilter">).fields.cutoffFrequencyHz;
      }
      t.create("desktopAudioCable", { fromSocket: output, toSocket: channel.fields.audioInput.location });
      if (part.device.type === "beatbox8") {
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
        const target = curve.target === "gain" ? channel.fields.preGain : curve.target === "pan" ? channel.fields.faderParameters.fields.panning : filterTarget;
        if (!target) throw new Error(`Filter automation on ${part.id} requires an autoFilter effect`);
        const automationTrack = t.create("automationTrack", { automatedParameter: target.location, orderAmongTracks: document.parts.length + automationEvents });
        const collection = t.create("automationCollection", {});
        t.create("automationRegion", { track: automationTrack.location, collection: collection.location, region: { displayName: `${part.name} ${curve.target}`, positionTicks: 0, durationTicks: duration, loopDurationTicks: duration } });
        for (const point of curve.points) { t.create("automationEvent", { collection: collection.location, positionTicks: toNexusTicks(point.tick), value: point.value }); automationEvents += 1; }
      }
    }
  });
  const mappedParts = document.parts.filter((part) => part.device.type !== "audio" || part.sourceRegions.every((region) => !unresolvedSources.includes(region.id))).length;
  return { mappedParts, noteEntities, patternRegions, automationEvents, unresolvedSources };
}

export async function validateNativeOffline(document: NativeDocument, sourceSamples: NativeSampleResources = {}) {
  const offline = await createOfflineDocument({ validated: true });
  const mapped = await applyNativeSnapshot(offline, document, sourceSamples);
  return {
    mappingVersion: NATIVE_MAPPING_VERSION, nexusTicksPerBeat: Ticks.Beat,
    ...mapped,
    readback: {
      synths: offline.queryEntities.ofTypes("heisenberg", "pulverisateur", "gakki").get().length,
      drumMachines: offline.queryEntities.ofTypes("beatbox8").get().length,
      noteEntities: offline.queryEntities.ofTypes("note").get().length,
      patternRegions: offline.queryEntities.ofTypes("patternRegion").get().length,
      effectDevices: offline.queryEntities.ofTypes("stompboxDelay", "stompboxReverb", "stompboxCompressor", "stompboxParametricEqualizer", "autoFilter").get().length,
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
  // Entity IDs are allocated by Nexus and differ between equivalent documents.
  // Map every supported entity to a stable, type-local ordinal before reading
  // pointers. Keep actual socket field indexes: they distinguish routing ends
  // and automation targets. UI positions, labels and colors are not music.
  const semanticTypes = ["config", "groove", "mixerMaster", "mixerChannel", "desktopAudioCable", "heisenberg", "pulverisateur", "gakki", "beatbox8", "beatbox8Pattern", "noteTrack", "noteCollection", "noteRegion", "note", "patternTrack", "patternRegion", "stompboxDelay", "stompboxReverb", "stompboxCompressor", "stompboxParametricEqualizer", "autoFilter", "automationTrack", "automationRegion", "automationCollection", "automationEvent", "audioDevice", "audioTrack", "audioRegion", "sample"] as const;
  const entities = doc.queryEntities.ofTypes(...semanticTypes).get();
  const ordinals = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const entity of entities) {
    const type = entity.location.entityType ?? "unknown";
    const ordinal = counts.get(type) ?? 0;
    counts.set(type, ordinal + 1);
    ordinals.set(entity.location.entityId, `${type}:${ordinal}`);
  }
  const ignored = new Set(["positionX", "positionY", "colorIndex", "displayName", "orderAmongStrips"]);
  const normalize = (value: unknown): unknown => {
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "number") return Math.round(value * 1_000_000) / 1_000_000;
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(normalize);
    const record = value as Record<string, unknown>;
    if (typeof record.entityId === "string" && Array.isArray(record.fieldIndex)) {
      return { ref: record.entityId ? ordinals.get(record.entityId) ?? `${String(record.entityType)}:outside-mapping` : null, socket: record.fieldIndex };
    }
    if ("value" in record && "location" in record) return normalize(record.value);
    if (Array.isArray(record.array)) return record.array.map(normalize);
    if (record.fields && typeof record.fields === "object") return normalize(record.fields);
    return Object.fromEntries(Object.entries(record).filter(([key]) => !ignored.has(key)).map(([key, child]) => [key, normalize(child)]));
  };
  const semanticEntities = entities.map((entity) => ({ type: entity.location.entityType, fields: normalize(entity.fields) }));
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
    cables: doc.queryEntities.ofTypes("desktopAudioCable").get().length,
    effects: doc.queryEntities.ofTypes("stompboxDelay", "stompboxReverb", "stompboxCompressor", "stompboxParametricEqualizer", "autoFilter").get().length,
    noteRegions: doc.queryEntities.ofTypes("noteRegion").get().length,
    patternRegions: doc.queryEntities.ofTypes("patternRegion").get().length,
    automationTracks: doc.queryEntities.ofTypes("automationTrack").get().length,
    notes, patterns, automation, semanticEntities
  };
}

export function requiresUnresolvedSourceMapping(document: NativeDocument): boolean { return document.parts.some((part: NativePart) => part.sourceRegions.length > 0); }
export function structuralNoteCount(document: NativeDocument): number { return document.parts.reduce((sum, part) => sum + materializedNotes(document, part.id).length, 0); }
