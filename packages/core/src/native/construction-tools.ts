import { z } from "zod";
import { canonicalHash } from "../domain/hash.js";
import { analyzeNativeSection, applyNativeOperations, barTicks, materializedNotes, NATIVE_PPQ, nativeDocumentSchema, nativeOperationSchema, nativeParameterRanges, automatableDeviceFields, automatableEffectFields, type NativeDocument, type NativeOperation } from "./model.js";
import { NativeCorrectableError, NativeUnknownIdError } from "./errors.js";
import { bassHits, bassPatterns, bassRegisters, bassRootLine, compHits, compPatterns, feelChangesMaterial, feelFor, nativeFeelSchema, nativeKeySchema, parseChordSymbol, scaleOf, voiceProgression, voicingRegisters, type ChordSpan, type CycleGrid, type NativeChord, type NativeFeel, type PatternHit, type VoicingOptions } from "./harmony.js";
import { gmDrumKits, nativePresetRecipes, readNativeRecipe } from "./resources.js";
import { compileDrumGroove, drumGrooveBody } from "./groove-tools.js";

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
// (harmonizeSection, sequenceSectionPattern, addNotes, setDevice, addEffect) before the
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
  feel: nativeFeelSchema.optional().describe("Swing/humanize for comp and bass"),
  ending: z.object({ symbol: z.string().min(1).max(16), bars: z.number().min(0.5).max(4).default(1) }).strict().optional().describe("Last section ends on this chord")
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
/** A section's repeating cycle as explicit notes up to stopTick, placed the way
 * harmonizeSection and sequenceSectionPattern place them. */
function cycleNotes(hits: ReturnType<typeof feelHits>, cycleTicks: number, startTick: number, stopTick: number) {
  const notes: Array<{ startTick: number; durationTicks: number; pitch: number; velocity: number }> = [];
  for (let cycleStart = startTick; cycleStart < stopTick; cycleStart += cycleTicks) for (const hit of hits) {
    const at = cycleStart + hit.tick + hit.timingOffsetTicks;
    // A hit written at or after stopTick stays out even when feel pulls it just ahead.
    if (cycleStart + hit.tick < stopTick && at < stopTick) notes.push({ startTick: at, durationTicks: Math.min(hit.durationTicks, stopTick - at), pitch: hit.pitch, velocity: hit.velocity });
  }
  return notes;
}

