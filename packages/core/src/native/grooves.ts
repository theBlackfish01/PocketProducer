import { canonicalHash } from "../domain/hash.js";
import type { CycleGrid, PatternHit } from "./harmony.js";

// Deterministic drum grooves for the producer's symbolic tools. The model picks a
// style, a density and where a fill goes; this module writes kick, backbeat, hats,
// ghost notes and dynamics as explicit hits. Ticks are written straight: swing and
// humanising come afterwards from feelFor. A style is vocabulary the model chooses
// and then edits, not a genre generator, and nothing here is heard audio.

export const gmDrums = { kick: 36, rim: 37, snare: 38, clap: 39, closedHat: 42, pedalHat: 44, lowTom: 45, openHat: 46, midTom: 47, crash: 49, highTom: 50, ride: 51, tambourine: 54, shaker: 70 } as const;
export type DrumVoice = keyof typeof gmDrums;

export const grooveStyles = ["boom-bap", "four-on-the-floor", "two-step", "half-time", "funk", "straight-pop", "trap", "brushed-waltz", "shuffle"] as const;
export const grooveDensities = ["sparse", "medium", "busy"] as const;
export const fillKinds = ["snare-roll", "tom-run", "kick-pickup", "hat-open", "crash-in"] as const;
export type GrooveStyle = typeof grooveStyles[number];
export type GrooveDensity = typeof grooveDensities[number];
export type FillKind = typeof fillKinds[number];

/** `swing` and `swingGrid` are the suggested feel for feelFor; the hits themselves are straight. */
export interface GrooveInfo { id: GrooveStyle; description: string; meter: "4/4" | "3/4"; tempo: readonly [number, number]; swing: number; swingGrid: "8th" | "16th" }
export const grooveCatalog: readonly GrooveInfo[] = [
  { id: "boom-bap", description: "Head-nod hip-hop: kick on 1 and a late syncopation, snare on 2 and 4, eighth hats", meter: "4/4", tempo: [80, 98], swing: 0.58, swingGrid: "16th" },
  { id: "four-on-the-floor", description: "House and disco pulse: kick on every beat, clap on 2 and 4, open hats on the off-beats", meter: "4/4", tempo: [112, 130], swing: 0.5, swingGrid: "16th" },
  { id: "two-step", description: "Garage skip: kick on 1 and after 3 but never on 3, snare on 2 and 4, hats leaning on the off-beat", meter: "4/4", tempo: [126, 138], swing: 0.58, swingGrid: "16th" },
  { id: "half-time", description: "Wide and heavy: one snare on beat 3, kick on 1 with a push, steady hats", meter: "4/4", tempo: [70, 150], swing: 0.5, swingGrid: "8th" },
  { id: "funk", description: "Syncopated sixteenths: pushed kicks, backbeat snare with ghost notes, sixteenth hats", meter: "4/4", tempo: [90, 116], swing: 0.54, swingGrid: "16th" },
  { id: "straight-pop", description: "Plain backbeat: kick on 1 and 3, snare on 2 and 4, even hats", meter: "4/4", tempo: [96, 132], swing: 0.5, swingGrid: "8th" },
  { id: "trap", description: "Sparse heavy kick, snare on 3, eighth hats broken up by fast rolls", meter: "4/4", tempo: [120, 160], swing: 0.5, swingGrid: "16th" },
  { id: "brushed-waltz", description: "Gentle three: kick on 1, soft brushed snare on 2 and 3, light ride", meter: "3/4", tempo: [84, 152], swing: 0.6, swingGrid: "8th" },
  { id: "shuffle", description: "Blues shuffle backbeat written straight: it needs triplet swing on the eighths", meter: "4/4", tempo: [84, 132], swing: 0.66, swingGrid: "8th" }
];

export interface GrooveOptions { style: GrooveStyle; grid: CycleGrid; bars: 1 | 2 | 4; density: GrooveDensity; ghostNotes: boolean; seed: unknown }
export interface FillOptions { kind: FillKind; grid: CycleGrid; lengthBeats: 1 | 2 | 4; seed: unknown }

const clampVelocity = (value: number) => Math.min(1, Math.max(0.01, Number(value.toFixed(3))));
/** Stable pseudo-random value in [-1, 1] for a seed. */
const jitter = (seed: unknown) => parseInt(canonicalHash(seed).slice(0, 8), 16) / 0xffffffff * 2 - 1;
const key = (tick: number, pitch: number) => `${tick}:${pitch}`;
// Drums are one-shots: short notes, with the open hat and crash left to ring (960 ticks per quarter).
const lengthOf = (voice: DrumVoice) => voice === "crash" ? 1920 : voice === "openHat" ? 480 : ["closedHat", "pedalHat", "rim", "shaker", "tambourine"].includes(voice) ? 120 : 240;
const backbeat = 0.93, ghost = 0.26, levels = { sparse: 0, medium: 1, busy: 2 } as const;

