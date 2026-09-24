import { describe, expect, it } from "vitest";
import { interpretNativeBrief } from "./intent.js";
import { applyNativeOperations } from "./model.js";
import { nativeCompletionIssues, seedNativeDocument } from "./producer.js";

const part = (id: string, role: "melody" | "bass" | "percussion") => ({ id, name: id, role, device: { type: "heisenberg" as const, parameters: {} }, gain: 0.6, pan: 0, notes: [{ id: `${id}-note`, startTick: 0, durationTicks: 960, pitch: 60, velocity: 0.7 }], placements: [], sourceRegions: [], effects: [], automation: [] });
const melody = applyNativeOperations(seedNativeDocument("A melody"), [{ kind: "removePart", partId: "starting-voice" }, { kind: "addPart", part: part("lead", "melody") }]);

describe("traceable native brief constraints", () => {
  it("accepts explicit exclusions without requesting the excluded roles", () => {
    expect(interpretNativeBrief("Make a 4-bar melody with no drums and no bass")).toMatchObject({ totalBars: 4, excludedRoles: [{ label: "drums" }, { label: "bass" }] });
    expect(nativeCompletionIssues(melody, "Make a 4-bar melody with no drums and no bass", "generation")).toEqual([]);
    const forbidden = applyNativeOperations(melody, [{ kind: "addPart", part: part("drums", "percussion") }]);
    expect(nativeCompletionIssues(forbidden, "A melody without drums", "generation")).toContain("Excluded drums has constructed material");
  });
  it("distinguishes total duration from section lengths and leaves ambiguous totals advisory", () => {
    const long = applyNativeOperations(melody, [{ kind: "setStructure", bars: 32, sections: [{ id: "intro", name: "Intro", startBar: 0, endBar: 4, intent: "Quiet" }, { id: "body", name: "Body", startBar: 4, endBar: 32, intent: "Develop" }] }]);
    expect(interpretNativeBrief("Start with a 4-bar intro, then develop a 32-bar melody in total").totalBars).toBe(32);
    expect(nativeCompletionIssues(long, "Start with a 4-bar intro, then develop a 32-bar melody in total", "generation")).toEqual([]);
    expect(interpretNativeBrief("A 4-bar intro and an 8-bar verse")).toMatchObject({ totalBars: null, advisory: [expect.stringContaining("Several section lengths")] });
  });
  it("requires a positive ensemble, treats optional roles as optional and keeps the empty-sketch guard", () => {
    expect(nativeCompletionIssues(melody, "A 4-bar melody with bass and drums", "generation")).toEqual(expect.arrayContaining(["Requested bass has no constructed material", "Requested drums has no constructed material"]));
    expect(nativeCompletionIssues(melody, "A melody, maybe add bass if useful", "generation")).toEqual([]);
    expect(nativeCompletionIssues(melody, "Something intimate and evolving", "generation")).toEqual([]);
    expect(nativeCompletionIssues(seedNativeDocument("Something intimate"), "Something intimate", "generation")).toContain("The starting sketch was not replaced");
    expect(nativeCompletionIssues(melody, "Simplify the drums", "revision")).toEqual([]);
  });
});
