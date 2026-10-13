import { barTicks, materializedNotes, NATIVE_PPQ, type NativeDocument, type NativeNote } from "./model.js";
import { nameChord, nativeModes, pitchClassNames, pitchName } from "./harmony.js";

// Deterministic symbolic facts about the music: what a careful editor reading
// the score would notice. They guide the producer and the reviewer; none is a
// completion gate, and nothing here claims anything about heard sound.

export type MusicalityCode = "HARSH_OVER_BASS" | "OUT_OF_KEY" | "QUIET_MIX" | "LOOPED_PART" | "FIXED_VELOCITY" | "MECHANICAL_DRUMS" | "REGISTER_CROWDING" | "VOICE_LEAPS" | "NO_LOW_END";
export interface MusicalityIssue { code: MusicalityCode; severity: "high" | "medium" | "low"; partId?: string; sectionId?: string; detail: string; suggestion: string }
export interface NativeMusicality {
  /** An estimate. `relative` is the key with the same notes; the two are told apart by the opening bass note only. */
  key: { tonic: string; mode: "major" | "minor"; label: string; confidence: number; relative: string } | null;
  sections: Array<{ id: string; layers: number; parts: string[]; lowest: string | null; highest: string | null }>;
  /** Chord names by bar for each section, as the chord parts and bass spell them ("-" silent, "?" unnamed). */
  chords: Array<{ sectionId: string; bars: string[] }>;
  finalChord: string | null;
  issues: MusicalityIssue[];
  limits: string;
}

// Krumhansl–Kessler key profiles.
const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
function correlation(a: number[], b: number[]) {
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const ma = mean(a), mb = mean(b);
  let top = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { top += (a[i]! - ma) * (b[i]! - mb); da += (a[i]! - ma) ** 2; db += (b[i]! - mb) ** 2; }
  return da && db ? top / Math.sqrt(da * db) : 0;
}

const pitched = (part: NativeDocument["parts"][number]) => part.role !== "percussion" && part.device.type !== "beatbox8" && part.device.type !== "audio";
const bars = (list: number[]) => {
  const sorted = [...new Set(list)].sort((a, b) => a - b), out: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    out.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]));
    i = j;
  }
  return out.join(", ");
};

