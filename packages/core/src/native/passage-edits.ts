import { z } from "zod";
import { canonicalHash } from "../domain/hash.js";
import { NativeCorrectableError } from "./errors.js";
import { applyNativeOperations, barTicks, materializedNotes, type NativeDocument, type NativeNote, type NativeOperation, type NativePart } from "./model.js";
import type { NativeReview } from "./critique.js";

const id = z.string().min(1).max(64);
export const passageEdit = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("thin"), partIds: z.array(id).min(1).max(12) }),
  z.object({ kind: z.literal("land"), voices: z.array(z.object({ partId: id, pitches: z.array(z.int().min(0).max(127)).max(8) })).min(1).max(12) }),
  z.object({ kind: z.literal("reuseKitPattern"), partId: id, motifId: id, offsetBars: z.int().min(0).max(255).default(0), repeats: z.int().min(1).max(64) }),
  z.object({ kind: z.literal("restKitSection"), partId: id })
]);
const bad = (message: string) => new NativeCorrectableError("SYMBOLIC_EDIT_INVALID", message, "Inspect the phrase and choose the intended editable parts.");
type Placement = NativePart["placements"][number];

/** A raw kit replacement after a section-specific review can accidentally list
 * only the visible placements. Detect complete losses outside the requested repair. */
export function checkReviewedKitReplacement(doc: NativeDocument, ops: NativeOperation[], review: NativeReview | null) {
  if (!review || !ops.some(op => op.kind === "replacePlacements")) return;
  const findings = review.findings.filter(f => f.priority !== "low");
  const part = doc.parts.find(p => p.id === findings[0]?.partId);
  if (part?.device.type !== "beatbox8" || findings.some(f => f.partId !== part.id || !f.sectionId)) return;
  if (!ops.some(op => op.kind === "replacePlacements" && op.partId === part.id) || review.documentHash !== canonicalHash(doc)) return;
  if (ops.some(op => op.kind === "setStructure" || op.kind === "setMeter" || (op.kind === "removePart" && op.partId === part.id))) return;
  const otherSections = doc.sections.filter(s => !findings.some(f => f.sectionId === s.id));
  if (!otherSections.length) return;
  const before = materializedNotes(doc, part.id);
  const after = materializedNotes(applyNativeOperations(doc, ops), part.id);
  const bar = barTicks(doc);
  const lost = otherSections.filter(s => {
    const inside = (n: NativeNote) => n.startTick >= s.startBar * bar && n.startTick < s.endBar * bar;
    return before.some(inside) && !after.some(inside);
  });
  if (lost.length) throw new NativeCorrectableError("SYMBOLIC_EDIT_INVALID",
    `Replacing every placement on ${part.name} would also silence ${lost.map(s => s.name).join(", ")} outside the review's sections.`,
    "Keep those placements. Use edit_native_passage for a local groove or restKitSection for a deliberate section rest, or retain the reviewed score.");
}

// Detach only repetitions touched by the edit. Intact phrases on either side
// keep their motifs. A section boundary can fall inside a melodic repetition.
function splitPlacements(doc: NativeDocument, part: NativePart, start: number, end: number) {
  const kept: Placement[] = [], affected: Placement[] = [];
  for (const p of part.placements) {
    const motif = doc.motifs.find(m => m.id === p.motifId)!;
    const length = motif.lengthTicks;
    if (p.startTick >= end || p.startTick + length * p.repeats <= start) { kept.push(p); continue; }
    if (doc.protectedMotifIds.includes(p.motifId)) throw bad("This passage contains a protected phrase.");
    const left = Math.max(0, Math.floor((start - p.startTick) / length));
    const right = Math.min(p.repeats, Math.ceil((end - p.startTick) / length));
    const piece = (first: number, repeats: number): Placement => ({
      ...p,
      id: first === 0 ? p.id : "p-" + canonicalHash([p.id, first]).slice(0, 24), startTick: p.startTick + first * length, repeats
    });
    if (left) kept.push(piece(0, left));
    affected.push(piece(left, right - left));
    if (right < p.repeats) kept.push(piece(right, p.repeats - right));
  }
  return { kept, affected };
}

