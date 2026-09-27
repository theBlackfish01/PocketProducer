import { describe, expect, it } from "vitest";
import { encodeWav } from "../audio/wav.js";
import { createOfflineDocument } from "@audiotool/nexus/node";
import { applyNativeSnapshot } from "./adapter.js";
import { applyNativeOperations } from "./model.js";
import { seedNativeDocument } from "./producer.js";
import { nativePresetRecipes, profileOwnedSourceWav, readNativeRecipe, searchNativeResources } from "./resources.js";

describe("owned native resource inspection", () => {
  it("maps every local palette recipe to the pinned offline SDK without claiming playback", async () => {
    expect(nativePresetRecipes.length).toBeGreaterThanOrEqual(6);
    const hashes = new Set<string>();
    for (const recipe of nativePresetRecipes) {
      const inspected = readNativeRecipe(recipe.id);
      expect(inspected.heard).toBe(false);
      expect(inspected.auditionStatus).toBe("unheard");
      expect(inspected.configurationHash).toMatch(/^[a-f0-9]{64}$/);
      expect(inspected.guidance.failureMode.length).toBeGreaterThan(10);
      hashes.add(inspected.configurationHash);
      const document = applyNativeOperations(seedNativeDocument(recipe.name), [
        { kind: "setDevice", partId: "starting-voice", device: recipe.device },
        ...recipe.effects.map((effect, index) => ({ kind: "addEffect" as const, partId: "starting-voice", effect: { id: `effect-${index}`, ...effect } }))
      ]);
      const offline = await createOfflineDocument({ validated: true });
      await applyNativeSnapshot(offline, document);
      expect(offline.queryEntities.ofTypes(recipe.device.type).get()).toHaveLength(1);
    }
    expect(hashes.size).toBe(nativePresetRecipes.length);
  });
  it("exposes activity after a silent opening without inventing a first-two-second choice", () => {
    const rate = 8_000;
    const data = new Float32Array(rate * 8);
    for (let index = rate * 4; index < data.length; index++) data[index] = Math.sin(index / 17) * 0.3;
    const profile = profileOwnedSourceWav(encodeWav(data, data, rate));
    expect(profile.segments).toHaveLength(4);
    expect(profile.segments[0]!.nonSilentRatio).toBe(0);
    expect(profile.segments[1]!.nonSilentRatio).toBe(0);
    expect(profile.segments[2]!.nonSilentRatio).toBeGreaterThan(0.9);
    expect(profile.segments[3]!.rms).toBeGreaterThan(0.1);
    const result = searchNativeResources("field", [{ assetId: "owned", name: "Field recording", assetHash: "a".repeat(64), durationSeconds: 8, rights: "User-owned", profile }]);
    expect(result.ownedSamples[0]?.profile?.segments[2]?.startSeconds).toBe(4);
    expect(result.remoteLibrary).toMatch(/not queried/);
  });
  it("rejects newly introduced Gakki without a pinned sound identity", () => {
    expect(() => applyNativeOperations(seedNativeDocument("A clear kit"), [{ kind: "setDevice", partId: "starting-voice", device: { type: "gakki", parameters: {} } }])).toThrow(/inspected, pinned preset/);
  });
});
