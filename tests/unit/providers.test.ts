import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzePreview, encodeWav, probeNexusNodeAdapter } from "@pocket/core";

describe("optional provider boundaries", () => {
  it("returns an honest unavailable Gemini result without a key", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pocket-provider-"));
    const path = join(directory, "silence.wav");
    await writeFile(path, encodeWav(new Float32Array(4_800), new Float32Array(4_800), 48_000));
    const result = await analyzePreview({ path, hash: "fixture-hash", durationSeconds: 0.1, peak: 0, rms: 0, nonSilentRatio: 0 });
    expect(result.status).toBe("unavailable");
    expect(result.observations).toEqual([]);
    expect(result.measured.durationSeconds).toBe(0.1);
  });

  it("loads the Nexus node adapter but does not claim a renderer", async () => {
    const result = await probeNexusNodeAdapter();
    expect(result.offlineDocumentCreated).toBe(true);
    expect(result.standaloneRenderer).toBe(false);
  });
});
