import { describe, expect, it } from "vitest";
import { decodeWav, encodeWav } from "../audio/wav.js";
import { prepareLibrarySampleAnalysis } from "./gemini.js";

describe("short-hit Gemini inspection preparation", () => {
  it("repeats unchanged hits with silence and binds opinion to the derivative hash", () => {
    const hit = new Float32Array(8_000 / 4).fill(0.25);
    const original = encodeWav(hit, hit, 8_000);
    const prepared = prepareLibrarySampleAnalysis(original);
    expect(prepared.preprocessing).toBe("four-unchanged-hits-one-second-apart");
    expect(prepared.bytes.equals(original)).toBe(false);
    const decoded = decodeWav(prepared.bytes);
    expect(decoded.durationSeconds).toBe(4);
    for (const second of [0, 1, 2, 3]) expect(decoded.channels[0]![second * 8_000]).toBeCloseTo(hit[0]!, 4);
    for (const second of [0.5, 1.5, 2.5, 3.5]) expect(decoded.channels[0]![second * 8_000]).toBe(0);
    expect(prepared.measured.nonSilentRatio).toBeCloseTo(0.25, 2);
    expect(prepareLibrarySampleAnalysis(original).hash).toBe(prepared.hash);
  });
  it("keeps longer source bytes unchanged", () => {
    const loop = new Float32Array(16_000).fill(0.1);
    const original = encodeWav(loop, loop, 8_000);
    const prepared = prepareLibrarySampleAnalysis(original);
    expect(prepared.preprocessing).toBe("original-wav");
    expect(prepared.bytes.equals(original)).toBe(true);
  });
});
