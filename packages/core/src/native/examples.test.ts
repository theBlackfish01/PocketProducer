import { describe, expect, it } from "vitest";
import { readNativeExample, searchNativeExamples } from "./examples.js";
import { discoverNativeCapabilities } from "./catalog.js";

describe("retrievable musical references", () => {
  it("validates six distinct canonical recipes without treating them as heard music", () => {
    const ids = ["spare-answer", "groove-cut", "operator-ascent", "turnaround", "motif-handoff", "overbusy-counterexample"];
    for (const id of ids) {
      const example = readNativeExample(id);
      expect(example.documentHash).toMatch(/^[a-f0-9]{64}$/);
      expect(example.heard).toBe(false);
      expect(example.sectionMap.length).toBeGreaterThan(1);
      expect(example.motifMap[0]?.notes).toBeGreaterThan(0);
    }
    expect(readNativeExample("spare-answer").documentHash).not.toBe(readNativeExample("overbusy-counterexample").documentHash);
  });
  it("retrieves a relevant example and finds FM filter capability by multiword query", async () => {
    expect(searchNativeExamples("sparse").map((item) => item.id)).toContain("spare-answer");
    expect(searchNativeExamples("sample").map((item) => item.id)).toContain("groove-cut");
    expect((await discoverNativeCapabilities("heisenberg filter")).matches.some((item) => item.type === "heisenberg")).toBe(true);
  });
});
