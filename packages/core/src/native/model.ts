import { z } from "zod";
import { canonicalHash } from "../domain/composition.js";

export const NATIVE_PPQ = 960;
const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const unmappedParameters = z.record(z.string(), z.number()).refine((value) => Object.keys(value).length === 0, "Only mapped native parameters are accepted; use mix and automation controls for supported values");
const note = z.object({ id, startTick: z.number().int().min(0), durationTicks: z.number().int().min(1), pitch: z.number().int().min(0).max(127), velocity: z.number().min(0.01).max(1) });
const point = z.object({ tick: z.number().int().min(0), value: z.number().min(0).max(1) });
const part = z.object({
  id, name: z.string().min(1).max(80), role: z.enum(["percussion", "bass", "melody", "harmony", "texture", "lead", "fx", "source"]),
  device: z.object({ type: z.enum(["heisenberg", "pulverisateur", "gakki", "beatbox8", "audio"]), parameters: unmappedParameters.default({}) }),
  gain: z.number().min(0).max(1).default(0.7), pan: z.number().min(-1).max(1).default(0),
  notes: z.array(note).max(4096).default([]),
  placements: z.array(z.object({ id, motifId: id, startTick: z.number().int().min(0), repeats: z.number().int().min(1).max(64), transpose: z.number().int().min(-36).max(36) })).max(512).default([]),
  sourceRegions: z.array(z.object({ id, assetId: z.uuid(), assetHash: z.string().regex(/^[a-f0-9]{64}$/), sampleId: z.string().min(1).max(160).optional(), startTick: z.number().int().min(0), durationTicks: z.number().int().positive(), sourceStartSeconds: z.number().min(0), sourceDurationSeconds: z.number().positive(), gain: z.number().min(0).max(1), rights: z.string().min(1).max(300) })).max(128).default([]),
  effects: z.array(z.object({ id, type: z.enum(["stompboxDelay", "stompboxReverb", "stompboxCompressor", "stompboxParametricEqualizer", "autoFilter"]), parameters: unmappedParameters.default({}) })).max(8).default([]),
  automation: z.array(z.object({ id, target: z.enum(["gain", "pan", "filter"]), points: z.array(point).min(2).max(128) })).max(16).default([])
});
const motif = z.object({ id, partId: id, name: z.string().min(1).max(80), lengthTicks: z.number().int().positive(), notes: z.array(note).min(1).max(256) });
const section = z.object({ id, name: z.string().min(1).max(80), startBar: z.number().int().min(0), endBar: z.number().int().positive(), intent: z.string().max(240).default("") });

