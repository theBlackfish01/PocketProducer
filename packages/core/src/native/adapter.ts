import { createOfflineDocument } from "@audiotool/nexus/node";
import { Ticks } from "@audiotool/nexus/utils";
import type { SyncedDocument } from "@audiotool/nexus";
import type { NexusEntity } from "@audiotool/nexus/document";
import { materializedNotes, nativeDocumentSchema, type NativeDocument, type NativePart } from "./model.js";

export const NATIVE_MAPPING_VERSION = "nexus-native-v1";
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
  open(project: string): Promise<NativeRemoteDocument>;
}
const drumField = (pitch: number) => pitch === 36 ? "bassdrumIsActive" : pitch === 38 ? "snaredrumIsActive" : pitch === 42 ? "closedHihatIsActive" : pitch === 46 ? "openHihatIsActive" : null;

export async function applyNativeSnapshot(doc: WritableDocument, raw: NativeDocument): Promise<{ mappedParts: number; noteEntities: number; patternRegions: number; automationEvents: number; unresolvedSources: string[] }> {
  const document = nativeDocumentSchema.parse(raw);
  const unresolvedSources: string[] = [];
  let noteEntities = 0;
  let patternRegions = 0;
  let automationEvents = 0;
  // This v1 adapter owns only documents it creates. It never deletes or rewrites
  // unknown entities in an existing Studio document.
  if (doc.queryEntities.ofTypes("note", "beatbox8", "heisenberg", "pulverisateur", "gakki", "audioRegion").get().length) throw new Error("Native target is not empty; inspect/reconcile external edits before applying a snapshot");
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
      const channel = t.create("mixerChannel", { preGain: part.gain, faderParameters: { panning: part.pan } });
      if (part.device.type === "audio") {
        for (const region of part.sourceRegions) unresolvedSources.push(region.id);
        continue;
      }
      const position = { displayName: part.name, positionX: 100 + (index % 4) * 240, positionY: 100 + Math.floor(index / 4) * 220 };
      const instrument = part.device.type === "heisenberg" ? t.create("heisenberg", { ...position, gain: part.gain, operatorA: { gain: 0.5 }, playModeIndex: 4 })
        : part.device.type === "pulverisateur" ? t.create("pulverisateur", { ...position, gain: part.gain })
        : part.device.type === "gakki" ? t.create("gakki", { ...position, gain: part.gain })
        : t.create("beatbox8", { ...position, gain: part.gain });
      let output = instrument.fields.audioOutput.location;
      let filterTarget: { location: typeof output } | null = null;
      for (const [effectIndex, effect] of part.effects.entries()) {
        const fxPosition = { displayName: `${part.name} ${effect.type}`, positionX: position.positionX + 120 + effectIndex * 100, positionY: position.positionY + 80 };
        const fx = effect.type === "stompboxDelay" ? t.create("stompboxDelay", { ...fxPosition })
          : effect.type === "stompboxReverb" ? t.create("stompboxReverb", { ...fxPosition })
          : effect.type === "stompboxCompressor" ? t.create("stompboxCompressor", { ...fxPosition })
          : effect.type === "stompboxParametricEqualizer" ? t.create("stompboxParametricEqualizer", { ...fxPosition })
          : t.create("autoFilter", { ...fxPosition });
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
  const mappedParts = document.parts.filter((part) => part.device.type !== "audio").length;
  return { mappedParts, noteEntities, patternRegions, automationEvents, unresolvedSources };
}

export async function validateNativeOffline(document: NativeDocument) {
  const offline = await createOfflineDocument({ validated: true });
  const mapped = await applyNativeSnapshot(offline, document);
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
    notes, patterns, automation
  };
}

export function requiresUnresolvedSourceMapping(document: NativeDocument): boolean { return document.parts.some((part: NativePart) => part.sourceRegions.length > 0); }
export function structuralNoteCount(document: NativeDocument): number { return document.parts.reduce((sum, part) => sum + materializedNotes(document, part.id).length, 0); }
