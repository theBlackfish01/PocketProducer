import { describe, expect, it } from "vitest";
import { fillHits, fillKinds, gmDrums, grooveCatalog, grooveDensities, grooveHits, grooveStyles, grooveSummary, toBeatbox8, withFill, type GrooveOptions, type GrooveStyle } from "./grooves.js";
import type { CycleGrid, PatternHit } from "./harmony.js";

const grid44 = { barTicks: 3840, beatTicks: 960, beatsPerBar: 4 }, grid34 = { barTicks: 2880, beatTicks: 960, beatsPerBar: 3 };
const grid54 = { barTicks: 4800, beatTicks: 960, beatsPerBar: 5 }, grid78 = { barTicks: 3360, beatTicks: 480, beatsPerBar: 7 }, grid68 = { barTicks: 2880, beatTicks: 480, beatsPerBar: 6 };
const { kick, snare, clap, closedHat, openHat, crash } = gmDrums;
const cycleLengths = [1, 2, 4] as const, drumPitches: number[] = Object.values(gmDrums);
const naturalGrid = (style: GrooveStyle) => grooveCatalog.find((entry) => entry.id === style)!.meter === "3/4" ? grid34 : grid44;
const groove = (style: GrooveStyle, overrides: Partial<GrooveOptions> = {}) => grooveHits({ style, grid: naturalGrid(style), bars: 2, density: "medium", ghostNotes: false, seed: "groove", ...overrides });
const shape = (hits: PatternHit[]) => hits.map((hit) => `${hit.tick}:${hit.pitch}`);
const inBar = (hits: PatternHit[], grid: CycleGrid, bar: number) => hits.filter((hit) => Math.floor(hit.tick / grid.barTicks) === bar);
/** One bar's pitches and bar-relative ticks, without velocities. */
const barShape = (hits: PatternHit[], grid: CycleGrid, bar: number) => shape(inBar(hits, grid, bar).map((hit) => ({ ...hit, tick: hit.tick - bar * grid.barTicks })));
const at = (hits: PatternHit[], tick: number, pitch: number) => hits.find((hit) => hit.tick === tick && hit.pitch === pitch);
const of = (hits: PatternHit[], ...pitches: number[]) => hits.filter((hit) => pitches.includes(hit.pitch));

/** Hits that break the note contract: integer ticks inside the cycle, a usable velocity, a known drum, no drum over itself. */
function flaws(hits: PatternHit[], end: number): PatternHit[] {
  const sounding = new Map<number, number>();
  return [...hits].sort((a, b) => a.tick - b.tick).filter((hit) => {
    const free = (sounding.get(hit.pitch) ?? 0) <= hit.tick;
    sounding.set(hit.pitch, hit.tick + hit.durationTicks);
    return !(free && Number.isInteger(hit.tick) && Number.isInteger(hit.durationTicks) && hit.tick >= 0 && hit.tick < end && hit.durationTicks >= 1
      && hit.tick + hit.durationTicks <= end && hit.velocity > 0 && hit.velocity <= 1 && drumPitches.includes(hit.pitch));
  });
}
function expectGroove(hits: PatternHit[], grid: CycleGrid, bars: number, label: string) {
  expect(hits.length, label).toBeGreaterThan(0);
  expect(flaws(hits, bars * grid.barTicks), label).toEqual([]);
  expect(new Set(shape(hits)).size, label).toBe(hits.length);
  for (let bar = 0; bar < bars; bar++) expect(at(hits, bar * grid.barTicks, kick), `${label} bar ${bar + 1} downbeat`).toBeDefined();
}
function eachGroove(run: (hits: PatternHit[], options: GrooveOptions, label: string) => void, gridFor: (style: GrooveStyle) => CycleGrid = naturalGrid) {
  for (const style of grooveStyles) for (const density of grooveDensities) for (const bars of cycleLengths) for (const ghostNotes of [false, true]) {
    const options: GrooveOptions = { style, grid: gridFor(style), bars, density, ghostNotes, seed: "every" };
    run(grooveHits(options), options, `${style} ${density} ${bars} bars${ghostNotes ? " with ghosts" : ""}`);
  }
}

