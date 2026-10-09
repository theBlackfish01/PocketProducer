import { z } from "zod";
import { canonicalHash } from "../domain/hash.js";

// Deterministic music theory for the producer's symbolic tools. The model makes
// musical choices (key, chord symbols, pattern, feel); this module turns them
// into exact pitches and ticks, so a smaller model never does pitch arithmetic.
// Results are expanded into ordinary validated operations and stored explicitly.

export const pitchClassNames = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"] as const;
const letters: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const pitchName = (pitch: number) => `${pitchClassNames[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`;

/** "C", "F#", "Bb" → pitch class; null when unreadable. */
export function parsePitchClass(name: string): number | null {
  const match = /^([A-Ga-g])(#|b)?$/.exec(name.trim());
  if (!match) return null;
  return (letters[match[1]!.toUpperCase()]! + (match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0) + 12) % 12;
}

export const nativeModes = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10], locrian: [0, 1, 3, 5, 6, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11], melodicMinor: [0, 2, 3, 5, 7, 9, 11]
} as const;
export type NativeMode = keyof typeof nativeModes;
export const nativeScaleSchema = z.object({
  tonic: z.string().regex(/^[A-G](#|b)?$/).describe("Key tonic letter, for example D, Bb or F#"),
  mode: z.enum(Object.keys(nativeModes) as [NativeMode, ...NativeMode[]])
}).strict();
export type NativeScale = z.infer<typeof nativeScaleSchema>;
/** A key on the tool wire: "D minor", "Bb dorian", "F# harmonicMinor". One short
 * string keeps every tool schema that offers a key small. */
export const nativeKeySchema = z.string().regex(new RegExp(`^[A-G][#b]? (${Object.keys(nativeModes).join("|")})$`)).describe('For example "D minor" or "Bb dorian"');
export function scaleOf(key: string): NativeScale {
  const [tonic, mode] = key.split(" ");
  return nativeScaleSchema.parse({ tonic, mode });
}
const tonicOf = (scale: NativeScale) => parsePitchClass(scale.tonic)!;
export const scalePitchClasses = (scale: NativeScale) => nativeModes[scale.mode].map((interval) => (tonicOf(scale) + interval) % 12);

// Replay contract: varyMotifInstance and developSectionNotes store key/diatonicSteps/
// invertAround/feel as parameters and evaluate them on every replay, so
// diatonicShift, diatonicInvert, scalePitchClasses, feelFor and their seeds are part
// of stored history. Changing their results needs a new operation field or version,
// never an in-place edit, or in-flight jobs stop as NATIVE_HISTORY_INCONSISTENT.

/** A pitch as an absolute scale degree plus its chromatic distance above that degree. */
function toDegree(pitch: number, scale: NativeScale): { degree: number; offset: number } {
  const intervals = nativeModes[scale.mode];
  const relative = pitch - tonicOf(scale);
  const octave = Math.floor(relative / 12), within = relative - octave * 12;
  let index = 0;
  for (let i = 0; i < intervals.length; i++) if (intervals[i]! <= within) index = i;
  return { degree: octave * 7 + index, offset: within - intervals[index]! };
}
function fromDegree(degree: number, offset: number, scale: NativeScale): number {
  const octave = Math.floor(degree / 7), index = degree - octave * 7;
  return tonicOf(scale) + octave * 12 + nativeModes[scale.mode][index]! + offset;
}

/** Move a pitch by scale steps, staying in the key (a chromatic note keeps its offset). */
export function diatonicShift(pitch: number, scale: NativeScale, steps: number): number {
  const { degree, offset } = toDegree(pitch, scale);
  return fromDegree(degree + steps, offset, scale);
}

/** Mirror a pitch around an axis within the key (melodic inversion). */
export function diatonicInvert(pitch: number, scale: NativeScale, axisPitch: number): number {
  const note = toDegree(pitch, scale), axis = toDegree(axisPitch, scale);
  return fromDegree(2 * axis.degree - note.degree, note.offset, scale);
}

// ---------------------------------------------------------------------------
// Chord symbols

type ToneRole = "root" | "third" | "fifth" | "sixth" | "seventh" | "ninth" | "eleventh" | "thirteenth" | "sus";
export interface NativeChord { symbol: string; root: number; bass: number; quality: "major" | "minor" | "diminished" | "augmented" | "suspended" | "dominant"; tones: Array<{ interval: number; role: ToneRole }> }

const qualities: Record<string, { quality: NativeChord["quality"]; intervals: number[] }> = {
  "": { quality: "major", intervals: [0, 4, 7] }, maj: { quality: "major", intervals: [0, 4, 7] }, M: { quality: "major", intervals: [0, 4, 7] },
  m: { quality: "minor", intervals: [0, 3, 7] }, min: { quality: "minor", intervals: [0, 3, 7] }, "-": { quality: "minor", intervals: [0, 3, 7] },
  dim: { quality: "diminished", intervals: [0, 3, 6] }, "°": { quality: "diminished", intervals: [0, 3, 6] }, o: { quality: "diminished", intervals: [0, 3, 6] },
  aug: { quality: "augmented", intervals: [0, 4, 8] }, "+": { quality: "augmented", intervals: [0, 4, 8] },
  sus2: { quality: "suspended", intervals: [0, 2, 7] }, sus4: { quality: "suspended", intervals: [0, 5, 7] }, sus: { quality: "suspended", intervals: [0, 5, 7] },
  "6": { quality: "major", intervals: [0, 4, 7, 9] }, m6: { quality: "minor", intervals: [0, 3, 7, 9] }, "69": { quality: "major", intervals: [0, 4, 7, 9, 14] }, "6/9": { quality: "major", intervals: [0, 4, 7, 9, 14] },
  "7": { quality: "dominant", intervals: [0, 4, 7, 10] }, maj7: { quality: "major", intervals: [0, 4, 7, 11] }, M7: { quality: "major", intervals: [0, 4, 7, 11] }, "Δ": { quality: "major", intervals: [0, 4, 7, 11] }, "Δ7": { quality: "major", intervals: [0, 4, 7, 11] }, ma7: { quality: "major", intervals: [0, 4, 7, 11] },
  m7: { quality: "minor", intervals: [0, 3, 7, 10] }, min7: { quality: "minor", intervals: [0, 3, 7, 10] }, "-7": { quality: "minor", intervals: [0, 3, 7, 10] }, mmaj7: { quality: "minor", intervals: [0, 3, 7, 11] }, mM7: { quality: "minor", intervals: [0, 3, 7, 11] },
  m7b5: { quality: "diminished", intervals: [0, 3, 6, 10] }, "ø": { quality: "diminished", intervals: [0, 3, 6, 10] }, "ø7": { quality: "diminished", intervals: [0, 3, 6, 10] },
  dim7: { quality: "diminished", intervals: [0, 3, 6, 9] }, "°7": { quality: "diminished", intervals: [0, 3, 6, 9] }, o7: { quality: "diminished", intervals: [0, 3, 6, 9] },
  "7sus4": { quality: "suspended", intervals: [0, 5, 7, 10] }, "7sus": { quality: "suspended", intervals: [0, 5, 7, 10] },
  "9": { quality: "dominant", intervals: [0, 4, 7, 10, 14] }, maj9: { quality: "major", intervals: [0, 4, 7, 11, 14] }, M9: { quality: "major", intervals: [0, 4, 7, 11, 14] },
  m9: { quality: "minor", intervals: [0, 3, 7, 10, 14] }, min9: { quality: "minor", intervals: [0, 3, 7, 10, 14] }, "-9": { quality: "minor", intervals: [0, 3, 7, 10, 14] },
  add9: { quality: "major", intervals: [0, 4, 7, 14] }, add2: { quality: "major", intervals: [0, 4, 7, 14] }, madd9: { quality: "minor", intervals: [0, 3, 7, 14] },
  "11": { quality: "dominant", intervals: [0, 7, 10, 14, 17] }, m11: { quality: "minor", intervals: [0, 3, 7, 10, 14, 17] },
  "13": { quality: "dominant", intervals: [0, 4, 7, 10, 14, 21] }, maj13: { quality: "major", intervals: [0, 4, 7, 11, 14, 21] }, m13: { quality: "minor", intervals: [0, 3, 7, 10, 14, 21] },
  "7b9": { quality: "dominant", intervals: [0, 4, 7, 10, 13] }, "7#9": { quality: "dominant", intervals: [0, 4, 7, 10, 15] }, "7#11": { quality: "dominant", intervals: [0, 4, 7, 10, 18] }
};
export const supportedChordSuffixes = Object.keys(qualities).filter(Boolean);

function role(interval: number, quality: NativeChord["quality"]): ToneRole {
  if (interval === 0) return "root";
  if (interval === 3 || interval === 4) return "third";
  if (interval === 2 || interval === 5) return "sus";
  if (interval >= 6 && interval <= 8) return "fifth";
  if (interval === 9) return quality === "diminished" ? "seventh" : "sixth";
  if (interval === 10 || interval === 11) return "seventh";
  if (interval >= 13 && interval <= 15) return "ninth";
  if (interval === 17 || interval === 18) return "eleventh";
  return "thirteenth";
}

/** Parse a chord symbol such as Dm9, Bbmaj7, F#m7b5, G7sus4, C/E or Ab6/9. */
export function parseChordSymbol(symbol: string): NativeChord {
  const clean = symbol.trim().replace(/[()]/g, "");
  const slash = /^(.*)\/([A-G](?:#|b)?)$/.exec(clean);
  const body = slash && !clean.endsWith("6/9") ? slash[1]! : clean;
  const match = /^([A-G])(#|b)?(.*)$/.exec(body);
  const known = match ? qualities[match[3]!] : undefined;
  if (!match || !known) throw new Error(`Unreadable chord symbol "${symbol}". Use a root such as C, F# or Bb followed by one of: ${supportedChordSuffixes.slice(0, 40).join(", ")}; an optional /bass note.`);
  const root = parsePitchClass(`${match[1]}${match[2] ?? ""}`)!;
  const bass = slash && !clean.endsWith("6/9") ? parsePitchClass(slash[2]!)! : root;
  return { symbol, root, bass, quality: known.quality, tones: known.intervals.map((interval) => ({ interval, role: role(interval, known.quality) })) };
}

export type ChordExtensions = "as-written" | "sevenths" | "ninths";
/** Chord tones to voice, in priority order. Enrichment uses the key's own scale
 * tones when a key is given (diatonic sevenths/ninths), otherwise the quality. */
function chordTones(chord: NativeChord, extensions: ChordExtensions, scale?: NativeScale): Array<{ interval: number; role: ToneRole }> {
  const tones = [...chord.tones];
  const has = (wanted: ToneRole) => tones.some((tone) => tone.role === wanted);
  const inKey = (interval: number) => !scale || scalePitchClasses(scale).includes((chord.root + interval) % 12);
  if (extensions !== "as-written" && !has("seventh") && !has("sixth") && chord.quality !== "augmented") {
    const options = chord.quality === "major" ? [11, 10] : chord.quality === "diminished" ? [10, 9] : [10, 11];
    const seventh = options.find(inKey) ?? options[0]!;
    tones.push({ interval: seventh, role: "seventh" });
  }
  if (extensions === "ninths" && !has("ninth") && chord.quality !== "diminished" && inKey(14)) tones.push({ interval: 14, role: "ninth" });
  const priority: ToneRole[] = ["third", "sus", "seventh", "sixth", "ninth", "eleventh", "thirteenth", "fifth", "root"];
  return tones.sort((a, b) => priority.indexOf(a.role) - priority.indexOf(b.role));
}

export type VoicingStyle = "close" | "open" | "shell";
export const voicingRegisters = { low: [43, 64], mid: [52, 76], high: [60, 84] } as const;
export interface VoicingOptions { register: readonly [number, number]; voices: number; style: VoicingStyle; extensions: ChordExtensions; scale?: NativeScale }

/** Pitch-class choice for one chord, before octave placement. */
function voicePitchClasses(chord: NativeChord, options: VoicingOptions): number[] {
  const tones = chordTones(chord, options.extensions, options.scale);
  const count = options.style === "shell" ? Math.min(options.voices, 3) : options.voices;
  const chosen: number[] = [];
  for (const tone of tones) { const pc = (chord.root + tone.interval) % 12; if (!chosen.includes(pc)) chosen.push(pc); if (chosen.length === count) break; }
  // A small chord fills remaining voices with its root and fifth again (octave doublings).
  const doublings = [chord.root, (chord.root + 7) % 12];
  for (let i = 0; chosen.length < count && i < 4; i++) chosen.push(doublings[i % 2]!);
  return chosen;
}

/** Voice a progression with smooth voice leading inside the register: each chord
 * takes the placement closest to the previous chord, so voices move by small steps. */
export function voiceProgression(chords: NativeChord[], options: VoicingOptions): number[][] {
  const [low, high] = options.register, center = (low + high) / 2;
  const maxSpan = options.style === "open" ? 28 : 19;
  const result: number[][] = [];
  let previous: number[] | null = null;
  for (const chord of chords) {
    const classes = voicePitchClasses(chord, options);
    const candidates = classes.map((pc) => { const list: number[] = []; for (let pitch = low; pitch <= high; pitch++) if (pitch % 12 === pc) list.push(pitch); return list; });
    if (candidates.some((list) => !list.length)) throw new Error(`Register ${pitchName(low)}–${pitchName(high)} cannot hold ${chord.symbol}`);
    let best: number[] | null = null, bestScore = Infinity;
    const walk = (index: number, picked: number[]) => {
      if (index === candidates.length) {
        const sorted = [...picked].sort((a, b) => a - b);
        if (new Set(sorted).size !== sorted.length) return;
        const span = sorted.at(-1)! - sorted[0]!;
        if (span > maxSpan) return;
        // Keep low voices apart: close intervals below E3 turn to mud.
        if (sorted.length > 1 && sorted[0]! < 52 && sorted[1]! - sorted[0]! < 3) return;
        const mean = sorted.reduce((sum, pitch) => sum + pitch, 0) / sorted.length;
        let score = Math.abs(mean - center) * (previous ? 0.15 : 1);
        if (previous) {
          const reference = previous;
          score += sorted.reduce((sum, pitch, i) => sum + Math.abs(pitch - reference[Math.min(i, reference.length - 1)]!), 0);
        }
        if (options.style === "open") score += Math.max(0, 14 - span) * 0.5;
        if (score < bestScore) { bestScore = score; best = sorted; }
        return;
      }
      for (const pitch of candidates[index]!) walk(index + 1, [...picked, pitch]);
    };
    walk(0, []);
    if (!best) throw new Error(`No ${options.style} voicing of ${chord.symbol} fits ${pitchName(low)}–${pitchName(high)}`);
    result.push(best);
    previous = best;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Rhythm: comping and bass patterns over a cycle of chords

export const compPatterns = ["sustain", "stabs", "backbeat", "pulse-quarters", "pulse-eighths", "arpeggio-up", "arpeggio-updown", "broken", "waltz"] as const;
export const bassPatterns = ["roots", "root-fifth", "syncopated", "pulse-eighths", "octaves", "walking"] as const;
export type CompPattern = typeof compPatterns[number];
export type BassPattern = typeof bassPatterns[number];
export interface PatternHit { tick: number; durationTicks: number; pitch: number; velocity: number }
export interface CycleGrid { barTicks: number; beatTicks: number; beatsPerBar: number }
export interface ChordSpan { startTick: number; endTick: number; chord: NativeChord; voicing: number[] }

const clampVelocity = (value: number) => Math.min(1, Math.max(0.01, Number(value.toFixed(3))));

/** Hits for a comping pattern over chord spans (ticks relative to the cycle start). */
export function compHits(spans: ChordSpan[], pattern: CompPattern, grid: CycleGrid, velocity: number): PatternHit[] {
  const { beatTicks, barTicks } = grid, eighth = beatTicks / 2;
  const hits: PatternHit[] = [];
  // A chord span need not be a whole number of beats: never start a hit at or after its end.
  const chordAt = (span: ChordSpan, tick: number, duration: number, accent = 0) => { if (tick >= span.endTick) return; for (const pitch of span.voicing) hits.push({ tick, durationTicks: Math.max(1, Math.min(duration, span.endTick - tick)), pitch, velocity: clampVelocity(velocity + accent) }); };
  for (const span of spans) {
    const length = span.endTick - span.startTick;
    const beats = Math.max(1, Math.round(length / beatTicks));
    const sorted = [...span.voicing].sort((a, b) => a - b);
    switch (pattern) {
      // Held chords re-strike each bar: a sequenced note lasts at most one bar.
      case "sustain": for (let bar = span.startTick; bar < span.endTick; bar += barTicks) chordAt(span, bar, Math.min(barTicks, span.endTick - bar) - 10); break;
      case "stabs": for (let beat = 0; beat < beats; beat++) chordAt(span, span.startTick + beat * beatTicks + eighth, Math.round(beatTicks * 0.4)); break;
      case "backbeat": for (let beat = 0; beat < beats; beat++) { const position = (span.startTick + beat * beatTicks) % barTicks / beatTicks; if (position % 2 === 1) chordAt(span, span.startTick + beat * beatTicks, Math.round(beatTicks * 0.6)); } break;
      case "pulse-quarters": for (let beat = 0; beat < beats; beat++) chordAt(span, span.startTick + beat * beatTicks, Math.round(beatTicks * 0.85), beat === 0 ? 0.08 : 0); break;
      case "pulse-eighths": for (let step = 0; step < beats * 2; step++) chordAt(span, span.startTick + step * eighth, Math.round(eighth * 0.8), step === 0 ? 0.08 : step % 2 ? -0.06 : 0); break;
      case "arpeggio-up":
      case "arpeggio-updown": {
        const order = pattern === "arpeggio-up" ? sorted : [...sorted, ...sorted.slice(1, -1).reverse()];
        for (let step = 0; step < beats * 2 && span.startTick + step * eighth < span.endTick; step++) hits.push({ tick: span.startTick + step * eighth, durationTicks: Math.min(Math.round(eighth * 1.6), span.endTick - span.startTick - step * eighth), pitch: order[step % order.length]!, velocity: clampVelocity(velocity + (step === 0 ? 0.08 : step % 2 ? -0.05 : 0)) });
        break;
      }
      // A rolled chord each bar: the lowest note, then the upper voices an eighth apart, ringing to the bar end.
      case "broken": for (let bar = span.startTick; bar < span.endTick; bar += barTicks) {
        const barEnd = Math.min(bar + barTicks, span.endTick);
        hits.push({ tick: bar, durationTicks: Math.min(barEnd - bar - 10, beatTicks * 2), pitch: sorted[0]!, velocity: clampVelocity(velocity + 0.06) });
        sorted.slice(1).forEach((pitch, i) => { const tick = bar + (i + 1) * eighth; if (tick < barEnd) hits.push({ tick, durationTicks: Math.max(1, barEnd - tick - 10), pitch, velocity: clampVelocity(velocity - 0.04) }); });
      } break;
      case "waltz": for (let bar = span.startTick; bar < span.endTick; bar += barTicks) {
        hits.push({ tick: bar, durationTicks: Math.min(beatTicks, span.endTick - bar), pitch: sorted[0]!, velocity: clampVelocity(velocity + 0.08) });
        for (let beat = 1; beat < grid.beatsPerBar && bar + beat * beatTicks < span.endTick; beat++) for (const pitch of sorted.slice(1)) hits.push({ tick: bar + beat * beatTicks, durationTicks: Math.round(beatTicks * 0.8), pitch, velocity: clampVelocity(velocity - 0.08) });
      } break;
    }
  }
  return hits;
}

export const bassRegisters = { low: [28, 52], mid: [36, 60] } as const;
/** One root per chord: the line with the least movement, counting the step from
 * the last chord back to the first (the cycle repeats), with a small pull toward
 * the register's centre. Exact search over each chord's octave choices. */
export function bassRootLine(pitchClasses: number[], low: number, high: number): number[] {
  const center = (low + high) / 2, place = (pitch: number) => 0.25 * Math.abs(pitch - center);
  const options = pitchClasses.map((pc) => { const out: number[] = []; for (let pitch = low; pitch <= high; pitch++) if (pitch % 12 === pc) out.push(pitch); return out; });
  let best: { cost: number; line: number[] } | null = null;
  for (const start of options[0]!) {
    let layer = [{ cost: place(start), line: [start] }];
    for (const choices of options.slice(1)) layer = choices.map((pitch) => {
      let pick: { cost: number; line: number[] } | null = null;
      for (const prior of layer) { const cost = prior.cost + Math.abs(pitch - prior.line.at(-1)!) + place(pitch); if (!pick || cost < pick.cost) pick = { cost, line: [...prior.line, pitch] }; }
      return pick!;
    });
    for (const end of layer) { const cost = end.cost + Math.abs(start - end.line.at(-1)!); if (!best || cost < best.cost) best = { cost, line: end.line }; }
  }
  return best!.line;
}
/** Bass hits from the chord roots (or slash bass notes), kept near one another. */
export function bassHits(spans: ChordSpan[], pattern: BassPattern, grid: CycleGrid, velocity: number, register: readonly [number, number], scale?: NativeScale): PatternHit[] {
  const { beatTicks, barTicks } = grid, eighth = beatTicks / 2;
  const [low, high] = register;
  const hits: PatternHit[] = [];
  // The register always spans more than an octave, so every pitch class has a candidate.
  const roots = bassRootLine(spans.map((span) => span.chord.bass), low, high);
  spans.forEach((span, index) => {
    const root = roots[index]!;
    const fifthInterval = span.chord.tones.find((tone) => tone.role === "fifth")?.interval ?? 7;
    const fifth = root + fifthInterval > high ? root + fifthInterval - 12 : root + fifthInterval;
    const length = span.endTick - span.startTick, beats = Math.max(1, Math.round(length / beatTicks));
    const add = (tick: number, duration: number, pitch: number, accent = 0) => { if (tick < span.endTick) hits.push({ tick, durationTicks: Math.max(1, Math.min(duration, span.endTick - tick)), pitch, velocity: clampVelocity(velocity + accent) }); };
    switch (pattern) {
      case "roots": for (let bar = span.startTick; bar < span.endTick; bar += barTicks) add(bar, Math.min(barTicks, span.endTick - bar) - 20, root, bar === span.startTick ? 0.05 : 0); break;
      case "root-fifth": for (let beat = 0; beat < beats; beat++) { const position = (span.startTick + beat * beatTicks) % barTicks / beatTicks; if (position === 0) add(span.startTick + beat * beatTicks, Math.round(beatTicks * 1.8), root, 0.06); else if (position === Math.floor(grid.beatsPerBar / 2) + (grid.beatsPerBar % 2)) add(span.startTick + beat * beatTicks, Math.round(beatTicks * 0.9), fifth); } break;
      case "syncopated": for (let bar = span.startTick; bar < span.endTick; bar += barTicks) { add(bar, Math.round(beatTicks * 1.3), root, 0.07); add(bar + beatTicks + eighth, Math.round(beatTicks * 0.9), root, -0.04); if (grid.beatsPerBar >= 4) add(bar + 3 * beatTicks, Math.round(beatTicks * 0.8), fifth); } break;
      case "pulse-eighths": for (let step = 0; step < beats * 2; step++) add(span.startTick + step * eighth, Math.round(eighth * 0.8), root, step === 0 ? 0.06 : step % 2 ? -0.06 : 0); break;
      case "octaves": for (let step = 0; step < beats * 2; step++) add(span.startTick + step * eighth, Math.round(eighth * 0.7), step % 2 ? root + 12 : root, step % 2 ? -0.05 : 0.04); break;
      case "walking": {
        const target = roots[(index + 1) % spans.length]!;
        const third = root + (span.chord.tones.find((tone) => tone.role === "third")?.interval ?? 4);
        const line = [root, third, fifth];
        for (let beat = 0; beat < beats; beat++) {
          const last = beat === beats - 1 && beats > 1;
          // The last beat approaches the next root by a step: in key when a key is given.
          const approach = scale ? diatonicShift(target, scale, target > root ? -1 : 1) : target + (target > root ? -1 : 1);
          add(span.startTick + beat * beatTicks, Math.round(beatTicks * 0.9), last ? approach : line[beat % line.length]!, beat === 0 ? 0.05 : 0);
        }
        break;
      }
    }
  });
  return hits;
}

// ---------------------------------------------------------------------------
// Feel: swing and humanising, applied deterministically

export const nativeFeelSchema = z.object({
  swing: z.number().min(0.5).max(0.75).default(0.5).describe("0.5 straight, 0.58 light, 0.66 triplet"),
  grid: z.enum(["8th", "16th"]).default("8th"),
  // Up to this many ticks early or late, fixed per note.
  humanizeTicks: z.number().int().min(0).max(40).default(0),
  humanizeVelocity: z.number().min(0).max(0.25).default(0),
  accent: z.enum(["none", "downbeats", "backbeats"]).default("none")
}).strict();
export type NativeFeel = z.infer<typeof nativeFeelSchema>;

/** Stable pseudo-random value in [-1, 1] for a seed. */
function jitter(seed: unknown): number { return parseInt(canonicalHash(seed).slice(0, 8), 16) / 0xffffffff * 2 - 1; }

/** Timing offset and velocity for one event under a feel. Swing delays the
 * off-beat position of the chosen grid; humanising adds a fixed, seeded nudge. */
export function feelFor(tick: number, velocity: number, feel: NativeFeel, grid: CycleGrid, seed: unknown): { offset: number; velocity: number } {
  const subdivision = feel.grid === "8th" ? grid.beatTicks / 2 : grid.beatTicks / 4;
  const pair = subdivision * 2;
  let offset = tick % pair === subdivision ? Math.round((feel.swing - 0.5) * 2 * subdivision) : 0;
  offset += Math.round(jitter([seed, "t"]) * feel.humanizeTicks);
  const position = tick % grid.barTicks;
  const accent = feel.accent === "downbeats" && position === 0 ? 0.1 : feel.accent === "backbeats" && position % grid.beatTicks === 0 && (position / grid.beatTicks) % 2 === 1 ? 0.1 : 0;
  return { offset, velocity: clampVelocity(velocity + jitter([seed, "v"]) * feel.humanizeVelocity + accent) };
}
export const feelChangesMaterial = (feel: NativeFeel) => feel.swing !== 0.5 || feel.humanizeTicks > 0 || feel.humanizeVelocity > 0 || feel.accent !== "none";