export function analyzeNativeMusicality(document: NativeDocument): NativeMusicality {
  const bar = barTicks(document), beat = NATIVE_PPQ * 4 / document.meter.denominator;
  const notes = new Map<string, NativeNote[]>(document.parts.map((part) => [part.id, materializedNotes(document, part.id).sort((a, b) => a.startTick - b.startTick)]));
  const parts = document.parts.filter((part) => (notes.get(part.id)?.length ?? 0) > 0);
  const sectionOf = (tick: number) => document.sections.find((section) => tick >= section.startBar * bar && tick < section.endBar * bar) ?? document.sections.at(-1)!;
  const issues: MusicalityIssue[] = [];

  // Key: duration-weighted pitch classes of pitched parts.
  const histogram = Array.from({ length: 12 }, () => 0);
  for (const part of parts.filter(pitched)) for (const note of notes.get(part.id)!) histogram[note.pitch % 12]! += note.durationTicks / beat;
  let key: NativeMusicality["key"] = null;
  let allowed: Set<number> | null = null;
  if (histogram.some(Boolean)) {
    let best = { tonic: 0, mode: "major" as "major" | "minor", r: -2 };
    for (let tonic = 0; tonic < 12; tonic++) for (const [mode, profile] of [["major", majorProfile], ["minor", minorProfile]] as const) {
      const r = correlation(histogram, profile.map((_, i) => profile[(i - tonic + 12) % 12]!));
      if (r > best.r) best = { tonic, mode, r };
    }
    // A key and its relative share every note, so note weights alone often pick
    // the wrong one of the pair (Dm7 Bbmaj7 Fmaj7 C7 weighs as F major). When the
    // relative also fits and the bass opens on its tonic, the piece is in the relative.
    const relativeOf = (of: typeof best) => ({ tonic: (of.tonic + (of.mode === "major" ? 9 : 3)) % 12, mode: of.mode === "major" ? "minor" as const : "major" as const });
    const relative = relativeOf(best);
    const relativeFit = correlation(histogram, (relative.mode === "major" ? majorProfile : minorProfile).map((_, i, profile) => profile[(i - relative.tonic + 12) % 12]!));
    const opening = parts.filter((part) => part.role === "bass" && pitched(part)).flatMap((part) => notes.get(part.id)!).sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch)[0];
    if (opening && opening.pitch % 12 === relative.tonic && relativeFit >= 0.6 && best.r - relativeFit <= 0.25) best = { ...relative, r: relativeFit };
    const other = relativeOf(best);
    key = { tonic: pitchClassNames[best.tonic]!, mode: best.mode, label: `${pitchClassNames[best.tonic]} ${best.mode}`, confidence: Number(best.r.toFixed(2)), relative: `${pitchClassNames[other.tonic]} ${other.mode}` };
    // Minor keys also admit the raised sixth and seventh (melodic/harmonic minor).
    allowed = new Set((best.mode === "major" ? [...nativeModes.major] : [...nativeModes.minor, 9, 11]).map((interval) => (best.tonic + interval) % 12));
  }

  // Bass reference: the lowest sounding bass-role note at a tick.
  const bassNotes = parts.filter((part) => part.role === "bass" && pitched(part)).flatMap((part) => notes.get(part.id)!);
  const soundingBass = (tick: number) => bassNotes.filter((note) => note.startTick <= tick && note.startTick + note.durationTicks > tick).sort((a, b) => a.pitch - b.pitch)[0];
  const allPitched = parts.filter(pitched).flatMap((part) => notes.get(part.id)!);

  for (const part of parts) {
    const list = notes.get(part.id)!;
    if (pitched(part)) {
      // Long or on-beat notes only: brief passing tones are ordinary melody.
      const weighty = list.filter((note) => note.durationTicks >= beat / 2 || note.startTick % beat === 0);
      const clashes = new Map<string, { bars: number[]; examples: string[] }>();
      const outside = new Map<string, { bars: number[]; pitches: Set<string> }>();
      for (const note of weighty) {
        const section = sectionOf(note.startTick), barNumber = Math.floor(note.startTick / bar) + 1;
        if (part.role !== "bass") {
          const under = soundingBass(note.startTick);
          if (under) {
            const interval = ((note.pitch - under.pitch) % 12 + 12) % 12;
            // A tritone over the bass belongs to diminished harmony when its minor third also sounds.
            const diminished = interval === 6 && allPitched.some((other) => other !== note && other.startTick <= note.startTick && other.startTick + other.durationTicks > note.startTick && ((other.pitch - under.pitch) % 12 + 12) % 12 === 3);
            if ((interval === 1 || interval === 6) && !diminished) {
              const entry = clashes.get(section.id) ?? { bars: [], examples: [] };
              entry.bars.push(barNumber);
              const example = `${pitchName(note.pitch)} over ${pitchName(under.pitch)}`;
              if (entry.examples.length < 3 && !entry.examples.includes(example)) entry.examples.push(example);
              clashes.set(section.id, entry);
            }
          }
        }
        if (allowed && !allowed.has(note.pitch % 12)) {
          const entry = outside.get(section.id) ?? { bars: [], pitches: new Set<string>() };
          entry.bars.push(barNumber); entry.pitches.add(pitchClassNames[note.pitch % 12]!);
          outside.set(section.id, entry);
        }
      }
      for (const [sectionId, entry] of clashes) issues.push({ code: "HARSH_OVER_BASS", severity: entry.bars.length >= 2 ? "high" : "medium", partId: part.id, sectionId,
        detail: `${part.name}: ${entry.bars.length} sustained or on-beat ${entry.bars.length === 1 ? "note forms" : "notes form"} a minor 9th or tritone over the bass in bars ${bars(entry.bars)} (${entry.examples.join("; ")})`,
        suggestion: "Unless intended as tension, move those notes to chord tones or within the key (in-key moves: key plus diatonicSteps), or change the bass under them" });
      for (const [sectionId, entry] of outside) if (entry.bars.length >= 2) issues.push({ code: "OUT_OF_KEY", severity: "medium", partId: part.id, sectionId,
        detail: `${part.name}: ${entry.bars.length} notes outside ${key?.label ?? "the key"} (${[...entry.pitches].join(", ")}) in bars ${bars(entry.bars)}`,
        suggestion: "Keep them if this is a deliberate key change or color; otherwise transpose within the key (diatonicSteps) rather than by semitones" });
    }

    // Loops: the same bar (or two-bar cell) across a section change.
    const fingerprint = (index: number) => list.filter((note) => note.startTick >= index * bar && note.startTick < (index + 1) * bar).map((note) => `${note.startTick - index * bar}:${note.pitch}:${Math.round(note.velocity * 20)}`).join(" ");
    const prints = Array.from({ length: document.bars }, (_, index) => fingerprint(index));
    const active = prints.filter(Boolean).length;
    if (active >= 8 && document.sections.length > 1) {
      const cycle = prints[1] === prints[0] ? 1 : 2;
      let run = 0;
      for (let index = cycle; index < prints.length; index++) if (prints[index] && prints[index] === prints[index - cycle]) run++;
      const repeatedAcrossSections = new Set(document.sections.filter((section) => prints.slice(section.startBar, section.endBar).some(Boolean)).map((section) => prints.slice(section.startBar, section.endBar).filter(Boolean).join("|"))).size === 1;
      if (run + cycle >= Math.max(8, active - 1) && repeatedAcrossSections) issues.push({ code: "LOOPED_PART", severity: "medium", partId: part.id,
        detail: `${part.name} repeats the same ${cycle}-bar pattern in every section (${active} bars)`,
        suggestion: "Vary it between sections: a fill or drop before a section change, a different pattern or register in a later section, or development of the phrase" });
    }

    // Expression.
    if (part.device.type === "beatbox8") {
      if (parts.length >= 3) issues.push({ code: "MECHANICAL_DRUMS", severity: "low", partId: part.id, detail: `${part.name} uses Beatbox8: fixed velocity on a straight 16th grid`,
        suggestion: "Fine for a deliberately mechanical pulse; for a groove, use an inspected Gakki drum kit (search_gm_sounds, family drums) and apply feel (swing, humanize)" });
    } else if (list.length >= 12) {
      const velocities = list.map((note) => note.velocity), spread = Math.max(...velocities) - Math.min(...velocities);
      const onGrid = list.every((note) => note.startTick % (beat / 4) === 0);
      if (part.role === "percussion" && onGrid && spread < 0.05) issues.push({ code: "MECHANICAL_DRUMS", severity: "low", partId: part.id, detail: `${part.name}: every hit is on the grid at one velocity`,
        suggestion: "Apply feel with developSectionNotes (for example swing 0.56, humanizeTicks 8, humanizeVelocity 0.08, accent backbeats)" });
      else if (spread < 0.04) issues.push({ code: "FIXED_VELOCITY", severity: "low", partId: part.id, detail: `${part.name}: all ${list.length} notes share one velocity (${velocities[0]!.toFixed(2)})`,
        suggestion: "Shape dynamics: accent phrase starts, soften repeats, or apply feel humanizeVelocity" });
    }
  }

  // Texture per section: layers, register extremes and crowding.
  const sections = document.sections.map((section) => {
    const start = section.startBar * bar, end = section.endBar * bar;
    const present = parts.filter((part) => notes.get(part.id)!.some((note) => note.startTick < end && note.startTick + note.durationTicks > start));
    const sounding = present.filter(pitched).flatMap((part) => notes.get(part.id)!.filter((note) => note.startTick >= start && note.startTick < end));
    const sustained = present.filter((part) => pitched(part) && part.role !== "bass").map((part) => {
      const inside = notes.get(part.id)!.filter((note) => note.startTick >= start && note.startTick < end).map((note) => note).sort((a, b) => a.pitch - b.pitch);
      return { part, inside, median: inside.length ? inside[Math.floor(inside.length / 2)]!.pitch : 0, meanDuration: inside.length ? inside.reduce((sum, note) => sum + note.durationTicks, 0) / inside.length : 0 };
    }).filter((entry) => entry.inside.length >= 4 && entry.meanDuration >= beat);
    for (let i = 0; i < sustained.length; i++) for (let j = i + 1; j < sustained.length; j++) {
      const a = sustained[i]!, b = sustained[j]!;
      if (Math.abs(a.median - b.median) <= 2) issues.push({ code: "REGISTER_CROWDING", severity: "low", sectionId: section.id,
        detail: `${a.part.name} and ${b.part.name} hold notes around the same register (${pitchName(a.median)} and ${pitchName(b.median)}) in ${section.name}`,
        suggestion: "Separate them by about an octave, thin one of them, or give one a different rhythm" });
    }
    return { id: section.id, layers: present.length, parts: present.map((part) => part.id),
      lowest: sounding.length ? pitchName(Math.min(...sounding.map((note) => note.pitch))) : null, highest: sounding.length ? pitchName(Math.max(...sounding.map((note) => note.pitch))) : null };
  });

  // Chord parts: average voice movement between consecutive chords.
  for (const part of parts.filter((item) => pitched(item) && (item.role === "harmony" || item.role === "texture"))) {
    const byOnset = new Map<number, number[]>();
    for (const note of notes.get(part.id)!) byOnset.set(note.startTick, [...(byOnset.get(note.startTick) ?? []), note.pitch]);
    const chords = [...byOnset.entries()].filter(([, pitches]) => pitches.length >= 3).sort(([a], [b]) => a - b).map(([, pitches]) => pitches.sort((a, b) => a - b));
    const moves: number[] = [];
    for (let i = 1; i < chords.length; i++) if (chords[i]!.length === chords[i - 1]!.length && chords[i]!.join() !== chords[i - 1]!.join()) moves.push(chords[i]!.reduce((sum, pitch, v) => sum + Math.abs(pitch - chords[i - 1]![v]!), 0) / chords[i]!.length);
    const average = moves.length ? moves.reduce((sum, value) => sum + value, 0) / moves.length : 0;
    if (moves.length >= 3 && average > 5) issues.push({ code: "VOICE_LEAPS", severity: "low", partId: part.id, detail: `${part.name}: voices jump about ${average.toFixed(1)} semitones per chord change`,
      suggestion: "Voice the chords closer so each voice moves by a step or two (a chordProgression comp voices them automatically)" });
  }

  if (!parts.some((part) => part.role === "bass") && allPitched.length && Math.min(...allPitched.map((note) => note.pitch)) >= 48 && parts.length >= 2)
    issues.push({ code: "NO_LOW_END", severity: "low", detail: "No part plays below C3, so the arrangement has no bass register", suggestion: "Add a bass line or let one part reach the low register, unless the brief wants a weightless texture" });

  // Chords by bar, named from what the chord parts and the bass actually play,
  // so a reader never has to work out a chord from pitch numbers.
  const chordNotes = parts.filter((part) => pitched(part) && (part.role === "harmony" || part.role === "texture")).flatMap((part) => notes.get(part.id)!);
  const named = (from: number, to: number) => {
    const inside = chordNotes.filter((note) => note.startTick < to - beat / 4 && note.startTick + note.durationTicks > from + beat / 4);
    if (!inside.length) return "-";
    const under = soundingBass(from + beat / 4) ?? soundingBass(from) ?? bassNotes.filter((note) => note.startTick >= from && note.startTick < to).sort((a, b) => a.startTick - b.startTick)[0];
    return nameChord(inside.map((note) => note.pitch), under?.pitch) ?? "?";
  };
  const barChord = (index: number) => {
    const from = index * bar, half = from + bar / 2, to = from + bar, plain = (name: string) => name !== "?" && name !== "-";
    // Two chords in one bar are two names; their notes together would spell a third chord that is not there.
    const first = named(from, half), second = named(half, to);
    if (plain(first) && plain(second) && first !== second) return `${first} ${second}`;
    const whole = named(from, to);
    if (whole !== "?") return whole;
    return plain(first) || plain(second) ? `${first} ${second}` : "?";
  };
  const chords = chordNotes.length ? document.sections.map((section) => ({ sectionId: section.id, bars: Array.from({ length: section.endBar - section.startBar }, (_, offset) => barChord(section.startBar + offset)) })) : [];
  // The last chord that sounds; null when it is not a plain chord.
  const lastChord = chords.flatMap((entry) => entry.bars).filter((name) => name !== "-").at(-1)?.split(" ").filter((name) => name !== "-").at(-1);
  const finalChord = lastChord && lastChord !== "?" ? lastChord : null;

  // Level: nothing here was heard, but every part playing softly at a low gain
  // is a mix that reads as near-silent once copied. Velocity scales loudness on
  // these instruments; Beatbox8 always plays at full velocity.
  const levels = parts.map((part) => { const list = notes.get(part.id)!; return { part, level: part.gain * (part.device.type === "beatbox8" ? 1 : list.reduce((sum, note) => sum + note.velocity, 0) / list.length) }; }).sort((a, b) => b.level - a.level);
  // An audio clip's level is in its recording, which the score cannot read.
  const hasAudio = document.parts.some((part) => part.sourceRegions.length > 0 || (part.libraryRegions?.length ?? 0) > 0);
  if (!hasAudio && levels[0] && levels[0].level < 0.2) issues.push({ code: "QUIET_MIX", severity: "medium", partId: levels[0].part.id,
    detail: `The whole mix is very quiet: the loudest part (${levels[0].part.name}) plays at about ${Math.round(levels[0].level * 100)}% of full level (gain × average velocity)`,
    suggestion: "Raise note velocities (melodies usually 0.6–0.9) or part gains (0.5–0.75); keep the balance between parts" });

  const order = { high: 0, medium: 1, low: 2 };
  return { key, sections, chords, finalChord, issues: issues.sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 10),
    limits: "Symbolic score facts only. Intentional tension, chromatic color, repetition or sparseness can be valid; nothing here was heard." };
}

