import { z } from "zod";
import { canonicalHash } from "../domain/hash.js";
import { analyzeNativeSection, nativeDocumentSchema, nativeOperationSchema, nativeParameterRanges, automatableDeviceFields, automatableEffectFields, type NativeDocument, type NativeOperation } from "./model.js";

const stepKey = z.string().regex(/^[a-z0-9-]{1,96}$/);
const id = nativeDocumentSchema.shape.parts.element.shape.id;
const motifSchema = nativeDocumentSchema.shape.motifs.element;
const noteFields = motifSchema.shape.notes.element.shape;
// Compact wire representation only: canonical music still has stable note IDs
// and exact validated values. No rhythmic/pitch choices are inferred.
const compactPattern = motifSchema.omit({ notes: true }).extend({
  // Homogeneous array schema works across provider tool dialects; canonical
  // field validation still checks each positional value before any mutation.
  events: z.array(z.array(z.number()).length(4).superRefine((row, ctx) => {
    [noteFields.startTick, noteFields.durationTicks, noteFields.pitch, noteFields.velocity].forEach((field, i) => {
      const checked = field.safeParse(row[i]);
      if (!checked.success) ctx.addIssue({ code: "custom", path: [i], message: checked.error.issues[0]!.message });
    });
  })).min(1).max(256)
});
export const inspectionScope = z.object({ sectionIds: z.array(id).max(3).default([]), soundPartIds: z.array(id).max(3).default([]) });
export const nativeBatchSchema = z.object({ stepKey, operations: z.array(nativeOperationSchema).min(1).max(128), inspect: inspectionScope.optional() });
type OperationSchema = typeof nativeOperationSchema.options[number];
const operation = <K extends NativeOperation["kind"]>(kind: K) => nativeOperationSchema.options.find((option) => option.shape.kind.value === kind)! as Extract<OperationSchema, { shape: { kind: z.ZodLiteral<K> } }>;

// Exact canonical ticks throughout. No beat conversion, generated genre recipe,
// implicit repeats or invented notes. An initial scene can replace the seed;
// later scenes append only the explicitly named parts/motifs/placements.
export const nativeSceneSchema = z.object({
  stepKey, replaceSeed: z.boolean().default(false),
  title: z.string().min(1).max(120).optional(),
  meter: nativeDocumentSchema.shape.meter.optional(),
  structure: operation("setStructure").omit({ kind: true }).optional(),
  parts: z.array(nativeDocumentSchema.shape.parts.element).max(12).default([]),
  motifs: z.array(nativeDocumentSchema.shape.motifs.element).max(24).default([]),
  patterns: z.array(compactPattern).max(24).default([]).describe("Compact motifs: events are [startTick,durationTicks,MIDI pitch,velocity]. Exact notes, deterministic IDs; prefer to verbose notes. Build a few patterns per call, not the whole piece at once."),
  placements: z.array(z.object({ partId: id, placement: nativeDocumentSchema.shape.parts.element.shape.placements.unwrap().element })).max(48).default([]),
  inspect: inspectionScope.optional()
});
export function sceneOperations(raw: unknown): NativeOperation[] {
  const args = nativeSceneSchema.parse(raw);
  const ops: unknown[] = [];
  if (args.title) ops.push({ kind: "setTitle", title: args.title });
  if (args.meter) ops.push({ kind: "setMeter", meter: args.meter });
  if (args.structure) ops.push({ ...args.structure, kind: "setStructure" });
  if (args.replaceSeed) ops.push({ kind: "removePart", partId: "starting-voice" });
  const motifs = [...args.motifs, ...args.patterns.map(({ events, ...pattern }) => ({ ...pattern, notes: events.map(([startTick, durationTicks, pitch, velocity], i) => ({ id: `n-${canonicalHash([pattern.id, i]).slice(0, 24)}`, startTick, durationTicks, pitch, velocity })) }))];
  ops.push(...args.parts.map((part) => ({ kind: "addPart", part })), ...motifs.map((motif) => ({ kind: "defineMotif", motif })), ...args.placements.map((item) => ({ kind: "placeMotif", ...item })));
  return z.array(nativeOperationSchema).min(1).max(128).parse(ops);
}

