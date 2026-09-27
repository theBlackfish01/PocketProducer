import { describe, expect, it } from "vitest";
import { decodeWav, encodeWav } from "@pocket/core";

describe("owned source WAV", () => {
  it("roundtrips a real stereo signal deterministically", () => {
    const left = Float32Array.from({ length: 4800 }, (_, i) => Math.sin(i * 0.04) * 0.25);
    const right = Float32Array.from(left, (v) => -v);
    const bytes = encodeWav(left, right, 48000);
    expect(bytes).toEqual(encodeWav(left, right, 48000));
    const decoded = decodeWav(bytes);
    expect(decoded.durationSeconds).toBe(0.1);
    expect(decoded.channels).toHaveLength(2);
    expect(decoded.channels[0]![20]).toBeCloseTo(left[20]!, 4);
    expect(decoded.channels[1]![20]).toBeCloseTo(right[20]!, 4);
  });

  it("rejects malformed, unsupported and over-duration WAV input with typed client errors", () => {
    const valid = encodeWav(new Float32Array(4_800), new Float32Array(4_800), 48_000);
    const truncated = Buffer.from(valid);
    truncated.writeUInt32LE(valid.length + 500, 4);
    expect(() => decodeWav(truncated)).toThrow(expect.objectContaining({ code: "MALFORMED_WAV", statusCode: 422 }));

    const unsupported = Buffer.from(valid);
    unsupported.writeUInt16LE(20, 34);
    expect(() => decodeWav(unsupported)).toThrow(expect.objectContaining({ code: "UNSUPPORTED_WAV_ENCODING", statusCode: 415 }));

    expect(() => decodeWav(valid, { maxDurationSeconds: 0.05 })).toThrow(expect.objectContaining({ code: "WAV_DURATION_OUT_OF_RANGE", statusCode: 422 }));
  });
});
