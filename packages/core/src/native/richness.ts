// How much music there is, as deterministic score facts. The musicality analysis
// says what is wrong; this says what is still thin, against a target for the
// chosen depth. Targets are guidance for a full arrangement: the brief wins, and
// nothing here is a completion requirement or a claim about heard audio.
import { canonicalHash } from "../domain/hash.js";
import { barTicks, materializedNotes, type NativeDocument, type NativeNote } from "./model.js";

export type RichnessDepth = "focused" | "detailed";
export type RichnessCode = "THIN_ARRANGEMENT" | "FLAT_SECTIONS" | "NO_TRANSITIONS" | "NO_ENDING" | "STATIC_SOUND" | "SHARED_PATCH";
export interface RichnessGap { code: RichnessCode; detail: string; next: string }
export interface NativeRichness {
  depth: RichnessDepth;
  layers: { fullest: number; target: number; bySection: Record<string, number> };
  contrasts: Array<{ from: string; to: string; changed: string[] }>;
  boundaries: { marked: number; total: number };
  endingWritten: boolean;
  movement: { automation: number; sends: number };
  gaps: RichnessGap[];
}

const targets = {
  focused: { layers: 4, contrast: 2, automation: 1, sends: 0, everyBoundary: false, distinctPatches: false },
  detailed: { layers: 6, contrast: 2, automation: 2, sends: 2, everyBoundary: true, distinctPatches: true }
} as const;

const pitched = (part: NativeDocument["parts"][number]) => part.role !== "percussion" && part.device.type !== "beatbox8" && part.device.type !== "audio";
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? 0; };

