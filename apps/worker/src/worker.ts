import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { awaitAllCallbacks } from "@langchain/core/callbacks/promises";
import {
  analyzePreview, appendAttemptEvent, attemptBoundedDrumRepair, canonicalHash, claimNextJob, closePool, commitCancelled, commitExportPreparation, commitRevision, compileArrangement, completeProviderEffect, compositionSourceLineage, createAudiotoolServerClient, decodeWav, dispatchOutbox, expireJob, exportManifestToAudiotool, exportResumeState, failJob, failProviderEffect,
  getConfig, getRevision, heartbeat, isCancelled, markEffectDispatched, needsAttentionJob, produceArrangement, protectedTrackHash, providerAvailability, recordExportProgress, requeueJob, reserveProviderEffect,
  measureDecodedWav, profileOwnedSourceWav, renderAssets, renderComposition, safeStoragePath, simplifyDrums, validateComposition, writeNexusManifest,
  AudiotoolSessionExpiredError, JobControlError, NexusOperationError, NEXUS_MAPPING_VERSION, NativeToolSession, advanceNativeSync, applyNativeOperations, applyNativeSnapshot, beginNativeSync, beginOwnedSampleUpload, commitNativeRevision, createNativeLibrary, finishNativeSync, finishOwnedSampleUpload, getNativeRevision, getPool, markOwnedSampleUncertain, nativeDocumentSchema, nativeHasMaterial, nativeStructuralReadback, produceNative, readyOwnedSampleResources, resolveNativePresets, resolveNativeSamples, seedNativeDocument, setNativeProtections, validateNativeOffline, type AudiotoolExportCheckpoint, type AudioAnalysis, type JobRecord, type NativeLibrary, type NativeLibraryClient, type NativeRemoteClient, type NativeSource, type SourceDescriptor
} from "@pocket/core";

const config = getConfig();
export async function optionalNativeLibraryConnection(ownerId: string, clientId: string, connect: typeof createAudiotoolServerClient = createAudiotoolServerClient) {
  try { return await connect(ownerId, clientId); }
  catch (error) { if (error instanceof AudiotoolSessionExpiredError) return null; throw error; }
}
const workerId = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;

async function stage(job: JobRecord, name: string, message: string) {
  await appendAttemptEvent(job, "stage", { stage: name, message }, name);
}

async function checkpoint(job: JobRecord): Promise<void> {
  const control = await heartbeat(job);
  if (control) throw new JobControlError(control, control === "CANCELLED" ? "Cancellation requested" : control === "DEADLINE_EXCEEDED" ? "Job deadline expired" : "Worker lease lost");
}

export async function withLeaseMonitor(
  job: JobRecord,
  run: (signal: AbortSignal) => Promise<void>,
  options: { renew?: (job: JobRecord) => Promise<ReturnType<typeof heartbeat> extends Promise<infer T> ? T : never>; intervalMs?: number } = {}
): Promise<void> {
  const controller = new AbortController();
  let monitorError: JobControlError | undefined;
  let stopped = false;
  let wake: (() => void) | undefined;
  const intervalMs = options.intervalMs ?? Math.max(250, Math.floor(config.JOB_LEASE_SECONDS * 1_000 / 3));
  const renew = options.renew ?? heartbeat;
  const monitor = (async () => {
    while (!stopped) {
      await new Promise<void>((resolve) => {
        wake = resolve;
        const timer = setTimeout(resolve, intervalMs);
        timer.unref?.();
      });
      wake = undefined;
      if (stopped) return;
      try {
        const control = await renew(job);
        if (control) {
          monitorError = new JobControlError(control, control === "CANCELLED" ? "Cancellation requested" : control === "DEADLINE_EXCEEDED" ? "Job deadline expired" : "Worker lease lost");
          controller.abort(monitorError);
          return;
        }
      } catch (error) {
        monitorError = new JobControlError("MONITOR_UNAVAILABLE", `Lease renewal failed: ${error instanceof Error ? error.name : "database error"}`);
        controller.abort(monitorError);
        return;
      }
    }
  })();
  try {
    await run(controller.signal);
    if (monitorError) throw monitorError;
  } catch (error) {
    if (controller.signal.aborted && controller.signal.reason instanceof JobControlError) throw controller.signal.reason;
    throw error;
  } finally {
    stopped = true;
    wake?.();
    await monitor;
  }
}

function throwIfAborted(signal: AbortSignal, fallback: string): void {
  if (!signal.aborted) return;
  if (signal.reason instanceof JobControlError) throw signal.reason;
  throw new JobControlError("CANCELLED", fallback);
}

