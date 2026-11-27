import { z } from "zod";
import { NativeCorrectableError } from "./errors.js";
import { bassRootLine, parseChordSymbol, voiceProgression } from "./harmony.js";
import { nativeDocumentSchema, type NativeDocument, type NativePart } from "./model.js";
import { readNativeRecipe } from "./resources.js";
import type { NativeBrief } from "./brief.js";

// These version IDs describe musical content. Keep the old definition when publishing a new version.
export const starterSchema = z.object({
  id: z.enum(["french-house-v1", "broken-beat-v1", "chamber-waltz-v1"]),
  chords: z.array(z.string().min(1).max(16)).min(1).max(16).describe("Your chord cycle, one symbol per bar"),
  arc: z.array(z.enum(["open", "pocket", "break", "lift", "close"])).min(1).max(24).describe("One energy per section. lift restores the full groove; close thins the whole section. landing handles the final bar independently."),
  landing: z.string().min(1).max(16).describe("Chord on the final bar"),
  pocket: z.enum(["spare", "signature", "driving"]).default("signature"),
  bassLine: z.enum(["starter", "authored"]).optional().describe("authored leaves bass empty for your patterns and placements"),
  lead: z.boolean().default(true).describe("Place your motifs on the supplied part named lead. Set false if omitting it or declaring your own lead part.")
}).strict();
export type Starter = z.infer<typeof starterSchema>;
type Energy = Starter["arc"][number];
type Structure = { bars: number; sections: NativeDocument["sections"]; tempoBpm?: number | undefined };
const bad = (reason: string) => new NativeCorrectableError("SYMBOLIC_EDIT_INVALID", reason, "Adjust the initial scene or omit starter and compose freely.");
const palette = {
  "french-house-v1": { beats: 4, tempo: 118, bass: "rubber-pulse", keys: "house-stab", lead: "soft-lead", kit: "punchy-step-kit" },
  "broken-beat-v1": { beats: 4, tempo: 86, bass: "dusty-bass", keys: "lofi-keys", lead: "glass-bell", kit: "dry-step-kit" },
  "chamber-waltz-v1": { beats: 3, tempo: 78, bass: "held-bass", keys: "string-swell", lead: "soft-glass", kit: null }
} as const;

// Discovery only. An exact interpreted meter or incompatible ensemble takes priority.
export function starterSuggestions(direction: string, brief: Pick<NativeBrief, "roles" | "meter"> | null): string[] {
  if (/\b(unmetered|unaccompanied|a cappella|solo (piano|guitar|violin|cello|voice) piece|piano alone)\b/i.test(direction)
      || /^\s*(?:a |an )?solo\b/i.test(direction)) return [];
  const role = (kind: "absent" | "required", name: string) =>
    brief?.roles.some(r => r.kind === kind && r.role === name && !r.section && !r.reduceDensity);
  if (role("absent", "bass") || role("absent", "harmony")) return [];
  const styles = [
    ["french-house-v1", /\b(french[- ]house|synth[- ]?disco|disco|filter(ed)? house|octave bass)\b/i, "clipped chord stabs and octave bass between kick hits"],
    ["broken-beat-v1", /\b(broken[- ]beat|neo[- ]?soul|late rhodes|behind[- ]the[- ]beat)\b/i, "late keys and syncopated bass with space for an answer"],
    ["chamber-waltz-v1", /\b(waltz|in three|three[- ]beat)\b/i, "drumless sustained strings and a glass voice in three"]
  ] as const;
  return styles.filter(([id, pattern]) => {
    const beats = palette[id].beats;
    return pattern.test(direction) && (!brief?.meter || (brief.meter.numerator === beats && brief.meter.denominator === 4)) &&
      !(beats === 3 ? role("required", "drums") : role("absent", "drums"));
  }).slice(0, 2).map(([id, , reason]) => id + " (" + reason + ")");
}

function voice(id: string, name: string, role: NativePart["role"], recipeId: string, gain: number, pan: number): NativePart {
  const recipe = readNativeRecipe(recipeId);
  return nativeDocumentSchema.shape.parts.element.parse({
    id, name, role, device: recipe.device, gain, pan,
    effects: recipe.effects.map((fx, i) => ({ ...fx, id: `fx-${i + 1}` }))
  });
}