describe("drum grooves", () => {
  it("describes every style once with a meter, a tempo range and a swing the feel helper accepts", () => {
    expect(grooveCatalog.map((entry) => entry.id)).toEqual([...grooveStyles]);
    for (const entry of grooveCatalog) {
      expect(entry.description.length).toBeGreaterThan(20);
      expect(entry.description).not.toContain("\n");
      expect(entry.tempo[0]).toBeLessThan(entry.tempo[1]);
      expect(entry.swing).toBeGreaterThanOrEqual(0.5);
      expect(entry.swing).toBeLessThanOrEqual(0.66);
    }
    expect(grooveCatalog.filter((entry) => entry.meter === "3/4").map((entry) => entry.id)).toEqual(["brushed-waltz"]);
  });

  it("gives every style, density, cycle length and ghost setting well-formed hits with a kick on each downbeat", () => {
    eachGroove((hits, { grid, bars }, label) => expectGroove(hits, grid, bars, label));
  });

  it("places kick, backbeat and hats the way each style is played", () => {
    eachGroove((hits, { style, grid, bars, density }, label) => {
      for (let bar = 0; bar < bars; bar++) {
        const start = bar * grid.barTicks, beat = (nth: number) => start + (nth - 1) * 960;
        const accented = (pitch: number, nth: number) => (at(hits, beat(nth), pitch)?.velocity ?? 0) >= 0.85;
        if (["boom-bap", "two-step", "funk", "straight-pop", "shuffle"].includes(style)) expect(accented(snare, 2) && accented(snare, 4), label).toBe(true);
        if (style === "four-on-the-floor") {
          expect(accented(clap, 2) && accented(clap, 4), label).toBe(true);
          expect([1, 2, 3, 4].every((nth) => at(hits, beat(nth), kick)), label).toBe(true);
          expect([1, 2, 3, 4].every((nth) => at(hits, beat(nth) + 480, openHat)), label).toBe(true);
        }
        if (style === "half-time" || style === "trap") {
          expect(accented(snare, 3), label).toBe(true);
          expect(of(inBar(hits, grid, bar), snare).filter((hit) => hit.velocity >= 0.35), label).toHaveLength(1);
        }
        if (style === "two-step") expect(at(hits, beat(3), kick), label).toBeUndefined();
        if (style === "brushed-waltz") {
          // Soft brush strokes on 2 and 3: present, but well under a backbeat.
          for (const nth of [2, 3]) expect(at(hits, beat(nth), snare)?.velocity, label).toBeGreaterThan(0.4);
          for (const nth of [2, 3]) expect(at(hits, beat(nth), snare)?.velocity, label).toBeLessThan(0.7);
        }
      }
      // Everything but the trap rolls sits on the sixteenth grid; a shuffle is written as straight eighths.
      const hats = of(hits, closedHat).map((hit) => hit.tick);
      if (style === "trap") expect(hats.some((tick, index) => index > 0 && tick - hats[index - 1]! < 240), label).toBe(true);
      else expect(hits.every((hit) => hit.tick % (style === "shuffle" ? 480 : 240) === 0), label).toBe(true);
      if (style === "funk" && density !== "sparse") expect(of(inBar(hits, grid, 0), closedHat, openHat), label).toHaveLength(16);
      if (style === "boom-bap" && density !== "busy") expect(of(inBar(hits, grid, 0), closedHat, openHat), label).toHaveLength(8);
    });
  });

  it("shapes dynamics: strong kicks, an accented backbeat, hats that alternate and ghost notes only on request", () => {
    eachGroove((hits, { ghostNotes }, label) => {
      for (const hit of of(hits, kick)) { expect(hit.velocity, label).toBeGreaterThanOrEqual(0.8); expect(hit.velocity, label).toBeLessThanOrEqual(0.95); }
      const quiet = hits.filter((hit) => hit.velocity < 0.35);
      expect(quiet.length > 0, label).toBe(ghostNotes);
      expect(quiet.every((hit) => hit.pitch === snare && hit.velocity >= 0.2 && hit.velocity <= 0.32), label).toBe(true);
    });
    const hats = of(groove("straight-pop"), closedHat);
    const onBeat = hats.filter((hit) => hit.tick % 960 === 0).map((hit) => hit.velocity), offBeat = hats.filter((hit) => hit.tick % 960 !== 0).map((hit) => hit.velocity);
    expect(onBeat).toHaveLength(8);
    expect(offBeat).toHaveLength(8);
    expect(Math.min(...onBeat)).toBeGreaterThan(Math.max(...offBeat) + 0.1);
    expect(Math.min(...of(groove("straight-pop"), snare).map((hit) => hit.velocity))).toBeGreaterThanOrEqual(0.85);
    // Ghosts are extra notes: the groove without them is still all there.
    expect(shape(groove("funk", { ghostNotes: true }))).toEqual(expect.arrayContaining(shape(groove("funk"))));
  });

  it("returns the same hits for the same options; a seed moves velocities only, and only slightly", () => {
    for (const style of grooveStyles) {
      const options: GrooveOptions = { style, grid: naturalGrid(style), bars: 4, density: "busy", ghostNotes: true, seed: { job: "a", part: 3 } };
      const first = grooveHits(options), other = grooveHits({ ...options, seed: { job: "b", part: 3 } });
      expect(grooveHits({ ...options, seed: { part: 3, job: "a" } })).toEqual(first);
      expect(shape(other)).toEqual(shape(first));
      expect(other.map((hit) => hit.durationTicks)).toEqual(first.map((hit) => hit.durationTicks));
      const moved = first.map((hit, index) => Math.abs(hit.velocity - other[index]!.velocity));
      expect(moved.some((difference) => difference > 0)).toBe(true);
      expect(Math.max(...moved)).toBeLessThanOrEqual(0.081);
    }
  });

  it("varies the second bar, and the fourth again, so longer cycles breathe", () => {
    eachGroove((hits, options, label) => {
      const { grid, bars } = options;
      // The first bar is the plain pattern whatever the cycle length.
      expect(barShape(hits, grid, 0), label).toEqual(shape(grooveHits({ ...options, bars: 1 })));
      if (bars === 1) return;
      expect(barShape(hits, grid, 1), label).not.toEqual(barShape(hits, grid, 0));
      if (bars === 2) return;
      expect(barShape(hits, grid, 2), label).toEqual(barShape(hits, grid, 0));
      expect(barShape(hits, grid, 3), label).not.toEqual(barShape(hits, grid, 1));
      expect(barShape(hits, grid, 3), label).not.toEqual(barShape(hits, grid, 0));
    });
  });

  it("adds hits with density in every style", () => {
    for (const style of grooveStyles) for (const bars of cycleLengths) for (const ghostNotes of [false, true]) {
      const [sparse, medium, busy] = grooveDensities.map((density) => groove(style, { bars, density, ghostNotes }).length);
      expect(medium!, `${style} medium`).toBeGreaterThan(sparse!);
      expect(busy!, `${style} busy`).toBeGreaterThan(medium!);
    }
  });

  it("falls back to kick on 1, a backbeat and eighth hats in meters a style was not written for", () => {
    for (const grid of [grid54, grid78, grid68, grid34, grid44]) {
      const meter = `${grid.beatsPerBar} beats of ${grid.beatTicks}`;
      eachGroove((hits, { style, bars, density, ghostNotes }, label) => {
        expectGroove(hits, grid, bars, `${label} in ${meter}`);
        if (naturalGrid(style).beatsPerBar === grid.beatsPerBar) return;
        for (let bar = 0; bar < bars; bar++) expect(of(inBar(hits, grid, bar), snare).some((hit) => hit.velocity >= 0.85), `${label} in ${meter}`).toBe(true);
        if (bars > 1) expect(barShape(hits, grid, 1), `${label} in ${meter}`).not.toEqual(barShape(hits, grid, 0));
        if (density === "busy") expect(hits.length, `${label} in ${meter}`).toBeGreaterThan(grooveHits({ style, grid, bars, density: "sparse", ghostNotes, seed: "every" }).length);
      }, () => grid);
    }
    const accents = (grid: CycleGrid) => of(grooveHits({ style: "funk", grid, bars: 1, density: "medium", ghostNotes: false, seed: 1 }), snare).map((hit) => hit.tick);
    expect(accents(grid54)).toEqual([960, 2880]);
    expect(accents(grid34)).toEqual([1920]);
    // 6/8 is felt in two, 7/8 as 2+2+3: the backbeat opens the last group and every eighth carries a hat.
    expect(accents(grid68)).toEqual([1440]);
    expect(accents(grid78)).toEqual([1920]);
    expect(of(grooveHits({ style: "shuffle", grid: grid78, bars: 1, density: "medium", ghostNotes: false, seed: 1 }), closedHat).map((hit) => hit.tick)).toEqual([0, 480, 960, 1440, 1920, 2400, 2880]);
    // A waltz asked for in 4/4 gets the common-time fallback, not a three-beat pattern with a hole.
    expect(of(grooveHits({ style: "brushed-waltz", grid: grid44, bars: 1, density: "sparse", ghostNotes: false, seed: 1 }), snare).map((hit) => hit.tick)).toEqual([960, 2880]);
  });
});

