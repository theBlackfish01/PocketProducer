import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  analyzePreview, appendAttemptEvent, appendJobEvent, attemptBoundedDrumRepair, canonicalHash, claimNextJob, closePool, commitCancelled, commitExportPreparation, commitRevision, compileArrangement, completeProviderEffect, createAudiotoolServerClient, decodeWav, dispatchOutbox, expireJob, exportManifestToAudiotool, exportResumeState, failJob, failProviderEffect,
  getConfig, getRevision, heartbeat, isCancelled, markEffectDispatched, needsAttentionJob, produceArrangement, protectedTrackHash, providerAvailability, recordExportProgress, requeueJob, reserveProviderEffect,
  measureDecodedWav, recordAudioAnalysis, renderAssets, renderComposition, safeStoragePath, simplifyDrums, validateComposition, writeNexusManifest,
  JobControlError, type AudioAnalysis, type JobRecord, type SourceDescriptor
} from "@pocket/core";

const config = getConfig();
const workerId = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;

async function stage(job: JobRecord, name: string, message: string) {
  await appendAttemptEvent(job, "stage", { stage: name, message }, name);
}

async function checkpoint(job: JobRecord): Promise<void> {
  if (await isCancelled(job)) throw new JobControlError("CANCELLED", "Cancellation requested");
  if (Date.now() >= new Date(job.deadlineAt).getTime()) throw new JobControlError("DEADLINE_EXCEEDED", "Job deadline expired");
}

async function withLeaseMonitor(job: JobRecord, run: (signal: AbortSignal) => Promise<void>): Promise<void> {
  const controller = new AbortController();
  let monitorError: JobControlError | undefined;
  let renewing = false;
  const interval = setInterval(() => {
    if (renewing || monitorError) return;
    renewing = true;
    void (async () => {
      try {
        if (Date.now() >= new Date(job.deadlineAt).getTime()) {
          monitorError = new JobControlError("DEADLINE_EXCEEDED", "Job deadline expired");
          controller.abort();
          return;
        }
        if (!await heartbeat(job)) {
          const cancelled = await isCancelled(job).catch(() => false);
          monitorError = new JobControlError(cancelled ? "CANCELLED" : "LEASE_LOST", cancelled ? "Cancellation requested" : "Worker lease lost");
          controller.abort();
        }
      } finally {
        renewing = false;
      }
    })();
  }, Math.max(500, Math.floor(config.JOB_LEASE_SECONDS * 1_000 / 3)));
  try {
    await run(controller.signal);
    if (monitorError) throw monitorError;
  } finally {
    clearInterval(interval);
  }
}

