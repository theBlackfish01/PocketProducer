import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzePreview, compileArrangement, createAudiotoolTokenRefreshHandler, deterministicPlan, encodeWav, exportManifestToAudiotool, probeNexusNodeAdapter, writeNexusManifest, type AudiotoolExportClient } from "@pocket/core";

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

  it("validates a substantive four-stem Nexus document and resumes uploaded samples", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pocket-nexus-"));
    const composition = compileArrangement(deterministicPlan("Warm restrained instrumental", false), undefined, 7);
    const bytes = encodeWav(new Float32Array(4_800), new Float32Array(4_800), 48_000);
    const stems: Record<string, string> = {};
    for (const track of composition.tracks) {
      const path = join(directory, `${track.id}.wav`);
      await writeFile(path, bytes);
      stems[track.id] = path;
    }
    const mapped = await writeNexusManifest({ revisionId: "fixture-revision", composition, stems, outputDirectory: join(directory, "export") });
    expect(mapped.evidence).toMatchObject({ regionCount: 4, trackCount: 4, tempoBpm: composition.tempoBpm, durationTicks: composition.durationTicks });
    expect(mapped.manifest.parts.every((part) => part.fidelity === "editable-stem" && part.positionTicks === 0)).toBe(true);

    const uploadedRoles: string[] = [];
    let inserted = 0;
    let stopped = false;
    const client: AudiotoolExportClient = {
      projects: { createProject: () => Promise.resolve({ project: { name: "projects/mock-project" } }) },
      samples: { upload: ({ displayName }) => {
        uploadedRoles.push(displayName);
        return Promise.resolve({ uploaded: Promise.resolve(undefined), ready: Promise.resolve({ name: `samples/${displayName}` }) });
      } },
      open: () => Promise.resolve({
        dawUrl: "https://beta.audiotool.com/studio?project=mock-project",
        start: () => Promise.resolve(),
        stop: () => { stopped = true; return Promise.resolve(); },
        modify: (run) => { run({ insertSample: () => { inserted += 1; return {}; } }); return Promise.resolve(); }
      })
    };
    const checkpoints: Array<{ remoteProjectId: string; uploadedSamples: Record<string, string> }> = [];
    const exported = await exportManifestToAudiotool({ client, manifest: mapped.manifest, title: "Mock export", resume: { remoteProjectId: "projects/mock-project", uploadedSamples: { drums: "samples/already-uploaded" } }, checkpoint: (value) => { checkpoints.push(structuredClone(value)); return Promise.resolve(); } });
    expect(exported.studioUrl).toContain("mock-project");
    expect(uploadedRoles).toHaveLength(3);
    expect(checkpoints).toHaveLength(3);
    expect(inserted).toBe(4);
    expect(stopped).toBe(true);
  });

  it("waits for refresh-token persistence and surfaces a failed rotation write", async () => {
    const tokens = { accessToken: "access-token-value", refreshToken: "refresh-token-value", expiresAt: Date.now() + 60_000 };
    const successful = createAudiotoolTokenRefreshHandler("owner", "tester", () => Promise.resolve());
    successful.onTokenRefresh(tokens);
    await expect(successful.awaitPersistence()).resolves.toBeUndefined();

    const failed = createAudiotoolTokenRefreshHandler("owner", "tester", () => Promise.reject(new Error("rotation persistence failed")));
    failed.onTokenRefresh(tokens);
    await expect(failed.awaitPersistence()).rejects.toThrow("rotation persistence failed");
  });
});
