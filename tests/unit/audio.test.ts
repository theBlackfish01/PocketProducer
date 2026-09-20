import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeWav, renderComposition, validateComposition } from "@pocket/core";

const tinyComposition = validateComposition({
  schemaVersion: 1,
  ppq: 960,
  tempoBpm: 96,
  timeSignature: { numerator: 4, denominator: 4 },
  durationTicks: 3_840,
  tailSeconds: 0.2,
  seed: 19,
  palette: "sunroom",
  sourceAssetIds: [],
  sections: [{ id: "intro", name: "Intro", startTick: 0, endTick: 3_840 }],
  tracks: [
    { id: "drums", role: "drums", gainDb: -3, pan: 0, events: [{ id: "kick", assetId: "builtin:kick", startTick: 0, durationTicks: 480, gainDb: -2 }] },
    { id: "melody", role: "melody", gainDb: -8, pan: 0.1, events: [{ id: "note", assetId: "builtin:melody:60", startTick: 960, durationTicks: 960, gainDb: -8 }] }
  ]
});

describe("deterministic WAV renderer", () => {
  it("writes a playable 48 kHz stereo preview with real signal", async () => {
    const firstDirectory = await mkdtemp(join(tmpdir(), "pocket-render-a-"));
    const secondDirectory = await mkdtemp(join(tmpdir(), "pocket-render-b-"));
    const first = await renderComposition(tinyComposition, firstDirectory, []);
    const second = await renderComposition(tinyComposition, secondDirectory, []);
    const firstBytes = await readFile(first.previewPath);
    const secondBytes = await readFile(second.previewPath);
    const decoded = decodeWav(firstBytes);

    expect(decoded.sampleRate).toBe(48_000);
    expect(decoded.channels).toHaveLength(2);
    expect(decoded.durationSeconds).toBeGreaterThan(2.6);
    expect(first.peak).toBeGreaterThan(0.01);
    expect(first.rms).toBeGreaterThan(0.001);
    expect(first.nonSilentRatio).toBeGreaterThan(0.01);
    expect(createHash("sha256").update(firstBytes).digest("hex")).toBe(createHash("sha256").update(secondBytes).digest("hex"));
  });
});