async function generation(job: JobRecord, signal: AbortSignal): Promise<void> {
  const direction = typeof job.request.direction === "string" ? job.request.direction : "Make a warm, restrained instrumental.";
  const requestedSource = typeof job.request.sourceAssetId === "string" ? job.request.sourceAssetId : undefined;
  const assets = await renderAssets(job.ownerId, job.projectId);
  const sourceAssetId = requestedSource && assets.some((asset) => asset.id === requestedSource) ? requestedSource : assets[0]?.id;
  let sourceAnalysis: AudioAnalysis | undefined;
  let sourceDescriptor: SourceDescriptor | undefined;
  if (sourceAssetId) {
    const source = assets.find((asset) => asset.id === sourceAssetId);
    if (source) {
      const bytes = await readFile(source.path);
      const measured = measureDecodedWav(decodeWav(bytes));
      sourceAnalysis = await analyzePreview({ job, path: source.path, hash: createHash("sha256").update(bytes).digest("hex"), purpose: "source-analysis", signal, ...measured });
      sourceDescriptor = {
        assetId: sourceAssetId,
        assetHash: sourceAnalysis.assetHash,
        status: sourceAnalysis.status === "available" ? "available" : sourceAnalysis.status === "failed" ? "failed" : "unavailable",
        measured: sourceAnalysis.measured,
        observations: sourceAnalysis.observations,
        uncertainty: sourceAnalysis.uncertainty
      };
    }
  }
  await stage(job, "planning", "Shaping the arrangement");
  const producer = await produceArrangement({ job, direction, ...(sourceDescriptor ? { source: sourceDescriptor } : {}), signal });
  await stage(job, "composing", "Writing parts into the Sunroom palette");
  let composition = validateComposition(compileArrangement(producer.plan, sourceAssetId));
  await stage(job, "rendering", "Rendering a real 48 kHz preview");
  const outputDirectory = safeStoragePath(job.ownerId, job.projectId, "renders", job.id, `attempt-${job.leaseGeneration}-${job.attemptId}`);
  const renderOptions = { signal, checkpoint: () => { if (signal.aborted) throw new JobControlError("CANCELLED", "Rendering interrupted"); return Promise.resolve(); } };
  let render = await renderComposition(composition, outputDirectory, assets, renderOptions);
  let renderAttempts = 1;
  await stage(job, "checking", "Checking timing, headroom and source lineage");
  if (render.rms < 0.001 || render.nonSilentRatio < 0.01 || render.peak <= 0) throw new Error("Rendered preview is silent");
  if (render.durationSeconds > config.MAX_OUTPUT_SECONDS) throw new Error("Rendered preview exceeds the configured output duration");
  const previewBytes = await readFile(render.previewPath);
  const firstPreviewHash = createHash("sha256").update(previewBytes).digest("hex");
  const analysis = await analyzePreview({ job, path: render.previewPath, hash: firstPreviewHash, purpose: "preview-critique", signal, durationSeconds: render.durationSeconds, peak: render.peak, rms: render.rms, nonSilentRatio: render.nonSilentRatio });
  let repairedDrums = 0;
  let finalAnalysis = analysis;
  if (analysis.status === "available" && analysis.repairAction === "simplify-drums" && config.MAX_AUDIO_CRITIQUE_PASSES > 0 && renderAttempts < config.MAX_RENDER_ATTEMPTS_PER_JOB) {
    const repair = await attemptBoundedDrumRepair({
      composition, render,
      renderCandidate: (candidate) => renderComposition(candidate, join(outputDirectory, "repair-1"), assets, renderOptions),
      validateCandidate: (_candidate, candidateRender) => candidateRender.rms >= 0.001 && candidateRender.nonSilentRatio >= 0.01 && candidateRender.peak > 0
    });
    if (repair.rejectedError) {
      await appendAttemptEvent(job, "repair_rejected", { message: repair.rejectedError.slice(0, 240) });
    } else if (repair.removed > 0) {
      composition = repair.composition;
      render = repair.render;
      repairedDrums = repair.removed;
      renderAttempts += 1;
      const repairedBytes = await readFile(render.previewPath);
      finalAnalysis = {
        status: "uncritiqued", assetHash: createHash("sha256").update(repairedBytes).digest("hex"), model: analysis.model, promptVersion: "audio-analysis-v2", purpose: "preview-critique",
        inspectedInterval: { start: 0, end: render.durationSeconds }, measured: { durationSeconds: render.durationSeconds, peak: render.peak, rms: render.rms, nonSilentRatio: render.nonSilentRatio },
        observations: [], uncertainty: "The bounded critique budget was spent on the earlier candidate; this repaired audio passed deterministic checks but was not sent to Gemini again.",
        suggestedActions: [], suggestedSourceRole: null, repairAction: "none", usage: { promptTokens: 0, candidateTokens: 0, totalTokens: 0 }, costMicrousd: 0
      };
    }
  }
  await checkpoint(job);
  const finalPreviewBytes = await readFile(render.previewPath);
  const finalPreviewHash = createHash("sha256").update(finalPreviewBytes).digest("hex");
  const committed = await commitRevision(job, {
    composition, previewPath: render.previewPath, stems: render.stems, waveformPeaks: render.waveformPeaks, durationSeconds: render.durationSeconds,
    previewHash: finalPreviewHash, peak: render.peak, rms: render.rms, nonSilentRatio: render.nonSilentRatio, title: producer.plan.title,
    summary: `Created a ${producer.plan.tempoBpm} BPM ${producer.plan.energy < 0.5 ? "restrained" : "energized"} instrumental${composition.sourceAssetIds.includes(sourceAssetId ?? "") ? " using the supplied source" : " from the owned Sunroom palette"}.${repairedDrums ? ` Gemini critique triggered one bounded repair that removed ${repairedDrums} Groove hi-hat hits.` : ""}`,
    protectedTrackHashes: {}, producer: { ...producer, sourceAnalysisStatus: sourceAnalysis?.status ?? "not-requested", previewAnalysisStatus: finalAnalysis.status, previewAnalysisHash: finalAnalysis.assetHash, repairAction: analysis.repairAction, renderAttempts }
  });
  const records: Array<{ revisionId: string | null; analysis: AudioAnalysis }> = [];
  if (sourceAnalysis) records.push({ revisionId: committed.revisionId, analysis: sourceAnalysis });
  records.push({ revisionId: repairedDrums ? null : committed.revisionId, analysis });
  if (repairedDrums) records.push({ revisionId: committed.revisionId, analysis: finalAnalysis });
  for (const item of records) {
    try { await recordAudioAnalysis({ ownerId: job.ownerId, projectId: job.projectId, revisionId: item.revisionId, analysis: item.analysis }); }
    catch { await appendJobEvent(job.id, "analysis_record_failed", { purpose: item.analysis.purpose, message: "The audio version is safe; analysis metadata could not be stored." }); }
  }
}