async function boundedNativeWait<T>(run: () => Promise<T>, job: JobRecord, signal: AbortSignal, step: string): Promise<T> {
  throwIfAborted(signal, `${step} interrupted`);
  const remaining = new Date(job.deadlineAt).getTime() - Date.now();
  if (remaining <= 0) throw new JobControlError("DEADLINE_EXCEEDED", `${step} exceeded the job deadline`);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const limit = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${step} timed out after dispatch; outcome requires reconciliation`)), Math.min(remaining, 60_000));
    onAbort = () => reject(signal.reason instanceof Error ? signal.reason : new JobControlError("CANCELLED", `${step} interrupted`));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try { return await Promise.race([run(), limit]); }
  finally { if (timer) clearTimeout(timer); if (onAbort) signal.removeEventListener("abort", onAbort); }
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
        uncertainty: sourceAnalysis.uncertainty,
        suggestedRole: sourceAnalysis.suggestedSourceRole
      };
    }
  }
  await stage(job, "planning", "Shaping the arrangement");
  const producer = await produceArrangement({ job, direction, ...(sourceDescriptor ? { source: sourceDescriptor } : {}), signal });
  await stage(job, "composing", "Writing parts into the Sunroom palette");
  let composition = validateComposition(compileArrangement(producer.plan, sourceAssetId));
  await stage(job, "rendering", "Rendering a real 48 kHz preview");
  const outputDirectory = safeStoragePath(job.ownerId, job.projectId, "renders", job.id, `attempt-${job.leaseGeneration}-${job.attemptId}`);
  const renderOptions = { signal, checkpoint: () => { throwIfAborted(signal, "Rendering interrupted"); return Promise.resolve(); } };
  let render = await renderComposition(composition, outputDirectory, assets, renderOptions);
  let renderAttempts = 1;
  await stage(job, "checking", "Checking timing, headroom and source lineage");
  if (render.rms < 0.001 || render.nonSilentRatio < 0.01 || render.peak <= 0) throw new Error("Rendered preview is silent");
  if (render.durationSeconds > config.MAX_OUTPUT_SECONDS) throw new Error("Rendered preview exceeds the configured output duration");
  const previewBytes = await readFile(render.previewPath);
  const firstPreviewHash = createHash("sha256").update(previewBytes).digest("hex");
  const analysis: AudioAnalysis = config.MAX_AUDIO_CRITIQUE_PASSES === 0 ? {
    status: "uncritiqued", assetHash: firstPreviewHash, model: null, promptVersion: "audio-analysis-v2", purpose: "preview-critique",
    inspectedInterval: { start: 0, end: render.durationSeconds }, measured: { durationSeconds: render.durationSeconds, peak: render.peak, rms: render.rms, nonSilentRatio: render.nonSilentRatio },
    observations: [], uncertainty: "Preview critique is disabled by MAX_AUDIO_CRITIQUE_PASSES=0.", suggestedActions: [], suggestedSourceRole: null,
    repairAction: "none", usage: { promptTokens: 0, candidateTokens: 0, thoughtsTokens: 0, totalTokens: 0 }, costMicrousd: 0
  } : await analyzePreview({ job, path: render.previewPath, hash: firstPreviewHash, purpose: "preview-critique", signal, durationSeconds: render.durationSeconds, peak: render.peak, rms: render.rms, nonSilentRatio: render.nonSilentRatio });
  let repairedDrums = 0;
  let finalAnalysis = analysis;
  if (analysis.status === "available" && analysis.repairAction === "simplify-drums" && config.MAX_AUDIO_CRITIQUE_PASSES > 0 && renderAttempts < config.MAX_RENDER_ATTEMPTS_PER_JOB) {
    renderAttempts += 1;
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
      const repairedBytes = await readFile(render.previewPath);
      finalAnalysis = {
        status: "uncritiqued", assetHash: createHash("sha256").update(repairedBytes).digest("hex"), model: analysis.model, promptVersion: "audio-analysis-v2", purpose: "preview-critique",
        inspectedInterval: { start: 0, end: render.durationSeconds }, measured: { durationSeconds: render.durationSeconds, peak: render.peak, rms: render.rms, nonSilentRatio: render.nonSilentRatio },
        observations: [], uncertainty: "The bounded critique budget was spent on the earlier candidate; this repaired audio passed deterministic checks but was not sent to Gemini again.",
        suggestedActions: [], suggestedSourceRole: null, repairAction: "none", usage: { promptTokens: 0, candidateTokens: 0, thoughtsTokens: 0, totalTokens: 0 }, costMicrousd: 0
      };
    }
  }
  await checkpoint(job);
  const finalPreviewBytes = await readFile(render.previewPath);
  const finalPreviewHash = createHash("sha256").update(finalPreviewBytes).digest("hex");
  const sourceLineage = compositionSourceLineage(composition);
  // The legacy renderer uses the beginning of each source file for every event.
  // Whole-file source analysis can be non-silent while that actual excerpt is
  // silent, so inspect the rendered source-only texture stem instead.
  const textureStem = render.stems.texture;
  const sourceStemSignal = textureStem ? measureDecodedWav(decodeWav(await readFile(textureStem))).nonSilentRatio : 0;
  const sourceWasAudible = Boolean(sourceAssetId && sourceLineage.referencedSourceAssetIds.includes(sourceAssetId) && sourceStemSignal >= 0.001);
  await commitRevision(job, {
    composition, previewPath: render.previewPath, stems: render.stems, waveformPeaks: render.waveformPeaks, durationSeconds: render.durationSeconds,
    previewHash: finalPreviewHash, peak: render.peak, rms: render.rms, nonSilentRatio: render.nonSilentRatio, title: producer.plan.title,
    summary: `Created a ${producer.plan.tempoBpm} BPM ${producer.plan.energy < 0.5 ? "restrained" : "energized"} instrumental${sourceWasAudible ? " using the supplied source" : " from the owned Sunroom palette"}.${repairedDrums ? ` Gemini critique triggered one bounded repair that removed ${repairedDrums} Groove hi-hat hits.` : ""}`,
    protectedTrackHashes: {}, producer: {
      ...producer,
      sourceAnalysisStatus: sourceAnalysis?.status ?? "not-requested",
      previewAnalysisStatus: finalAnalysis.status,
      previewAnalysisHash: finalAnalysis.assetHash,
      repairAction: analysis.repairAction,
      renderAttempts,
      sourceLineage: { attached: sourceLineage.attachedSourceAssetIds, selected: sourceAssetId ?? null, referenced: sourceLineage.referencedSourceAssetIds, audiblyUsed: sourceWasAudible }
    },
    analysisRecords: [
      ...(sourceAnalysis ? [{ analysis: sourceAnalysis, associateWithRevision: true }] : []),
      { analysis, associateWithRevision: repairedDrums === 0 },
      ...(repairedDrums ? [{ analysis: finalAnalysis, associateWithRevision: true }] : [])
    ]
  });
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
  const render = await renderComposition(composition, outputDirectory, assets, { signal, checkpoint: () => { throwIfAborted(signal, "Rendering interrupted"); return Promise.resolve(); } });
  const baseStems = baseRow.stems as Record<string, string>;
  if (baseStems.melody) {
    render.stems.melody = baseStems.melody;
  }
  await stage(job, "checking", "Verifying the protected melody and revision scope");
  if (render.rms < 0.001 || render.nonSilentRatio < 0.01 || render.peak <= 0 || protectedTrackHash(composition, "melody") !== beforeHash) throw new Error("Revised render failed signal or protected-melody validation");
  const previewHash = createHash("sha256").update(await readFile(render.previewPath)).digest("hex");
  const revisionAnalysis: AudioAnalysis = {
    status: "uncritiqued", assetHash: previewHash, model: null, promptVersion: "audio-analysis-v2", purpose: "preview-critique",
    inspectedInterval: { start: 0, end: render.durationSeconds }, measured: { durationSeconds: render.durationSeconds, peak: render.peak, rms: render.rms, nonSilentRatio: render.nonSilentRatio },
    observations: [], uncertainty: "Semantic revision passed deterministic signal and protected-artifact checks; no preview-critique pass was requested.",
    suggestedActions: [], suggestedSourceRole: null, repairAction: "none", usage: { promptTokens: 0, candidateTokens: 0, thoughtsTokens: 0, totalTokens: 0 }, costMicrousd: 0
  };
  await commitRevision(job, {
    composition, previewPath: render.previewPath, stems: render.stems, waveformPeaks: render.waveformPeaks, durationSeconds: render.durationSeconds,
    previewHash, peak: render.peak, rms: render.rms, nonSilentRatio: render.nonSilentRatio, title: String(baseRow.title),
    summary: `Removed ${removed} hi-hat hits from Groove. Melody structure and protected stem preserved.`,
    protectedTrackHashes: { melody: beforeHash }, producer: { provider: "validated-semantic-revision", direction, removed },
    analysisRecords: [{ analysis: revisionAnalysis, associateWithRevision: true }]
  });
}

interface OfflineNativeConstruction { library: NativeLibrary; scriptedModel: NonNullable<Parameters<typeof produceNative>[0]["scriptedModel"]>; testGraphStepLimit?: number }
async function nativeConstruction(job: JobRecord, signal: AbortSignal, offlineInput?: OfflineNativeConstruction): Promise<void> {
  const direction = typeof job.request.direction === "string" ? job.request.direction : "Construct an editable piece";
  const baseId = typeof job.request.baseNativeRevisionId === "string" ? job.request.baseNativeRevisionId : null;
  const base = baseId ? (await getNativeRevision(job.ownerId, job.projectId, baseId)).document : seedNativeDocument(direction);
  const protectionChange = job.request.protectionChange && typeof job.request.protectionChange === "object" ? job.request.protectionChange as { expectedPartIds?: unknown; desiredPartIds?: unknown } : null;
  const protectedPartIds = Array.isArray(job.request.protectedPartIds) ? job.request.protectedPartIds.filter((value): value is string => typeof value === "string") : [];
  const protectedBase = protectionChange && Array.isArray(protectionChange.expectedPartIds) && Array.isArray(protectionChange.desiredPartIds)
    ? setNativeProtections(base, protectionChange.expectedPartIds as string[], protectionChange.desiredPartIds as string[])
    : protectedPartIds.length ? applyNativeOperations(base, [{ kind: "protect", partIds: protectedPartIds, motifIds: [] }]) : base;
  const libraryConnection = !offlineInput && !config.FIXTURE_MODE && config.AUDIOTOOL_CLIENT_ID ? await optionalNativeLibraryConnection(job.ownerId, config.AUDIOTOOL_CLIENT_ID) : null;
  const library = offlineInput?.library ?? (libraryConnection ? createNativeLibrary(libraryConnection.client as unknown as NativeLibraryClient) : null);
  const session = new NativeToolSession(job, protectedBase, true, library);
  const selected = Array.isArray(job.request.sourceAssetIds) ? job.request.sourceAssetIds.filter((value): value is string => typeof value === "string") : [];
  const assets = selected.length ? await getPool().query<{ id: string; name: string; content_hash: string; duration_seconds: number }>("SELECT id,name,content_hash,duration_seconds FROM asset WHERE owner_id=$1 AND project_id=$2 AND kind='source' AND readiness='ready' AND id=ANY($3::uuid[])", [job.ownerId, job.projectId, selected]) : { rows: [] };
  if (assets.rows.length !== selected.length) throw new Error("A selected source is no longer available");
  const sources: NativeSource[] = await Promise.all(assets.rows.map(async (row) => {
    const bytes = await readFile(safeStoragePath(job.ownerId, job.projectId, "sources", `${row.content_hash}.wav`));
    if (createHash("sha256").update(bytes).digest("hex") !== row.content_hash) throw new Error("Selected owned source bytes no longer match their accepted hash");
    return { assetId: row.id, name: row.name, assetHash: row.content_hash, durationSeconds: Number(row.duration_seconds), rights: "User-uploaded source; license not independently verified", profile: profileOwnedSourceWav(bytes) };
  }));
  await stage(job, "discovering", "Checking native devices, protected material and current project context");
  throwIfAborted(signal, "Native construction interrupted");
  await stage(job, "constructing", "Building sections, instrument parts, motifs and automation");
  try {
    const produced = await produceNative({ session, direction, mode: job.kind === "native-generation" ? "generation" : "revision", sources, ...(typeof job.request.targetPartId === "string" ? { targetPartId: job.request.targetPartId } : {}), ...(typeof job.request.targetSectionId === "string" ? { targetSectionId: job.request.targetSectionId } : {}), ...(offlineInput ? { scriptedModel: offlineInput.scriptedModel, testGraphStepLimit: offlineInput.testGraphStepLimit } : {}), signal });
    await checkpoint(job);
    const document = nativeDocumentSchema.parse(session.document);
    if (job.kind === "native-generation" && !nativeHasMaterial(document)) throw new Error("Native producer returned no musical material");
    await stage(job, "validating", "Validating native notes, pattern regions, routing and automation in the pinned SDK");
    const presets = await resolveNativePresets(document, library);
    const librarySamples = await resolveNativeSamples(document, library);
    const offline = await validateNativeOffline(document, {}, presets, librarySamples);
    await checkpoint(job);
    await commitNativeRevision(job, document, produced.summary, { ...produced, offlineValidation: offline, audioState: "deferred" });
  } finally { await libraryConnection?.awaitTokenPersistence(); }
}

export async function nativeSynchronization(job: JobRecord, signal: AbortSignal, offlineConnection?: { client: NativeRemoteClient; awaitTokenPersistence(): Promise<void> }): Promise<void> {
  const revisionId = typeof job.request.baseNativeRevisionId === "string" ? job.request.baseNativeRevisionId : "";
  const revision = await getNativeRevision(job.ownerId, job.projectId, revisionId);
  if (!offlineConnection && (!providerAvailability(config).audiotool || !config.AUDIOTOOL_CLIENT_ID)) throw new Error("Native synchronization is unavailable in fixture mode or without Audiotool configuration");
  const connection = offlineConnection ?? await createAudiotoolServerClient(job.ownerId, config.AUDIOTOOL_CLIENT_ID!);
  if (!connection) throw new Error("Connect Audiotool before requesting native synchronization");
  try {
  const client = connection.client as unknown as NativeRemoteClient;
  const library = createNativeLibrary(connection.client as unknown as NativeLibraryClient);
  await stage(job, "validating", "Checking the selected native structure and owned sources offline");
  const presets = await resolveNativePresets(revision.document, library);
  const librarySamples = await resolveNativeSamples(revision.document, library);
  await validateNativeOffline(revision.document, {}, presets, librarySamples);
  await checkpoint(job);
  const saved = await beginNativeSync(job, revision.documentHash);
  let checkpointState = saved.state;
  if (saved.state === "create_in_flight" && !saved.createdNow) {
    await advanceNativeSync(job, "create_in_flight", "uncertain", { errorMessage: "A prior Audiotool project-create call may have succeeded; its identity needs reconciliation." });
    await needsAttentionJob(job, "NATIVE_CREATE_OUTCOME_UNKNOWN", "A prior Audiotool project-create call may have succeeded; reconcile its identity before retrying.");
    return;
  }
  if (["conflict", "uncertain", "failed"].includes(saved.state)) {
    await needsAttentionJob(job, "NATIVE_SYNC_RECONCILIATION_REQUIRED", `Native synchronization checkpoint is ${saved.state}; inspect the remote project before any new mutation.`);
    return;
  }
  let remoteName = saved.remoteProjectName;
  if (saved.createdNow) {
    await stage(job, "synchronizing", "Creating an isolated native Audiotool project");
    throwIfAborted(signal, "Native synchronization interrupted");
    try {
      const created = await boundedNativeWait(() => client.projects.createProject({ project: { displayName: `Pocket Producer · ${revision.document.title.slice(0, 72)} · v${revision.ordinal}` } }), job, signal, "native project create");
      if (created instanceof Error || !created.project?.name) throw new Error("Audiotool project creation did not return a durable identity");
      remoteName = created.project.name;
      await advanceNativeSync(job, "create_in_flight", "created", { remoteProjectName: created.project.name });
      checkpointState = "created";
    } catch {
      await advanceNativeSync(job, "create_in_flight", "uncertain", { errorMessage: "Remote project creation may have succeeded; automatic retry is fenced." });
      await needsAttentionJob(job, "NATIVE_CREATE_OUTCOME_UNKNOWN", "Remote project creation may have succeeded; automatic retry is fenced.");
      return;
    }
  }
  if (!remoteName) throw new Error("Native synchronization checkpoint has no remote project identity");
  const sourceIds = revision.document.sourceAssetIds;
  for (const assetId of sourceIds) {
    const asset = await getPool().query<{ content_hash: string; duration_seconds: number; name: string }>("SELECT content_hash,duration_seconds,name FROM asset WHERE id=$1 AND owner_id=$2 AND project_id=$3 AND kind='source' AND readiness='ready'", [assetId, job.ownerId, job.projectId]);
    if (!asset.rows[0]) throw new Error(`Owned source ${assetId} is no longer ready`);
    const row = asset.rows[0];
    const upload = await beginOwnedSampleUpload(job, assetId, row.content_hash);
    if (upload.state === "ready") continue;
    if (!upload.createdNow) {
      await advanceNativeSync(job, checkpointState, "uncertain", { errorMessage: `Upload for source ${assetId} has no confirmed ready outcome; no retry was attempted.` });
      await needsAttentionJob(job, "NATIVE_SAMPLE_OUTCOME_UNKNOWN", `Upload for source ${assetId} requires reconciliation before synchronization.`);
      return;
    }
    await stage(job, "synchronizing", `Uploading owned source ${assetId.slice(0, 8)} with durable identity`);
    try {
      throwIfAborted(signal, "Native sample upload interrupted");
      const bytes = await readFile(safeStoragePath(job.ownerId, job.projectId, "sources", `${row.content_hash}.wav`));
      if (createHash("sha256").update(bytes).digest("hex") !== row.content_hash) throw new Error("Owned source bytes no longer match the accepted hash");
      const result = await boundedNativeWait(() => client.samples.upload({ file: Uint8Array.from(bytes).buffer, displayName: `Pocket Producer · ${row.name.slice(0, 72)}`, bpm: revision.document.tempoBpm, kind: "loop", visibility: "unlisted", tags: ["pocket-producer", "owned-source", revision.id] }, signal), job, signal, "native sample upload acceptance");
      if (result instanceof Error) throw result;
      const uploaded = await boundedNativeWait(() => result.uploaded, job, signal, "native sample bytes");
      if (uploaded instanceof Error) throw uploaded;
      const ready = await boundedNativeWait(() => result.ready, job, signal, "native sample readiness");
      if (ready instanceof Error) throw ready;
      await finishOwnedSampleUpload(job, assetId, ready.name, Number(ready.durationSeconds ?? row.duration_seconds));
      await checkpoint(job);
    } catch (error) {
      await markOwnedSampleUncertain(job, assetId, error instanceof Error ? error.message : "Unknown upload outcome");
      await advanceNativeSync(job, checkpointState, "uncertain", { errorMessage: `Owned source ${assetId} upload outcome is uncertain; automatic retry is fenced.` });
      await needsAttentionJob(job, "NATIVE_SAMPLE_OUTCOME_UNKNOWN", `Owned source ${assetId} upload outcome is uncertain; automatic retry is fenced.`);
      return;
    }
  }
  const sourceSamples = await readyOwnedSampleResources(job.ownerId, job.projectId, sourceIds);
  if (Object.keys(sourceSamples).length !== sourceIds.length) throw new Error("Not all selected owned sources have a ready Audiotool sample identity");
  const local = await validateNativeOffline(revision.document, sourceSamples, presets, librarySamples);
  if (local.unresolvedSources.length) throw new Error("Native source mapping remained incomplete after ready uploads");
  const expectedHash = canonicalHash(local.structuralReadback);
  if (saved.state === "verified") {
    if (!saved.remoteProjectName || !saved.remoteUrl) throw new Error("Verified native checkpoint lacks remote identity");
    const fresh = await client.open(saved.remoteProjectName);
    await fresh.start();
    let observed: string;
    let url: string;
    try { observed = canonicalHash(nativeStructuralReadback(fresh)); url = fresh.dawUrl; }
    finally { await fresh.stop(); await connection.awaitTokenPersistence(); }
    if (observed !== expectedHash) {
      await advanceNativeSync(job, "verified", "conflict", { remoteUrl: url, observedHash: observed, errorMessage: "Fresh Studio readback differs from the saved native version; no overwrite was attempted." });
      await needsAttentionJob(job, "NATIVE_REMOTE_CONFLICT", "Fresh Studio readback differs from the saved native version; no overwrite was attempted.");
      return;
    }
    await finishNativeSync(job, saved.remoteProjectName, url, observed, "verified");
    return;
  }
  await stage(job, "synchronizing", "Writing notes, patterns, effects and routing to the isolated project");
  const remote = await client.open(remoteName);
  await remote.start();
  let remoteUrl = remote.dawUrl;
  try {
    if (saved.state === "apply_in_flight") {
      const observed = canonicalHash(nativeStructuralReadback(remote));
      if (observed === expectedHash) {
        await finishNativeSync(job, remoteName, remoteUrl, observed, "apply_in_flight");
        return;
      }
      await advanceNativeSync(job, "apply_in_flight", "conflict", { remoteUrl, observedHash: observed, errorMessage: "Remote structure differs after an interrupted write; manual reconciliation required." });
      await needsAttentionJob(job, "NATIVE_REMOTE_CONFLICT", "Remote structure differs after an interrupted write; no automatic overwrite was attempted.");
      return;
    }
    if (saved.state === "created" || saved.createdNow) {
      const initial = nativeStructuralReadback(remote);
       if (initial.semanticEntities.some((entity) => ["heisenberg", "pulverisateur", "gakki", "beatbox8", "noteTrack", "noteRegion", "patternTrack", "patternRegion", "audioDevice", "audioTrack", "audioRegion", "sample", "mixerChannel", "mixerGroup", "mixerStripGrouping", "mixerReverbAux", "mixerAuxRoute", "desktopAudioCable", "automationTrack", "stompboxDelay", "stompboxReverb", "stompboxCompressor", "stompboxParametricEqualizer", "autoFilter"].includes(entity.type ?? ""))) {
        await advanceNativeSync(job, "created", "conflict", { remoteUrl, observedHash: canonicalHash(initial), errorMessage: "The target project is not empty." });
        await needsAttentionJob(job, "NATIVE_REMOTE_CONFLICT", "The isolated target project was not empty; no remote overwrite was attempted.");
        return;
      }
      await advanceNativeSync(job, "created", "apply_in_flight", { remoteUrl });
      try { await applyNativeSnapshot(remote, revision.document, sourceSamples, presets, librarySamples); }
      catch {
        await advanceNativeSync(job, "apply_in_flight", "uncertain", { remoteUrl, errorMessage: "Native document mutation may have committed; inspect before retrying." });
        await needsAttentionJob(job, "NATIVE_APPLY_OUTCOME_UNKNOWN", "Native document mutation may have committed; automatic retry is fenced.");
        return;
      }
    }
  } finally { await remote.stop(); await connection.awaitTokenPersistence(); }
  // A second open is a fresh server readback, not the optimistic local document state.
  const readback = await client.open(remoteName);
  await readback.start();
  let observedHash: string;
  try { remoteUrl = readback.dawUrl; observedHash = canonicalHash(nativeStructuralReadback(readback)); }
  finally { await readback.stop(); await connection.awaitTokenPersistence(); }
  if (observedHash !== expectedHash) {
    await advanceNativeSync(job, "apply_in_flight", "conflict", { remoteUrl, observedHash, errorMessage: "Fresh remote readback differs from the validated local structure." });
    await needsAttentionJob(job, "NATIVE_REMOTE_CONFLICT", "Fresh remote readback differs from the validated local structure.");
    return;
  }
  await checkpoint(job);
  await finishNativeSync(job, remoteName, remoteUrl, observedHash, "apply_in_flight");
  } finally { await connection.awaitTokenPersistence(); }
}

async function exportRevision(job: JobRecord, signal: AbortSignal): Promise<void> {
  if (!job.baseRevisionId) throw new Error("Export job is missing its revision");
  const revision = await getRevision(job.ownerId, job.baseRevisionId);
  const composition = validateComposition(revision.composition);
  await stage(job, "exporting", "Preparing editable per-part stems for Nexus");
  const result = await writeNexusManifest({ revisionId: job.baseRevisionId, composition, stems: revision.stems as Record<string, string>, outputDirectory: safeStoragePath(job.ownerId, job.projectId, "exports", job.id, `attempt-${job.leaseGeneration}-${job.attemptId}`) });
  const available = providerAvailability(config).audiotool;
  const fidelity = { level: "editable-stem", noteEditability: "rendered-audio-only", parts: result.manifest.parts, offlineValidation: result.evidence };
  const resume = await exportResumeState(job.ownerId, job.baseRevisionId);
  if (resume.state === "completed" && resume.remoteProjectId && resume.remoteUrl) {
    await commitExportPreparation(job, { state: "completed", fidelity, manifestPath: result.path, remoteProjectId: resume.remoteProjectId, remoteUrl: resume.remoteUrl, remoteEffects: resume.checkpoint ?? {} });
    return;
  }
  if (resume.state === "uncertain") {
    await commitExportPreparation(job, { state: "uncertain", fidelity, manifestPath: result.path, ...(resume.remoteProjectId ? { remoteProjectId: resume.remoteProjectId } : {}), remoteEffects: resume.checkpoint ?? {}, errorMessage: resume.errorMessage ?? "A prior Audiotool mutation has an unresolved outcome; automatic replay is fenced." });
    return;
  }
  if (!available || !config.AUDIOTOOL_CLIENT_ID) {
    await commitExportPreparation(job, { state: "disabled", fidelity, manifestPath: result.path, errorMessage: "Audiotool app registration is not configured; the validated local four-stem manifest remains available." });
    return;
  }
  const serverClient = await createAudiotoolServerClient(job.ownerId, config.AUDIOTOOL_CLIENT_ID);
  if (!serverClient) {
    await commitExportPreparation(job, { state: "awaiting_authorization", fidelity, manifestPath: result.path, errorMessage: "Audiotool app configuration is present; browser OAuth consent is required before remote export." });
    return;
  }

  const emptyCheckpoint: AudiotoolExportCheckpoint = {
    ...(resume.remoteProjectId ? { remoteProjectId: resume.remoteProjectId } : {}),
    uploadedSamples: {},
    project: resume.remoteProjectId ? { state: "succeeded", remoteId: resume.remoteProjectId } : { state: "never_dispatched" },
    uploads: {},
    arrangement: { state: "never_dispatched" }
  };
  let durableCheckpoint = resume.checkpoint ?? emptyCheckpoint;
  try {
    await recordExportProgress(job, { fidelity, manifestPath: result.path, checkpoint: durableCheckpoint });
  } catch (error) {
    if (error instanceof Error && /EXPORT_(?:OUTCOME_UNCERTAIN|OPERATION_IN_PROGRESS|ALREADY_COMPLETED)/.test(error.message)) {
      await needsAttentionJob(job, error.message, "The durable Audiotool operation must be reconciled before a new remote mutation can start.");
      return;
    }
    throw error;
  }
  const reservation = await reserveProviderEffect({
    job, provider: "audiotool", step: "four-stem-export", idempotencyKey: `audiotool:export:${job.baseRevisionId}:${NEXUS_MAPPING_VERSION}`,
    inputHash: canonicalHash({ revisionId: job.baseRevisionId, mappingVersion: result.manifest.mappingVersion, tempoBpm: result.manifest.tempoBpm, projectDurationNexusTicks: result.manifest.projectDurationNexusTicks, parts: result.manifest.parts.map(({ trackId, role, durationSeconds, sampleRate, channels, audioDurationNexusTicks }) => ({ trackId, role, durationSeconds, sampleRate, channels, audioDurationNexusTicks })) }),
    model: "nexus-0.0.17", promptVersion: NEXUS_MAPPING_VERSION, reservationMicrousd: 0
  });
  if (!reservation.created) {
    if (reservation.state === "succeeded") {
      const cached = reservation.cachedOutput as { projectId?: string; studioUrl?: string; uploadedSamples?: Record<string, string> } | undefined;
      if (cached?.projectId && cached.studioUrl) {
        await commitExportPreparation(job, { state: "completed", fidelity, manifestPath: result.path, remoteProjectId: cached.projectId, remoteUrl: cached.studioUrl, remoteEffects: resume.checkpoint ?? { uploadedSamples: cached.uploadedSamples ?? {} } });
        return;
      }
    }
    await commitExportPreparation(job, { state: "uncertain", fidelity, manifestPath: result.path, ...(resume.remoteProjectId ? { remoteProjectId: resume.remoteProjectId } : {}), remoteEffects: durableCheckpoint, errorMessage: `The prior Audiotool effect is ${reservation.state}; Pocket Producer will not duplicate it automatically.` });
    return;
  }
  await markEffectDispatched(reservation.id, job);
  try {
    const exported = await exportManifestToAudiotool({
      client: serverClient.client, manifest: result.manifest, title: String(revision.title), signal,
      timeoutMs: Math.max(1_000, new Date(job.deadlineAt).getTime() - Date.now()), resume: durableCheckpoint,
      checkpoint: async (value) => {
        durableCheckpoint = value;
        await recordExportProgress(job, { fidelity, manifestPath: result.path, checkpoint: value });
      }
    });
    const effectState = await completeProviderEffect({ effectId: reservation.id, job, output: exported, actualCostMicrousd: 0 });
    if (effectState === "uncertain") throw new Error("Audiotool result arrived after this worker lost ownership");
    let persistenceWarning: string | undefined;
    try { await serverClient.awaitTokenPersistence(); }
    catch { persistenceWarning = "The export completed, but refreshed authorization could not be stored; reconnect Audiotool before the next export."; }
    await commitExportPreparation(job, { state: "completed", fidelity, manifestPath: result.path, remoteProjectId: exported.projectId, remoteUrl: exported.studioUrl, remoteEffects: exported.checkpoint, ...(persistenceWarning ? { errorMessage: persistenceWarning } : {}) });
  } catch (error) {
    const uncertain = error instanceof NexusOperationError ? error.kind === "uncertain" : error instanceof Error && /network|socket|ECONN|lost ownership/i.test(error.message);
    await failProviderEffect({ effectId: reservation.id, job, errorClass: error instanceof Error ? error.name : "UnknownError", uncertain }).catch(() => undefined);
    const latest = await exportResumeState(job.ownerId, job.baseRevisionId);
    if (error instanceof NexusOperationError && (error.kind === "cancelled" || error.kind === "deadline")) throw new JobControlError(error.kind === "cancelled" ? "CANCELLED" : "DEADLINE_EXCEEDED", error.message);
    await commitExportPreparation(job, { state: uncertain ? "uncertain" : "failed", fidelity, manifestPath: result.path, ...(latest.remoteProjectId ? { remoteProjectId: latest.remoteProjectId } : {}), remoteEffects: latest.checkpoint ?? durableCheckpoint, errorMessage: uncertain ? "Audiotool export stopped after an ambiguous transport result; it will not be recreated automatically." : "Audiotool rejected or could not complete the export. The local preview and stem manifest remain available." });
  }
}

export async function processJob(job: JobRecord, offlineNative?: OfflineNativeConstruction): Promise<void> {
  try {
    if (await isCancelled(job)) return await commitCancelled(job);
    await withLeaseMonitor(job, async (signal) => {
      if (job.kind === "generation") await generation(job, signal);
      else if (job.kind === "revision") await revision(job, signal);
      else if (job.kind === "export") await exportRevision(job, signal);
      else if (job.kind === "native-generation" || job.kind === "native-revision") await nativeConstruction(job, signal, offlineNative);
      else if (job.kind === "native-sync") await nativeSynchronization(job, signal);
      else throw new Error("Native synchronization is not yet enabled for this worker");
    });
  } catch (error) {
    if (error instanceof JobControlError && error.code === "CANCELLED") await commitCancelled(job);
    else if (error instanceof JobControlError && (error.code === "LEASE_LOST" || error.code === "MONITOR_UNAVAILABLE")) return;
    else if (error instanceof JobControlError && error.code === "DEADLINE_EXCEEDED") await expireJob(job);
    else if ((job.kind === "native-generation" || job.kind === "native-revision") && error instanceof Error && (/^(NATIVE_INCOMPLETE|MODEL_CALL_LIMIT_EXCEEDED|MODEL_BUDGET_EXCEEDED|OPENAI_INPUT_LIMIT_EXCEEDED|OPENAI_INCOMPLETE_RESPONSE)/.test(error.message) || error.name === "GraphRecursionError" || /Recursion limit of \d+ reached/.test(error.message))) {
      await needsAttentionJob(job, "NATIVE_PARTIAL", `The editable draft is unfinished and was not selected. Confirmed work is saved under this request. ${error.message}`);
    }
    else if (error instanceof Error && /outcome is not safely replayable|previous (?:native )?producer dispatch|NATIVE_STEP_REPLAY_CONFLICT|EFFECT_(?:DISPATCHED|UNCERTAIN)/i.test(error.message)) {
      await needsAttentionJob(job, "PROVIDER_OUTCOME_UNCERTAIN", error.message);
    } else if (job.attempts < 2 && error instanceof Error && /timeout|rate|ECONN|network|socket/i.test(error.message)) {
      const requeued = await requeueJob(job, "TRANSIENT_RETRY", error.message);
      if (!requeued) {
        const control = await heartbeat(job).catch(() => "LEASE_LOST" as const);
        if (control === "CANCELLED") await commitCancelled(job);
        else if (control === "DEADLINE_EXCEEDED") await expireJob(job);
      }
    } else {
      const failed = await failJob(job, "JOB_FAILED", error instanceof Error ? error.message : "Unknown worker error");
      if (!failed) {
        const control = await heartbeat(job).catch(() => "LEASE_LOST" as const);
        if (control === "CANCELLED") await commitCancelled(job);
        else if (control === "DEADLINE_EXCEEDED") await expireJob(job);
      }
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
  // The long-running worker submits traces in the background. Flush pending
  // callbacks on a graceful stop without making observability job-critical.
  try { await awaitAllCallbacks(); }
  catch { process.stderr.write("Trace callback flush failed\n"); }
  await closePool();
  process.stdout.write("Worker stopped after current job\n");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) await runWorker();