// Reuse the actual operation schemas rather than a second musical vocabulary.
export const themeDevelopmentSchema = z.object({ stepKey,
  operations: z.array(z.union([operation("varyMotifInstance"), operation("handoffMotif"), operation("developSectionNotes")])).min(1).max(24), inspect: inspectionScope.optional() });
export const sectionSoundSchema = z.object({ stepKey,
  operations: z.array(z.union([operation("editSectionAutomation"), operation("setSectionEffectFeedback"), operation("setSectionClipGain")])).min(1).max(24), inspect: inspectionScope.optional() });

export const soundInspectionSchema = z.object({ partId: z.string(), query: z.string().max(120).default(""), offset: z.number().int().min(0).default(0) });
export function inspectEditableSound(document: NativeDocument, partId: string, query = "", offset = 0) {
  const part = document.parts.find((item) => item.id === partId);
  if (!part) throw new Error(`Unknown part ${partId}`);
  const controls = (type: keyof typeof nativeParameterRanges, values: Record<string, number>, prefix: string, allowed: Set<string> | undefined) => Object.entries(nativeParameterRanges[type]).map(([path, range]) => ({
    parameter: path, range, integer: /Index$|Count$/.test(path),
    unit: /Hz$/.test(path) ? "Hz" : /Ms$/.test(path) ? "ms" : /Db$/.test(path) ? "dB" : /Semitones$/.test(path) ? "semitones" : "SDK value",
    value: values[path] ?? null, valueSource: Object.hasOwn(values, path) ? "explicit" : "preset or SDK default; not measured",
    automationTarget: allowed?.has(path) ? `${prefix}${path}` : null,
    automationValueRange: allowed?.has(path) ? [0, 1] : null
  }));
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const available = controls(part.device.type, part.device.parameters, "device.", automatableDeviceFields[part.device.type]).filter((control) => !terms.length || terms.some((term) => control.parameter.toLowerCase().includes(term))).sort((a, b) => Number(b.value !== null) - Number(a.value !== null));
  return { documentHash: canonicalHash(document), partId, protected: document.protectedPartIds.includes(partId),
    device: { type: part.device.type, preset: part.device.preset ?? null, controls: available.slice(offset, offset + 12), totalControls: available.length, nextOffset: offset + 12 < available.length ? offset + 12 : null, query },
    effects: [...part.effects, ...(part.parallel?.effects ?? [])].map((effect) => ({ id: effect.id, type: effect.type, controls: controls(effect.type, effect.parameters, `effect.${effect.id}.`, automatableEffectFields) })),
    mix: { gain: part.gain, pan: part.pan, groupId: part.groupId ?? null, sends: part.sends ?? [] },
    automation: part.automation,
    noteContract: part.device.type === "beatbox8" ? { lanes: { kick: 36, snare: 38, closedHat: 42, openHat: 46 }, gridTicks: 240, durationTicks: 240, velocity: 1, maxPatterns: 5 } : { timing: "integer ticks, 960 per quarter note", pitch: "MIDI 0–127", velocity: [0.01, 1] },
    editExample: { kind: "setDevice", partId, device: part.device },
    guidance: "Patch values use the listed SDK range; automation points use normalized 0–1, not Hz/ms/dB. Merge desired values into the returned device for setDevice; it replaces the patch. Only listed automation targets are writable. SDK discovery paths are not canonical edit paths. This is structural evidence, not heard sound." };
}

// Local to one producer invocation (and therefore owner/job), invalidated by
// exact document hash. Never cache mutable external resources or authorization.
export class NativeInspectionCache {
  private hash = "";
  private readonly entries = new Map<string, unknown>();
  read(document: NativeDocument, scope: z.infer<typeof inspectionScope>) {
    const hash = canonicalHash(document);
    if (hash !== this.hash) { this.entries.clear(); this.hash = hash; }
    const read = (key: string, inspect: () => unknown) => {
      if (!this.entries.has(key)) { if (this.entries.size >= 32) this.entries.delete(this.entries.keys().next().value!); this.entries.set(key, inspect()); }
      return this.entries.get(key);
    };
    return { documentHash: hash, sections: scope.sectionIds.map((id) => read(`section:${id}`, () => analyzeNativeSection(document, id))), sounds: scope.soundPartIds.map((id) => read(`sound:${id}`, () => inspectEditableSound(document, id))) };
  }
}