async function revision(job: JobRecord, signal: AbortSignal): Promise<void> {
  if (!job.baseRevisionId) throw new Error("Revision job is missing its base revision");
  const baseRow = await getRevision(job.ownerId, job.baseRevisionId);
  const base = validateComposition(baseRow.composition);
  const direction = typeof job.request.direction === "string" ? job.request.direction : "Simplify the drums; keep the melody.";
  if (!/drum/i.test(direction) || !/simpl|less|space|restrain/i.test(direction)) throw new Error("This milestone supports drum simplification revisions; make the requested scope explicit");
  const protectedTrackIds = Array.isArray(job.request.protectedTrackIds) ? job.request.protectedTrackIds : [];
  if (protectedTrackIds.length !== 1 || protectedTrackIds[0] !== "melody") throw new Error("This revision requires the melody protection lock and accepts no unsupported lock identifiers");
  if (job.request.sectionId !== undefined && job.request.sectionId !== "groove") throw new Error("This revision supports only the Groove section");
  await stage(job, "planning", "Locking the melody and scoping the drum change");
  const beforeHash = protectedTrackHash(base, "melody");
  const { composition, removed } = simplifyDrums(base);
  const afterHash = protectedTrackHash(composition, "melody");
  if (beforeHash !== afterHash) throw new Error("Protected melody validation failed");
  if (removed === 0) {
    await commitRevision(job, {
      composition: base,
      previewPath: String(baseRow.preview_path),
      ...(baseRow.preview_hash ? { previewHash: String(baseRow.preview_hash) } : {}),
      stems: baseRow.stems as Record<string, string>,
      waveformPeaks: baseRow.waveform_peaks as number[],
      durationSeconds: Number(baseRow.duration_seconds), peak: Number(baseRow.peak), rms: Number(baseRow.rms), nonSilentRatio: Number(baseRow.non_silent_ratio), title: String(baseRow.title),
      summary: "Drums were already simplified in Groove; the existing immutable version was reused without fabricating a change.",
      protectedTrackHashes: { melody: beforeHash }, producer: { provider: "validated-semantic-revision", direction, removed: 0, noOp: true }
    });
    return;
  }
  await stage(job, "rendering", "Re-rendering only the changed arrangement");
  const assets = await renderAssets(job.ownerId, job.projectId);
  const outputDirectory = safeStoragePath(job.ownerId, job.projectId, "renders", job.id, `attempt-${job.leaseGeneration}-${job.attemptId}`);
  const render = await renderComposition(composition, outputDirectory, assets, { signal, checkpoint: () => { if (signal.aborted) throw new JobControlError("CANCELLED", "Rendering interrupted"); return Promise.resolve(); } });
  const baseStems = baseRow.stems as Record<string, string>;
  if (baseStems.melody) {
    render.stems.melody = baseStems.melody;
  }
  await stage(job, "checking", "Verifying the protected melody and revision scope");
  if (render.rms < 0.001 || render.nonSilentRatio < 0.01 || render.peak <= 0 || protectedTrackHash(composition, "melody") !== beforeHash) throw new Error("Revised render failed signal or protected-melody validation");
  const previewHash = createHash("sha256").update(await readFile(render.previewPath)).digest("hex");
  await commitRevision(job, {
    composition, previewPath: render.previewPath, stems: render.stems, waveformPeaks: render.waveformPeaks, durationSeconds: render.durationSeconds,
    previewHash, peak: render.peak, rms: render.rms, nonSilentRatio: render.nonSilentRatio, title: String(baseRow.title),
    summary: `Removed ${removed} hi-hat hits from Groove. Melody structure and protected stem preserved.`,
    protectedTrackHashes: { melody: beforeHash }, producer: { provider: "validated-semantic-revision", direction, removed }
  });
}

