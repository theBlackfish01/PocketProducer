import { z } from "zod";
import { canonicalHash } from "../domain/composition.js";

export const NATIVE_PPQ = 960;
const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
// Curated against the pinned Nexus 0.0.17 schema. Values are SDK field values,
// not inferred physical units (for example, compressor.ratio is normalized).
export const nativeParameterRanges = {
  heisenberg: { gain: [0, 1], unisonoCount: [1, 4], "operatorA.gain": [0, 1], "filter.cutoffFrequencyHz": [33, 22050], "envelopeMain.attackTimeNormalized": [0, 1] },
  pulverisateur: { gain: [0, 1], "filter.cutoffFrequencyHz": [18, 15500], "filter.resonance": [0, 1] },
  gakki: { gain: [0, 1] },
  beatbox8: { gain: [0, 1] },
  audio: {},
  stompboxDelay: { feedbackFactor: [0, 1], mix: [0, 1], stepCount: [1, 7], stepLengthIndex: [1, 3] },
  stompboxReverb: { roomSizeFactor: [0, 1], preDelayTimeMs: [8, 500], feedbackFactor: [0, 1], mix: [0, 1] },
  stompboxCompressor: { thresholdDb: [-24, 0], ratio: [0, 1], attackMs: [0, 200], releaseMs: [0, 1000], makeupGainDb: [0, 24] },
  stompboxParametricEqualizer: { frequencyHz: [31, 12000], postGainDb: [-12, 12], bandwidthFactor: [0, 1] },
  autoFilter: { cutoffFrequencyHz: [18, 10000], mix: [0, 1], filterModulationDepth: [0, 1] }
} as const;
type ParameterDevice = keyof typeof nativeParameterRanges;
function mappedParameters(type: ParameterDevice, values: Record<string, number>, context: z.RefinementCtx): void {
  const ranges = nativeParameterRanges[type] as Record<string, readonly [number, number]>;
  for (const [key, value] of Object.entries(values)) {
    const range = ranges[key];
    if (!range || !Number.isFinite(value) || value < range[0] || value > range[1] || (["unisonoCount", "stepCount", "stepLengthIndex"].includes(key) && !Number.isInteger(value)))
      context.addIssue({ code: "custom", path: ["parameters", key], message: `Only mapped native parameters and their SDK ranges are accepted: ${type}.${key}` });
  }
}
const parameters = z.record(z.string(), z.number()).default({});
const note = z.object({ id, startTick: z.number().int().min(0), durationTicks: z.number().int().min(1), pitch: z.number().int().min(0).max(127), velocity: z.number().min(0.01).max(1) });
const point = z.object({ tick: z.number().int().min(0), value: z.number().min(0).max(1) });
const part = z.object({
  id, name: z.string().min(1).max(80), role: z.enum(["percussion", "bass", "melody", "harmony", "texture", "lead", "fx", "source"]),
  device: z.object({ type: z.enum(["heisenberg", "pulverisateur", "gakki", "beatbox8", "audio"]), parameters }).superRefine((value, context) => mappedParameters(value.type, value.parameters, context)),
  gain: z.number().min(0).max(1).default(0.7), pan: z.number().min(-1).max(1).default(0),
  notes: z.array(note).max(4096).default([]),
  placements: z.array(z.object({ id, motifId: id, startTick: z.number().int().min(0), repeats: z.number().int().min(1).max(64), transpose: z.number().int().min(-36).max(36) })).max(512).default([]),
  sourceRegions: z.array(z.object({ id, assetId: z.uuid(), assetHash: z.string().regex(/^[a-f0-9]{64}$/), sampleId: z.string().min(1).max(160).optional(), startTick: z.number().int().min(0), durationTicks: z.number().int().positive(), sourceStartSeconds: z.number().min(0), sourceDurationSeconds: z.number().positive(), playbackMode: z.enum(["once", "loop"]).optional(), gain: z.number().min(0).max(1), rights: z.string().min(1).max(300) })).max(128).default([]),
  effects: z.array(z.object({ id, type: z.enum(["stompboxDelay", "stompboxReverb", "stompboxCompressor", "stompboxParametricEqualizer", "autoFilter"]), parameters }).superRefine((value, context) => mappedParameters(value.type, value.parameters, context))).max(8).default([]),
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
export function assertNativeDeviceMapping(document: NativeDocument): void {
  // Keep schema-v2 historical readers permissive. New writes and synchronization
  // must meet the stricter, actually mapped Beatbox8 on/off contract.
  for (const item of document.parts) {
    if (item.device.type !== "beatbox8") continue;
    if (item.notes.length) throw new Error(`Beatbox8 ${item.id} uses on/off pattern slots, not direct MIDI notes`);
    const phrases = document.motifs.filter((value) => value.partId === item.id);
    if (phrases.length > 5) throw new Error(`Beatbox8 ${item.id} has more than five pattern slots`);
    if (item.placements.some((value) => value.transpose !== 0)) throw new Error(`Beatbox8 ${item.id} cannot transpose fixed drum lanes`);
    for (const phrase of phrases) {
      if (phrase.lengthTicks % 240 !== 0 || phrase.lengthTicks / 240 > 64) throw new Error(`Beatbox8 ${phrase.id} needs 1–64 sixteenth-note steps`);
      const occupied = new Set<string>();
      for (const event of phrase.notes) {
        if (![36, 38, 42, 46].includes(event.pitch) || event.startTick % 240 !== 0 || event.durationTicks !== 240 || event.velocity !== 1) throw new Error(`Beatbox8 ${phrase.id} maps only on/off MIDI 36/38/42/46 sixteenth-grid steps; velocity and duration expression are unsupported`);
        const cell = `${event.startTick}:${event.pitch}`;
        if (occupied.has(cell)) throw new Error(`Duplicate Beatbox8 lane step ${cell}`);
        occupied.add(cell);
      }
    }
  }
}
export const nativeOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("setTitle"), title: z.string().min(1).max(120) }),
  z.object({ kind: z.literal("setObjective"), objective: z.string().min(1).max(2000) }),
  z.object({ kind: z.literal("setStructure"), bars: z.number().int().min(4).max(128), sections: z.array(section).min(1).max(24), tempoBpm: z.number().int().min(40).max(220).optional() }),
  z.object({ kind: z.literal("setMeter"), meter: z.object({ numerator: z.number().int().min(2).max(12), denominator: z.union([z.literal(4), z.literal(8)]) }) }),
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
  z.object({ kind: z.literal("replaceEffect"), partId: id, effect: part.shape.effects.unwrap().element }),
  z.object({ kind: z.literal("removeEffect"), partId: id, effectId: id }),
  z.object({ kind: z.literal("addAutomation"), partId: id, automation: part.shape.automation.unwrap().element }),
  z.object({ kind: z.literal("replaceAutomation"), partId: id, automation: part.shape.automation.unwrap().element }),
  z.object({ kind: z.literal("removeAutomation"), partId: id, automationId: id }),
  z.object({ kind: z.literal("placeSource"), partId: id, region: part.shape.sourceRegions.unwrap().element }),
  z.object({ kind: z.literal("replaceSource"), partId: id, region: part.shape.sourceRegions.unwrap().element }),
  z.object({ kind: z.literal("removeSource"), partId: id, regionId: id }),
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

