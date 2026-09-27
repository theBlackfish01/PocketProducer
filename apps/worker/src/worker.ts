import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { awaitAllCallbacks } from "@langchain/core/callbacks/promises";
import {
  appendAttemptEvent, canonicalHash, claimNextJob, closePool, commitCancelled, createAudiotoolServerClient, dispatchOutbox, expireJob, failJob, getConfig, heartbeat, isCancelled, needsAttentionJob, providerAvailability, requeueJob, profileOwnedSourceWav, safeStoragePath, AudiotoolSessionExpiredError, JobControlError, NativeToolSession, advanceNativeSync, applyNativeOperations, applyNativeSnapshot, beginNativeSync, beginOwnedSampleUpload, commitNativeRevision, createNativeLibrary, finishNativeSync, finishOwnedSampleUpload, getNativeRevision, getPool, markOwnedSampleUncertain, nativeDocumentSchema, nativeHasMaterial, nativeStructuralReadback, produceNative, readyOwnedSampleResources, resolveNativePresets, resolveNativeSamples, seedNativeDocument, setNativeProtections, validateNativeOffline, type JobRecord, type NativeLibrary, type NativeLibraryClient, type NativeRemoteClient, type NativeSource
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

interface OfflineNativeConstruction { library: NativeLibrary; scriptedModel: NonNullable<Parameters<typeof produceNative>[0]["scriptedModel"]>; scriptedReviewer?: NonNullable<Parameters<typeof produceNative>[0]["scriptedReviewer"]>; scriptedGeminiClient?: NonNullable<Parameters<typeof produceNative>[0]["scriptedGeminiClient"]>; testGraphStepLimit?: number }
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
  const library = offlineInput?.library ?? (libraryConnection ? createNativeLibrary(libraryConnection.client) : null);
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
    const produced = await produceNative({ session, direction, mode: job.kind === "native-generation" ? "generation" : "revision", sources, ...(typeof job.request.targetPartId === "string" ? { targetPartId: job.request.targetPartId } : {}), ...(typeof job.request.targetSectionId === "string" ? { targetSectionId: job.request.targetSectionId } : {}), ...(offlineInput ? { scriptedModel: offlineInput.scriptedModel, ...(offlineInput.scriptedReviewer ? { scriptedReviewer: offlineInput.scriptedReviewer } : {}), ...(offlineInput.scriptedGeminiClient ? { scriptedGeminiClient: offlineInput.scriptedGeminiClient } : {}), testGraphStepLimit: offlineInput.testGraphStepLimit } : {}), signal });
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
  const client = connection.client;
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

export async function processJob(job: JobRecord, offlineNative?: OfflineNativeConstruction): Promise<void> {
  if (!["native-generation", "native-revision", "native-sync"].includes(job.kind)) throw new Error("Unsupported retired job kind");
  try {
    if (await isCancelled(job)) return await commitCancelled(job);
    await withLeaseMonitor(job, async (signal) => {
      if (job.kind === "native-generation" || job.kind === "native-revision") await nativeConstruction(job, signal, offlineNative);
      else if (job.kind === "native-sync") await nativeSynchronization(job, signal);
      else throw new Error("Native synchronization is not yet enabled for this worker");
    });
  } catch (error) {
    if (error instanceof JobControlError && error.code === "CANCELLED") await commitCancelled(job);
    else if (error instanceof JobControlError && (error.code === "LEASE_LOST" || error.code === "MONITOR_UNAVAILABLE")) return;
    else if (error instanceof JobControlError && error.code === "DEADLINE_EXCEEDED") await expireJob(job);
    else if ((job.kind === "native-generation" || job.kind === "native-revision") && error instanceof Error && (/^(NATIVE_INCOMPLETE|MODEL_CALL_LIMIT_EXCEEDED|MODEL_BUDGET_EXCEEDED|OPENAI_INPUT_LIMIT_EXCEEDED|OPENAI_INCOMPLETE_RESPONSE)/.test(error.message) || error.name === "GraphRecursionError" || error.name === "NativeGraphInterruptedError" || /Recursion limit of \d+ reached/.test(error.message))) {
      await needsAttentionJob(job, "NATIVE_PARTIAL", `Construction stopped before completion; no new version was selected. Confirmed work, if any, is saved under this request. ${error.message}`);
    }
    else if (error instanceof Error && (error.name === "NativeModelOutcomeUncertainError" || /outcome is not safely replayable|previous (?:native )?producer dispatch|NATIVE_STEP_REPLAY_CONFLICT|EFFECT_(?:DISPATCHED|UNCERTAIN)/i.test(error.message))) {
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