export const nativeDocumentSchema = z.object({
  schemaVersion: z.literal(2), ppq: z.literal(NATIVE_PPQ), title: z.string().min(1).max(120), direction: z.string().min(1).max(2000), currentObjective: z.string().min(1).max(2000),
  assumptions: z.array(z.string().max(240)).max(16), tempoBpm: z.number().int().min(40).max(220),
  meter: z.object({ numerator: z.number().int().min(2).max(12), denominator: z.union([z.literal(4), z.literal(8)]) }),
  bars: z.number().int().min(4).max(128), sections: z.array(section).min(1).max(24), parts: z.array(part).min(1).max(24),
  motifs: z.array(motif).max(256), protectedPartIds: z.array(id).max(24), protectedMotifIds: z.array(id).max(256),
  sourceAssetIds: z.array(z.uuid()).max(24), audio: z.object({ state: z.enum(["deferred", "unavailable", "stale"]), revisionId: z.null(), assetHash: z.null() })
}).superRefine((document, context) => {
  const unique = (values: string[], path: string) => { if (new Set(values).size !== values.length) context.addIssue({ code: "custom", path: [path], message: `Duplicate ${path} identity` }); };
  unique(document.sections.map((value) => value.id), "sections"); unique(document.parts.map((value) => value.id), "parts"); unique(document.motifs.map((value) => value.id), "motifs");
  let cursor = 0;
  for (const item of document.sections) { if (item.startBar !== cursor || item.endBar <= item.startBar) context.addIssue({ code: "custom", path: ["sections"], message: "Sections must be ordered and contiguous" }); cursor = item.endBar; }
  if (cursor !== document.bars) context.addIssue({ code: "custom", path: ["sections"], message: "Sections must cover the arrangement" });
  const totalTicks = document.bars * document.meter.numerator * NATIVE_PPQ * 4 / document.meter.denominator;
  const parts = new Set(document.parts.map((value) => value.id));
  const motifs = new Map(document.motifs.map((value) => [value.id, value]));
  for (const item of document.motifs) {
    if (!parts.has(item.partId)) context.addIssue({ code: "custom", path: ["motifs"], message: `Motif ${item.id} has no part` });
    if (item.notes.some((value) => value.startTick + value.durationTicks > item.lengthTicks)) context.addIssue({ code: "custom", path: ["motifs"], message: `Motif ${item.id} has notes outside its phrase` });
    unique(item.notes.map((value) => value.id), "motif notes");
  }
  for (const item of document.parts) {
    unique(item.notes.map((value) => value.id), "part notes"); unique(item.placements.map((value) => value.id), "placements");
    if (item.notes.some((value) => value.startTick + value.durationTicks > totalTicks)) context.addIssue({ code: "custom", path: ["parts"], message: `Part ${item.id} has notes outside the arrangement` });
    for (const placement of item.placements) {
      const phrase = motifs.get(placement.motifId);
      if (!phrase || phrase.partId !== item.id || placement.startTick + placement.repeats * phrase.lengthTicks > totalTicks) context.addIssue({ code: "custom", path: ["parts"], message: `Invalid motif placement ${placement.id}` });
      if (phrase?.notes.some((value) => value.pitch + placement.transpose < 0 || value.pitch + placement.transpose > 127)) context.addIssue({ code: "custom", path: ["parts"], message: `Pitch outside MIDI range in ${placement.id}` });
    }
    for (const region of item.sourceRegions) {
      if (!document.sourceAssetIds.includes(region.assetId) || region.startTick + region.durationTicks > totalTicks) context.addIssue({ code: "custom", path: ["parts"], message: `Invalid source region ${region.id}` });
    }
    for (const curve of item.automation) {
      if (curve.points.some((value) => value.tick > totalTicks) || curve.points.some((value, index) => index > 0 && value.tick <= curve.points[index - 1]!.tick)) context.addIssue({ code: "custom", path: ["parts"], message: `Invalid automation ${curve.id}` });
    }
  }
  if (document.protectedPartIds.some((value) => !parts.has(value)) || document.protectedMotifIds.some((value) => !motifs.has(value))) context.addIssue({ code: "custom", path: ["protectedPartIds"], message: "A protection references missing material" });
});

export type NativeDocument = z.infer<typeof nativeDocumentSchema>;
export type NativePart = NativeDocument["parts"][number];
export type NativeNote = NativePart["notes"][number];
export const nativeOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("setObjective"), objective: z.string().min(1).max(2000) }),
  z.object({ kind: z.literal("setStructure"), bars: z.number().int().min(4).max(128), sections: z.array(section).min(1).max(24), tempoBpm: z.number().int().min(40).max(220).optional() }),
  z.object({ kind: z.literal("addPart"), part }),
  z.object({ kind: z.literal("defineMotif"), motif }),
  z.object({ kind: z.literal("replaceMotif"), motif }),
  z.object({ kind: z.literal("placeMotif"), partId: id, placement: part.shape.placements.unwrap().element }),
  z.object({ kind: z.literal("replacePlacements"), partId: id, placements: part.shape.placements.unwrap() }),
  z.object({ kind: z.literal("addNotes"), partId: id, notes: z.array(note).min(1).max(256) }),
  z.object({ kind: z.literal("replaceNotes"), partId: id, notes: z.array(note).max(4096) }),
  z.object({ kind: z.literal("setDevice"), partId: id, device: part.shape.device }),
  z.object({ kind: z.literal("setMix"), partId: id, gain: z.number().min(0).max(1).optional(), pan: z.number().min(-1).max(1).optional() }),
  z.object({ kind: z.literal("addEffect"), partId: id, effect: part.shape.effects.unwrap().element }),
  z.object({ kind: z.literal("addAutomation"), partId: id, automation: part.shape.automation.unwrap().element }),
  z.object({ kind: z.literal("placeSource"), partId: id, region: part.shape.sourceRegions.unwrap().element }),
  z.object({ kind: z.literal("protect"), partIds: z.array(id).max(24), motifIds: z.array(id).max(256) }),
  z.object({ kind: z.literal("removePart"), partId: id })
]);
export type NativeOperation = z.infer<typeof nativeOperationSchema>;