export function setNativeProtections(base: NativeDocument, expectedPartIds: string[], desiredPartIds: string[]): NativeDocument {
  const current = [...base.protectedPartIds].sort();
  if (canonicalHash(current) !== canonicalHash([...expectedPartIds].sort())) throw new Error("Protection state changed; refresh before unlocking or protecting parts");
  const next = structuredClone(base);
  next.protectedPartIds = [...new Set(desiredPartIds)];
  return nativeDocumentSchema.parse(next);
}

export function nativeMusicHash(document: NativeDocument): string {
  return canonicalHash({
    tempoBpm: document.tempoBpm, meter: document.meter, bars: document.bars,
    sections: document.sections.map(({ startBar, endBar }) => ({ startBar, endBar })),
    parts: document.parts.map(({ id, device, gain, pan, notes, placements, sourceRegions, effects, automation }) => ({ id, device, gain, pan, notes, placements, sourceRegions, effects, automation })),
    motifs: document.motifs.map(({ id, partId, lengthTicks, notes }) => ({ id, partId, lengthTicks, notes }))
  });
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
      case "setTitle": next.title = op.title; break;
      case "setObjective": next.currentObjective = op.objective; break;
      case "setStructure": next.bars = op.bars; next.sections = op.sections; if (op.tempoBpm !== undefined) next.tempoBpm = op.tempoBpm; break;
      case "setMeter": next.meter = op.meter; break;
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
      case "replaceEffect": { const effects = findPart(op.partId).effects; const index = effects.findIndex((value) => value.id === op.effect.id); if (index < 0) throw new Error(`Unknown effect ${op.effect.id}`); effects[index] = op.effect; break; }
      case "removeEffect": { const item = findPart(op.partId); if (!item.effects.some((value) => value.id === op.effectId)) throw new Error(`Unknown effect ${op.effectId}`); item.effects = item.effects.filter((value) => value.id !== op.effectId); break; }
      case "addAutomation": findPart(op.partId).automation.push(op.automation); break;
      case "replaceAutomation": { const curves = findPart(op.partId).automation; const index = curves.findIndex((value) => value.id === op.automation.id); if (index < 0) throw new Error(`Unknown automation ${op.automation.id}`); curves[index] = op.automation; break; }
      case "removeAutomation": { const item = findPart(op.partId); if (!item.automation.some((value) => value.id === op.automationId)) throw new Error(`Unknown automation ${op.automationId}`); item.automation = item.automation.filter((value) => value.id !== op.automationId); break; }
      case "placeSource": findPart(op.partId).sourceRegions.push(op.region); if (!next.sourceAssetIds.includes(op.region.assetId)) next.sourceAssetIds.push(op.region.assetId); break;
      case "replaceSource": { const item = findPart(op.partId); const index = item.sourceRegions.findIndex((value) => value.id === op.region.id); if (index < 0) throw new Error(`Unknown source region ${op.region.id}`); item.sourceRegions[index] = op.region; if (!next.sourceAssetIds.includes(op.region.assetId)) next.sourceAssetIds.push(op.region.assetId); break; }
      case "removeSource": { const item = findPart(op.partId); if (!item.sourceRegions.some((value) => value.id === op.regionId)) throw new Error(`Unknown source region ${op.regionId}`); item.sourceRegions = item.sourceRegions.filter((value) => value.id !== op.regionId); break; }
      case "protect": next.protectedPartIds = [...new Set([...next.protectedPartIds, ...op.partIds])]; next.protectedMotifIds = [...new Set([...next.protectedMotifIds, ...op.motifIds])]; break;
      case "removePart": next.parts = next.parts.filter((value) => value.id !== op.partId); next.motifs = next.motifs.filter((value) => value.partId !== op.partId); break;
    }
  }
  next.sourceAssetIds = [...new Set(next.parts.flatMap((item) => item.sourceRegions.map((region) => region.assetId)))];
  const validated = nativeDocumentSchema.parse(next);
  assertNativeDeviceMapping(validated);
  for (const [partId, hash] of before) if (protectedPartHash(validated, partId) !== hash) throw new Error(`Protected part ${partId} or its dependencies changed`);
  for (const motifId of base.protectedMotifIds) if (canonicalHash(base.motifs.find((value) => value.id === motifId)) !== canonicalHash(validated.motifs.find((value) => value.id === motifId))) throw new Error(`Protected motif ${motifId} changed`);
  return validated;
}

