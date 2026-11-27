import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { REPOSITORY_ROOT } from "../config.js";
import { describe, expect, it } from "vitest";
import { validateNativeOffline } from "./adapter.js";
import { compileRecipe, sceneOperations } from "./construction-tools.js";
import { applyNativeOperations, barTicks, materializedNotes, nativeMusicHash } from "./model.js";
import { seedNativeDocument } from "./producer.js";
import { buildReference, referenceScene, starterReferences } from "./starter-references.js";
import { checkReviewedKitReplacement, editPassage } from "./passage-edits.js";
import { arrangementTemplates } from "./template-catalog.js";
import { starterSuggestions } from "./starters.js";
import { symbolicNativeReview, validateNativeReview } from "./critique.js";

describe("original arrangement starters", () => {
  const v1Hashes = {
    "french-house-v1":"93660058b8ca2b30792c455790c7c936d86ff974f1d45770245f095b8ba1dd8b",
    "broken-beat-v1":"1794fadc6384727fee3c931c558f08a7c1167190987453fcb1712d4edbe4ab17",
    "chamber-waltz-v1":"29cd8931f3b5a77fd97f822820abfc433e151a93a94568641aafe1f3cffdf9b4",
    "synthwave-v1":"b5cbde4d3474e9ad2c3297525676f60c6f0d28837def10fb37a767bb25ac4cf7",
    "bossa-nova-v1":"cab96665deec13c0419f7f96df7e60621a22e167d84251b9898c5d2af438e216",
    "tidal-ambient-v1":"7b372a278e8bc65c62f5512d265829691e99ad4d2503924826fc58936c9b823e"
  };
  const recordingHashes = {
    "french-house-v1": "e06b3a4b7ab4ba48468bfe56cd3601bc33e187d6d74ec77b058c16a5860f5f71",
    "broken-beat-v1": "2b520bd485d2ba4bd881b4417cce8b5240266f8ad99e8346b5d3ea3f5dd66f26",
    "chamber-waltz-v1": "6d563a220b10bb19c9504c55836e345fdf53d259c84d7e393b4119aa5b02d89c",
    "synthwave-v1": "ee0c147f86b313747b0c99c72d2ab906fdcb361cc9a60b5ebe7aca4a56494e99",
    "bossa-nova-v1": "b66ddaf274d4152f25b4302aac0c55077b7e5b677604580ef4b80583f4372468",
    "tidal-ambient-v1": "fd6e45d315d01e6e35333fb0bb2b30a22563c70f5d691367f915c212398d5fae"
  };
  it("publishes one editable score per template", () => {
    expect(arrangementTemplates.map(t => t.id).sort()).toEqual(starterReferences.map(r => r.id).sort());
  });
  for (const ref of starterReferences) it(`maps ${ref.title} to editable Nexus notes, automation and its requested drum palette`, async () => {
    const score = buildReference(ref);
    expect(score).toEqual(buildReference(ref));
    expect(nativeMusicHash(score)).toBe(recordingHashes[ref.id]);
    const file = await open(resolve(REPOSITORY_ROOT, "apps/web/public/templates", ref.id + ".mp3"), "r");
    try {
      const tag = Buffer.alloc(1024);
      await file.read(tag, 0, tag.length, 0);
      expect(tag.subarray(0, 3).toString()).toBe("ID3");
      expect(tag.includes(Buffer.from("Pocket Producer reference " + recordingHashes[ref.id]))).toBe(true);
    } finally { await file.close(); }
    expect(arrangementTemplates.find(t => t.id === ref.id)).toMatchObject({ title: score.title, bpm: score.tempoBpm, beats: score.meter.numerator, bars: score.bars });
    expect(score.meter).toEqual({ numerator: ref.beats, denominator: 4 });
    expect(score.tempoBpm).toBe(ref.bpm);
    expect(score.sourceAssetIds).toEqual([]);
    expect(score.parts.some(p => p.device.preset)).toBe(false);
    const landing = (score.bars - 1) * barTicks(score);
    expect(materializedNotes(score, "bass").filter(n => n.startTick >= landing).map(n => n.startTick)).toEqual([landing]);
    expect(materializedNotes(score, "keys").filter(n => n.startTick >= landing).every(n => n.startTick === landing)).toBe(true);
    const bar = (i: number) => materializedNotes(score, "bass").filter(n => n.startTick >= i * barTicks(score) && n.startTick < (i + 1) * barTicks(score));
    const breakSection = score.sections[2]!, lift = score.sections[3]!;
    expect(bar(breakSection.startBar)).toHaveLength(0);
    expect(bar(lift.startBar).length).toBeGreaterThan(0);
    expect(score.motifs.filter(m => m.partId === "lead" && m.derivedFromMotifId).length).toBeGreaterThanOrEqual(3);
    const starter = buildReference(ref, false);
    expect(materializedNotes(starter, "lead")).toEqual([]);
    expect(nativeMusicHash(starter)).toEqual(v1Hashes[ref.id]);
    const sdk = await validateNativeOffline(score);
    expect(sdk.readback.noteEntities).toBeGreaterThan(50);
    expect(sdk.readback.automationEvents).toBe(ref.id === "broken-beat-v1" ? 21 : 6);
    const hasKit = ref.id !== "chamber-waltz-v1" && ref.id !== "tidal-ambient-v1";
    expect(sdk.readback.drumMachines).toBe(hasKit ? 1 : 0);
    if (hasKit) {
      const hits = materializedNotes(score, "drums");
      expect(hits.every(n => n.startTick % 240 === 0 && n.velocity === 1 && n.durationTicks === 240 && n.startTick < landing)).toBe(true);
      expect(sdk.readback.patternRegions).toBeGreaterThan(0);
    }
  }, 30000);

  const ref = starterReferences[0]!;
  const seed = seedNativeDocument("Short house study");
  const base = referenceScene(ref, false);
  it("suggests at most two fitting starters, respecting a captured meter and whole-piece absences", () => {
    expect(starterSuggestions("French house with some neo-soul and a waltz feel", null)).toHaveLength(2);
    expect(starterSuggestions("Unmetered solo piano inspired by disco", null)).toEqual([]);
    expect(starterSuggestions("French house", { meter: { numerator: 7, denominator: 8, quote: "7/8" }, roles: [] })).toEqual([]);
    expect(starterSuggestions("Disco without any drums", { meter: null, roles: [{ kind: "absent", role: "drums", section: null, quote: "without any drums", reduceDensity: false }] })).toEqual([]);
  });

  it("can make three distinct house foundations from one palette", () => {
    const docs = (["spare", "signature", "driving"] as const).map((pocket, i) => {
      const input = { ...base, starter: { ...base.starter, pocket, lead: i !== 2 } };
      return applyNativeOperations(seed, sceneOperations(input, seed));
    });
    const counts = docs.map(doc => materializedNotes(doc, "bass").length);
    expect(counts[0]!).toBeLessThan(counts[1]!);
    expect(counts[1]!).toBeLessThan(counts[2]!);
    expect(docs[2]!.parts.some(p => p.id === "lead")).toBe(false);
  });

  it("thins the pocket while retaining kick/snare timing, complete voicings and other sections", async () => {
    const before = buildReference(ref), section = before.sections[1]!, bar = barTicks(before);
    const after = applyNativeOperations(before, editPassage(before, section.id, { kind: "thin", partIds: ["drums", "keys", "bass"] }));
    const performance = (score: typeof before, partId: string) => materializedNotes(score, partId).map(n => [n.startTick, n.pitch, n.durationTicks, n.velocity]);
    for (const id of ["drums", "keys", "bass"]) {
      const outside = (n: number[]) => n[0]! < section.startBar * bar || n[0]! >= section.endBar * bar;
      expect(performance(after, id).filter(outside)).toEqual(performance(before, id).filter(outside));
      expect(performance(after, id).length).toBeLessThan(performance(before, id).length);
    }
    expect(performance(after, "drums").filter(n => n[1]! < 42)).toEqual(performance(before, "drums").filter(n => n[1]! < 42));
    const locked = { ...before, protectedPartIds: ["keys"] };
    expect(() => applyNativeOperations(locked, editPassage(locked, section.id, { kind: "thin", partIds: ["keys"] }))).toThrow(/protected/i);
    await validateNativeOffline(after);
  });
  it("restores a placed kit pattern for two bars without changing surrounding hits or any other voice", async () => {
    const before = buildReference(starterReferences[1]!);
    const section = before.sections[3]!, bar = barTicks(before);
    const edit = { kind: "reuseKitPattern" as const, partId: "drums", motifId: "kit-pocket", offsetBars: 2, repeats: 2 };
    const ops = editPassage(before, section.id, edit);
    expect(ops).toEqual(editPassage(before, section.id, edit));
    expect(ops.map(o => o.kind)).toEqual(["replacePlacements"]);
    const after = applyNativeOperations(before, ops);
    const start = (section.startBar + edit.offsetBars) * bar, end = start + 2 * bar;
    const hits = (doc: typeof before) => materializedNotes(doc, "drums")
      .sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch).map(n => [n.startTick, n.pitch, n.durationTicks, n.velocity]);
    const outside = (n: number[]) => n[0]! < start || n[0]! >= end;
    expect(hits(after).filter(outside)).toEqual(hits(before).filter(outside));
    const pattern = before.motifs.find(m => m.id === edit.motifId)!;
    expect(hits(after).filter(n => !outside(n))).toEqual([start, start + bar].flatMap(t =>
      [...pattern.notes].sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch).map(n => [t + n.startTick, n.pitch, n.durationTicks, n.velocity])));
    expect(after.motifs).toEqual(before.motifs);
    expect(after.parts.filter(p => p.id !== "drums")).toEqual(before.parts.filter(p => p.id !== "drums"));
    expect(() => editPassage(after, section.id, edit)).toThrow(/already fills/);
    expect(() => editPassage(before, section.id, { ...edit, repeats: 8 })).toThrow(/beyond/);
    expect(() => editPassage(before, section.id, { ...edit, partId: "bass" })).toThrow(/same Beatbox8/);
    expect(() => editPassage({ ...before, protectedPartIds: ["drums"] }, section.id, edit)).toThrow(/protected/);
    expect(() => editPassage({ ...before, protectedMotifIds: ["kit-lift"] }, section.id, edit)).toThrow(/protected/);
    await validateNativeOffline(after);
  });

  it("rejects a kit replacement that would cut into a neighboring repetition", () => {
    const score = buildReference(starterReferences[1]!);
    const section = score.sections[3]!, bar = barTicks(score);
    score.motifs.find(m => m.id === "kit-lift")!.lengthTicks = 2 * bar;
    score.parts.find(p => p.id === "drums")!.placements = [{ id: "two-bars", motifId: "kit-lift", startTick: section.startBar * bar, repeats: 2, transpose: 0 }];
    const edit = { kind: "reuseKitPattern" as const, partId: "drums", motifId: "kit-pocket", offsetBars: 1, repeats: 1 };
    expect(() => editPassage(score, section.id, edit)).toThrow(/complete drum repetitions/);
  });

  it("keeps a local drum repair from silencing earlier sections and can rest the requested section with all slots occupied", async () => {
    const score = buildReference(starterReferences[1]!);
    const section = score.sections[3]!, kit = score.parts.find(p => p.id === "drums")!;
    const review = validateNativeReview({ verdict: "Give the arrival more space.", noChangeReason: null,
      findings: [{ priority: "medium", sectionId: section.id, partId: kit.id, observation: "The kit remains busy.", suggestedChange: "Leave the kit silent in this section." }] }, score, true);
    const incomplete = [{ kind: "replacePlacements" as const, partId: kit.id, placements: kit.placements.slice(0, 1) }];
    expect(score.motifs.filter(m => m.partId === kit.id)).toHaveLength(5);
    expect(() => checkReviewedKitReplacement(score, incomplete, review)).toThrow(/would also silence/);
    expect(() => checkReviewedKitReplacement(score, [...incomplete, { kind: "setMix", partId: kit.id, gain: 0.5 }], review)).toThrow(/would also silence/);
    expect(() => checkReviewedKitReplacement(score, incomplete, null)).not.toThrow();
    expect(() => checkReviewedKitReplacement(score, incomplete, { ...review, findings: review.findings.map(f => ({ ...f, sectionId: null })) })).not.toThrow();
    const rest = { kind: "restKitSection" as const, partId: kit.id };
    const scoped = editPassage(score, section.id, rest);
    expect(() => checkReviewedKitReplacement(score, scoped, review)).not.toThrow();
    const after = applyNativeOperations(score, scoped), bar = barTicks(score);
    const outside = materializedNotes(score, kit.id).filter(n => n.startTick < section.startBar * bar || n.startTick >= section.endBar * bar);
    expect(materializedNotes(after, kit.id)).toEqual(outside);
    expect(after.motifs).toEqual(score.motifs);
    expect(() => editPassage(after, section.id, rest)).toThrow(/already silent/);
    expect(() => editPassage({ ...score, protectedPartIds: [kit.id] }, section.id, rest)).toThrow(/editable Beatbox8/);
    expect(() => editPassage({ ...score, protectedMotifIds: ["kit-lift"] }, section.id, rest)).toThrow(/protected phrase/);
    expect(() => editPassage({ ...score, protectedPartIds: [kit.id] }, section.id, rest)).toThrow(/editable/);
    await validateNativeOffline(after);
  });

  it("lands voices together inside a two-bar lead phrase and preserves its earlier performance", async () => {
    const before = buildReference(ref), last = before.sections.at(-1)!, landing = (before.bars - 1) * barTicks(before);
    const args = { kind: "land" as const, voices: [{ partId: "lead", pitches: [74] }, { partId: "bass", pitches: [38] }, { partId: "keys", pitches: [53, 57, 60, 64] }, { partId: "drums", pitches: [] }] };
    const after = applyNativeOperations(before, editPassage(before, last.id, args));
    for (const { partId, pitches } of args.voices) {
      const earlier = (doc: typeof before) => materializedNotes(doc, partId).filter(n => n.startTick < landing).map(n => [n.startTick, n.pitch, n.durationTicks, n.velocity]);
      expect(earlier(after)).toEqual(earlier(before));
      expect(materializedNotes(after, partId).filter(n => n.startTick >= landing).map(n => n.pitch).sort((a, b) => a - b)).toEqual(pitches);
    }
    await validateNativeOffline(after);
  });
  it("honors a new brief's length, key, tempo, landing and omitted lead", () => {
    const structure = { tempoBpm: 109, bars: 6, sections: [{ name: "Pocket", id: "a", startBar: 0, endBar: 3 }, { name: "Landing", id: "b", startBar: 3, endBar: 6 }] };
    const adapted = { ...base, structure, starter: { ...base.starter, chords: ["Em7/B", "Am9"], landing: "Cmaj7/E", arc: ["pocket", "close"], lead: false } };
    const score = applyNativeOperations(seed, sceneOperations(adapted, seed));
    expect(score.bars).toBe(6);
    expect(score.tempoBpm).toBe(109);
    expect(score.parts.find(p => p.id === "lead")).toBeUndefined();
    expect(materializedNotes(score, "bass")[0]!.pitch % 12).toBe(11);
    expect(materializedNotes(score, "bass").at(-1)!.pitch % 12).toBe(4);
  });

  it("accepts an original bass hook in the starter scene without doubling its notes", async () => {
    const original = buildReference(ref, false);
    const custom = { ...base, starter: { ...base.starter, bassLine: "authored", lead: false },
      patterns: [{ id: "bass-hook", name: "Bass question", partId: "bass", lengthTicks: 3840, events: [[240, 360, 43, .8], [1680, 480, 46, .65]] }],
      placements: [{ partId: "bass", placement: { id: "first", motifId: "bass-hook", startTick: 0, repeats: 1, transpose: 0 } }] };
    const score = applyNativeOperations(seed, sceneOperations(custom, seed));
    expect(materializedNotes(score, "bass").map(n => [n.startTick, n.pitch])).toEqual([[240, 43], [1680, 46]]);
    expect(score.parts.find(p => p.id === "bass")!.device).toEqual(original.parts.find(p => p.id === "bass")!.device);
    for (const id of ["keys", "drums"]) expect(materializedNotes(score, id)).toEqual(materializedNotes(original, id));
    expect(score.parts.some(p => p.id === "lead")).toBe(false);
    await validateNativeOffline(score);
  });

  it("identifies an exact local glass patch for review without claiming a remote preset", () => {
    const doc = buildReference(starterReferences[1]!, false);
    const evidence = () => symbolicNativeReview(doc, null).soundEvidence.find(p => p.id === "lead")!;
    expect(evidence()).toMatchObject({ matchedLocalParameterRecipe: "glass-bell", presetHash: null });
    doc.parts.find(p => p.id === "lead")!.effects[0]!.parameters.mix = 0.37;
    expect(evidence().matchedLocalParameterRecipe).toBeUndefined();
  });

  it("rejects conflicting or invalid starter requests before touching an existing score", () => {
    const doubled = { ...base, parts: [{ id: "bass", name: "Bass", role: "bass", recipe: "dusty-bass" }] };
    expect(() => sceneOperations(doubled, seed)).toThrow(/starter already supplies bass/i);
    expect(() => sceneOperations({ ...base, meter: { numerator: 3, denominator: 4 } }, seed)).toThrow(/meter/i);
    expect(() => sceneOperations({ ...base, starter: { ...base.starter, arc: ["open"] } }, seed)).toThrow(/arc/i);
    expect(() => sceneOperations({ ...base, starter: { ...base.starter, landing: "J99" } }, seed)).toThrow(/chord/i);
    expect(() => sceneOperations({ ...base, structure: { ...base.structure, bars: 4 } }, seed)).toThrow(/sections/i);
    expect(() => sceneOperations(base, buildReference(ref))).toThrow(/fresh/i);
    expect(() => sceneOperations(base, { ...seed, protectedPartIds: ["starting-voice"] })).toThrow(/fresh/i);
    expect(seed.parts[0]!.id).toBe("starting-voice");
  });

  it("revoices factory effects in place and keeps customized effects", () => {
    const score = buildReference(starterReferences[0]!, false);
    const apply = (doc: typeof score, partId: string, recipeId: "sub-round" | "house-stab") =>
      applyNativeOperations(doc, compileRecipe({ kind: "applyRecipe", partId, recipeId }, doc));
    const keys = (doc: typeof score) => doc.parts.find(p => p.id === "keys")!;
    const bass = (doc: typeof score) => doc.parts.find(p => p.id === "bass")!;
    expect(keys(apply(score, "keys", "house-stab")).effects).toEqual(keys(score).effects);
    const changed = apply(score, "bass", "sub-round");
    expect(bass(changed).effects.map(fx => fx.id)).toEqual(["fx-1"]);
    expect(bass(changed).effects[0]!.parameters).not.toEqual(bass(score).effects[0]!.parameters);
    expect(bass(apply(changed, "bass", "sub-round")).effects).toEqual(bass(changed).effects);
    const custom = structuredClone(score);
    bass(custom).effects[0]!.parameters.thresholdDb = -23;
    const edited = bass(apply(custom, "bass", "sub-round"));
    expect(edited.effects.map(fx => fx.id)).toEqual(["fx-1", "sub-round-1"]);
    expect(edited.effects[0]!.parameters.thresholdDb).toBe(-23);
  });
});
