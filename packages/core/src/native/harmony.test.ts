import { describe, expect, it } from "vitest";
import { bassHits, bassRootLine, compHits, diatonicInvert, diatonicShift, feelFor, nativeFeelSchema, parseChordSymbol, scalePitchClasses, voiceProgression, voicingRegisters, type ChordSpan } from "./harmony.js";

const dMinor = { tonic: "D", mode: "minor" } as const, cMajor = { tonic: "C", mode: "major" } as const;
const pcs = (pitches: number[]) => [...new Set(pitches.map((pitch) => pitch % 12))].sort((a, b) => a - b);
const grid44 = { barTicks: 3840, beatTicks: 960, beatsPerBar: 4 }, grid34 = { barTicks: 2880, beatTicks: 960, beatsPerBar: 3 };

describe("deterministic harmony", () => {
  it("reads common chord symbols, slash basses and rejects unreadable ones with the supported forms", () => {
    expect(parseChordSymbol("Dm9").tones.map((tone) => tone.interval)).toEqual([0, 3, 7, 10, 14]);
    expect(parseChordSymbol("Bbmaj7")).toMatchObject({ root: 10, bass: 10, quality: "major" });
    expect(parseChordSymbol("F#m7b5")).toMatchObject({ root: 6, quality: "diminished" });
    expect(parseChordSymbol("C/E")).toMatchObject({ root: 0, bass: 4 });
    expect(parseChordSymbol("G7sus4").tones.map((tone) => tone.interval)).toEqual([0, 5, 7, 10]);
    expect(parseChordSymbol("A6/9")).toMatchObject({ root: 9, bass: 9 });
    expect(() => parseChordSymbol("H7")).toThrow(/Unreadable chord symbol/);
    expect(() => parseChordSymbol("Cblah")).toThrow(/maj7/);
  });

  it("moves and mirrors phrases within the key, never into accidental chromatic notes", () => {
    const phrase = [69, 72, 65, 74]; // A4 C5 F4 D5 in D minor
    const up = phrase.map((pitch) => diatonicShift(pitch, dMinor, 2));
    expect(up).toEqual([72, 76, 69, 77]);
    expect(up.every((pitch) => scalePitchClasses(dMinor).includes(pitch % 12))).toBe(true);
    // The chromatic transposition that produced the Soft Corner clash would leave the key.
    expect(phrase.map((pitch) => pitch + 3).filter((pitch) => !scalePitchClasses(dMinor).includes(pitch % 12))).toHaveLength(2);
    expect(diatonicShift(60, cMajor, -1)).toBe(59);
    expect(diatonicShift(61, cMajor, 1)).toBe(63); // C# keeps its chromatic offset above D
    expect(diatonicInvert(64, cMajor, 62)).toBe(60); // E mirrored around D is C
    expect(diatonicInvert(67, cMajor, 64)).toBe(60);
  });

  it("voices a progression inside its register with small voice movement", () => {
    const chords = ["Am", "F", "C", "G"].map(parseChordSymbol);
    const voicings = voiceProgression(chords, { register: voicingRegisters.mid, voices: 4, style: "close", extensions: "as-written" });
    for (const [index, voicing] of voicings.entries()) {
      expect(voicing.every((pitch) => pitch >= 52 && pitch <= 76)).toBe(true);
      expect(pcs(voicing)).toEqual(pcs(chords[index]!.tones.map((tone) => chords[index]!.root + tone.interval)));
    }
    for (let i = 1; i < voicings.length; i++) {
      const movement = voicings[i]!.reduce((sum, pitch, voice) => sum + Math.abs(pitch - voicings[i - 1]![voice]!), 0) / voicings[i]!.length;
      expect(movement).toBeLessThanOrEqual(3);
    }
  });

  it("adds sevenths and ninths from the key when one is given", () => {
    const [ii, v, i] = voiceProgression(["Dm", "G", "C"].map(parseChordSymbol), { register: voicingRegisters.mid, voices: 4, style: "close", extensions: "sevenths", scale: cMajor });
    expect(pcs(ii!)).toEqual(pcs([62, 65, 69, 72])); // Dm7
    expect(pcs(v!)).toEqual(pcs([67, 71, 74, 65])); // G7, not Gmaj7
    expect(pcs(i!)).toEqual(pcs([60, 64, 67, 71])); // Cmaj7
    const [rich] = voiceProgression([parseChordSymbol("Em")], { register: voicingRegisters.mid, voices: 5, style: "close", extensions: "ninths", scale: cMajor });
    expect(rich!.some((pitch) => pitch % 12 === 6)).toBe(false); // no F# (b9-type colour outside C major)
  });

  it("places comping and bass patterns on the meter's beats, in 4/4 and 3/4", () => {
    const chord = parseChordSymbol("Am");
    const span = (grid: typeof grid44): ChordSpan => ({ chord, voicing: [57, 60, 64], startTick: 0, endTick: grid.barTicks });
    expect(compHits([span(grid44)], "backbeat", grid44, 0.5).map((hit) => hit.tick)).toEqual([960, 960, 960, 2880, 2880, 2880]);
    const waltz = compHits([span(grid34)], "waltz", grid34, 0.5);
    expect(waltz.filter((hit) => hit.tick === 0).map((hit) => hit.pitch)).toEqual([57]);
    expect(waltz.filter((hit) => hit.tick === 960).map((hit) => hit.pitch)).toEqual([60, 64]);
    expect(compHits([span(grid44)], "arpeggio-up", grid44, 0.5)).toHaveLength(8);
    const walking = bassHits([{ ...span(grid44), voicing: [] }, { chord: parseChordSymbol("F"), voicing: [], startTick: 3840, endTick: 7680 }], "walking", grid44, 0.7, [28, 52], cMajor);
    expect(walking.map((hit) => hit.tick)).toEqual([0, 960, 1920, 2880, 3840, 4800, 5760, 6720]);
    expect(walking[0]!.pitch % 12).toBe(9);
    expect([4, 7].includes(walking[3]!.pitch % 12)).toBe(true); // a step below or above F, in C major (E or G)
    expect(walking.every((hit) => hit.pitch >= 28 && hit.pitch <= 56)).toBe(true);
  });

  it("keeps a repeating bass cycle smooth, including the step back to its first chord", () => {
    const [low, high] = [28, 52];
    const line = bassRootLine([9, 5, 0, 7], low, high); // Am F C G
    const leaps = line.map((pitch, i) => Math.abs(pitch - line[(i + 1) % line.length]!));
    expect(Math.max(...leaps)).toBeLessThanOrEqual(7);
    expect(line.every((pitch) => pitch >= low && pitch <= high)).toBe(true);
    expect(line.map((pitch) => pitch % 12)).toEqual([9, 5, 0, 7]);
    // The whole line sits near the register's centre rather than at its floor.
    expect(Math.abs(line.reduce((sum, pitch) => sum + pitch, 0) / line.length - 40)).toBeLessThanOrEqual(6);
    expect(bassRootLine([2], low, high)).toEqual([38]);
  });

  it("swings the off-beat of the chosen grid and humanises deterministically within bounds", () => {
    const feel = nativeFeelSchema.parse({ swing: 0.6, grid: "8th", humanizeTicks: 10, humanizeVelocity: 0.1, accent: "backbeats" });
    expect(feelFor(480, 0.5, { ...feel, humanizeTicks: 0, humanizeVelocity: 0 }, grid44, "a").offset).toBe(96);
    expect(feelFor(960, 0.5, { ...feel, humanizeTicks: 0, humanizeVelocity: 0 }, grid44, "a")).toEqual({ offset: 0, velocity: 0.6 });
    const first = feelFor(480, 0.5, feel, grid44, ["p", 3]), again = feelFor(480, 0.5, feel, grid44, ["p", 3]);
    expect(first).toEqual(again);
    expect(Math.abs(first.offset - 96)).toBeLessThanOrEqual(10);
    expect(Math.abs(first.velocity - 0.5)).toBeLessThanOrEqual(0.1);
    expect(feelFor(240, 0.5, nativeFeelSchema.parse({ swing: 0.66, grid: "16th" }), grid44, "x").offset).toBe(77);
  });
});
