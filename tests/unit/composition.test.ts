import { describe, expect, it } from "vitest";
import { attemptBoundedDrumRepair, compileArrangement, compositionSourceLineage, deterministicPlan, protectedTrackHash, simplifyDrums, validateComposition, type SourceDescriptor } from "@pocket/core";

describe("canonical composition and protected revisions", () => {
  it("keeps fallback titles within the schema without cutting a word in half", () => {
    const title = deterministicPlan("Make a warm, restrained instrumental around this sound with a gentle pulse.", true).title;
    expect(title).toBe("Make a warm, restrained instrumental around this sound with a…");
    expect(title.length).toBeLessThanOrEqual(64);
  });

  it("compiles a complete 16-bar arrangement", () => {
    const composition = validateComposition(compileArrangement(deterministicPlan("Warm, spacious and gently rising", false)));
    expect(composition.sections.map((section) => section.id)).toEqual(["intro", "groove", "lift", "outro"]);
    expect(composition.sections.at(-1)?.endTick).toBe(composition.durationTicks);
    expect(composition.tracks.map((track) => track.role)).toEqual(["drums", "bass", "melody", "texture"]);
    expect(composition.tracks.find((track) => track.id === "texture")?.events).toEqual([]);
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

  it("preserves the earlier candidate when a forced repair render fails", async () => {
    const base = compileArrangement(deterministicPlan("Warm and restrained", false));
    const earlierRender = { id: "accepted-candidate", peak: 0.4 };
    const rejected = await attemptBoundedDrumRepair({
      composition: base,
      render: earlierRender,
      renderCandidate: () => Promise.reject(new Error("forced render failure")),
      validateCandidate: () => true
    });
    expect(rejected).toMatchObject({ composition: base, render: earlierRender, removed: 0, rejectedError: "forced render failure" });

    const repaired = await attemptBoundedDrumRepair({
      composition: base,
      render: earlierRender,
      renderCandidate: () => Promise.resolve({ id: "repair", peak: 0.3 }),
      validateCandidate: (_composition, render) => render.peak > 0
    });
    expect(repaired.removed).toBeGreaterThan(0);
    expect(repaired.render.id).toBe("repair");
    expect(protectedTrackHash(repaired.composition, "melody")).toBe(protectedTrackHash(base, "melody"));
  });

  it("separates an attached source from selected, referenced, and audible use", () => {
    const sourceId = "owned-source";
    const descriptor = (suggestedRole: SourceDescriptor["suggestedRole"], status: SourceDescriptor["status"] = "available"): SourceDescriptor => ({
      assetId: sourceId,
      assetHash: `hash-${suggestedRole ?? "unknown"}`,
      status,
      measured: { durationSeconds: 2, peak: 0.4, rms: 0.1, nonSilentRatio: status === "available" ? 0.8 : 0 },
      observations: status === "available" ? ["Short dry transient"] : [],
      uncertainty: status === "available" ? "Fixture observation" : "Provider unavailable",
      suggestedRole
    });

    for (const role of ["none", "percussion", "texture"] as const) {
      const source = descriptor(role);
      const plan = deterministicPlan("Warm and restrained", true, source);
      const composition = compileArrangement(plan, sourceId);
      const lineage = compositionSourceLineage(composition);
      expect(plan.sourceRole).toBe(role);
      expect(lineage.attachedSourceAssetIds).toEqual([sourceId]);
      expect(lineage.referencedSourceAssetIds).toEqual(role === "none" ? [] : [sourceId]);
      expect(composition.tracks.flatMap((track) => track.events).filter((event) => event.assetId === `source:${sourceId}`)).toHaveLength(role === "none" ? 0 : 4);
    }

    const unavailable = descriptor("none", "unavailable");
    expect(deterministicPlan("Keep the attachment available but do not use it", true, unavailable).sourceRole).toBe("none");

    const muted = compileArrangement(deterministicPlan("Warm texture", true, descriptor("texture")), sourceId);
    const texture = muted.tracks.find((track) => track.id === "texture");
    if (!texture) throw new Error("Expected texture track");
    texture.gainDb = -48;
    expect(compositionSourceLineage(muted)).toEqual({ attachedSourceAssetIds: [sourceId], referencedSourceAssetIds: [] });
  });
});