// Sixteenth cells. Kit voices are native on/off steps. Broken-beat keys and bass carry the late pocket.
type KitBar = [number[], number[], number[], number[]];
const houseKit: Record<Energy, KitBar> = {
  open: [[0, 8], [], [6, 14], []], pocket: [[0, 4, 8, 12], [4, 12], [2, 6, 10], [14]],
  break: [[], [], [2, 10], []], lift: [[0, 4, 8, 12], [4, 12], [0, 6, 8, 14], [2, 10]], close: [[0], [4], [2], []]
};
const brokenKit: Record<Energy, KitBar> = {
  open: [[0], [], [6, 14], []], pocket: [[0, 7, 10], [4, 12], [2, 6, 9, 14], []],
  break: [[], [12], [6], []], lift: [[0, 6, 10, 15], [4, 12], [0, 3, 6, 9, 14], [11]], close: [[0], [], [6], []]
};
function drumPhrase(energy: Energy, bar: KitBar): NativeDocument["motifs"][number] {
  const pitches = [36, 38, 42, 46];
  return {
    id: `kit-${energy}`, partId: "drums", name: `Pocket · ${energy}`, lengthTicks: 3840,
    notes: bar.flatMap((cells, lane) => cells.map(cell => ({
      id: `d-${lane}-${cell}`, pitch: pitches[lane]!,
      startTick: cell * 240, durationTicks: 240, velocity: 1
    })))
  };
}

// [tick within bar, duration, velocity, octave displacement]. These figures leave gaps
// for one another. Use literal ticks so the off-grid pushes survive Nexus readback.
type Attack = readonly [number, number, number, number?];
const houseBass: Attack[] = [[240, 400, .83], [960, 285, .72], [1680, 210, .65, 1], [2160, 500, .87], [3120, 292, .76]];
const houseKeys: Attack[] = [[480, 215, .65], [1440, 160, .50], [2640, 260, .68], [3360, 185, .54]];
const brokenBass: Attack[] = [[0, 810, .86], [1472, 380, .62], [2208, 790, .81], [3392, 265, .57, 1]];
const brokenKeys: Attack[] = [[528, 755, .63], [1992, 520, .73], [3192, 340, .52]];
const waltzBass: Attack[] = [[0, 2060, .72]];
const waltzKeys: Attack[] = [[192, 2450, .62]];
function phrase(part: NativePart, offset: number, pitches: number[], attacks: readonly Attack[], level: number) {
  for (const [tick, duration, velocity, octave = 0] of attacks) for (const [i, pitch] of pitches.entries()) {
    part.notes.push({
      id: `n-${offset + tick}-${i}`, startTick: offset + tick, durationTicks: duration,
      pitch: pitch + octave * 12, velocity: Math.min(1, velocity * level * (i === 0 ? 1 : .94))
    });
  }
}

