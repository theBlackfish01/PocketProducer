import { describe, expect, it } from "vitest";
import { applyNativeOperations, canonicalHash, discoverNativeCapabilities, fixtureConstruct, fixtureRevise, inspectNativeCapability, materializedNotes, nativeDiff, nativeMusicHash, NativeToolSession, pinnedContext, protectedPartHash, seedNativeDocument, toNexusTicks, validateNativeOffline, type JobRecord } from "@pocket/core";

function session(direction: string) { return new NativeToolSession({} as JobRecord, seedNativeDocument(direction), false); }

describe("native construction contracts", () => {
  it("keeps generated editorial titles on a word boundary", () => {
    const title = seedNativeDocument("Build an evolving 64-bar ambient journey with a slow lead and spacious transitions into a final release").title;
    expect(title.length).toBeLessThanOrEqual(42);
    expect(title).not.toMatch(/transitio…$/);
  });
  it("rejects device or effect values that the pinned mapper would silently drop", () => {
    const base = seedNativeDocument("A small motif");
    expect(() => applyNativeOperations(base, [{ kind: "setDevice", partId: "starting-voice", device: { type: "heisenberg", parameters: { imaginaryCutoff: 1200 } } }])).toThrow(/mapped native parameters/);
    expect(() => applyNativeOperations(base, [{ kind: "addEffect", partId: "starting-voice", effect: { id: "space", type: "stompboxReverb", parameters: { imaginaryDecay: 0.7 } } }])).toThrow(/mapped native parameters/);
  });
  it("discovers pinned SDK entities and their actual field ranges", async () => {
    const result = await discoverNativeCapabilities("instrument", 32);
    expect(result.totalEntities).toBeGreaterThan(60);
    expect(result.matches.some((value) => value.type === "heisenberg")).toBe(true);
    expect((await discoverNativeCapabilities("audioRegion")).matches[0]?.writableInPocketProducer).toBe(true);
    expect((await discoverNativeCapabilities("audioRegion")).matches[0]?.operationContract.prerequisite).toMatch(/Owned ready WAV/);
    const detail = await inspectNativeCapability("/beatbox8Pattern/length");
    expect(detail.schema.type).toBe("primitive");
    expect(toNexusTicks(960)).toBe(3840);
  });

  it("constructs two materially different directions through the same tool executor", async () => {
    const ambient = session("Build an evolving 64-bar ambient journey with a slow lead and spacious transitions");
    const club = session("Build a driving club track with a sharp hook and a break");
    await fixtureConstruct(ambient, ambient.document.direction, []);
    await fixtureConstruct(club, club.document.direction, []);
    expect(ambient.document.bars).toBe(64);
    expect(ambient.document.parts.length).toBeGreaterThanOrEqual(8);
    expect(ambient.document.motifs.length).toBeGreaterThanOrEqual(16);
    expect(ambient.document.parts.some((part) => part.automation.length > 0)).toBe(true);
    expect(club.document.bars).toBe(32);
    expect(ambient.document.tempoBpm).not.toBe(club.document.tempoBpm);
    expect(canonicalHash(ambient.document)).not.toBe(canonicalHash(club.document));
    expect(pinnedContext(ambient.document, "revision-a").parts.length).toBe(ambient.document.parts.length);
    const offline = await validateNativeOffline(ambient.document);
    expect(offline.readback.synths).toBeGreaterThanOrEqual(4);
    expect(offline.readback.drumMachines).toBeGreaterThanOrEqual(2);
    expect(offline.readback.noteEntities).toBeGreaterThan(100);
    expect(offline.readback.patternRegions).toBeGreaterThan(0);
    expect(offline.readback.effectDevices).toBeGreaterThan(0);
    expect(offline.readback.automationEvents).toBeGreaterThan(0);
  }, 120_000);

  it("makes localized structural revisions without changing a protected part", async () => {
    const draft = session("An evolving 64-bar ambient journey");
    await fixtureConstruct(draft, draft.document.direction, []);
    const protectedId = "lead";
    const protectedBefore = protectedPartHash(draft.document, protectedId);
    draft.document = applyNativeOperations(draft.document, [{ kind: "protect", partIds: [protectedId], motifIds: [] }]);
    const before = structuredClone(draft.document);
    await fixtureRevise(draft, "Vary the rhythmic phrase in the later section", "soft-pulse", "section-4");
    expect(protectedPartHash(draft.document, protectedId)).toBe(protectedBefore);
    expect(nativeDiff(before, draft.document).changedParts).toContain("soft-pulse");
    expect(materializedNotes(draft.document, "soft-pulse").length).toBeGreaterThan(0);
    await expect(fixtureRevise(draft, "Change the instrument", protectedId, "section-4")).rejects.toThrow(/Protected part/);
  }, 30_000);

  it("distinguishes real motif edits from objective-only text changes", async () => {
    const draft = session("A compact rhythmic sketch");
    await fixtureConstruct(draft, draft.document.direction, []);
    const base = draft.document;
    const objectiveOnly = applyNativeOperations(base, [{ kind: "setObjective", objective: "Say this differently" }]);
    expect(nativeMusicHash(objectiveOnly)).toBe(nativeMusicHash(base));
    const labelsOnly = applyNativeOperations(base, [{ kind: "setTitle", title: "New label" }, { kind: "setStructure", bars: base.bars, sections: base.sections.map((section) => ({ ...section, name: `${section.name} renamed`, intent: "New annotation" })) }]);
    expect(nativeMusicHash(labelsOnly)).toBe(nativeMusicHash(base));
    const motif = base.motifs.find((value) => value.partId === "bass-drive")!;
    const changed = applyNativeOperations(base, [{ kind: "replaceMotif", motif: { ...motif, notes: motif.notes.map((value, index) => index === 0 ? { ...value, pitch: value.pitch + 1 } : value) } }]);
    expect(nativeMusicHash(changed)).not.toBe(nativeMusicHash(base));
    expect(nativeDiff(base, changed).changedParts).toContain("bass-drive");
  });

  it("rejects Beatbox8 changes the boolean-step mapper cannot faithfully express", async () => {
    const draft = session("A driving rhythmic sketch");
    await fixtureConstruct(draft, draft.document.direction, []);
    const base = draft.document;
    const part = base.parts.find((value) => value.id === "kick-grid")!;
    const motif = base.motifs.find((value) => value.partId === part.id)!;
    expect(() => applyNativeOperations(base, [{ kind: "replacePlacements", partId: part.id, placements: part.placements.map((placement, index) => index === 0 ? { ...placement, transpose: 2 } : placement) }])).toThrow(/Beatbox8/);
    expect(() => applyNativeOperations(base, [{ kind: "replaceMotif", motif: { ...motif, notes: motif.notes.map((note, index) => index === 0 ? { ...note, velocity: 0.5 } : note) } }])).toThrow(/Beatbox8/);
    expect(() => applyNativeOperations(base, [{ kind: "replaceMotif", motif: { ...motif, notes: motif.notes.map((note, index) => index === 0 ? { ...note, pitch: 40 } : note) } }])).toThrow(/Beatbox8/);
  });
});
