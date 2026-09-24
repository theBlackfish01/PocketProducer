import { z } from "zod";
import { canonicalHash } from "../domain/composition.js";
import { nativeDocumentSchema, nativeOperationSchema, type NativeDocument, type NativeOperation } from "./model.js";

const formId = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const formNote = z.object({ beat: z.number().min(0).max(512), durationBeats: z.number().positive().max(32), pitch: z.number().int().min(0).max(127), velocity: z.number().min(0.01).max(1) });
const formMotif = z.object({ id: formId, name: z.string().min(1).max(80), lengthBeats: z.number().positive().max(64), notes: z.array(formNote).min(1).max(64) });
const formPlacement = z.object({ id: formId, motifId: formId, startBar: z.number().int().min(0).max(127), repeats: z.number().int().min(1).max(64), transpose: z.number().int().min(-36).max(36).default(0) });
const formSection = z.object({ id: formId, name: z.string().min(1).max(80), bars: z.number().int().min(1).max(64), intent: z.string().max(240).default("") });
const formPlayback = { playbackRate: z.number().min(0.5).max(2).optional(), stretchMode: z.enum(["resample", "preservePitch"]).optional(), pitchShiftSemitones: z.number().min(-24).max(24).optional() };
const formSource = z.object({ id: formId, assetId: z.uuid(), startBar: z.number().int().min(0).max(127), durationBars: z.number().positive().max(32), sourceStartSeconds: z.number().min(0), sourceDurationSeconds: z.number().positive(), playbackMode: z.enum(["once", "loop"]).default("once"), gain: z.number().min(0).max(1), ...formPlayback });
const formLibrarySample = z.object({ id: formId, sampleName: z.string().regex(/^samples\/[a-zA-Z0-9-]{1,120}$/), displayName: z.string().min(1).max(160), ownerName: z.string().max(160), durationSeconds: z.number().positive(), bpm: z.number().min(0).max(400), startBar: z.number().int().min(0).max(127), durationBars: z.number().positive().max(32), sourceStartSeconds: z.number().min(0), sourceDurationSeconds: z.number().positive(), playbackMode: z.enum(["once", "loop"]).default("once"), gain: z.number().min(0).max(1), ...formPlayback });
const nativePartShape = nativeDocumentSchema.shape.parts.element;
export const nativeFormSchema = z.object({
  title: z.string().min(1).max(120), tempoBpm: z.number().int().min(40).max(220),
  meter: nativeDocumentSchema.shape.meter, sections: z.array(formSection).min(1).max(12),
  groups: nativeDocumentSchema.shape.groups.unwrap().default([]), reverbBus: nativeDocumentSchema.shape.reverbBus.unwrap().optional(),
  parts: z.array(z.object({
    id: formId, name: z.string().min(1).max(80), role: nativePartShape.shape.role,
    device: nativePartShape.shape.device, gain: z.number().min(0).max(1), pan: z.number().min(-1).max(1),
    groupId: formId.optional(), sends: nativePartShape.shape.sends.unwrap().default([]),
    motifs: z.array(formMotif).max(8), placements: z.array(formPlacement).max(64),
    freeNotes: z.array(formNote).max(128).default([]), effects: nativePartShape.shape.effects.unwrap().default([]),
    automation: nativePartShape.shape.automation.unwrap().default([]), sources: z.array(formSource).max(24).default([]), librarySamples: z.array(formLibrarySample).max(24).default([])
  })).min(1).max(24)
});
export type NativeForm = z.infer<typeof nativeFormSchema>;
export interface OwnedNativeSource { assetId: string; assetHash: string; durationSeconds: number; rights: string }

