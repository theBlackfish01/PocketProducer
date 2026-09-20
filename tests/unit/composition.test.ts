import { describe, expect, it } from "vitest";
import { compileArrangement, deterministicPlan, protectedTrackHash, simplifyDrums, validateComposition } from "@pocket/core";

describe("canonical composition and protected revisions", () => {
  it("compiles a complete 16-bar arrangement", () => {
    const composition = validateComposition(compileArrangement(deterministicPlan("Warm, spacious and gently rising", false)));
    expect(composition.sections.map((section) => section.id)).toEqual(["intro", "groove", "lift", "outro"]);
    expect(composition.sections.at(-1)?.endTick).toBe(composition.durationTicks);
    expect(composition.tracks.map((track) => track.role)).toEqual(["drums", "bass", "melody"]);
  });

  it("simplifies Groove drums and preserves the melody exactly", () => {
    const base = compileArrangement(deterministicPlan("Warm and restrained", false));
    const melodyBefore = protectedTrackHash(base, "melody");
    const drumsBefore = base.tracks.find((track) => track.id === "drums")?.events ?? [];
    const { composition, removed } = simplifyDrums(base);
    const drumsAfter = composition.tracks.find((track) => track.id === "drums")?.events ?? [];

    expect(removed).toBeGreaterThan(0);
    expect(drumsAfter).toHaveLength(drumsBefore.length - removed);
    expect(protectedTrackHash(composition, "melody")).toBe(melodyBefore);
    expect(base.tracks.find((track) => track.id === "melody")).toEqual(composition.tracks.find((track) => track.id === "melody"));
  });
});
