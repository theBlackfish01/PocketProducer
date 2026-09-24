import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { analyzePreview, boundOpenAiRequest, canonicalTicksToNexus, compileArrangement, createAudiotoolTokenRefreshHandler, createOfflineNexusDocument, deterministicPlan, encodeWav, exportManifestToAudiotool, probeNexusNodeAdapter, validateOfflineNexusMapping, writeNexusManifest, type AudiotoolExportCheckpoint, type AudiotoolExportClient, type NexusExportManifest } from "@pocket/core";

async function tinyExportManifest(): Promise<NexusExportManifest> {
  const directory = await mkdtemp(join(tmpdir(), "pocket-nexus-steps-"));
  const stemPath = join(directory, "tiny.wav");
  await writeFile(stemPath, encodeWav(new Float32Array(480), new Float32Array(480), 48_000));
  const roles = ["drums", "bass", "melody", "texture"];
  return {
    mappingVersion: "nexus-stem-v3",
    revisionId: "step-fixture",
    tempoBpm: 96,
    canonicalPpq: 960,
    nexusPpq: 3_840,
    musicalBodyCanonicalTicks: 960,
    musicalBodyNexusTicks: 3_840,
    musicalBodySeconds: 0.625,
    tailSeconds: 0.01,
    projectDurationNexusTicks: 3_901,
    sections: [{ id: "body", name: "Body", startTick: 0, endTick: 960, startNexusTicks: 0, endNexusTicks: 3_840 }],
    sourceLineage: { attachedSourceAssetIds: [], referencedSourceAssetIds: [] },
    parts: roles.map((role) => ({ trackId: role, role, stemPath, fidelity: "editable-stem" as const, positionCanonicalTicks: 0 as const, positionNexusTicks: 0 as const, musicalBodyCanonicalTicks: 960, musicalBodyNexusTicks: 3_840, audioDurationNexusTicks: 3_901, tailNexusTicks: 61, durationSeconds: 0.635, sampleRate: 48_000, channels: 2, intentionallySilent: role === "texture" })),
    liveProject: { status: "needs-auth", requiredClientConfiguration: ["AUDIOTOOL_CLIENT_ID", "AUDIOTOOL_REDIRECT_URL", "AUDIOTOOL_SCOPES"] }
  };
}

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
    const bodySeconds = composition.durationTicks / composition.ppq * 60 / composition.tempoBpm;
    const frameCount = Math.round((bodySeconds + composition.tailSeconds) * 48_000);
    const bytes = encodeWav(new Float32Array(frameCount), new Float32Array(frameCount), 48_000);
    const stems: Record<string, string> = {};
    for (const track of composition.tracks) {
      const path = join(directory, `${track.id}.wav`);
      await writeFile(path, bytes);
      stems[track.id] = path;
    }
    const mapped = await writeNexusManifest({ revisionId: "fc2bffdb-d86b-473b-8c20-d514e5b18058", composition, stems, outputDirectory: join(directory, "export") });
    expect(mapped.evidence).toMatchObject({ regionCount: 4, trackCount: 4, routedTrackCount: 4, enabledTrackCount: 4, tempoBpm: composition.tempoBpm });
    expect(mapped.manifest.musicalBodyNexusTicks).toBe(canonicalTicksToNexus(composition.durationTicks));
    expect(mapped.manifest.musicalBodyNexusTicks).toBe(245_760);
    expect(mapped.manifest.parts.every((part) => part.fidelity === "editable-stem" && part.positionNexusTicks === 0 && part.tailNexusTicks > 0)).toBe(true);
    expect(mapped.manifest.sections.at(-1)?.endNexusTicks).toBe(mapped.manifest.musicalBodyNexusTicks);
    expect(mapped.manifest.projectDurationNexusTicks).toBeGreaterThan(mapped.manifest.musicalBodyNexusTicks);
    expect(mapped.manifest.parts.find((part) => part.role === "texture")?.intentionallySilent).toBe(true);

    const secondTempo = structuredClone(mapped.manifest);
    secondTempo.tempoBpm = 108;
    secondTempo.musicalBodySeconds = secondTempo.musicalBodyNexusTicks / 3_840 * 60 / secondTempo.tempoBpm;
    secondTempo.projectDurationNexusTicks = Math.round((secondTempo.musicalBodySeconds + secondTempo.tailSeconds) * secondTempo.tempoBpm / 60 * 3_840);
    for (const part of secondTempo.parts) {
      part.durationSeconds = secondTempo.musicalBodySeconds + secondTempo.tailSeconds;
      part.audioDurationNexusTicks = secondTempo.projectDurationNexusTicks;
      part.tailNexusTicks = part.audioDurationNexusTicks - part.musicalBodyNexusTicks;
    }
    const secondEvidence = await validateOfflineNexusMapping(secondTempo);
    expect(secondEvidence).toMatchObject({ tempoBpm: 108, projectDurationNexusTicks: secondTempo.projectDurationNexusTicks, regionCount: 4, routedTrackCount: 4 });

    const uploadedRoles: string[] = [];
    let stopped = false;
    const remoteDocument = await createOfflineNexusDocument();
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
        modify: (run) => remoteDocument.modify((transaction) => run(transaction))
      })
    };
    const checkpoints: AudiotoolExportCheckpoint[] = [];
    const exported = await exportManifestToAudiotool({ client, manifest: mapped.manifest, title: "Mock export", resume: { remoteProjectId: "projects/mock-project", uploadedSamples: { drums: "samples/already-uploaded" } }, checkpoint: (value) => { checkpoints.push(structuredClone(value)); return Promise.resolve(); } });
    expect(exported.studioUrl).toContain("mock-project");
    expect(uploadedRoles).toHaveLength(3);
    expect(checkpoints.length).toBeGreaterThanOrEqual(5);
    expect(exported.checkpoint.arrangement.state).toBe("succeeded");
    expect(remoteDocument.queryEntities.ofTypes("audioRegion").get()).toHaveLength(4);
    expect(stopped).toBe(true);
    await exportManifestToAudiotool({ client, manifest: mapped.manifest, title: "Mock export", resume: exported.checkpoint });
    expect(uploadedRoles).toHaveLength(3);
    expect(remoteDocument.queryEntities.ofTypes("audioRegion").get()).toHaveLength(4);
  });

  it("waits for refresh-token persistence and surfaces a failed rotation write", async () => {
    const tokens = { accessToken: "access-token-value", refreshToken: "refresh-token-value", expiresAt: Date.now() + 60_000 };
    const successful = createAudiotoolTokenRefreshHandler("owner", "tester", () => Promise.resolve());
    successful.onTokenRefresh(tokens);
    await expect(successful.awaitPersistence()).resolves.toBeUndefined();

    const failed = createAudiotoolTokenRefreshHandler("owner", "tester", () => Promise.reject(new Error("rotation persistence failed")));
    failed.onTokenRefresh(tokens);
    await expect(failed.awaitPersistence()).rejects.toThrow("rotation persistence failed");

    const order: number[] = [];
    let releaseFirst: (() => void) | undefined;
    const serialized = createAudiotoolTokenRefreshHandler("owner", "tester", async (_owner, _user, rotated) => {
      order.push((rotated as { expiresAt: number }).expiresAt);
      if (order.length === 1) await new Promise<void>((resolve) => { releaseFirst = resolve; });
    });
    const firstExpiry = Date.now() + 120_000;
    const secondExpiry = firstExpiry + 60_000;
    serialized.onTokenRefresh({ ...tokens, expiresAt: firstExpiry });
    serialized.onTokenRefresh({ ...tokens, expiresAt: firstExpiry - 1 });
    serialized.onTokenRefresh({ ...tokens, expiresAt: secondExpiry });
    await vi.waitFor(() => expect(order).toEqual([firstExpiry]));
    if (!releaseFirst) throw new Error("Expected first persistence barrier");
    releaseFirst();
    await serialized.awaitPersistence();
    expect(order).toEqual([firstExpiry, secondExpiry]);
  });

  it("bounds OpenAI reservations from the normalized request and rejects oversized context", () => {
    const message = (content: string) => ({ getType: () => "human", content, name: undefined, additional_kwargs: {} });
    const short = boundOpenAiRequest([[message("keep the melody") as never]]);
    const longer = boundOpenAiRequest([[message("keep the melody and simplify the drums ".repeat(40)) as never]]);
    expect(short.outputTokenBound).toBe(900);
    expect(longer.inputTokenBound).toBeGreaterThan(short.inputTokenBound);
    expect(() => boundOpenAiRequest([[message("x".repeat(20_000)) as never]])).toThrow("OPENAI_INPUT_LIMIT_EXCEEDED");
  });

  it("prevents post-cancel mutation and fences ambiguous Nexus outcomes", async () => {
    const manifest = await tinyExportManifest();
    let creates = 0;
    const never = <T>() => new Promise<T>(() => undefined);
    const aborted = new AbortController();
    aborted.abort();
    const preCancelled: AudiotoolExportClient = {
      projects: { createProject: () => { creates += 1; return Promise.resolve({ project: { name: "projects/never" } }); } },
      samples: { upload: () => Promise.reject(new Error("must not upload")) },
      open: () => Promise.reject(new Error("must not open"))
    };
    await expect(exportManifestToAudiotool({ client: preCancelled, manifest, title: "Cancelled", signal: aborted.signal })).rejects.toMatchObject({ kind: "cancelled", step: "project:create" });
    expect(creates).toBe(0);

    let creationCheckpoint: AudiotoolExportCheckpoint | undefined;
    const lostCreate: AudiotoolExportClient = {
      projects: { createProject: () => { creates += 1; return never(); } },
      samples: { upload: () => Promise.reject(new Error("must not upload")) },
      open: () => Promise.reject(new Error("must not open"))
    };
    await expect(exportManifestToAudiotool({ client: lostCreate, manifest, title: "Lost create", timeoutMs: 1_000, checkpoint: (value) => { creationCheckpoint = structuredClone(value); return Promise.resolve(); } })).rejects.toMatchObject({ kind: "uncertain", step: "project:create" });
    expect(creationCheckpoint?.project.state).toBe("uncertain");
    if (!creationCheckpoint) throw new Error("Expected a durable creation checkpoint");
    await expect(exportManifestToAudiotool({ client: lostCreate, manifest, title: "Lost create replay", resume: creationCheckpoint })).rejects.toMatchObject({ kind: "uncertain" });
    expect(creates).toBe(1);

    let readinessCheckpoint: AudiotoolExportCheckpoint | undefined;
    let uploads = 0;
    const lostReady: AudiotoolExportClient = {
      projects: { createProject: () => Promise.reject(new Error("must reuse project")) },
      samples: { upload: () => { uploads += 1; return Promise.resolve({ uploaded: Promise.resolve(), ready: never() }); } },
      open: () => Promise.reject(new Error("must not open"))
    };
    const projectResume: Partial<AudiotoolExportCheckpoint> = { remoteProjectId: "projects/known", project: { state: "succeeded", remoteId: "projects/known" }, uploadedSamples: {}, uploads: {}, arrangement: { state: "never_dispatched" } };
    await expect(exportManifestToAudiotool({ client: lostReady, manifest, title: "Lost ready", timeoutMs: 5_000, resume: projectResume, checkpoint: (value) => { readinessCheckpoint = structuredClone(value); return Promise.resolve(); } })).rejects.toMatchObject({ kind: "uncertain", step: "upload:drums:ready" });
    expect(readinessCheckpoint?.uploads.drums?.state).toBe("uncertain");
    if (!readinessCheckpoint) throw new Error("Expected a durable readiness checkpoint");
    await expect(exportManifestToAudiotool({ client: lostReady, manifest, title: "Lost ready replay", resume: readinessCheckpoint })).rejects.toMatchObject({ kind: "uncertain" });
    expect(uploads).toBe(1);

    const uploadedSamples = Object.fromEntries(manifest.parts.map((part) => [part.trackId, `samples/${part.trackId}`]));
    const uploadsDone = Object.fromEntries(manifest.parts.map((part) => [part.trackId, { state: "succeeded" as const, remoteId: `samples/${part.trackId}` }]));
    let insertCheckpoint: AudiotoolExportCheckpoint | undefined;
    let opens = 0;
    let modifies = 0;
    const lostInsert: AudiotoolExportClient = {
      projects: { createProject: () => Promise.reject(new Error("must reuse project")) },
      samples: { upload: () => Promise.reject(new Error("must reuse upload")) },
      open: () => { opens += 1; return Promise.resolve({ dawUrl: "https://beta.audiotool.com/studio?project=known", start: () => Promise.resolve(), stop: () => Promise.resolve(), modify: () => { modifies += 1; return never(); } }); }
    };
    const insertResume: Partial<AudiotoolExportCheckpoint> = { ...projectResume, uploadedSamples, uploads: uploadsDone };
    await expect(exportManifestToAudiotool({ client: lostInsert, manifest, title: "Lost insert", timeoutMs: 1_000, resume: insertResume, checkpoint: (value) => { insertCheckpoint = structuredClone(value); return Promise.resolve(); } })).rejects.toMatchObject({ kind: "uncertain", step: "arrangement:insert" });
    expect(insertCheckpoint?.arrangement.state).toBe("uncertain");
    if (!insertCheckpoint) throw new Error("Expected a durable arrangement checkpoint");
    await expect(exportManifestToAudiotool({ client: lostInsert, manifest, title: "Lost insert replay", resume: insertCheckpoint })).rejects.toMatchObject({ kind: "uncertain" });
    expect({ opens, modifies }).toEqual({ opens: 1, modifies: 1 });

    const betweenStages = new AbortController();
    let postCancelModifies = 0;
    let cancellationCheckpoint: AudiotoolExportCheckpoint | undefined;
    const cancelBeforeInsert: AudiotoolExportClient = {
      projects: { createProject: () => Promise.reject(new Error("must reuse project")) },
      samples: { upload: () => Promise.reject(new Error("must reuse upload")) },
      open: () => Promise.resolve({
        dawUrl: "https://beta.audiotool.com/studio?project=known",
        start: () => Promise.resolve(),
        stop: () => Promise.resolve(),
        modify: () => { postCancelModifies += 1; return Promise.resolve(); }
      })
    };
    await expect(exportManifestToAudiotool({
      client: cancelBeforeInsert, manifest, title: "Cancel before insert", resume: insertResume, signal: betweenStages.signal,
      checkpoint: (value) => {
        cancellationCheckpoint = structuredClone(value);
        if (value.arrangement.state === "in_flight") betweenStages.abort();
        return Promise.resolve();
      }
    })).rejects.toMatchObject({ kind: "cancelled", step: "arrangement:insert" });
    expect(postCancelModifies).toBe(0);
    expect(cancellationCheckpoint?.arrangement.state).toBe("never_dispatched");

    const stopTimeout: AudiotoolExportClient = {
      projects: { createProject: () => Promise.reject(new Error("must reuse project")) },
      samples: { upload: () => Promise.reject(new Error("must reuse upload")) },
      open: () => Promise.resolve({
        dawUrl: "https://beta.audiotool.com/studio?project=known",
        start: () => Promise.resolve(),
        stop: () => never(),
        modify: () => Promise.resolve()
      })
    };
    const stoppedLate = await exportManifestToAudiotool({ client: stopTimeout, manifest, title: "Stop timeout", timeoutMs: 1_000, resume: insertResume });
    expect(stoppedLate.checkpoint.arrangement.state).toBe("succeeded");
    expect(stoppedLate.shutdownWarning).toContain("operation deadline expired");
  }, 12_000);
});