describe("drum fills", () => {
  const windowed = fillKinds.filter((kind) => kind !== "crash-in");

  it("keeps each fill inside the last beats of the bar, starting on the window's first beat", () => {
    for (const kind of windowed) for (const grid of [grid44, grid34, grid78]) for (const lengthBeats of cycleLengths) {
      const hits = fillHits({ kind, grid, lengthBeats, seed: "fill" }), label = `${kind} ${lengthBeats} beats in ${grid.beatsPerBar}`;
      const from = grid.barTicks - Math.min(lengthBeats, grid.beatsPerBar) * grid.beatTicks;
      expect(flaws(hits, grid.barTicks), label).toEqual([]);
      expect(new Set(shape(hits)).size, label).toBe(hits.length);
      expect(Math.min(...hits.map((hit) => hit.tick)), label).toBe(from);
      expect(fillHits({ kind, grid, lengthBeats, seed: "fill" }), label).toEqual(hits);
      expect(shape(fillHits({ kind, grid, lengthBeats, seed: "other" })), label).toEqual(shape(hits));
    }
  });

  it("builds each fill idiomatically, with a crescendo into the next bar", () => {
    const roll = fillHits({ kind: "snare-roll", grid: grid44, lengthBeats: 2, seed: 1 });
    expect(roll.every((hit) => hit.pitch === snare)).toBe(true);
    expect(roll.map((hit) => hit.tick)).toEqual([1920, 2400, 2880, 3120, 3360, 3600]);
    expect(roll.at(-1)!.velocity - roll[0]!.velocity).toBeGreaterThan(0.3);
    expect(roll.at(-1)!.velocity).toBeGreaterThanOrEqual(0.9);
    expect(fillHits({ kind: "snare-roll", grid: grid44, lengthBeats: 1, seed: 1 }).map((hit) => hit.tick)).toEqual([2880, 3120, 3360, 3600]);

    const toms = fillHits({ kind: "tom-run", grid: grid44, lengthBeats: 2, seed: 1 });
    expect(toms.map((hit) => hit.pitch)).toEqual([50, 50, 50, 47, 47, 47, 45, 45]);
    expect(toms.at(-1)!.velocity).toBeGreaterThan(toms[0]!.velocity);

    const pickup = fillHits({ kind: "kick-pickup", grid: grid44, lengthBeats: 1, seed: 1 });
    expect(of(pickup, kick).map((hit) => hit.tick)).toEqual([3360, 3600]);
    expect(at(pickup, 2880, snare)?.velocity).toBeGreaterThanOrEqual(0.85);
    for (const hit of of(pickup, kick)) { expect(hit.velocity).toBeGreaterThanOrEqual(0.8); expect(hit.velocity).toBeLessThanOrEqual(0.95); }

    const lift = fillHits({ kind: "hat-open", grid: grid44, lengthBeats: 2, seed: 1 });
    expect(of(lift, openHat).map((hit) => hit.tick)).toEqual([2400, 3360]);
    expect(at(lift, 3360, openHat)!.velocity).toBeGreaterThan(at(lift, 2400, openHat)!.velocity);
    expect(at(lift, 3360, openHat)!.durationTicks).toBe(480);

    for (const lengthBeats of cycleLengths) {
      const downbeat = fillHits({ kind: "crash-in", grid: grid34, lengthBeats, seed: 1 });
      expect(downbeat.map((hit) => [hit.tick, hit.pitch])).toEqual([[0, kick], [0, crash]]);
      expect(downbeat[1]!.durationTicks).toBeGreaterThan(480);
      expect(flaws(downbeat, grid34.barTicks)).toEqual([]);
    }
  });

  it("replaces the end of the final bar with the fill and leaves the rest of the cycle alone", () => {
    for (const style of grooveStyles) for (const kind of windowed) for (const lengthBeats of cycleLengths) for (const bars of cycleLengths) {
      const grid = naturalGrid(style), end = bars * grid.barTicks, barStart = end - grid.barTicks, label = `${style} ${kind} ${lengthBeats} beats, ${bars} bars`;
      const cycle = groove(style, { bars, ghostNotes: true }), fill = fillHits({ kind, grid, lengthBeats, seed: "fill" });
      const from = end - Math.min(lengthBeats, grid.beatsPerBar) * grid.beatTicks;
      const filled = withFill(cycle, fill, grid, bars);
      expectGroove(filled, grid, bars, label);
      expect(shape(filled.filter((hit) => hit.tick < from)), label).toEqual(shape(cycle.filter((hit) => hit.tick < from)));
      // Inside the window only the fill sounds, plus the bar's own downbeat kick when the fill takes the whole bar.
      const expected = fill.map((hit) => ({ ...hit, tick: hit.tick + barStart }));
      if (from === barStart && !at(expected, barStart, kick)) expected.push(at(cycle, barStart, kick)!);
      expect(shape(filled.filter((hit) => hit.tick >= from)).sort(), label).toEqual(shape(expected).sort());
      expect(at(filled, barStart, kick), label).toEqual(at(cycle, barStart, kick));
    }
  });

  it("removes the hits a fill replaces", () => {
    const cycle = groove("boom-bap", { ghostNotes: true }), filled = withFill(cycle, fillHits({ kind: "tom-run", grid: grid44, lengthBeats: 1, seed: 1 }), grid44, 2);
    expect(at(cycle, 3840 + 2880, snare)).toBeDefined();
    expect(filled.filter((hit) => hit.tick >= 3840 + 2880).map((hit) => hit.pitch)).toEqual([50, 50, 47, 45]);
    expect(filled.filter((hit) => hit.tick < 3840 + 2880)).toEqual(cycle.filter((hit) => hit.tick < 3840 + 2880));
    expect(withFill(cycle, [], grid44, 2)).toEqual(cycle);
  });

  it("lands a crash-in on the cycle's first downbeat without removing anything", () => {
    const cycle = groove("four-on-the-floor", { bars: 4 }), filled = withFill(cycle, fillHits({ kind: "crash-in", grid: grid44, lengthBeats: 1, seed: 1 }), grid44, 4);
    expect(filled).toHaveLength(cycle.length + 1);
    expect(of(filled, crash).map((hit) => hit.tick)).toEqual([0]);
    expect(filled.filter((hit) => hit.pitch !== crash)).toEqual(cycle);
  });
});

