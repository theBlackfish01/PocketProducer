import { describe, expect, it } from "vitest";
import { decodeWav, measureDecodedWav } from "./wav.js";

function pcm24(samples: number[], channels = 1): Buffer {
  const bytes = Buffer.alloc(44 + samples.length * 3);
  bytes.write("RIFF", 0, "ascii"); bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8, "ascii"); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(8_000, 24); bytes.writeUInt32LE(8_000 * channels * 3, 28);
  bytes.writeUInt16LE(channels * 3, 32); bytes.writeUInt16LE(24, 34);
  bytes.write("data", 36, "ascii"); bytes.writeUInt32LE(samples.length * 3, 40);
  samples.forEach((sample, index) => bytes.writeIntLE(sample, 44 + index * 3, 3));
  return bytes;
}

describe("bounded PCM24 WAV inspection", () => {
  it("sign-extends negative samples and measures the decoded selected bytes", () => {
    const decoded = decodeWav(pcm24([0, -8_388_608, 4_194_304, 8_388_607]));
    expect(Array.from(decoded.channels[0]!)).toEqual([0, -1, 0.5, 8_388_607 / 8_388_608]);
    expect(measureDecodedWav(decoded).peak).toBe(1);
  });
  it("rejects incomplete frames and duration beyond the inspection limit", () => {
    const malformed = pcm24([1, 2]);
    malformed.writeUInt32LE(5, 40);
    expect(() => decodeWav(malformed)).toThrow(/aligned/);
    expect(() => decodeWav(pcm24([1, 2]), { maxDurationSeconds: 0.0001 })).toThrow(/exceeds/);
    const falseDepth = pcm24([1, 2]);
    falseDepth.writeUInt16LE(16, 34);
    expect(() => decodeWav(falseDepth)).toThrow(/rate or frame alignment/);
  });
});
