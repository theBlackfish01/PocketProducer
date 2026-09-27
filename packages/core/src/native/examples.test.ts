import { describe, expect, it } from "vitest";
import { readNativeExample, searchNativeExamples } from "./examples.js";
import { discoverNativeCapabilities } from "./catalog.js";
import { createOfflineDocument } from "@audiotool/nexus/node";
import { applyNativeSnapshot } from "./adapter.js";
import { nativeFormOperations } from "./form.js";
import { applyNativeOperations } from "./model.js";
import { seedNativeDocument } from "./producer.js";
import { symbolicNativeReview } from "./critique.js";

describe("retrievable musical references", () => {
  it("offers three substantive original scenes without treating them as heard music", () => {
    const ids = ["disco-groove-study", "disco-rise-study", "sparse-motif-handoff"];
    for (const id of ids) {
      const example = readNativeExample(id);
      expect(example.documentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(example.heard).toBe(false);
      expect(example.sectionMap.length).toBeGreaterThan(1);
      expect(example.motifMap[0]?.notes).toBeGreaterThan(0);
    }
    expect(readNativeExample("sparse-motif-handoff").documentHash).not.toBe(readNativeExample("disco-rise-study").documentHash);
  });
  it("retrieves a relevant example and finds FM filter capability by multiword query", async () => {
    expect(searchNativeExamples("sparse").map((item) => item.id)).toContain("sparse-motif-handoff");
    expect(searchNativeExamples("groove").map((item) => item.id)).toContain("disco-groove-study");
    expect((await discoverNativeCapabilities("heisenberg filter")).matches.some((item) => item.type === "heisenberg")).toBe(true);
  });
  it("links the sparse cross-instrument handoff to its originating motif and maps both parts", async () => {
    const example = readNativeExample("sparse-motif-handoff");
    const document = applyNativeOperations(seedNativeDocument(example.purpose), [...nativeFormOperations(example.form, []), ...example.extraOperations]);
    expect(document.parts.map((part) => part.id)).toEqual(["lead", "keys"]);
    expect(document.motifs.find((item) => item.id === "glass-call")?.derivedFromMotifId).toBe("shared-call");
    expect(document.parts.find((item) => item.id === "keys")?.placements[0]?.startTick).toBe(4 * 3840);
    const offline = await createOfflineDocument({ validated: true });
    const mapped = await applyNativeSnapshot(offline, document);
    expect(mapped.noteEntities).toBeGreaterThan(5);
  });
  it("constructs an eight-bar groove and a different sixteen-bar rise with offline Nexus readback", async () => {
    for (const id of ["disco-groove-study", "disco-rise-study"]) {
      const example = readNativeExample(id);
      const document = applyNativeOperations(seedNativeDocument(example.purpose), nativeFormOperations(example.form, []));
      expect(document.parts.map((part) => part.role)).toEqual(["percussion", "bass", "harmony", "lead"]);
      expect(document.motifs.length).toBeGreaterThanOrEqual(5);
      const offline = await createOfflineDocument({ validated: true });
      const mapped = await applyNativeSnapshot(offline, document);
      expect(mapped.noteEntities).toBeGreaterThan(10);
      expect(mapped.patternRegions).toBeGreaterThan(0);
      expect(offline.queryEntities.ofTypes("noteRegion").get().length).toBeGreaterThanOrEqual(4);
      expect(offline.queryEntities.ofTypes("mixerChannel").get()).toHaveLength(4);
      const review = symbolicNativeReview(document, null);
      expect(review.sameSectionSignatures).toBe(false);
      expect(review.sections.every((section) => section.totalOnsets > 0)).toBe(true);
    }
    const rise = readNativeExample("disco-rise-study");
    expect(rise.sectionMap.map((section) => section.name)).toEqual(["Pocket", "Answer", "Rise", "Arrival"]);
    expect(searchNativeExamples("payoff").map((item) => item.id)).toContain("disco-rise-study");
  });
});
