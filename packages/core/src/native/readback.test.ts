import { createOfflineDocument } from "@audiotool/nexus/node";
import { describe, expect, it } from "vitest";
import { canonicalHash } from "../domain/composition.js";
import { applyNativeSnapshot, nativeStructuralReadback, toNexusTicks } from "./adapter.js";
import { applyNativeOperations } from "./model.js";
import { seedNativeDocument } from "./producer.js";

async function mapped(automationTarget: "gain" | "pan" = "gain") {
  const base = seedNativeDocument("A small sound-design probe");
  const document = applyNativeOperations(base, [
    { kind: "setDevice", partId: "starting-voice", device: { type: "heisenberg", parameters: { "filter.cutoffFrequencyHz": 850, "operatorA.gain": 0.72 } } },
    { kind: "addNotes", partId: "starting-voice", notes: [{ id: "note-a", startTick: 0, durationTicks: 480, pitch: 60, velocity: 0.7 }] },
    { kind: "addEffect", partId: "starting-voice", effect: { id: "delay-a", type: "stompboxDelay", parameters: { feedbackFactor: 0.3, mix: 0.24 } } },
    { kind: "addAutomation", partId: "starting-voice", automation: { id: "gain-arc", target: automationTarget, points: [{ tick: 0, value: 0.2 }, { tick: 3840, value: 0.8 }] } }
  ]);
  const offline = await createOfflineDocument({ validated: true });
  await applyNativeSnapshot(offline, document);
  return offline;
}

describe("semantic native readback", () => {
  it("normalizes independently allocated SDK IDs while retaining real parameter intent", async () => {
    const a = await mapped();
    const b = await mapped();
    expect(canonicalHash(nativeStructuralReadback(a))).toBe(canonicalHash(nativeStructuralReadback(b)));
    const synth = a.queryEntities.ofTypes("heisenberg").getOne()!;
    const delay = a.queryEntities.ofTypes("stompboxDelay").getOne()!;
    expect(synth.fields.filter.fields.cutoffFrequencyHz.value).toBeCloseTo(850, 3);
    expect(synth.fields.operatorA.fields.gain.value).toBeCloseTo(0.72, 3);
    expect(delay.fields.feedbackFactor.value).toBeCloseTo(0.3, 3);
  });

  it("changes when a region moves or mixer gain changes", async () => {
    const doc = await mapped();
    const before = canonicalHash(nativeStructuralReadback(doc));
    const region = doc.queryEntities.ofTypes("noteRegion").getOne()!;
    await doc.modify((t) => t.update(region.fields.region.fields.positionTicks, toNexusTicks(3840)));
    const moved = canonicalHash(nativeStructuralReadback(doc));
    expect(moved).not.toBe(before);
    const channel = doc.queryEntities.ofTypes("mixerChannel").getOne()!;
    await doc.modify((t) => t.update(channel.fields.preGain, 0.01));
    expect(canonicalHash(nativeStructuralReadback(doc))).not.toBe(moved);
  });

  it("tracks loop length, pan, effect setting and automation target/value rather than counts", async () => {
    const doc = await mapped();
    const initial = canonicalHash(nativeStructuralReadback(doc));
    const region = doc.queryEntities.ofTypes("noteRegion").getOne()!;
    await doc.modify((t) => t.update(region.fields.region.fields.loopDurationTicks, toNexusTicks(1920)));
    const looped = canonicalHash(nativeStructuralReadback(doc));
    expect(looped).not.toBe(initial);
    const channel = doc.queryEntities.ofTypes("mixerChannel").getOne()!;
    await doc.modify((t) => t.update(channel.fields.faderParameters.fields.panning, 0.42));
    const panned = canonicalHash(nativeStructuralReadback(doc));
    expect(panned).not.toBe(looped);
    const delay = doc.queryEntities.ofTypes("stompboxDelay").getOne()!;
    await doc.modify((t) => t.update(delay.fields.feedbackFactor, 0.64));
    const effected = canonicalHash(nativeStructuralReadback(doc));
    expect(effected).not.toBe(panned);
    const event = doc.queryEntities.ofTypes("automationEvent").getOne()!;
    await doc.modify((t) => t.update(event.fields.value, 0.3));
    expect(canonicalHash(nativeStructuralReadback(doc))).not.toBe(effected);
    const encoded = JSON.stringify(nativeStructuralReadback(doc));
    expect(encoded).toContain("desktopAudioCable");
    expect(encoded).toContain("automationTrack");
  });

  it("tracks cable endpoints and automation parameter targets", async () => {
    const doc = await mapped();
    const before = canonicalHash(nativeStructuralReadback(doc));
    const cable = doc.queryEntities.ofTypes("desktopAudioCable").get()[0]!;
    const delay = doc.queryEntities.ofTypes("stompboxDelay").getOne()!;
    await doc.modify((t) => t.update(cable.fields.fromSocket, delay.fields.audioOutput.location));
    const rerouted = canonicalHash(nativeStructuralReadback(doc));
    expect(rerouted).not.toBe(before);
    const panTarget = await mapped("pan");
    const gainTarget = await mapped("gain");
    expect(canonicalHash(nativeStructuralReadback(panTarget))).not.toBe(canonicalHash(nativeStructuralReadback(gainTarget)));
  });
});