/** Sorted, inside the cycle, and no drum ringing over its own next hit. */
function tidy(hits: PatternHit[], end: number): PatternHit[] {
  const sorted = hits.filter((hit) => hit.tick >= 0 && hit.tick < end).sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
  const next = new Map<number, number>();
  for (let index = sorted.length - 1; index >= 0; index--) {
    const hit = sorted[index]!;
    sorted[index] = { ...hit, durationTicks: Math.max(1, Math.min(hit.durationTicks, (next.get(hit.pitch) ?? end) - hit.tick)) };
    next.set(hit.pitch, hit.tick);
  }
  return sorted;
}

/** Collects one cycle. The louder of two hits on the same drum and tick wins. */
function kit(end: number) {
  const placed = new Map<string, PatternHit>();
  return {
    put(voice: DrumVoice, tick: number, velocity: number) {
      const pitch = gmDrums[voice], prior = placed.get(key(tick, pitch));
      if (tick >= 0 && tick < end && (!prior || prior.velocity < velocity)) placed.set(key(tick, pitch), { tick, durationTicks: lengthOf(voice), pitch, velocity });
    },
    clear(voice: DrumVoice, from: number, to: number) {
      for (const [id, hit] of placed) if (hit.pitch === gmDrums[voice] && hit.tick >= from && hit.tick < to) placed.delete(id);
    },
    finish(seed: unknown): PatternHit[] {
      // An open hat takes the closed hat's place on its tick: one pair of cymbals cannot play both.
      for (const hit of placed.values()) if (hit.pitch === gmDrums.openHat) placed.delete(key(hit.tick, gmDrums.closedHat));
      return tidy([...placed.values()].map((hit) => ({ ...hit, velocity: clampVelocity(hit.velocity + jitter([seed, hit.pitch, hit.tick]) * 0.04) })), end);
    }
  };
}

// ---------------------------------------------------------------------------
// Styles: one bar at a time, in steps of a quarter beat (16 steps in 4/4)

interface Bar {
  level: 0 | 1 | 2; ghost: boolean; steps: number;
  /** Every second bar varies; the fourth bar of a four-bar cycle varies once more. */
  turn: boolean; close: boolean;
  hit(voice: DrumVoice, steps: readonly number[], velocity: number): void;
  /** Kicks: the downbeat strongest, other beats next, syncopations lightest. */
  kick(steps: readonly number[]): void;
  /** A timekeeper every `every` steps: strong on the beat (or on `accent`), weak between. */
  time(every: number, voice?: DrumVoice, accent?: number): void;
  /** A rising hat roll that replaces the hats in its span. */
  roll(from: number, to: number, every: number): void;
}

