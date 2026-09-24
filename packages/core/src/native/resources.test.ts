import { describe, expect, it } from "vitest";
import { encodeWav } from "../audio/wav.js";
import { profileOwnedSourceWav, searchNativeResources } from "./resources.js";

describe("owned native resource inspection", () => {
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
});