describe("Beatbox8 projection", () => {
  const strict = (hits: PatternHit[], cycleTicks: number) => hits.filter((hit) => !([36, 38, 42, 46].includes(hit.pitch) && hit.tick % 240 === 0 && hit.tick >= 0 && hit.tick < cycleTicks && hit.durationTicks === 240 && hit.velocity === 1));

  it("puts every groove, with or without a fill, onto the strict step contract", () => {
    eachGroove((hits, { grid, bars }, label) => {
      const cycleTicks = bars * grid.barTicks;
      const fills = fillKinds.map((kind) => withFill(hits, fillHits({ kind, grid, lengthBeats: 2, seed: "fill" }), grid, bars));
      for (const source of [hits, ...fills]) {
        const steps = toBeatbox8(source, cycleTicks);
        expect(strict(steps, cycleTicks), label).toEqual([]);
        expect(new Set(shape(steps)).size, label).toBe(steps.length);
        expect(at(steps, 0, 36), label).toBeDefined();
        expect(new Set(steps.map((hit) => hit.pitch)).size, label).toBeGreaterThanOrEqual(2);
      }
    });
    for (const grid of [grid54, grid78, grid34]) eachGroove((hits, { bars }, label) => expect(strict(toBeatbox8(hits, bars * grid.barTicks), bars * grid.barTicks), label).toEqual([]), () => grid);
  });

  it("maps voices to the four lanes, snaps to sixteenths, and drops ghosts, overruns and duplicates", () => {
    const hit = (tick: number, pitch: number, velocity = 0.8): PatternHit => ({ tick, durationTicks: 120, pitch, velocity });
    const lane = (pitch: number) => toBeatbox8([hit(0, pitch)], 3840)[0]?.pitch;
    expect([gmDrums.kick, gmDrums.lowTom].map(lane)).toEqual([36, 36]);
    expect([gmDrums.snare, gmDrums.rim, gmDrums.clap, gmDrums.midTom, gmDrums.highTom].map(lane)).toEqual([38, 38, 38, 38, 38]);
    expect([gmDrums.closedHat, gmDrums.pedalHat, gmDrums.ride, gmDrums.shaker, gmDrums.tambourine].map(lane)).toEqual([42, 42, 42, 42, 42]);
    expect([gmDrums.openHat, gmDrums.crash].map(lane)).toEqual([46, 46]);

    expect(toBeatbox8([hit(110, 36), hit(130, 38), hit(360, 42), hit(3700, 42), hit(3730, 36), hit(3840, 38)], 3840).map((step) => [step.tick, step.pitch])).toEqual([[0, 36], [240, 38], [480, 42], [3600, 42]]);
    expect(toBeatbox8([hit(0, 36), hit(40, 36, 0.9), hit(0, 35), hit(240, 38, 0.3), hit(480, 38, 0.35)], 960)).toEqual([{ tick: 0, durationTicks: 240, pitch: 36, velocity: 1 }, { tick: 480, durationTicks: 240, pitch: 38, velocity: 1 }]);
    // A crash becomes the open hat and takes the closed hat's step, as in the grooves themselves.
    expect(toBeatbox8([hit(0, gmDrums.crash), hit(0, 42), hit(240, 42)], 960).map((step) => [step.tick, step.pitch])).toEqual([[0, 46], [240, 42]]);

    const funk = groove("funk", { density: "busy", ghostNotes: true });
    expect(toBeatbox8(funk, 7680)).toEqual(toBeatbox8(funk.filter((item) => item.velocity >= 0.35), 7680));
    expect(toBeatbox8(funk, 7680)).toEqual(toBeatbox8(groove("funk", { density: "busy", ghostNotes: true, seed: "another" }), 7680));
  });
});