async function exportRevision(job: JobRecord, signal: AbortSignal): Promise<void> {
  if (!job.baseRevisionId) throw new Error("Export job is missing its revision");
  const revision = await getRevision(job.ownerId, job.baseRevisionId);
  const composition = validateComposition(revision.composition);
  await stage(job, "exporting", "Preparing editable per-part stems for Nexus");
  const result = await writeNexusManifest({ revisionId: job.baseRevisionId, composition, stems: revision.stems as Record<string, string>, outputDirectory: safeStoragePath(job.ownerId, job.projectId, "exports", job.id, `attempt-${job.leaseGeneration}-${job.attemptId}`) });
  const available = providerAvailability(config).audiotool;
  const fidelity = { level: "editable-stem", noteEditability: "rendered-audio-only", parts: result.manifest.parts, offlineValidation: result.evidence };
  if (!available || !config.AUDIOTOOL_CLIENT_ID) {
    await commitExportPreparation(job, { state: "disabled", fidelity, manifestPath: result.path, errorMessage: "Audiotool app registration is not configured; the validated local four-stem manifest remains available." });
    return;
  }
  const serverClient = await createAudiotoolServerClient(job.ownerId, config.AUDIOTOOL_CLIENT_ID);
  if (!serverClient) {
    await commitExportPreparation(job, { state: "awaiting_authorization", fidelity, manifestPath: result.path, errorMessage: "Audiotool app configuration is present; browser OAuth consent is required before remote export." });
    return;
  }

  const resume = await exportResumeState(job.ownerId, job.baseRevisionId);
  await recordExportProgress(job, { fidelity, manifestPath: result.path, ...(resume.remoteProjectId ? { remoteProjectId: resume.remoteProjectId } : {}), remoteEffects: { uploadedSamples: resume.uploadedSamples ?? {} } });
  const reservation = await reserveProviderEffect({
    job, provider: "audiotool", step: "four-stem-export", idempotencyKey: `audiotool:export:${job.baseRevisionId}:nexus-stem-v2`,
    inputHash: canonicalHash({ revisionId: job.baseRevisionId, tempoBpm: result.manifest.tempoBpm, durationTicks: result.manifest.durationTicks, parts: result.manifest.parts.map(({ trackId, role, durationSeconds, sampleRate, channels }) => ({ trackId, role, durationSeconds, sampleRate, channels })) }),
    model: "nexus-0.0.17", promptVersion: "nexus-stem-v2", reservationMicrousd: 0
  });
  if (!reservation.created) {
    if (reservation.state === "succeeded") {
      const cached = reservation.cachedOutput as { projectId?: string; studioUrl?: string; uploadedSamples?: Record<string, string> } | undefined;
      if (cached?.projectId && cached.studioUrl) {
        await commitExportPreparation(job, { state: "completed", fidelity, manifestPath: result.path, remoteProjectId: cached.projectId, remoteUrl: cached.studioUrl, remoteEffects: { uploadedSamples: cached.uploadedSamples ?? {} } });
        return;
      }
    }
    await commitExportPreparation(job, { state: "uncertain", fidelity, manifestPath: result.path, ...(resume.remoteProjectId ? { remoteProjectId: resume.remoteProjectId } : {}), remoteEffects: { uploadedSamples: resume.uploadedSamples ?? {} }, errorMessage: `The prior Audiotool effect is ${reservation.state}; Pocket Producer will not duplicate it automatically.` });
    return;
  }
  await markEffectDispatched(reservation.id, job);
  try {
    const exported = await exportManifestToAudiotool({
      client: serverClient.client, manifest: result.manifest, title: String(revision.title), signal,
      timeoutMs: Math.max(1_000, new Date(job.deadlineAt).getTime() - Date.now()), resume,
      checkpoint: async (value) => recordExportProgress(job, { fidelity, manifestPath: result.path, remoteProjectId: value.remoteProjectId, remoteEffects: { uploadedSamples: value.uploadedSamples } })
    });
    await serverClient.awaitTokenPersistence();
    const effectState = await completeProviderEffect({ effectId: reservation.id, job, output: exported, actualCostMicrousd: 0 });
    if (effectState === "uncertain") throw new Error("Audiotool result arrived after this worker lost ownership");
    await commitExportPreparation(job, { state: "completed", fidelity, manifestPath: result.path, remoteProjectId: exported.projectId, remoteUrl: exported.studioUrl, remoteEffects: { uploadedSamples: exported.uploadedSamples } });
  } catch (error) {
    const uncertain = error instanceof Error && /timeout|network|socket|ECONN|lost ownership/i.test(error.message);
    await failProviderEffect({ effectId: reservation.id, job, errorClass: error instanceof Error ? error.name : "UnknownError", uncertain }).catch(() => undefined);
    const latest = await exportResumeState(job.ownerId, job.baseRevisionId);
    await commitExportPreparation(job, { state: uncertain ? "uncertain" : "failed", fidelity, manifestPath: result.path, ...(latest.remoteProjectId ? { remoteProjectId: latest.remoteProjectId } : {}), remoteEffects: { uploadedSamples: latest.uploadedSamples ?? {} }, errorMessage: uncertain ? "Audiotool export stopped after an ambiguous transport result; it will not be recreated automatically." : "Audiotool rejected or could not complete the export. The local preview and stem manifest remain available." });
  }
}

