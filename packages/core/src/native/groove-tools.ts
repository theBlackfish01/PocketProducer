// Drum grooves as a symbolic shortcut: the model picks a style, density and fill;
// deterministic code writes the hits. Like chord progressions, a groove compiles
// into ordinary operations before the step is stored.
import { z } from "zod";
import { canonicalHash } from "../domain/hash.js";
import { barTicks, materializedNotes, NATIVE_PPQ, nativeDocumentSchema, nativeOperationSchema, type NativeDocument, type NativeOperation } from "./model.js";
import { NativeCorrectableError, NativeUnknownIdError } from "./errors.js";
import { feelFor, nativeFeelSchema, type CycleGrid, type NativeFeel, type PatternHit } from "./harmony.js";
import { fillHits, grooveCatalog, grooveDensities, grooveHits, grooveStyles, toBeatbox8, withFill } from "./grooves.js";

const id = nativeDocumentSchema.shape.parts.element.shape.id;
export const drumFills = ["none", "snare-roll", "tom-run", "kick-pickup", "hat-open"] as const;
export const drumGrooveBody = z.object({
  partId: id, sectionIds: z.array(id).min(1).max(8),
  style: z.enum(grooveStyles), density: z.enum(grooveDensities).default("medium"), ghostNotes: z.boolean().default(true),
  bars: z.union([z.literal(1), z.literal(2), z.literal(4)]).default(2).describe("Cycle length"),
  fill: z.enum(drumFills).default("snare-roll").describe("Closes each listed section")
}).strict();
export type DrumGroove = z.infer<typeof drumGrooveBody>;

const invalid = (message: string, next: string) => new NativeCorrectableError("SYMBOLIC_EDIT_INVALID", message, next);

/** Expand a groove into explicit drum notes (a Gakki kit) or step patterns (Beatbox8). */
export function compileDrumGroove(raw: DrumGroove, document: NativeDocument): NativeOperation[] {
  const groove = drumGrooveBody.parse(raw);
  const part = document.parts.find((item) => item.id === groove.partId);
  if (!part) throw new NativeUnknownIdError("part", groove.partId);
  // A pinned Gakki sound is a kit only on a percussion part; on any other role it is a pitched instrument.
  const kit = part.device.type === "gakki" && Boolean(part.device.preset) && part.role === "percussion";
  if (!kit && part.device.type !== "beatbox8") throw invalid(`${part.name} is not a drum instrument`, "Give the groove a percussion part with a drum kit (a scene part with kit) or a Beatbox8 recipe");
  const bar = barTicks(document), grid: CycleGrid = { barTicks: bar, beatTicks: NATIVE_PPQ * 4 / document.meter.denominator, beatsPerBar: document.meter.numerator };
  const sections = groove.sectionIds.map((sectionId) => { const section = document.sections.find((item) => item.id === sectionId); if (!section) throw new NativeUnknownIdError("section", sectionId); return section; });
  const existing = materializedNotes(document, part.id);
  for (const section of sections) if (existing.some((note) => note.startTick < section.endBar * bar && note.startTick + note.durationTicks > section.startBar * bar))
    throw invalid(`${part.name} already plays in ${section.name}; a groove writes new drums there`, "Use sections where this part is silent, or a new drum part");
  const info = grooveCatalog.find((item) => item.id === groove.style)!;
  // A step machine plays straight at one velocity; a kit takes the style's own swing and a light humanize.
  const feel: NativeFeel | null = kit ? nativeFeelSchema.parse({ swing: info.swing, grid: info.swingGrid, humanizeTicks: 4, humanizeVelocity: 0.03 }) : null;
  const lengthBeats = grid.beatsPerBar >= 4 ? 2 : 1;
  const ops: unknown[] = [];
  let written = part.notes.length;
  const motifIds = new Set(document.motifs.map((motif) => motif.id));
  let slots = document.motifs.filter((motif) => motif.partId === part.id).length;

  for (const section of sections) {
    const length = section.endBar - section.startBar;
    // The cycle must tile the section so its last cycle can carry the fill.
    // A Beatbox8 pattern holds at most 64 sixteenth steps.
    const bars = ([groove.bars, 2, 1] as const).find((value) => value <= groove.bars && length % value === 0 && (kit || value * bar <= 64 * 240)) ?? 1;
    const cycles = length / bars, cycleTicks = bars * bar, start = section.startBar * bar;
    const cycle = grooveHits({ style: groove.style, grid, bars, density: groove.density, ghostNotes: groove.ghostNotes, seed: [part.id, section.id] });
    const closing = groove.fill === "none" ? cycle : withFill(cycle, fillHits({ kind: groove.fill, grid, lengthBeats, seed: [part.id, section.id, "fill"] }), grid, bars);
    if (kit) {
      const notes: Array<{ id: string; startTick: number; durationTicks: number; pitch: number; velocity: number }> = [];
      for (let repeat = 0; repeat < cycles; repeat++) for (const [index, hit] of (repeat === cycles - 1 ? closing : cycle).entries()) {
        const felt = feelFor(hit.tick, hit.velocity, feel!, grid, [part.id, section.id, repeat, index]);
        const at = Math.max(start, Math.min(section.endBar * bar - 1, start + repeat * cycleTicks + hit.tick + Math.max(-120, Math.min(120, felt.offset))));
        notes.push({ id: `n-${canonicalHash([part.id, section.id, "groove", repeat, index]).slice(0, 32)}`, startTick: at, durationTicks: Math.max(1, Math.min(hit.durationTicks, section.endBar * bar - at)), pitch: hit.pitch, velocity: felt.velocity });
      }
      written += notes.length;
      if (written > 4096) throw invalid(`This groove would give ${part.name} ${written} notes (a part holds 4,096)`, "Use a lower density, fewer sections per groove, or a second drum part for the later sections");
      for (let from = 0; from < notes.length; from += 256) ops.push({ kind: "addNotes", partId: part.id, notes: notes.slice(from, from + 256) });
      continue;
    }
    // Beatbox8: one pattern for the loop and one for the closing cycle, reused by every section they fit.
    const pattern = (hits: PatternHit[], label: string) => {
      const steps = toBeatbox8(hits, cycleTicks);
      const motifId = `groove-${canonicalHash([part.id, groove.style, groove.density, bars, label, steps.map((hit) => [hit.tick, hit.pitch])]).slice(0, 12)}`;
      if (!motifIds.has(motifId)) {
        if (++slots > 5) throw invalid(`${part.name} would need more than five Beatbox8 patterns`, "Use fill none, one cycle length for every section, or a drum kit");
        motifIds.add(motifId);
        ops.push({ kind: "defineMotif", motif: { id: motifId, partId: part.id, name: `${info.id} ${label}`, lengthTicks: cycleTicks, notes: steps.map((hit, index) => ({ id: `n-${canonicalHash([motifId, index]).slice(0, 24)}`, startTick: hit.tick, durationTicks: 240, pitch: hit.pitch, velocity: 1 })) } });
      }
      return motifId;
    };
    const placement = (motifId: string, from: number, repeats: number) => ops.push({ kind: "placeMotif", partId: part.id, placement: { id: `p-${canonicalHash([part.id, section.id, motifId, from]).slice(0, 24)}`, motifId, startTick: start + from * cycleTicks, repeats, transpose: 0 } });
    const fills = groove.fill !== "none";
    if (cycles > (fills ? 1 : 0)) placement(pattern(cycle, "loop"), 0, fills ? cycles - 1 : cycles);
    if (fills) placement(pattern(closing, "fill"), cycles - 1, 1);
  }
  return z.array(nativeOperationSchema).parse(ops);
}