export function barTicks(document: Pick<NativeDocument, "meter">): number { return document.meter.numerator * NATIVE_PPQ * 4 / document.meter.denominator; }
export function materializedNotes(document: NativeDocument, partId: string): NativeNote[] {
  const item = document.parts.find((value) => value.id === partId);
  if (!item) throw new Error(`Unknown part ${partId}`);
  const phrases = new Map(document.motifs.map((value) => [value.id, value]));
  const result = [...item.notes];
  for (const placement of item.placements) {
    const phrase = phrases.get(placement.motifId)!;
    for (let repeat = 0; repeat < placement.repeats; repeat++) for (const value of phrase.notes) result.push({ ...value, id: `${placement.id}-${repeat}-${value.id}`, startTick: placement.startTick + repeat * phrase.lengthTicks + value.startTick, pitch: value.pitch + placement.transpose });
  }
  return result.sort((a, b) => a.startTick - b.startTick || a.id.localeCompare(b.id));
}

export function protectedPartHash(document: NativeDocument, partId: string): string {
  const item = document.parts.find((value) => value.id === partId);
  if (!item) throw new Error(`Unknown part ${partId}`);
  return canonicalHash({ tempoBpm: document.tempoBpm, meter: document.meter, part: item, motifs: document.motifs.filter((value) => value.partId === partId) });
}

export function nativeMusicHash(document: NativeDocument): string {
  return canonicalHash({ tempoBpm: document.tempoBpm, meter: document.meter, bars: document.bars, sections: document.sections, parts: document.parts, motifs: document.motifs });
}

export function applyNativeOperations(base: NativeDocument, operations: NativeOperation[], requestedProtections: string[] = []): NativeDocument {
  if (operations.length > 128) throw new Error("Native batch exceeds 128 operations");
  const next = structuredClone(nativeDocumentSchema.parse(base));
  const locked = new Set([...base.protectedPartIds, ...requestedProtections]);
  const before = new Map([...locked].map((partId) => [partId, protectedPartHash(base, partId)]));
  for (const raw of operations) {
    const op = nativeOperationSchema.parse(raw);
    const findPart = (partId: string) => { const item = next.parts.find((value) => value.id === partId); if (!item) throw new Error(`Unknown part ${partId}`); return item; };
    switch (op.kind) {
      case "setObjective": next.currentObjective = op.objective; break;
      case "setStructure": next.bars = op.bars; next.sections = op.sections; if (op.tempoBpm !== undefined) next.tempoBpm = op.tempoBpm; break;
      case "addPart": next.parts.push(op.part); break;
      case "defineMotif": next.motifs.push(op.motif); break;
      case "replaceMotif": { const index = next.motifs.findIndex((value) => value.id === op.motif.id); if (index < 0) throw new Error(`Unknown motif ${op.motif.id}`); next.motifs[index] = op.motif; break; }
      case "placeMotif": findPart(op.partId).placements.push(op.placement); break;
      case "replacePlacements": findPart(op.partId).placements = op.placements; break;
      case "addNotes": findPart(op.partId).notes.push(...op.notes); break;
      case "replaceNotes": findPart(op.partId).notes = op.notes; break;
      case "setDevice": findPart(op.partId).device = op.device; break;
      case "setMix": { const item = findPart(op.partId); if (op.gain !== undefined) item.gain = op.gain; if (op.pan !== undefined) item.pan = op.pan; break; }
      case "addEffect": findPart(op.partId).effects.push(op.effect); break;
      case "addAutomation": findPart(op.partId).automation.push(op.automation); break;
      case "placeSource": findPart(op.partId).sourceRegions.push(op.region); if (!next.sourceAssetIds.includes(op.region.assetId)) next.sourceAssetIds.push(op.region.assetId); break;
      case "protect": next.protectedPartIds = [...new Set([...next.protectedPartIds, ...op.partIds])]; next.protectedMotifIds = [...new Set([...next.protectedMotifIds, ...op.motifIds])]; break;
      case "removePart": next.parts = next.parts.filter((value) => value.id !== op.partId); next.motifs = next.motifs.filter((value) => value.partId !== op.partId); break;
    }
  }
  const validated = nativeDocumentSchema.parse(next);
  for (const [partId, hash] of before) if (protectedPartHash(validated, partId) !== hash) throw new Error(`Protected part ${partId} or its dependencies changed`);
  for (const motifId of base.protectedMotifIds) if (canonicalHash(base.motifs.find((value) => value.id === motifId)) !== canonicalHash(validated.motifs.find((value) => value.id === motifId))) throw new Error(`Protected motif ${motifId} changed`);
  return validated;
}