/** Review evidence: the key, issues and limits. Section layers and ranges are
 * already in the review's own section facts, so they are not repeated. */
export function musicalityReviewEvidence(analysis: NativeMusicality) {
  // Repeated bars collapse ("Dm7 x2"), so a long section stays one short line.
  const line = (bars: string[]) => bars.reduce<Array<{ name: string; count: number }>>((runs, name) => { const last = runs.at(-1); if (last?.name === name) last.count++; else runs.push({ name, count: 1 }); return runs; }, []).map((run) => run.count > 1 ? `${run.name} x${run.count}` : run.name).join(" | ");
  return { key: analysis.key, chordsByBar: Object.fromEntries(analysis.chords.map((entry) => [entry.sectionId, line(entry.bars)])), finalChord: analysis.finalChord, issues: analysis.issues, limits: analysis.limits };
}

/** A compact form for the producer's per-turn checklist. */
export function musicalityChecklist(analysis: NativeMusicality) {
  return {
    key: analysis.key ? `${analysis.key.label} (fit ${analysis.key.confidence})` : null,
    ...(analysis.finalChord ? { finalChord: analysis.finalChord } : {}),
    layersBySection: Object.fromEntries(analysis.sections.map((section) => [section.id, section.layers])),
    notes: analysis.issues.slice(0, 5).map((issue) => `${issue.code}: ${issue.detail}. ${issue.suggestion}.`),
    caveat: "Score facts, not requirements."
  };
}