export function nativeDiff(before: NativeDocument | null, after: NativeDocument) {
  const prior = new Map((before?.parts ?? []).map((value) => [value.id, value]));
  const current = new Map(after.parts.map((value) => [value.id, value]));
  const changed = (a: unknown, b: unknown) => canonicalHash(a) !== canonicalHash(b);
  const partChanges = after.parts.flatMap((value) => {
    const old = prior.get(value.id);
    if (!old) return [];
    const fields: string[] = (["name", "role", "device", "gain", "pan", "notes", "placements", "sourceRegions", "effects", "automation"] as const).filter((field) => changed(old[field], value[field]));
    if (changed(before?.motifs.filter((motif) => motif.partId === value.id), after.motifs.filter((motif) => motif.partId === value.id))) fields.push("motifs");
    return fields.length ? [{ partId: value.id, fields }] : [];
  });
  const oldSections = new Map((before?.sections ?? []).map((value) => [value.id, value]));
  const newSections = new Map(after.sections.map((value) => [value.id, value]));
  return {
    addedParts: after.parts.filter((value) => !prior.has(value.id)).map((value) => value.id),
    removedParts: (before?.parts ?? []).filter((value) => !current.has(value.id)).map((value) => value.id),
    changedParts: partChanges.map((value) => value.partId),
    partChanges,
    addedSections: after.sections.filter((value) => !oldSections.has(value.id)).map((value) => value.id),
    removedSections: (before?.sections ?? []).filter((value) => !newSections.has(value.id)).map((value) => value.id),
    changedSections: after.sections.filter((value) => oldSections.has(value.id) && changed(oldSections.get(value.id), value)).map((value) => value.id),
    tempoChange: before && before.tempoBpm !== after.tempoBpm ? { from: before.tempoBpm, to: after.tempoBpm } : null,
    meterChange: before && changed(before.meter, after.meter) ? { from: before.meter, to: after.meter } : null,
    barsChange: before && before.bars !== after.bars ? { from: before.bars, to: after.bars } : null,
    titleChange: before && before.title !== after.title ? { from: before.title, to: after.title } : null,
    protectionChange: { added: after.protectedPartIds.filter((value) => !before?.protectedPartIds.includes(value)), removed: (before?.protectedPartIds ?? []).filter((value) => !after.protectedPartIds.includes(value)) },
    sourceAssetChange: { added: after.sourceAssetIds.filter((value) => !before?.sourceAssetIds.includes(value)), removed: (before?.sourceAssetIds ?? []).filter((value) => !after.sourceAssetIds.includes(value)) },
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