export function nativeDiff(before: NativeDocument | null, after: NativeDocument) {
  const prior = new Map((before?.parts ?? []).map((value) => [value.id, value]));
  const current = new Map(after.parts.map((value) => [value.id, value]));
  const partFingerprint = (document: NativeDocument, partId: string) => canonicalHash({ part: document.parts.find((value) => value.id === partId), motifs: document.motifs.filter((value) => value.partId === partId) });
  return {
    addedParts: after.parts.filter((value) => !prior.has(value.id)).map((value) => value.id),
    removedParts: (before?.parts ?? []).filter((value) => !current.has(value.id)).map((value) => value.id),
    changedParts: after.parts.filter((value) => prior.has(value.id) && before && partFingerprint(after, value.id) !== partFingerprint(before, value.id)).map((value) => value.id),
    addedSections: after.sections.filter((value) => !before?.sections.some((old) => old.id === value.id)).map((value) => value.id),
    noteCount: after.parts.reduce((sum, value) => sum + materializedNotes(after, value.id).length, 0),
    protectedPartIds: after.protectedPartIds
  };
}

export function pinnedContext(document: NativeDocument, revisionId: string | null, remote: { state: string; projectId: string | null; observedHash: string | null } = { state: "local", projectId: null, observedHash: null }) {
  return {
    revisionId, documentHash: canonicalHash(document), direction: document.direction, currentObjective: document.currentObjective, assumptions: document.assumptions,
    tempoBpm: document.tempoBpm, meter: document.meter, bars: document.bars,
    sections: document.sections.map((value) => ({ id: value.id, name: value.name, bars: [value.startBar, value.endBar], intent: value.intent })),
    parts: document.parts.map((value) => ({ id: value.id, name: value.name, role: value.role, device: value.device.type, notes: materializedNotes(document, value.id).length, effects: value.effects.map((effect) => effect.type), automation: value.automation.map((curve) => curve.target), sourceRegions: value.sourceRegions.length, protected: document.protectedPartIds.includes(value.id) })),
    motifs: document.motifs.map((value) => ({ id: value.id, partId: value.partId, name: value.name, instances: document.parts.flatMap((item) => item.placements).filter((placement) => placement.motifId === value.id).length })),
    sources: document.parts.flatMap((value) => value.sourceRegions.map((region) => ({ assetId: region.assetId, assetHash: region.assetHash, selectedInterval: [region.sourceStartSeconds, region.sourceStartSeconds + region.sourceDurationSeconds], state: "placed/referenced" as const }))),
    audio: document.audio.state, remote
  };
}