export function arrangeStarter(input: Starter, structure: Structure, requestedMeter?: NativeDocument["meter"]) {
  const sound = palette[input.id], house = input.id === "french-house-v1", waltz = sound.beats === 3;
  const meter = { numerator: sound.beats, denominator: 4 as const };
  if (requestedMeter && (requestedMeter.numerator !== meter.numerator || requestedMeter.denominator !== 4)) throw bad("Starter and requested meter differ.");
  if (input.arc.length !== structure.sections.length) throw bad("Each section needs one starter arc entry.");
  const ordered = structure.sections.every((section, i, sections) =>
    section.startBar === (sections[i - 1]?.endBar ?? 0) && section.endBar > section.startBar && section.endBar <= structure.bars);
  if (!ordered || structure.sections.at(-1)?.endBar !== structure.bars)
    throw bad("Sections must cover the arrangement in order, starting at bar index 0.");
  const ticks = sound.beats * 960;
  const parse = (symbol: string) => {
    try { return parseChordSymbol(symbol); }
    catch (error) { throw bad(error instanceof Error ? error.message : "Unreadable starter chord."); }
  };
  const cycle = input.chords.map(parse);
  const landing = parse(input.landing);
  const chords = Array.from({ length: structure.bars }, (_, i) => i === structure.bars - 1 ? landing : cycle[i % cycle.length]!);
  const bassLine = bassRootLine(chords.map(c => c.bass), 36, 51);
  const voicings = voiceProgression(chords, { register: waltz ? [54, 78] : [53, 77], voices: 4, style: waltz ? "open" : "close", extensions: "as-written" });
  const bass = voice("bass", waltz ? "Bowed foundation" : house ? "Octave rubber" : "Felt bass", "bass", sound.bass, waltz ? .54 : .71, 0);
  const keys = voice("keys", waltz ? "Veiled strings" : house ? "Prism stabs" : "Late Rhodes", "harmony", sound.keys, waltz ? .50 : .52, -.13);
  const parts = [bass, keys];
  const lead = input.lead ? voice("lead", waltz ? "Porcelain voice" : house ? "Ribbon lead" : "Copper tine", "melody", sound.lead, .57, .12) : undefined;
  if (lead) parts.push(lead);
  const drums = sound.kit ? voice("drums", house ? "Club kit" : "Side-street kit", "percussion", sound.kit, house ? .72 : .62, 0) : undefined;
  if (drums) parts.push(drums);
  const motifs: NativeDocument["motifs"] = [];
  const curve: NativePart["automation"][number]["points"] = [];
  const kitGain: typeof curve = [];
  for (const [idx, section] of structure.sections.entries()) {
    const energy = input.arc[idx]!;
    const level = { open: .70, pocket: .91, break: .60, lift: 1, close: .74 }[energy];
    const cutoff = { open: .39, pocket: .61, break: .31, lift: .78, close: .47 }[energy];
    curve.push({ tick: section.startBar * ticks, value: cutoff, interpolation: "linear" });
    if (drums) {
      const signature = (house ? houseKit : brokenKit)[energy];
      const drumBar: KitBar = input.pocket === "spare"
        ? [signature[0], signature[1], signature[2].filter((_, i) => i % 2 === 0), []]
        : signature;
      const motif = drumPhrase(energy, drumBar);
      if (!motifs.some(m => m.id === motif.id)) motifs.push(motif);
      const end = Math.min(section.endBar, structure.bars - 1);
      for (let bar = section.startBar; bar < end; bar += 64)
        drums.placements.push({ id: `kit-at-${bar}`, motifId: motif.id, startTick: bar * ticks, repeats: Math.min(64, end - bar), transpose: 0 });
      if (!house && end > section.startBar) {
        // Beatbox8 steps are boolean. Shape the channel around the last backbeat
        // and pickup independently of note velocity. At most three points per section.
        const lastBar = (end - 1) * ticks;
        kitGain.push({ tick: section.startBar * ticks, value: .62 * level, interpolation: "step" },
          { tick: lastBar + 2880, value: .70 * level, interpolation: "step" },
          { tick: lastBar + 3360, value: .46 * level, interpolation: "step" });
      }
    }
    for (let bar = section.startBar; bar < section.endBar; bar++) {
      const offset = bar * ticks, chord = voicings[bar]!, root = [bassLine[bar]!];
      if (bar === structure.bars - 1) {
        phrase(keys, offset, chord, [[0, ticks - 120, .67]], 1);
        phrase(bass, offset, root, [[0, ticks - 360, .72]], 1);
        continue;
      }
      if (energy === "break") {
        phrase(keys, offset, chord, [[waltz ? 480 : 960, ticks - 1080, .62]], level);
        continue;
      }
      if (energy === "open" || energy === "close") {
        phrase(keys, offset, chord, waltz ? waltzKeys : [[480, 650, .68], [2400, 390, .53]], level);
        if (energy === "close" || bar % 2 === 1) phrase(bass, offset, root, [[0, waltz ? 1740 : 730, .78]], level);
        continue;
      }
      const figure = waltz ? waltzBass : house ? houseBass : brokenBass;
      const attacks = input.pocket === "spare" ? figure.filter((_, i) => i % 2 === 0) : figure;
      if (!(waltz && input.pocket === "spare" && bar % 2 === 1)) phrase(bass, offset, root, attacks, level);
      if (input.pocket === "driving" && bar % 2 === 1)
        phrase(bass, offset, root, waltz ? [[2160, 180, .54]] : [[3660, 132, .54, 1]], level);
      phrase(keys, offset, chord, waltz ? waltzKeys : house ? houseKeys : brokenKeys, level);
      if (energy === "lift" && bar % 2 === 1) {
        if (waltz) phrase(bass, offset, root, [[2400, 360, .50, 1]], level);
        else phrase(keys, offset, [chord.at(-1)!], [[3672, 120, .50]], level);
      }
    }
  }
  curve.push({ tick: structure.bars * ticks, value: .35, interpolation: "linear" });
  keys.automation.push({ id: "timbre-arc", target: "device.filter.cutoffFrequencyHz", points: curve });
  if (drums && kitGain.length) drums.automation.push({ id: "kit-accents", target: "gain", points: kitGain });
  if (input.bassLine === "authored") bass.notes = [];
  return { parts, motifs, meter, tempo: structure.tempoBpm ?? sound.tempo, space: waltz ? "hall" as const : "room" as const };
}