export async function processJob(job: JobRecord): Promise<void> {
  try {
    if (await isCancelled(job)) return await commitCancelled(job);
    await withLeaseMonitor(job, async (signal) => {
      if (job.kind === "generation") await generation(job, signal);
      else if (job.kind === "revision") await revision(job, signal);
      else await exportRevision(job, signal);
    });
  } catch (error) {
    if (error instanceof JobControlError && error.code === "CANCELLED") await commitCancelled(job);
    else if (error instanceof JobControlError && error.code === "LEASE_LOST") return;
    else if (error instanceof JobControlError && error.code === "DEADLINE_EXCEEDED") await expireJob(job);
    else if (error instanceof Error && /outcome is not safely replayable|previous producer dispatch|EFFECT_(?:DISPATCHED|UNCERTAIN)/i.test(error.message)) {
      await needsAttentionJob(job, "PROVIDER_OUTCOME_UNCERTAIN", error.message);
    } else if (job.attempts < 2 && error instanceof Error && /timeout|rate|ECONN|network|socket/i.test(error.message)) {
      const requeued = await requeueJob(job, "TRANSIENT_RETRY", error.message);
      if (!requeued && await isCancelled(job).catch(() => false)) await commitCancelled(job);
    } else {
      const failed = await failJob(job, "JOB_FAILED", error instanceof Error ? error.message : "Unknown worker error");
      if (!failed && await isCancelled(job).catch(() => false)) await commitCancelled(job);
    }
  }
}

export async function runWorker(): Promise<void> {
  let stopping = false;
  process.on("SIGINT", () => { stopping = true; });
  process.on("SIGTERM", () => { stopping = true; });
  process.stdout.write(`Pocket Producer worker ${workerId} started\n`);
  while (!stopping) {
    await dispatchOutbox();
    const job = await claimNextJob(workerId);
    if (job) await processJob(job);
    else await new Promise((resolve) => setTimeout(resolve, 600));
  }
  await closePool();
  process.stdout.write("Worker stopped after current job\n");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await runWorker();