function thinner(notes: NativeNote[], start: number, bar: number) {
  const onsets = new Map<number, Set<number>>();
  for (const n of notes) {
    const index = Math.floor((n.startTick - start) / bar);
    const ticks = onsets.get(index) ?? new Set<number>();
    ticks.add(n.startTick);
    onsets.set(index, ticks);
  }
  const remove = new Set<number>();
  for (const ticks of onsets.values()) {
    const ordered = [...ticks].sort((a, b) => a - b);
    // Remove the turnaround attack, retaining the first attack and whole voicings.
    if (ordered.length > 1) remove.add(ordered.at(-1)!);
  }
  return notes.filter(n => !remove.has(n.startTick));
}

function thinKit(doc: NativeDocument, part: NativePart, affected: Placement[], start: number, end: number): NativeOperation[] {
  const ops: NativeOperation[] = [];
  const motifs = doc.motifs.filter(m => m.partId === part.id);
  const edited = new Map<string, string>();
  for (const p of affected) {
    const motif = motifs.find(m => m.id === p.motifId)!;
    const finish = p.startTick + motif.lengthTicks * p.repeats;
    if (p.startTick < start || finish > end) throw bad("Split the drum phrase on a repetition boundary for this edit.");
    const hats = motif.notes.filter(n => n.pitch === 42);
    const lastHat = hats.length > 1 ? Math.max(...hats.map(n => n.startTick)) : -1;
    const notes = motif.notes.filter(n => n.pitch !== 46 && !(n.pitch === 42 && (n.startTick % 960 === 0 || n.startTick === lastHat)));
    if (notes.length === motif.notes.length || !notes.length) continue;
    if (!edited.has(motif.id)) {
      const same = (a: NativeNote[]) => a.map(n => [n.startTick, n.pitch]).sort((l, r) => l[0]! - r[0]! || l[1]! - r[1]!);
      const existing = motifs.find(m => m.lengthTicks === motif.lengthTicks && canonicalHash(same(m.notes)) === canonicalHash(same(notes)));
      if (existing) edited.set(motif.id, existing.id);
      else {
        const onlyHere = part.placements.filter(x => x.motifId === motif.id).every(x => x.startTick >= start && x.startTick + x.repeats * motif.lengthTicks <= end);
        if (!onlyHere && motifs.length >= 5) throw bad("All five drum slots are in use and this pattern also plays elsewhere. Use reuseKitPattern for a lighter existing groove, or restKitSection if this section should be silent.");
        if (onlyHere) {
          ops.push({ kind: "replaceMotif", motif: { ...motif, notes } });
          edited.set(motif.id, motif.id);
        } else {
          const variant = {
            ...motif, id: "kit-" + canonicalHash([motif.id, notes]).slice(0, 24), name: "Thinned hats",
            derivedFromMotifId: motif.id, familyId: motif.familyId ?? motif.id, notes
          };
          ops.push({ kind: "defineMotif", motif: variant });
          motifs.push(variant);
          edited.set(motif.id, variant.id);
        }
      }
    }
    p.motifId = edited.get(motif.id)!;
  }
  return ops;
}