export function analyzeNativeRichness(document: NativeDocument, depth: RichnessDepth): NativeRichness {
  const target = targets[depth], bar = barTicks(document);
  const notes = new Map<string, NativeNote[]>(document.parts.map((part) => [part.id, materializedNotes(document, part.id)]));
  // An audio part is a layer where one of its clips plays, although it has no notes.
  const clipsOf = (part: NativeDocument["parts"][number]) => [...part.sourceRegions, ...(part.libraryRegions ?? [])];
  const parts = document.parts.filter((part) => notes.get(part.id)!.length > 0 || clipsOf(part).length > 0);
  // Bars are compared with a timing tolerance, so humanised repeats of one phrase
  // still match; a hit pulled slightly ahead of the barline belongs to the bar it leads.
  const early = 120, tolerance = 90;
  const hitsOf = (partId: string, index: number) => notes.get(partId)!.filter((note) => note.startTick + early >= index * bar && note.startTick + early < (index + 1) * bar)
    .map((note) => ({ tick: note.startTick - index * bar, pitch: note.pitch })).sort((a, b) => a.pitch - b.pitch || a.tick - b.tick);
  const barsOf = new Map(parts.map((part) => [part.id, Array.from({ length: document.bars }, (_, index) => hitsOf(part.id, index))]));
  type Bar = ReturnType<typeof hitsOf>;
  const same = (a: Bar, b: Bar) => a.length === b.length && a.every((hit, index) => hit.pitch === b[index]!.pitch && Math.abs(hit.tick - b[index]!.tick) <= tolerance);
  const inSection = (partId: string, section: NativeDocument["sections"][number]) => notes.get(partId)!.filter((note) => note.startTick >= section.startBar * bar && note.startTick < section.endBar * bar);
  const active = (section: NativeDocument["sections"][number]) => parts.filter((part) => inSection(part.id, section).length > 0
    || clipsOf(part).some((clip) => clip.startTick < section.endBar * bar && clip.startTick + clip.durationTicks > section.startBar * bar));

  const bySection = Object.fromEntries(document.sections.map((section) => [section.id, active(section).length]));
  const fullest = Math.max(0, ...Object.values(bySection));

  // What changes from one section to the next: who plays, how much, where, and what.
  const contrasts = document.sections.slice(1).map((next, index) => {
    const previous = document.sections[index]!, before = active(previous), after = active(next), changed: string[] = [];
    const both = after.filter((part) => before.some((item) => item.id === part.id));
    if (before.length !== after.length || both.length !== after.length) changed.push("parts");
    const rate = (partId: string, section: typeof next) => inSection(partId, section).length / (section.endBar - section.startBar);
    if (both.some((part) => { const ratio = rate(part.id, next) / rate(part.id, previous); return ratio >= 1.25 || ratio <= 0.8; })) changed.push("density");
    if (both.filter((part) => pitched(part) && part.role !== "bass").some((part) => Math.abs(median(inSection(part.id, next).map((note) => note.pitch)) - median(inSection(part.id, previous).map((note) => note.pitch))) >= 3)) changed.push("register");
    const span = Math.min(previous.endBar - previous.startBar, next.endBar - next.startBar);
    if (both.some((part) => { const list = barsOf.get(part.id)!; return Array.from({ length: span }, (_, offset) => offset).some((offset) => !same(list[previous.startBar + offset]!, list[next.startBar + offset]!)); })) changed.push("material");
    return { from: previous.id, to: next.id, changed };
  });

  // A boundary is marked when a looping part breaks its loop in the last bar
  // (a fill, a pickup, a stop) or a control curve moves there. A section with
  // no looping part is through-composed and needs no mark.
  const curveTicks = document.parts.flatMap((part) => part.automation.flatMap((curve) => curve.points.map((point) => point.tick)));
  const marked = (section: NativeDocument["sections"][number]) => {
    const last = section.endBar - 1;
    const sounding = (partId: string) => barsOf.get(partId)!.slice(section.startBar, section.endBar);
    const looping = active(section).filter((part) => { const list = sounding(part.id).filter((item) => item.length > 0); return list.some((item, index) => list.some((other, at) => at < index && same(item, other))); });
    if (!looping.length) return true;
    if (curveTicks.some((tick) => tick > last * bar && tick <= section.endBar * bar)) return true;
    return looping.some((part) => { const list = sounding(part.id), final = list.at(-1)!; return !list.slice(0, -1).some((item) => same(item, final)); });
  };
  const inner = document.sections.slice(0, -1);
  const markedInner = inner.filter(marked).length;
  const endingWritten = marked(document.sections.at(-1)!);

  const automation = document.parts.reduce((sum, part) => sum + part.automation.length, 0) + (document.groups ?? []).reduce((sum, group) => sum + (group.automation?.length ?? 0), 0);
  const sends = document.parts.reduce((sum, part) => sum + (part.sends?.length ?? 0), 0);

  const gaps: RichnessGap[] = [];
  const name = (id: string) => document.sections.find((section) => section.id === id)?.name ?? id;
  if (document.bars >= 8) {
    if (fullest < target.layers) {
      const where = document.sections.find((section) => bySection[section.id] === fullest)!;
      gaps.push({ code: "THIN_ARRANGEMENT", detail: `The fullest section (${where.name}) has ${fullest} ${fullest === 1 ? "part" : "parts"}; a ${depth} arrangement usually reaches ${target.layers}`,
        next: "If the brief allows more parts, add a supporting layer the style expects: a counter-line, a pad or arpeggio (chordProgression comp), or percussion" });
    }
    const flat = contrasts.filter((pair) => pair.changed.length < target.contrast);
    if (flat.length) gaps.push({ code: "FLAT_SECTIONS", detail: `${flat.map((pair) => `${name(pair.from)} to ${name(pair.to)}`).join(", ")} ${flat.length === 1 ? "changes" : "change"} little (${flat.map((pair) => pair.changed.join("+") || "nothing").join("; ")})`,
      next: "Make the later section differ in two ways: who plays, how busy a part is, its register, or its material (an in-key variation of the phrase)" });
    if (inner.length && (target.everyBoundary ? markedInner < inner.length : markedInner === 0)) gaps.push({ code: "NO_TRANSITIONS", detail: `${inner.length - markedInner} of ${inner.length} section changes arrive with the loop unchanged in the bar before`,
      next: "Mark a change: a drum fill, a pickup into the next section, a one-bar drop, or a filter or send ramp in the last bar" });
    if (!endingWritten) gaps.push({ code: "NO_ENDING", detail: "The final bar repeats the loop, so the piece stops rather than ends",
      next: "Write an ending: a chordProgression ending chord, a held final note, or a last bar where the loop thins or stops" });
    // Focused: some movement or some shared space. Detailed: both.
    const staticSound = depth === "detailed" ? automation < target.automation || sends < target.sends : automation === 0 && sends === 0;
    if (staticSound) gaps.push({ code: "STATIC_SOUND", detail: `Nothing moves in the sound: ${automation} control ${automation === 1 ? "curve" : "curves"} and ${sends} shared-space ${sends === 1 ? "send" : "sends"}`,
      next: "Add movement or space: one or two automation curves across a section (filter, gain or an effect mix), or a shared reverb or delay with sends" });
    if (target.distinctPatches) {
      const byPatch = new Map<string, string[]>();
      for (const part of parts.filter(pitched)) { const key = canonicalHash({ type: part.device.type, parameters: part.device.parameters, preset: part.device.preset ?? null }); byPatch.set(key, [...(byPatch.get(key) ?? []), part.name]); }
      const shared = [...byPatch.values()].filter((list) => list.length > 1);
      if (shared.length) gaps.push({ code: "SHARED_PATCH", detail: `${shared.map((list) => list.join(" and ")).join("; ")} use one identical patch`, next: "Give each role its own recipe or settings so they read as different instruments" });
    }
  }
  return { depth, layers: { fullest, target: target.layers, bySection }, contrasts, boundaries: { marked: markedInner, total: inner.length }, endingWritten, movement: { automation, sends }, gaps };
}

/** The producer's per-turn form. It rides on every request, so it is codes and
 * one next step; the first finish explains every gap in full, once. */
export function richnessChecklist(analysis: NativeRichness) {
  return {
    layers: `${analysis.layers.fullest} of ${analysis.layers.target} in the fullest section`,
    stillThin: analysis.gaps.map((gap) => gap.code),
    ...(analysis.gaps[0] ? { next: analysis.gaps[0].next } : {}),
    note: "Targets, not requirements: the brief wins."
  };
}