const styles: Record<GrooveStyle, (bar: Bar) => void> = {
  "boom-bap": (bar) => {
    bar.kick([[0, 10], [0, 7, 10], [0, 3, 7, 10]][bar.level]!);
    bar.hit("snare", [4, 12], backbeat);
    bar.time(bar.level === 2 ? 1 : 2);
    if (bar.ghost) bar.hit("snare", [9, 15], ghost);
    if (bar.turn) bar.kick([11]);
    if (bar.close) bar.hit("openHat", [14], 0.66);
  },
  "four-on-the-floor": (bar) => {
    bar.kick([0, 4, 8, 12]);
    bar.hit("clap", [4, 12], backbeat);
    bar.hit("openHat", [2, 6, 10, 14], 0.62);
    if (bar.level > 0) bar.hit("closedHat", [0, 4, 8, 12], 0.42);
    if (bar.level === 2) bar.time(1, "shaker", 2);
    if (bar.ghost) bar.hit("snare", [7, 15], ghost);
    if (bar.turn) bar.kick([15]);
    if (bar.close) bar.hit("clap", [15], 0.7);
  },
  "two-step": (bar) => {
    bar.kick([[0, 10], [0, 3, 10], [0, 3, 10, 15]][bar.level]!);
    bar.hit("snare", [4, 12], backbeat);
    // The garage hat leans on the off-beat.
    if (bar.level === 0) bar.hit("closedHat", [2, 6, 10, 14], 0.6); else bar.time(bar.level === 2 ? 1 : 2, "closedHat", 2);
    if (bar.level === 2) bar.hit("rim", [7, 13], 0.5);
    if (bar.ghost) bar.hit("snare", [7, 9], ghost);
    if (bar.turn) bar.hit("openHat", [14], 0.66);
    if (bar.close) bar.kick([6]);
  },
  "half-time": (bar) => {
    bar.kick([[0, 6], [0, 6, 14], [0, 3, 6, 14]][bar.level]!);
    bar.hit("snare", [8], 0.95);
    bar.time([4, 2, 1][bar.level]!);
    if (bar.ghost) bar.hit("snare", [5, 11], ghost);
    if (bar.turn) bar.kick([10]);
    if (bar.close) bar.hit("openHat", [14], 0.66);
  },
  funk: (bar) => {
    bar.kick([[0, 6, 10], [0, 3, 6, 10], [0, 3, 6, 10, 13]][bar.level]!);
    bar.hit("snare", [4, 12], backbeat);
    bar.time(bar.level === 0 ? 2 : 1);
    if (bar.level === 2) bar.hit("openHat", [10], 0.66);
    if (bar.ghost) bar.hit("snare", [7, 9, 15], ghost);
    if (bar.turn) bar.hit("openHat", [14], 0.66);
    if (bar.close) bar.kick([15]);
  },
  "straight-pop": (bar) => {
    bar.kick([[0, 8], [0, 8, 10], [0, 6, 8, 10]][bar.level]!);
    bar.hit("snare", [4, 12], backbeat);
    bar.time([4, 2, 1][bar.level]!);
    if (bar.level === 2) bar.hit("tambourine", [4, 12], 0.5);
    if (bar.ghost) bar.hit("snare", [7, 9], ghost);
    if (bar.turn) bar.kick([14]);
    if (bar.close) bar.hit("openHat", [14], 0.66);
  },
  trap: (bar) => {
    bar.kick([[0, 10], [0, 6, 10], [0, 3, 6, 10, 14]][bar.level]!);
    bar.hit("snare", [8], 0.95);
    if (bar.level === 2) bar.hit("clap", [8], 0.88);
    bar.time(bar.level === 2 ? 1 : 2);
    // Rolls: one triplet burst when sparse; thirty-seconds, and a triplet when busy, above that.
    if (bar.level === 0) bar.roll(14, 16, 2 / 3);
    else { bar.roll(6, 8, bar.level === 2 ? 0.5 : 1); if (bar.level === 2) bar.roll(12, 14, 2 / 3); bar.roll(14, 16, 0.5); }
    if (bar.ghost) bar.hit("snare", [7, 15], ghost);
    if (bar.turn) bar.hit("openHat", [10], 0.66);
    if (bar.close) bar.roll(12, 16, 0.5);
  },
  "brushed-waltz": (bar) => {
    bar.kick([0]);
    bar.hit("snare", [4], 0.56);
    bar.hit("snare", [8], 0.5);
    // The ride keeps time: the jazz-waltz "1, 2-and, 3" at medium, even eighths when busy.
    if (bar.level === 1) { bar.time(4, "ride"); bar.hit("ride", [6], 0.42); }
    if (bar.level === 2) { bar.time(2, "ride"); bar.hit("pedalHat", [4, 8], 0.5); }
    if (bar.ghost) bar.hit("snare", [6, 10], ghost);
    if (bar.turn) bar.kick([10]);
    if (bar.close) bar.hit("snare", [10, 11], 0.5);
  },
  shuffle: (bar) => {
    bar.kick([[0, 8], [0, 6, 8], [0, 6, 8, 14]][bar.level]!);
    bar.hit("snare", [4, 12], backbeat);
    // Sparse keeps only the skip notes into beats 1 and 3. Swing turns every off-beat into a triplet.
    if (bar.level === 0) { bar.time(4); bar.hit("closedHat", [6, 14], 0.42); } else bar.time(2);
    if (bar.level === 2) bar.hit("tambourine", [4, 12], 0.5);
    if (bar.ghost) bar.hit("snare", bar.level === 0 ? [6, 14] : [2, 6, 10, 14], ghost);
    if (bar.turn) bar.hit("openHat", [14], 0.66);
    if (bar.close) bar.kick([10]);
  }
};

/** Any meter a style was not written for: kick on 1, a backbeat on the middle or last
 * felt beat, hats on eighths. Eighth-note beats are felt in threes (6/8, 12/8) or in
 * twos that close on a three (7/8). */