export function editPassage(doc: NativeDocument, sectionId: string, edit: z.infer<typeof passageEdit>): NativeOperation[] {
  const section = doc.sections.find(s => s.id === sectionId);
  if (!section) throw bad("Unknown section " + sectionId);
  const bar = barTicks(doc), end = section.endBar * bar;
  const placementEnd = (p: Placement) => p.startTick + p.repeats * doc.motifs.find(m => m.id === p.motifId)!.lengthTicks;
  if (edit.kind === "restKitSection") {
    const part = doc.parts.find(p => p.id === edit.partId);
    if (part?.device.type !== "beatbox8" || doc.protectedPartIds.includes(part.id)) throw bad("Choose an editable Beatbox8 part.");
    const start = section.startBar * bar;
    const { kept, affected } = splitPlacements(doc, part, start, end);
    if (!affected.length) throw bad("The drum section is already silent.");
    if (affected.some(p => p.startTick < start || placementEnd(p) > end)) throw bad("A drum repetition crosses this section boundary. Keep it or choose a complete repetition.");
    return [{ kind: "replacePlacements", partId: part.id, placements: kept }];
  }
  if (edit.kind === "reuseKitPattern") {
    const part = doc.parts.find(p => p.id === edit.partId);
    const motif = doc.motifs.find(m => m.id === edit.motifId && m.partId === edit.partId);
    if (part?.device.type !== "beatbox8" || !motif?.notes.length) throw bad("Choose an existing nonempty pattern on the same Beatbox8 part.");
    if (doc.protectedPartIds.includes(part.id)) throw bad("Part " + part.id + " is protected.");
    const from = (section.startBar + edit.offsetBars) * bar;
    const to = from + motif.lengthTicks * edit.repeats;
    if (to > end) throw bad("The requested repetitions extend beyond the selected section.");
    const { kept, affected } = splitPlacements(doc, part, from, to);
    if (affected.some(p => p.startTick < from || placementEnd(p) > to)) throw bad("Choose complete drum repetitions so the surrounding groove is preserved.");
    const ordered = affected.sort((a, b) => a.startTick - b.startTick);
    if (ordered.length && ordered.every((p, i) => p.motifId === motif.id && p.startTick === (i ? placementEnd(ordered[i - 1]!) : from)) && placementEnd(ordered.at(-1)!) === to)
      throw bad("This pattern already fills the selected passage.");
    const placement = { id: "kit-" + canonicalHash([part.id, motif.id, from, to]).slice(0, 24), motifId: motif.id, startTick: from, repeats: edit.repeats, transpose: 0 };
    return [{ kind: "replacePlacements", partId: part.id, placements: [...kept, placement].sort((a, b) => a.startTick - b.startTick) }];
  }
  const start = edit.kind === "land" ? end - bar : section.startBar * bar;
  const voices = edit.kind === "land" ? edit.voices : edit.partIds.map(partId => ({ partId, pitches: [] }));
  if (new Set(voices.map(v => v.partId)).size !== voices.length) throw bad("Select each part once.");
  const ops: NativeOperation[] = [];
  for (const voice of voices) {
    const part = doc.parts.find(p => p.id === voice.partId);
    if (!part || part.device.type === "audio") throw bad("Select an editable instrument for " + voice.partId);
    if (doc.protectedPartIds.includes(part.id)) throw bad("Part " + part.id + " is protected.");
    if (new Set(voice.pitches).size !== voice.pitches.length) throw bad("Landing pitches must be distinct.");
    const { kept, affected } = splitPlacements(doc, part, start, end);
    if (part.device.type === "beatbox8") {
      if (edit.kind === "thin") ops.push(...thinKit(doc, part, affected, start, end));
      else if (voice.pitches.length || affected.some(p => p.startTick < start || placementEnd(p) > end))
        throw bad("For a step kit use an empty landing and a complete repetition boundary.");
      const placements = [...kept, ...(edit.kind === "thin" ? affected : [])].sort((a, b) => a.startTick - b.startTick);
      if (canonicalHash(placements) !== canonicalHash(part.placements)) ops.push({ kind: "replacePlacements", partId: part.id, placements });
      continue;
    }
    const notes = materializedNotes({ ...doc, parts: [{ ...part, placements: affected }] }, part.id);
    const inside = notes.filter(n => n.startTick >= start && n.startTick < end);
    if (edit.kind === "land" && !inside.length && !voice.pitches.length && !affected.length
      && !notes.some(n => n.startTick < start && n.startTick + n.durationTicks > start)) continue;
    const retained = edit.kind === "thin" ? new Set(part.role === "percussion"
      ? inside.filter(n => n.pitch !== 46 && !(n.pitch === 42 && n.startTick % 960 === 0))
      : thinner(inside, start, bar)) : undefined;
    const replacement = retained ? inside.filter(n => retained.has(n) || n.startTick + n.durationTicks > end) : voice.pitches.map(pitch => ({
      id: "land-" + canonicalHash([sectionId, part.id, pitch]).slice(0, 24), pitch, startTick: start, durationTicks: bar - 1, velocity: inside[0]?.velocity ?? .66
    }));
    if (edit.kind === "thin" && replacement.length === inside.length) continue;
    const outside = notes.filter(n => n.startTick < start || n.startTick >= end).map(n =>
      edit.kind === "land" && n.startTick < start && n.startTick + n.durationTicks > start ? { ...n, durationTicks: start - n.startTick } : n);
    if (edit.kind === "land" && notes.some(n => n.startTick < end && n.startTick + n.durationTicks > end))
      throw bad("A note sustains into the next section. Choose a landing without an outgoing tie.");
    if (affected.length) ops.push({ kind: "replacePlacements", partId: part.id, placements: kept });
    ops.push({ kind: "replaceNotes", partId: part.id, notes: [...outside, ...replacement] });
  }
  if (!ops.length) throw bad("The selected passage is already sparse or silent.");
  return ops;
}