export function nativeFormOperations(raw: NativeForm, ownedSources: OwnedNativeSource[]): NativeOperation[] {
  const form = nativeFormSchema.parse(raw);
  const beatsPerBar = form.meter.numerator * 4 / form.meter.denominator;
  const ticks = (beats: number) => {
    const value = beats * 960;
    if (!Number.isSafeInteger(value)) throw new Error("Native form beat positions must map exactly to 960 PPQ ticks");
    return value;
  };
  const sections: NativeDocument["sections"] = [];
  let cursor = 0;
  for (const item of form.sections) { sections.push({ id: item.id, name: item.name, startBar: cursor, endBar: cursor + item.bars, intent: item.intent }); cursor += item.bars; }
  if (cursor < 4 || cursor > 128) throw new Error("Native form must cover 4–128 bars");
  const sourceById = new Map(ownedSources.map((source) => [source.assetId, source]));
  const operations: NativeOperation[] = [
    { kind: "setTitle", title: form.title }, { kind: "setMeter", meter: form.meter },
    { kind: "setStructure", bars: cursor, sections, tempoBpm: form.tempoBpm }, { kind: "removePart", partId: "starting-voice" }
  ];
  for (const group of form.groups) operations.push({ kind: "upsertGroup", group });
  if (form.reverbBus) operations.push({ kind: "setReverbBus", bus: form.reverbBus });
  for (const item of form.parts) {
    const sourceRegions = item.sources.map((region) => {
      const source = sourceById.get(region.assetId);
      if (!source) throw new Error(`Source ${region.assetId} is not an owned source selected for this job`);
      if (region.sourceStartSeconds + region.sourceDurationSeconds > source.durationSeconds + 0.001) throw new Error(`Selected source interval exceeds owned source ${region.assetId}`);
      const durationTicks = ticks(region.durationBars * beatsPerBar);
      const selectedTicks = Math.round(region.sourceDurationSeconds / (region.playbackRate ?? 1) * form.tempoBpm / 60 * 960);
      if (region.playbackMode === "once" && durationTicks > selectedTicks) throw new Error("A one-shot source region cannot exceed the selected source interval; choose loop explicitly or shorten the timeline placement");
      return { id: region.id, assetId: source.assetId, assetHash: source.assetHash, startTick: ticks(region.startBar * beatsPerBar), durationTicks, sourceStartSeconds: region.sourceStartSeconds, sourceDurationSeconds: region.sourceDurationSeconds, playbackMode: region.playbackMode, gain: region.gain, rights: source.rights, ...(region.playbackRate !== undefined ? { playbackRate: region.playbackRate } : {}), ...(region.stretchMode ? { stretchMode: region.stretchMode } : {}), ...(region.pitchShiftSemitones !== undefined ? { pitchShiftSemitones: region.pitchShiftSemitones } : {}) };
    });
    const libraryRegions = item.librarySamples.map((region) => {
      if (region.sourceStartSeconds + region.sourceDurationSeconds > region.durationSeconds + 0.001) throw new Error(`Selected library interval exceeds ${region.sampleName}`);
      const durationTicks = ticks(region.durationBars * beatsPerBar);
      const selectedTicks = Math.round(region.sourceDurationSeconds / (region.playbackRate ?? 1) * form.tempoBpm / 60 * 960);
      if (region.playbackMode === "once" && durationTicks > selectedTicks) throw new Error(`Library one-shot ${region.id} exceeds the selected interval`);
      return { id: region.id, sampleName: region.sampleName, displayName: region.displayName, ownerName: region.ownerName, durationSeconds: region.durationSeconds, bpm: region.bpm, startTick: ticks(region.startBar * beatsPerBar), durationTicks, sourceStartSeconds: region.sourceStartSeconds, sourceDurationSeconds: region.sourceDurationSeconds, playbackMode: region.playbackMode, gain: region.gain, provenance: "audiotool-library" as const, ...(region.playbackRate !== undefined ? { playbackRate: region.playbackRate } : {}), ...(region.stretchMode ? { stretchMode: region.stretchMode } : {}), ...(region.pitchShiftSemitones !== undefined ? { pitchShiftSemitones: region.pitchShiftSemitones } : {}) };
    });
    operations.push({ kind: "addPart", part: {
      id: item.id, name: item.name, role: item.role, device: item.device, gain: item.gain, pan: item.pan, ...(item.groupId ? { groupId: item.groupId } : {}), sends: item.sends,
      notes: item.freeNotes.map((event, index) => ({ id: `free-${index}`, startTick: ticks(event.beat), durationTicks: ticks(event.durationBeats), pitch: event.pitch, velocity: event.velocity })),
      placements: item.placements.map((place) => ({ id: place.id, motifId: place.motifId, startTick: ticks(place.startBar * beatsPerBar), repeats: place.repeats, transpose: place.transpose })),
      sourceRegions, libraryRegions, effects: item.effects, automation: item.automation
    } });
    for (const motif of item.motifs) operations.push({ kind: "defineMotif", motif: { id: motif.id, partId: item.id, name: motif.name, lengthTicks: ticks(motif.lengthBeats), notes: motif.notes.map((event, index) => ({ id: `note-${index}`, startTick: ticks(event.beat), durationTicks: ticks(event.durationBeats), pitch: event.pitch, velocity: event.velocity })) } });
  }
  if (operations.length > 128) throw new Error("Native form exceeds the validated operation limit");
  return operations.map((operation) => nativeOperationSchema.parse(operation));
}

export function nativeFormFingerprint(form: NativeForm): string { return canonicalHash(form); }