function generic(bar: Bar, { beatTicks, beatsPerBar }: CycleGrid): void {
  const eighth = Math.max(1, Math.round(1920 / beatTicks)), size = beatTicks >= 960 ? 1 : beatsPerBar % 3 === 0 ? 3 : 2;
  const felt: number[] = [];
  for (let beat = 0; beat < beatsPerBar && (beat === 0 || size === 1 || beatsPerBar - beat > 1); beat += size) felt.push(beat * 4);
  const backbeats = felt.length === 1 ? (beatsPerBar > 1 ? [bar.steps - 4] : []) : felt.length === 3 ? [felt[2]!] : felt.filter((_, index) => index % 2 === 1);
  const last = backbeats.at(-1), pickup = Math.max(bar.steps - eighth, bar.steps / 2);
  bar.kick([0, ...(bar.level > 0 ? felt.filter((step, index) => index > 0 && index % 2 === 0 && !backbeats.includes(step)) : [])]);
  if (bar.level === 2 && last !== undefined) bar.kick([last - eighth]);
  bar.hit("snare", backbeats, backbeat);
  bar.hit("closedHat", felt, 0.6);
  if (bar.level > 0) for (let step = 0; step < bar.steps; step += bar.level === 2 ? eighth / 2 : eighth) bar.hit("closedHat", [step], bar.level === 2 && step % eighth === 0 ? 0.5 : 0.4);
  if (bar.ghost && last !== undefined) bar.hit("snare", [last - eighth / 2, bar.steps - eighth / 2], ghost);
  if (bar.turn) bar.kick([pickup]);
  if (bar.close) bar.hit("openHat", [pickup], 0.66);
}

/** One cycle of a groove, ticks relative to the cycle start. The same options always
 * give the same hits; the seed only moves velocities, by at most 0.04. */
export function grooveHits({ style, grid, bars, density, ghostNotes, seed }: GrooveOptions): PatternHit[] {
  const { barTicks, beatTicks, beatsPerBar } = grid, steps = beatsPerBar * 4, drums = kit(bars * barTicks);
  const natural = beatsPerBar === (grooveCatalog.find((entry) => entry.id === style)?.meter === "3/4" ? 3 : 4);
  for (let index = 0; index < bars; index++) {
    const start = index * barTicks, tickOf = (step: number) => start + Math.round(step * beatTicks / 4);
    const hit: Bar["hit"] = (voice, at, velocity) => { for (const step of at) if (step >= 0 && step < steps && tickOf(step) < start + barTicks) drums.put(voice, tickOf(step), velocity); };
    const bar: Bar = {
      level: levels[density], ghost: ghostNotes, steps, turn: index % 2 === 1, close: bars === 4 && index === 3, hit,
      kick: (at) => { for (const step of at) hit("kick", [step], step === 0 ? 0.91 : step % 4 === 0 ? 0.88 : 0.84); },
      time: (every, voice = "closedHat", accent = 0) => { for (let step = 0; step < steps; step += every) hit(voice, [step], (step - accent) % 4 === 0 ? 0.6 : every < 2 && (step - accent) % 2 === 0 ? 0.5 : 0.4); },
      roll: (from, to, every) => {
        drums.clear("closedHat", tickOf(from), tickOf(to));
        const count = Math.round((to - from) / every);
        for (let i = 0; i < count; i++) hit("closedHat", [from + i * every], 0.42 + 0.26 * i / Math.max(1, count - 1));
      }
    };
    if (natural) styles[style](bar); else generic(bar, grid);
  }
  return drums.finish(seed);
}

// ---------------------------------------------------------------------------
// Fills

/** A fill over the last `lengthBeats` beats of one bar (the whole bar when it is
 * shorter), ticks relative to the bar start. A fill replaces everything in its
 * window, so the pickup and open-hat fills carry their own hats and backbeat.
 * "crash-in" is the downbeat of a new section instead: crash and kick on tick 0. */
