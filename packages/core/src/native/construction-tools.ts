import { z } from "zod";
import { canonicalHash } from "../domain/hash.js";
import { analyzeNativeSection, applyNativeOperations, barTicks, materializedNotes, NATIVE_PPQ, nativeDocumentSchema, nativeOperationSchema, nativeParameterRanges, automatableDeviceFields, automatableEffectFields, type NativeDocument, type NativeOperation } from "./model.js";
import { NativeCorrectableError, NativeUnknownIdError } from "./errors.js";
import { bassHits, bassPatterns, bassRegisters, compHits, compPatterns, feelChangesMaterial, feelFor, nativeFeelSchema, nativeKeySchema, parseChordSymbol, scaleOf, voiceProgression, voicingRegisters, type ChordSpan, type CycleGrid, type NativeFeel, type PatternHit } from "./harmony.js";
import { nativePresetRecipes, readNativeRecipe } from "./resources.js";

const stepKey = z.string().regex(/^[a-z0-9-]{1,96}$/);
const id = nativeDocumentSchema.shape.parts.element.shape.id;
const motifSchema = nativeDocumentSchema.shape.motifs.element;
const noteFields = motifSchema.shape.notes.element.shape;
// Compact wire representation only: canonical music still has stable note IDs
// and exact validated values. No rhythmic/pitch choices are inferred.
const compactPattern = motifSchema.omit({ notes: true }).extend({
  feel: nativeFeelSchema.optional().describe("Swing/humanize when built; MIDI parts only, not Beatbox8"),
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

// Symbolic shortcuts. The model chooses chords, pattern, register, feel or a
// recipe; deterministic code expands them into ordinary validated operations
// (harmonizeSection, sequenceSectionPattern, setDevice, addEffect) before the
// step is stored, so history stays explicit notes and settings.
const recipeIds = nativePresetRecipes.map((recipe) => recipe.id) as [string, ...string[]];
const chordProgressionBody = z.object({
  sectionIds: z.array(id).min(1).max(8).describe("Repeats through each section"),
  key: nativeKeySchema.optional().describe("Keeps 7ths/9ths and walking approaches in key, e.g. \"D minor\""),
  chords: z.array(z.object({ symbol: z.string().min(1).max(16).describe("e.g. Dm9, Bbmaj7, F#m7b5, G7sus4, C/E"), bars: z.number().min(0.25).max(16) }).strict()).min(1).max(16),
  // Voiced automatically with smooth voice leading.
  comp: z.object({ partId: id, pattern: z.enum(compPatterns).default("sustain"), register: z.enum(["low", "mid", "high"]).default("mid"), voices: z.number().int().min(3).max(5).default(4),
    style: z.enum(["close", "open", "shell"]).default("close"), extensions: z.enum(["as-written", "sevenths", "ninths"]).default("as-written"), velocity: z.number().min(0.05).max(1).default(0.55) }).strict().optional(),
  // Follows the chord roots (or slash-bass notes).
  bass: z.object({ partId: id, pattern: z.enum(bassPatterns).default("roots"), register: z.enum(["low", "mid"]).default("low"), velocity: z.number().min(0.05).max(1).default(0.7) }).strict().optional(),
  feel: nativeFeelSchema.optional().describe("Swing/humanize for comp and bass")
}).strict();
export const chordProgressionSchema = chordProgressionBody.extend({ kind: z.literal("chordProgression") }).describe("Write chords (and optionally a bass line) from chord symbols into empty sections of MIDI parts");
export const applyRecipeSchema = z.object({ kind: z.literal("applyRecipe"), partId: id, recipeId: z.enum(recipeIds) }).strict().describe("Set a part's device and add the recipe's effect chain");
type ChordProgression = z.infer<typeof chordProgressionBody>;

const invalid = (message: string, next: string) => new NativeCorrectableError("SYMBOLIC_EDIT_INVALID", message, next);
const gridOf = (document: Pick<NativeDocument, "meter">): CycleGrid => ({ barTicks: barTicks(document), beatTicks: NATIVE_PPQ * 4 / document.meter.denominator, beatsPerBar: document.meter.numerator });
function midiPart(document: NativeDocument, partId: string) {
  const part = document.parts.find((item) => item.id === partId);
  if (!part) throw new NativeUnknownIdError("part", partId);
  if (part.device.type === "beatbox8" || part.device.type === "audio") throw invalid(`${part.name} uses ${part.device.type}, which cannot play chords, bass lines or feel`, "Use a Heisenberg, Pulverisateur or inspected Gakki part (for example a recipe part)");
  return part;
}
/** Swing/humanize for pattern hits within one cycle; offsets stay inside the cycle. */
function feelHits(hits: PatternHit[], feel: NativeFeel | undefined, grid: CycleGrid, cycleTicks: number, seed: string) {
  return hits.map((hit, index) => {
    hit = { ...hit, durationTicks: Math.min(3840, hit.durationTicks) };
    if (!feel || !feelChangesMaterial(feel)) return { ...hit, timingOffsetTicks: 0 };
    const felt = feelFor(hit.tick, hit.velocity, feel, grid, [seed, index]);
    const offset = Math.max(-120, Math.min(120, Math.max(-hit.tick, Math.min(cycleTicks - 1 - hit.tick, felt.offset))));
    return { ...hit, velocity: felt.velocity, timingOffsetTicks: offset };
  });
}

/** Expand a chord progression into explicit chord and bass notes for each section. */
export function compileChordProgression(raw: ChordProgression, document: NativeDocument): NativeOperation[] {
  const progression = chordProgressionBody.extend({ kind: z.literal("chordProgression").optional() }).parse(raw);
  if (!progression.comp && !progression.bass) throw invalid("A chord progression needs a comp part, a bass part or both", "Add comp: { partId } and/or bass: { partId }");
  const grid = gridOf(document), scale = progression.key ? scaleOf(progression.key) : undefined;
  const cycleBars = progression.chords.reduce((sum, chord) => sum + chord.bars, 0);
  if (!Number.isInteger(cycleBars) || cycleBars > 16) throw invalid(`The chord lengths add up to ${cycleBars} bars`, "Make the chord lengths add up to a whole number of bars, at most 16");
  let chords;
  try { chords = progression.chords.map((chord) => parseChordSymbol(chord.symbol)); }
  catch (error) { throw invalid(error instanceof Error ? error.message : "Unreadable chord symbol", "Use symbols such as Am, Fmaj7, C, G7, Dm9, Bb/D"); }
  const offsets: number[] = [];
  progression.chords.reduce((offset, chord) => { offsets.push(offset); return offset + chord.bars; }, 0);
  const sections = progression.sectionIds.map((sectionId) => { const section = document.sections.find((item) => item.id === sectionId); if (!section) throw new NativeUnknownIdError("section", sectionId); return section; });
  const empty = (partId: string) => {
    const part = midiPart(document, partId), notes = materializedNotes(document, partId);
    for (const section of sections) {
      const start = section.startBar * grid.barTicks, end = section.endBar * grid.barTicks;
      if (notes.some((note) => note.startTick < end && note.startTick + note.durationTicks > start)) throw invalid(`${part.name} already plays in ${section.name}; a chord progression writes new notes there`, "Use a part that is silent in these sections (add a new part if needed)");
    }
  };
  const ops: unknown[] = [];
  const spansFor = (voicings: number[][]): ChordSpan[] => chords.map((chord, index) => ({ chord, voicing: voicings[index]!, startTick: Math.round(offsets[index]! * grid.barTicks), endTick: Math.round((offsets[index]! + progression.chords[index]!.bars) * grid.barTicks) }));
  const cycleTicks = cycleBars * grid.barTicks;
  if (progression.comp) {
    const comp = progression.comp;
    empty(comp.partId);
    let voicings: number[][];
    try { voicings = voiceProgression(chords, { register: voicingRegisters[comp.register], voices: comp.voices, style: comp.style, extensions: comp.extensions, ...(scale ? { scale } : {}) }); }
    catch (error) { throw invalid(error instanceof Error ? error.message : "No voicing fits", "Choose another register or fewer voices"); }
    for (const section of sections) {
      // Held chords keep their full length. Swing or a timing nudge cannot
      // usefully move a held chord, so feel varies only each chord's velocity.
      if (comp.pattern === "sustain") {
        const velocityOf = (index: number) => progression.feel ? feelFor(Math.round(offsets[index]! * grid.barTicks), comp.velocity, progression.feel, grid, [comp.partId, section.id, index]).velocity : comp.velocity;
        ops.push({ kind: "harmonizeSection", partId: comp.partId, sectionId: section.id, cycleBars, chords: voicings.map((pitches, index) => ({ barOffset: offsets[index]!, durationBars: progression.chords[index]!.bars, pitches, velocity: velocityOf(index), strumTicks: 0 })) });
        continue;
      }
      if (cycleBars > 8) throw invalid(`A rhythmic ${comp.pattern} pattern repeats a cycle of at most 8 bars; this progression is ${cycleBars}`, "Split it into two progressions over different sections, or use the sustain pattern");
      const hits = feelHits(compHits(spansFor(voicings), comp.pattern, grid, comp.velocity), progression.feel, grid, cycleTicks, `${comp.partId}:${section.id}`);
      if (hits.length > 96) throw invalid(`The ${comp.pattern} pattern needs ${hits.length} notes per cycle (limit 96)`, "Use fewer voices, a sparser pattern or fewer bars per progression");
      ops.push({ kind: "sequenceSectionPattern", partId: comp.partId, sectionId: section.id, cycleBars, hits });
    }
  }
  if (progression.bass) {
    const bass = progression.bass;
    empty(bass.partId);
    if (cycleBars > 8) throw invalid(`A bass line repeats a cycle of at most 8 bars; this progression is ${cycleBars}`, "Split it into two progressions over different sections");
    const hits = bassHits(spansFor(chords.map(() => [])), bass.pattern, grid, bass.velocity, bassRegisters[bass.register], scale);
    if (hits.length > 96) throw invalid(`The ${bass.pattern} bass needs ${hits.length} notes per cycle (limit 96)`, "Use a sparser bass pattern or fewer bars per progression");
    for (const section of sections) ops.push({ kind: "sequenceSectionPattern", partId: bass.partId, sectionId: section.id, cycleBars, hits: feelHits(hits, progression.feel, grid, cycleTicks, `${bass.partId}:${section.id}`) });
  }
  return z.array(nativeOperationSchema).parse(ops);
}

/** A recipe's device settings and effect chain, as ordinary operations. */
export function compileRecipe(raw: z.infer<typeof applyRecipeSchema>, document: NativeDocument): NativeOperation[] {
  const op = applyRecipeSchema.parse(raw);
  const part = document.parts.find((item) => item.id === op.partId);
  if (!part) throw new NativeUnknownIdError("part", op.partId);
  const recipe = readNativeRecipe(op.recipeId);
  const effects = recipeEffects(recipe.id);
  return z.array(nativeOperationSchema).parse([
    { kind: "setDevice", partId: part.id, device: { type: recipe.device.type, parameters: { ...recipe.device.parameters } } },
    ...effects.map((effect) => ({ kind: part.effects.some((existing) => existing.id === effect.id) ? "replaceEffect" : "addEffect", partId: part.id, effect }))
  ]);
}
const recipeEffects = (recipeId: string) => readNativeRecipe(recipeId).effects.map((effect, index) => ({ id: `${recipeId}-${index + 1}`, type: effect.type, parameters: { ...effect.parameters } }));

/** Expand symbolic shortcuts in a tool's operation list against the document as
 * it will be when each shortcut runs (earlier operations in the list applied). */
export function compileToolOperations(operations: ReadonlyArray<unknown>, document: NativeDocument): NativeOperation[] {
  const result: NativeOperation[] = [];
  for (const raw of operations) {
    const kind = raw && typeof raw === "object" && "kind" in raw ? raw.kind : null;
    if (kind !== "chordProgression" && kind !== "applyRecipe") { result.push(nativeOperationSchema.parse(raw)); continue; }
    const projected = result.length ? applyNativeOperations(document, result) : document;
    result.push(...(kind === "chordProgression" ? compileChordProgression(chordProgressionSchema.parse(raw), projected) : compileRecipe(applyRecipeSchema.parse(raw), projected)));
  }
  if (result.length > 128) throw invalid(`This edit expands to ${result.length} operations (limit 128)`, "Split it into two steps with different step keys");
  return result;
}

export const nativeBatchSchema = z.object({ stepKey, operations: z.array(z.discriminatedUnion("kind", [...nativeOperationSchema.options, chordProgressionSchema, applyRecipeSchema])).min(1).max(128), inspect: inspectionScope.optional() });
type OperationSchema = typeof nativeOperationSchema.options[number];
const operation = <K extends NativeOperation["kind"]>(kind: K) => nativeOperationSchema.options.find((option) => option.shape.kind.value === kind)! as Extract<OperationSchema, { shape: { kind: z.ZodLiteral<K> } }>;

// Exact canonical ticks throughout. No beat conversion or implicit repeats, and
// nothing picks a genre, progression or pattern: a part's recipe and a harmony
// entry are the model's explicit choices, compiled into explicit settings and
// notes before the step is stored. An initial scene can replace the seed; later
// scenes append only the explicitly named parts/motifs/placements/harmony.
const partSchema = nativeDocumentSchema.shape.parts.element;
const scenePart = partSchema.omit({ device: true, effects: true }).extend({
  device: partSchema.shape.device.optional(), effects: partSchema.shape.effects.optional(),
  recipe: z.enum(recipeIds).optional().describe("A local recipe id: sets the device and its effect chain (device parameters you give override the recipe's)")
});
export const nativeSceneSchema = z.object({
  stepKey, replaceSeed: z.boolean().default(false),
  title: z.string().min(1).max(120).optional(),
  meter: nativeDocumentSchema.shape.meter.optional(),
  structure: operation("setStructure").omit({ kind: true }).optional(),
  parts: z.array(scenePart).max(12).default([]).describe("Each part needs a device or a recipe. Beatbox8 is boolean: pitches 36/38/42/46 only, startTick a multiple of 240, durationTicks 240, velocity 1. For a groove with feel use an inspected/pinned Gakki kit. Choose a recipe or explicit patch settings for distinctive synth voices."),
  motifs: z.array(nativeDocumentSchema.shape.motifs.element).max(24).default([]).describe("Root motif: omit familyId or set it to this motif's own id. A derived motif must reference its actual parent and the parent's family. Do not invent a separate family label for a root."),
  patterns: z.array(compactPattern).max(24).default([]).describe("Compact motifs: events are [startTick,durationTicks,MIDI pitch,velocity]. Root familyId must equal id or be omitted; derived patterns reference a real parent/family. Beatbox8 example: [0,240,36,1]. Build a few patterns per call, not the whole piece at once."),
  placements: z.array(z.object({ partId: id, placement: nativeDocumentSchema.shape.parts.element.shape.placements.unwrap().element })).max(48).default([]),
  harmony: z.array(chordProgressionBody).max(6).default([]).describe("Chord progressions written after the parts and phrases above: chord symbols voiced automatically, with an optional bass line"),
  inspect: inspectionScope.optional()
});
/** Scene arguments as operations. `document` is the current draft: it supplies
 * the meter for feel and the starting point for harmony and recipe checks. */
export function sceneOperations(raw: unknown, document?: NativeDocument): NativeOperation[] {
  const args = nativeSceneSchema.parse(raw);
  const ops: unknown[] = [];
  if (args.title) ops.push({ kind: "setTitle", title: args.title });
  if (args.meter) ops.push({ kind: "setMeter", meter: args.meter });
  if (args.structure) ops.push({ ...args.structure, kind: "setStructure" });
  if (args.replaceSeed) ops.push({ kind: "removePart", partId: "starting-voice" });
  const grid = gridOf({ meter: args.meter ?? document?.meter ?? { numerator: 4, denominator: 4 } });
  const parts = args.parts.map(({ recipe, device, effects, ...part }) => {
    if (!recipe) {
      if (!device) throw invalid(`Part ${part.id} needs a device or a recipe`, "Add recipe: \"<recipe id>\" or a device with explicit parameters");
      return { ...part, device, effects: effects ?? [] };
    }
    const source = readNativeRecipe(recipe);
    if (device && device.type !== source.device.type) throw invalid(`Part ${part.id} names recipe ${recipe} (${source.device.type}) with a ${device.type} device`, "Use the recipe alone, or a device of the same type to override its parameters");
    return { ...part, device: { type: source.device.type, parameters: { ...source.device.parameters, ...(device?.parameters ?? {}) } }, effects: [...recipeEffects(recipe), ...(effects ?? [])] };
  });
  const deviceOf = (partId: string) => parts.find((part) => part.id === partId)?.device.type ?? document?.parts.find((part) => part.id === partId)?.device.type;
  const motifs = [...args.motifs, ...args.patterns.map(({ events, feel, ...pattern }) => {
    if (feel && feelChangesMaterial(feel) && ["beatbox8", "audio"].includes(deviceOf(pattern.partId) ?? "")) throw invalid(`Pattern ${pattern.id} is on a Beatbox8/audio part, which cannot swing or vary velocity`, "Use an inspected Gakki drum kit for a groove with feel, or omit feel");
    return { ...pattern, notes: events.map(([startTick, durationTicks, pitch, velocity], i) => {
      if (!feel || !feelChangesMaterial(feel)) return { id: `n-${canonicalHash([pattern.id, i]).slice(0, 24)}`, startTick, durationTicks, pitch, velocity };
      const felt = feelFor(startTick!, velocity!, feel, grid, [pattern.id, i]);
      const moved = Math.max(0, Math.min(pattern.lengthTicks - 1, startTick! + felt.offset));
      return { id: `n-${canonicalHash([pattern.id, i]).slice(0, 24)}`, startTick: moved, durationTicks: Math.max(1, Math.min(durationTicks!, pattern.lengthTicks - moved)), pitch, velocity: felt.velocity };
    }) };
  })];
  ops.push(...parts.map((part) => ({ kind: "addPart", part })), ...motifs.map((motif) => ({ kind: "defineMotif", motif })), ...args.placements.map((item) => ({ kind: "placeMotif", ...item })));
  const base = z.array(nativeOperationSchema).parse(ops);
  if (!args.harmony.length) return z.array(nativeOperationSchema).min(1).max(128).parse(base);
  if (!document) throw invalid("Harmony in a scene needs the current draft", "Retry the scene");
  let projected = applyNativeOperations(document, base);
  const harmony: NativeOperation[] = [];
  for (const progression of args.harmony) {
    const compiled = compileChordProgression(progression, projected);
    harmony.push(...compiled);
    projected = applyNativeOperations(projected, compiled);
  }
  if (base.length + harmony.length > 128) throw invalid(`This scene expands to ${base.length + harmony.length} operations (limit 128)`, "Move some harmony or parts into a second scene with another step key");
  return z.array(nativeOperationSchema).min(1).max(128).parse([...base, ...harmony]);
}

// Reuse the actual operation schemas rather than a second musical vocabulary.
export const themeDevelopmentSchema = z.object({ stepKey,
  operations: z.array(z.union([operation("varyMotifInstance"), operation("handoffMotif"), operation("developSectionNotes")])).min(1).max(24), inspect: inspectionScope.optional() });
export const sectionSoundSchema = z.object({ stepKey,
  operations: z.array(z.union([operation("editSectionAutomation"), operation("setSectionEffectFeedback"), operation("setSectionClipGain")])).min(1).max(24), inspect: inspectionScope.optional() });

// A focused sound menu avoids advertising the entire source/note/routing union
// merely to change a patch or connect ambience. These are the exact canonical
// operations, not a parallel permissive implementation.
export const soundBatchSchema = z.object({ stepKey,
  operations: z.array(z.union([operation("setDevice"), operation("setMix"), operation("addEffect"), operation("replaceEffect"), operation("addAutomation"), operation("replaceAutomation"), operation("setReverbBus"), operation("setDelayBus"), operation("setSend"), operation("upsertGroup"), operation("routePart"), applyRecipeSchema])).min(1).max(32), inspect: inspectionScope.optional() });

export const soundInspectionSchema = z.object({ partId: z.string(), query: z.string().max(120).default(""), offset: z.number().int().min(0).default(0) });
export function inspectEditableSound(document: NativeDocument, partId: string, query = "", offset = 0) {
  const part = document.parts.find((item) => item.id === partId);
  if (!part) throw new NativeUnknownIdError("part", partId);
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