describe("groove summary", () => {
  it("counts hits per bar by voice name", () => {
    expect(grooveSummary(groove("straight-pop"), grid44, 2)).toEqual({ kick: [3, 4], snare: [2, 2], closedHat: [8, 8] });
    expect(grooveSummary(groove("four-on-the-floor", { density: "sparse", bars: 4 }), grid44, 4)).toEqual({ kick: [4, 5, 4, 5], clap: [2, 2, 2, 3], openHat: [4, 4, 4, 4] });
    eachGroove((hits, { grid, bars }, label) => {
      const summary = grooveSummary(hits, grid, bars);
      for (const [name, pitch] of Object.entries(gmDrums)) {
        const counts = Array.from({ length: bars }, (_, bar) => of(inBar(hits, grid, bar), pitch).length);
        expect(summary[name], `${label} ${name}`).toEqual(counts.some(Boolean) ? counts : undefined);
      }
      expect(Object.values(summary).flat().reduce((sum, count) => sum + count, 0), label).toBe(hits.length);
    });
  });

  it("names unknown pitches by number and ignores hits outside the counted bars", () => {
    const hits: PatternHit[] = [{ tick: 0, durationTicks: 240, pitch: 41, velocity: 0.8 }, { tick: 3840, durationTicks: 240, pitch: 36, velocity: 0.9 }, { tick: 7680, durationTicks: 240, pitch: 36, velocity: 0.9 }];
    expect(grooveSummary(hits, grid44, 2)).toEqual({ kick: [0, 1], pitch41: [1, 0] });
  });
});