export function fillHits({ kind, grid, lengthBeats, seed }: FillOptions): PatternHit[] {
  const { barTicks, beatTicks, beatsPerBar } = grid, beats = Math.min(lengthBeats, beatsPerBar), count = beats * 4;
  const from = barTicks - beats * beatTicks, drums = kit(barTicks);
  const put = (voice: DrumVoice, step: number, velocity: number) => drums.put(voice, from + Math.round(step * beatTicks / 4), velocity);
  const rise = (step: number, low: number, high: number) => low + (high - low) * step / Math.max(1, count - 1);
  // Time under a pickup: hats on the beats, the off-beats left to the caller, and the backbeat where an even meter has one.
  const bed = (offBeat: (step: number) => void) => {
    for (let beat = 0; beat < beats; beat++) {
      put("closedHat", beat * 4, 0.6);
      offBeat(beat * 4 + 2);
      if (beatsPerBar % 2 === 0 && (beatsPerBar - beats + beat) % 2 === 1) put("snare", beat * 4, backbeat);
    }
  };
  switch (kind) {
    case "crash-in": drums.put("crash", 0, 0.92); drums.put("kick", 0, 0.91); break;
    // Eighths that tighten into sixteenths for the second half.
    case "snare-roll": for (let step = 0; step < count; step++) if (beats === 1 || step >= count / 2 || step % 2 === 0) put("snare", step, rise(step, 0.5, 0.96)); break;
    case "tom-run": for (let step = 0; step < count; step++) put((["highTom", "midTom", "lowTom"] as const)[Math.floor(step * 3 / count)]!, step, rise(step, 0.7, 0.94)); break;
    case "kick-pickup": bed((step) => { put("closedHat", step, 0.42); put("kick", step, rise(step, 0.84, 0.9)); }); put("kick", count - 1, 0.91); break;
    case "hat-open": bed((step) => put("openHat", step, rise(step, 0.6, 0.86))); break;
  }
  return drums.finish(seed);
}

/** The cycle with a fill in its final bar. The window runs from the beat of the
 * fill's first hit to the bar end: cycle hits there are removed, except the kick on
 * that bar's downbeat. A fill that sits wholly on tick 0 (crash-in) replaces nothing
 * and lands on the cycle's first downbeat. */
export function withFill(cycleHits: PatternHit[], fill: PatternHit[], grid: CycleGrid, bars: number): PatternHit[] {
  const { barTicks, beatTicks } = grid, end = bars * barTicks;
  const inBar = fill.filter((hit) => hit.tick >= 0 && hit.tick < barTicks);
  const accent = inBar.every((hit) => hit.tick === 0), barStart = accent ? 0 : end - barTicks;
  const from = accent ? end : barStart + Math.floor(Math.min(...inBar.map((hit) => hit.tick)) / beatTicks) * beatTicks;
  const merged = new Map<string, PatternHit>();
  for (const hit of [...cycleHits.filter((item) => item.tick < from || (item.tick === barStart && item.pitch === gmDrums.kick)), ...inBar.map((item) => ({ ...item, tick: item.tick + barStart }))]) {
    if (!merged.has(key(hit.tick, hit.pitch))) merged.set(key(hit.tick, hit.pitch), hit);
  }
  return tidy([...merged.values()], end);
}

// ---------------------------------------------------------------------------
// Beatbox8 and summaries

/** Kick, snare, closed hat or open hat for any GM percussion pitch. */
const beatboxLane = (pitch: number) => pitch <= 36 || [41, 43, 45].includes(pitch) ? 36 : pitch <= 40 || [47, 48, 50].includes(pitch) ? 38 : [46, 49, 52, 55, 57].includes(pitch) ? 46 : 42;

/** Project a groove onto the strict Beatbox8 step contract: four lanes, sixteenth
 * steps, fixed length and velocity. Ghost notes and anything that rounds past the
 * cycle end are dropped; rolls collapse onto their steps. */
export function toBeatbox8(hits: PatternHit[], cycleTicks: number): PatternHit[] {
  const steps = new Map<string, PatternHit>();
  for (const hit of hits) {
    const tick = Math.round(hit.tick / 240) * 240, pitch = beatboxLane(hit.pitch);
    if (hit.velocity >= 0.35 && tick >= 0 && tick + 240 <= cycleTicks) steps.set(key(tick, pitch), { tick, durationTicks: 240, pitch, velocity: 1 });
  }
  for (const hit of steps.values()) if (hit.pitch === 46) steps.delete(key(hit.tick, 42));
  return [...steps.values()].sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
}

/** Hits per bar by voice name, for prompts and tests: `{ kick: [3, 4], snare: [2, 2] }`. */
export function grooveSummary(hits: PatternHit[], grid: CycleGrid, bars: number): Record<string, number[]> {
  const names = new Map<number, string>(Object.entries(gmDrums).map(([name, pitch]) => [pitch, name]));
  const summary: Record<string, number[]> = {};
  for (const hit of [...hits].sort((a, b) => a.pitch - b.pitch)) {
    const bar = Math.floor(hit.tick / grid.barTicks);
    if (bar < 0 || bar >= bars) continue;
    const counts = summary[names.get(hit.pitch) ?? `pitch${hit.pitch}`] ??= Array.from({ length: bars }, () => 0);
    counts[bar] = (counts[bar] ?? 0) + 1;
  }
  return summary;
}
