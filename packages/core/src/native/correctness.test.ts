import { describe, expect, it } from "vitest";
import { resolveNativePreservation } from "./intent.js";
import { nativeCompletionIssues, seedNativeDocument } from "./producer.js";
import type { NativeDocument } from "./model.js";

function fixture(): NativeDocument {
  const doc = seedNativeDocument("Independent preservation checks");
  doc.parts[0]!.id = "bells"; doc.parts[0]!.name = "Glass Bells";
  doc.parts[0]!.notes = [{ id: "n", startTick: 0, durationTicks: 480, pitch: 60, velocity: 0.7 }];
  doc.sections = [{ id: "intro", name: "Intro", startBar: 0, endBar: 2, intent: "" }, { id: "outro", name: "Outro", startBar: 2, endBar: 4, intent: "" }];
  return doc;
}
describe("focused correctness gates", () => {
  it("resolves real names and identities in preview and rejects a wrong candidate", () => {
    const base = fixture(), wrong = structuredClone(base); wrong.parts[0]!.notes[0]!.pitch++;
    for (const text of ["Keep Glass Bells unchanged", "Do not change Glass Bells", "Preserve part bells"]) {
      expect(resolveNativePreservation(text, base).namedParts.map((part) => part.id)).toEqual(["bells"]);
      expect(nativeCompletionIssues(wrong, text, "revision", [], base)).toContain("Requested preservation of Glass Bells was not met");
      expect(nativeCompletionIssues(base, text, "revision", [], base)).toEqual([]);
    }
  });
  it("keeps actual named protection scoped, rejects ambiguity, and does not overlock role words in names", () => {
    const base = fixture(); base.parts.push({ ...structuredClone(base.parts[0]!), id: "other", name: "Warm Bass", role: "bass" });
    base.parts.push({ ...structuredClone(base.parts[1]!), id: "sub", name: "Sub" });
    expect(resolveNativePreservation("Keep Warm Bass unchanged", base).namedParts.map((part) => part.id)).toEqual(["other"]);
    const outside = structuredClone(base); outside.parts[0]!.notes.push({ id: "later", startTick: 8000, durationTicks: 480, pitch: 67, velocity: 0.7 });
    expect(nativeCompletionIssues(outside, "Keep Glass Bells unchanged in Intro", "revision", [], base)).toEqual([]);
    base.parts[1]!.name = "Glass Bells";
    expect(resolveNativePreservation("Keep Glass Bells unchanged", base).unresolved.join()).toMatch(/more than one/);
    expect(resolveNativePreservation("Keep part bells unchanged", base).unresolved).toEqual([]);
  });
  it("compares the entire phrase family including additions and new placements without locking sound settings", () => {
    const base = fixture(); base.parts[0]!.notes = [];
    base.motifs = [{ id: "theme", name: "Bell phrase", partId: "bells", lengthTicks: 3840, notes: [{ id: "a", startTick: 0, durationTicks: 480, pitch: 60, velocity: 0.7 }] }];
    base.parts[0]!.placements = [{ id: "first", motifId: "theme", startTick: 0, repeats: 1, transpose: 0 }];
    for (const direction of ["Keep the theme", "Keep Bell phrase unchanged"]) {
      const added = structuredClone(base); added.motifs[0]!.notes.push({ id: "b", startTick: 480, durationTicks: 480, pitch: 64, velocity: 0.7 });
      expect(nativeCompletionIssues(added, direction, "revision", [], base).join()).toMatch(/preservation of theme/);
      const duplicated = structuredClone(base); duplicated.parts[0]!.placements.push({ ...duplicated.parts[0]!.placements[0]!, id: "duplicate" });
      expect(nativeCompletionIssues(duplicated, direction, "revision", [], base).join()).toMatch(/preservation of theme/);
      const changedSound = structuredClone(base); changedSound.parts[0]!.gain = 0.4;
      expect(nativeCompletionIssues(changedSound, direction, "revision", [], base)).toEqual([]);
      const outside = structuredClone(base); outside.parts[0]!.placements.push({ ...outside.parts[0]!.placements[0]!, id: "later", startTick: 8000 });
      expect(nativeCompletionIssues(outside, direction, "revision", [], base, "intro")).toEqual([]);
    }
  });
  it("accepts connected shared, group and parallel ambience reductions but rejects unused or out-of-scope changes", () => {
    const base = fixture(); base.delayBus = { id: "space", name: "Space", feedbackFactor: 0.6, stepCount: 3, stepLengthIndex: 2 };
    base.parts[0]!.sends = [{ busId: "space", gain: 0.5 }];
    const changed = structuredClone(base); changed.delayBus!.feedbackFactor = 0.2;
    expect(nativeCompletionIssues(changed, "Shorten the delay tail", "revision", [], base, "intro")).toEqual([]);
    const bass = { ...structuredClone(base.parts[0]!), id: "bass", name: "Bass", role: "bass" as const, sends: [] };
    base.parts.push(bass); changed.parts.push(structuredClone(bass));
    expect(nativeCompletionIssues(changed, "Shorten the delay tail, but keep the bass", "revision", [], base, "intro")).toEqual([]);
    expect(nativeCompletionIssues(changed, "Shorten the delay tail", "revision", [], base, "outro").join()).toMatch(/no evidenced/);
    base.parts[0]!.sends = []; changed.parts[0]!.sends = [];
    expect(nativeCompletionIssues(changed, "Shorten the delay tail", "revision", [], base).join()).toMatch(/no evidenced/);
    const effect = { id: "delay", type: "stompboxDelay" as const, parameters: { feedbackFactor: 0.6 } };
    base.groups = [{ id: "bus", name: "Bus", gain: 1, pan: 0, parallel: { wetMix: 0.5, effects: [effect] } }]; base.parts[0]!.groupId = "bus";
    const group = structuredClone(base); group.groups![0]!.parallel!.effects[0]!.parameters.feedbackFactor = 0.2;
    expect(nativeCompletionIssues(group, "Shorten the delay tail", "revision", [], base)).toEqual([]);
    base.parts[0]!.groupId = undefined; group.parts[0]!.groupId = undefined;
    expect(nativeCompletionIssues(group, "Shorten the delay tail", "revision", [], base).join()).toMatch(/no evidenced/);

    const local = fixture(); local.parts[0]!.effects = [{ id: "room", type: "stompboxReverb", parameters: { roomSizeFactor: 0.7, mix: 0.5 } }];
    const shorter = structuredClone(local); shorter.parts[0]!.effects[0]!.parameters.roomSizeFactor = 0.3;
    expect(nativeCompletionIssues(shorter, "Shorten the reverb tail", "revision", [], local)).toEqual([]);
    const muted = fixture(); muted.parts[0]!.parallel = { wetMix: 0.5, effects: [{ id: "echo", type: "stompboxDelay", parameters: { feedbackFactor: 0.7, mix: 0.5 } }] };
    muted.parts[0]!.automation = [{ id: "mute-echo", target: "parallel.wetMix", points: [{ tick: 0, value: 0 }, { tick: 15360, value: 0 }] }];
    const mutedShorter = structuredClone(muted); mutedShorter.parts[0]!.parallel!.effects[0]!.parameters.feedbackFactor = 0.2;
    expect(nativeCompletionIssues(mutedShorter, "Shorten the delay tail", "revision", [], muted).join()).toMatch(/no evidenced/);
  });
});