/** Expand a chord progression into explicit chord and bass notes for each section. */
export function compileChordProgression(raw: ChordProgression, document: NativeDocument): NativeOperation[] {
  const progression = chordProgressionBody.extend({ kind: z.literal("chordProgression").optional() }).parse(raw);
  if (!progression.comp && !progression.bass) throw invalid("A chord progression needs a comp part, a bass part or both", "Add comp: { partId } and/or bass: { partId }");
  const grid = gridOf(document), scale = progression.key ? scaleOf(progression.key) : undefined;
  const cycleBars = progression.chords.reduce((sum, chord) => sum + chord.bars, 0);
  if (!Number.isInteger(cycleBars) || cycleBars > 16) throw invalid(`The chord lengths add up to ${cycleBars} bars`, "Make the chord lengths add up to a whole number of bars, at most 16");
  let chords, finalChord: NativeChord | undefined;
  try { chords = progression.chords.map((chord) => parseChordSymbol(chord.symbol)); if (progression.ending) finalChord = parseChordSymbol(progression.ending.symbol); }
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
  // An ending replaces the close of the last listed section only. The cycle
  // operations repeat unchanged to a section's end, so that one section is
  // written as explicit notes; every other section compiles as it always did.
  const last = sections.at(-1)!, lastStart = last.startBar * grid.barTicks, lastEnd = last.endBar * grid.barTicks, endingBars = progression.ending?.bars ?? 0;
  const endingStart = lastEnd - Math.round(endingBars * grid.barTicks);
  if (endingStart < lastStart) throw invalid(`The ending lasts ${endingBars} bars but ${last.name} has only ${last.endBar - last.startBar}`, "Shorten ending.bars to fit the last listed section");
  // The chord sounding just before the ending leads into it (the cycle's last chord when the ending fills the section).
  const beforeEnding = endingStart > lastStart ? (endingStart - 1 - lastStart) % cycleTicks : cycleTicks - 1;
  const lead = offsets.filter((offset) => Math.round(offset * grid.barTicks) <= beforeEnding).length - 1;
  const close = (partId: string, role: "comp" | "bass", hits: ReturnType<typeof feelHits>, pitches: number[], velocity: number) => {
    const notes = [...cycleNotes(hits, cycleTicks, lastStart, endingStart), ...pitches.map((pitch) => ({ startTick: endingStart, durationTicks: lastEnd - endingStart, pitch, velocity }))]
      .map((note, index) => ({ id: `n-${canonicalHash([partId, last.id, role, index, note.startTick]).slice(0, 32)}`, ...note }));
    for (let from = 0; from < notes.length; from += 256) ops.push({ kind: "addNotes", partId, notes: notes.slice(from, from + 256) });
  };
  if (progression.comp) {
    const comp = progression.comp;
    empty(comp.partId);
    const voicing: VoicingOptions = { register: voicingRegisters[comp.register], voices: comp.voices, style: comp.style, extensions: comp.extensions, ...(scale ? { scale } : {}) };
    let voicings: number[][], finalVoicing: number[] = [];
    try { voicings = voiceProgression(chords, voicing); if (finalChord) finalVoicing = voiceProgression([...chords.slice(0, lead + 1), finalChord], voicing).at(-1)!; }
    catch (error) { throw invalid(error instanceof Error ? error.message : "No voicing fits", "Choose another register or fewer voices"); }
    for (const [sectionIndex, section] of sections.entries()) {
      const closing = finalChord !== undefined && sectionIndex === sections.length - 1;
      // Held chords keep their full length. Swing or a timing nudge cannot
      // usefully move a held chord, so feel varies only each chord's velocity.
      if (comp.pattern === "sustain") {
        const velocityOf = (index: number) => progression.feel ? feelFor(Math.round(offsets[index]! * grid.barTicks), comp.velocity, progression.feel, grid, [comp.partId, section.id, index]).velocity : comp.velocity;
        if (closing) close(comp.partId, "comp", voicings.flatMap((pitches, index) => pitches.map((pitch) => ({ tick: Math.round(offsets[index]! * grid.barTicks), durationTicks: Math.round(progression.chords[index]!.bars * grid.barTicks), pitch, velocity: velocityOf(index), timingOffsetTicks: 0 }))), finalVoicing, comp.velocity);
        else ops.push({ kind: "harmonizeSection", partId: comp.partId, sectionId: section.id, cycleBars, chords: voicings.map((pitches, index) => ({ barOffset: offsets[index]!, durationBars: progression.chords[index]!.bars, pitches, velocity: velocityOf(index), strumTicks: 0 })) });
        continue;
      }
      if (cycleBars > 8) throw invalid(`A rhythmic ${comp.pattern} pattern repeats a cycle of at most 8 bars; this progression is ${cycleBars}`, "Split it into two progressions over different sections, or use the sustain pattern");
      const hits = feelHits(compHits(spansFor(voicings), comp.pattern, grid, comp.velocity), progression.feel, grid, cycleTicks, `${comp.partId}:${section.id}`);
      if (hits.length > 96) throw invalid(`The ${comp.pattern} pattern needs ${hits.length} notes per cycle (limit 96)`, "Use fewer voices, a sparser pattern or fewer bars per progression");
      if (closing) close(comp.partId, "comp", hits, finalVoicing, comp.velocity);
      else ops.push({ kind: "sequenceSectionPattern", partId: comp.partId, sectionId: section.id, cycleBars, hits });
    }
  }
  if (progression.bass) {
    const bass = progression.bass, [low, high] = bassRegisters[bass.register];
    empty(bass.partId);
    if (cycleBars > 8) throw invalid(`A bass line repeats a cycle of at most 8 bars; this progression is ${cycleBars}`, "Split it into two progressions over different sections");
    const hits = bassHits(spansFor(chords.map(() => [])), bass.pattern, grid, bass.velocity, bassRegisters[bass.register], scale);
    if (hits.length > 96) throw invalid(`The ${bass.pattern} bass needs ${hits.length} notes per cycle (limit 96)`, "Use a sparser bass pattern or fewer bars per progression");
    // The final bass note sits next to the root that leads into it (the lower octave on a tie).
    let landing = -1;
    if (finalChord) {
      const leadRoot = bassRootLine(chords.map((chord) => chord.bass), low, high)[lead]!;
      for (let pitch = low; pitch <= high; pitch++) if (pitch % 12 === finalChord.bass && (landing < 0 || Math.abs(pitch - leadRoot) < Math.abs(landing - leadRoot))) landing = pitch;
    }
    for (const [sectionIndex, section] of sections.entries()) {
      const felt = feelHits(hits, progression.feel, grid, cycleTicks, `${bass.partId}:${section.id}`);
      if (finalChord && sectionIndex === sections.length - 1) close(bass.partId, "bass", felt, [landing], bass.velocity);
      else ops.push({ kind: "sequenceSectionPattern", partId: bass.partId, sectionId: section.id, cycleBars, hits: felt });
    }
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
  recipe: z.enum(recipeIds).optional().describe("Local recipe: device and effect chain; your device parameters override it"),
  kit: z.enum(gmDrumKits).optional().describe("A GM drum kit: swing, ghost notes and dynamics"),
  instrument: z.string().regex(/^[a-z0-9-]{2,40}$/).optional().describe("A GM instrument slug, e.g. acoustic-piano")
});
// Shared reverb in one word: the bus, then a send per part by its role.
const spaces = { room: { id: "shared-room", name: "Shared room", roomSize: 0.45, preDelayMs: 30, damp: 0.4 }, hall: { id: "shared-hall", name: "Shared hall", roomSize: 0.72, preDelayMs: 45, damp: 0.3 } } as const;
const sendByRole: Record<string, number> = { lead: 0.2, melody: 0.2, harmony: 0.16, texture: 0.26, fx: 0.3, percussion: 0.06, source: 0.1 };
export const nativeSceneSchema = z.object({
  stepKey, replaceSeed: z.boolean().default(false),
  title: z.string().min(1).max(120).optional(),
  meter: nativeDocumentSchema.shape.meter.optional(),
  structure: operation("setStructure").omit({ kind: true }).optional(),
  parts: z.array(scenePart).max(12).default([]).describe("Each part needs a recipe, kit, instrument or device. Beatbox8 is boolean: pitches 36/38/42/46, startTick a multiple of 240, durationTicks 240, velocity 1."),
  motifs: z.array(nativeDocumentSchema.shape.motifs.element).max(24).default([]).describe("Root motif: omit familyId or use its own id. A derived motif references its actual parent and that parent's family."),
  patterns: z.array(compactPattern).max(24).default([]).describe("Compact motifs: events are [startTick,durationTicks,MIDI pitch,velocity]. Root familyId equals id or is omitted; derived patterns reference a real parent/family. Beatbox8 example: [0,240,36,1]. A few patterns per call, not the whole piece."),
  placements: z.array(z.object({ partId: id, placement: nativeDocumentSchema.shape.parts.element.shape.placements.unwrap().element })).max(48).default([]),
  harmony: z.array(chordProgressionBody).max(6).default([]).describe("Chord progressions from symbols, voiced automatically, with an optional bass line"),
  grooves: z.array(drumGrooveBody).max(4).default([]).describe("Drum grooves by style, with a fill closing each section"),
  space: z.enum(["room", "hall"]).optional().describe("Shared reverb with a send per part"),
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
  const parts = args.parts.map(({ recipe, kit, instrument, device, effects, ...part }) => {
    if (!recipe) {
      // A kit or instrument is resolved to its pinned Gakki preset before this runs.
      if (!device && (kit || instrument)) throw invalid(`Part ${part.id} names a GM ${kit ? "kit" : "instrument"} that was not resolved`, "GM sounds need the Audiotool library; use a local recipe for this part");
      if (!device) throw invalid(`Part ${part.id} needs a recipe, a kit, an instrument or a device`, "Add recipe: \"<recipe id>\", kit: \"<drum kit>\" or a device with explicit parameters");
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
  if (!args.harmony.length && !args.grooves.length && !args.space) return z.array(nativeOperationSchema).min(1).max(128).parse(base);
  if (!document) throw invalid("Harmony, grooves and space in a scene need the current draft", "Retry the scene");
  // Shortcuts compile in order against the draft as each one leaves it.
  let projected = base.length ? applyNativeOperations(document, base) : document;
  const extra: NativeOperation[] = [];
  const add = (compiled: NativeOperation[]) => { if (!compiled.length) return; extra.push(...compiled); projected = applyNativeOperations(projected, compiled); };
  for (const progression of args.harmony) add(compileChordProgression(progression, projected));
  for (const groove of args.grooves) add(compileDrumGroove(groove, projected));
  if (args.space) {
    const bus = projected.reverbBus ?? spaces[args.space];
    // A protected part keeps its mix: it gets no send, and the rest of the scene still applies.
    add(z.array(nativeOperationSchema).parse([...(projected.reverbBus ? [] : [{ kind: "setReverbBus", bus }]),
      ...projected.parts.filter((part) => (sendByRole[part.role] ?? 0) > 0 && !projected.protectedPartIds.includes(part.id) && !(part.sends ?? []).some((send) => send.busId === bus.id)).map((part) => ({ kind: "setSend", partId: part.id, busId: bus.id, gain: sendByRole[part.role] }))]));
  }
  if (!base.length && !extra.length) throw invalid("This scene changes nothing: the shared space and its sends are already in place", "Continue with the next musical change");
  if (base.length + extra.length > 128) throw invalid(`This scene expands to ${base.length + extra.length} operations (limit 128)`, "Move some harmony, grooves or parts into a second scene with another step key");
  return z.array(nativeOperationSchema).min(1).max(128).parse([...base, ...extra]);
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
