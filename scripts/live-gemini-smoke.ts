import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  analyzePreview,
  claimJobById,
  closePool,
  commitRevision,
  createJob,
  decodeWav,
  devOwnerId,
  dispatchOutbox,
  failJob,
  getConfig,
  getPool,
  heartbeat,
  measureDecodedWav,
  recordAudioAnalysis,
  validateComposition
} from "@pocket/core";

const sourceProjectTitle = "Live integrated provider verification v1";
const idempotencyKey = "live-gemini-audio-v2";
const config = getConfig();
if (!(config.GEMINI_API_KEY ?? config.GOOGLE_API_KEY)) throw new Error("GEMINI_API_KEY is not configured in the root .env");
if (config.FIXTURE_MODE) throw new Error("The opt-in Gemini runner refuses FIXTURE_MODE=true");
if (config.INITIAL_BUILD_API_BUDGET_USD <= 0 || config.MAX_JOB_COST_USD < 0.02 || config.MAX_MODEL_CALLS_PER_JOB < 2) {
  throw new Error("Configured provider limits are too strict for two bounded Gemini audio calls; limits were not changed");
}

type SourceRow = { id: string; content_hash: string; object_path: string };
type RevisionRow = {
  id: string;
  title: string;
  composition: unknown;
  preview_path: string;
  preview_hash: string | null;
  stems: Record<string, string>;
  waveform_peaks: number[];
  duration_seconds: number;
  peak: number;
  rms: number;
  non_silent_ratio: number;
  change_summary: string;
  protected_track_hashes: Record<string, string>;
  producer: Record<string, unknown>;
};

const ownerId = await devOwnerId();
let activeJob: Awaited<ReturnType<typeof claimJobById>> = null;
try {
  const project = (await getPool().query<{ id: string; current_revision_id: string }>(
    "SELECT id,current_revision_id FROM project WHERE owner_id=$1 AND title=$2 AND current_revision_id IS NOT NULL ORDER BY created_at DESC LIMIT 1",
    [ownerId, sourceProjectTitle]
  )).rows[0];
  if (!project) throw new Error("Run the integrated live verification once before the targeted Gemini repair check");
  const source = (await getPool().query<SourceRow>(
    "SELECT id,content_hash,object_path FROM asset WHERE owner_id=$1 AND project_id=$2 AND kind='source' ORDER BY created_at LIMIT 1",
    [ownerId, project.id]
  )).rows[0];
  const revision = (await getPool().query<RevisionRow>("SELECT * FROM revision WHERE owner_id=$1 AND id=$2", [ownerId, project.current_revision_id])).rows[0];
  if (!source || !revision) throw new Error("Integrated live evidence is incomplete");

  const created = await createJob({
    ownerId,
    projectId: project.id,
    kind: "generation",
    idempotencyKey,
    request: { direction: "Targeted Gemini audio verification after bounded-output repair", sourceAssetId: source.id }
  });
  const existing = await getPool().query<{ state: string }>("SELECT state FROM job WHERE id=$1", [created.id]);
  const existingState = existing.rows[0]?.state;
  if (created.duplicate && existingState === "succeeded") {
    const analyses = await getPool().query("SELECT purpose,status,asset_hash,model,usage,model_cost_usd FROM audio_analysis WHERE owner_id=$1 AND project_id=$2 AND status='available' ORDER BY purpose", [ownerId, project.id]);
    process.stdout.write(`${JSON.stringify({ ok: true, reusedStoredEvidence: true, projectId: project.id, jobId: created.id, analyses: analyses.rows })}\n`);
    process.exitCode = 0;
  } else {
    if (created.duplicate && existingState && existingState !== "queued" && existingState !== "running") {
      throw new Error(`Prior targeted Gemini verification is ${existingState}; it will not be repeated automatically`);
    }
    await dispatchOutbox();
    activeJob = await claimJobById(created.id, `live-gemini-${process.pid}`);
    if (!activeJob) throw new Error(`Targeted Gemini verification could not claim job ${created.id}`);

    const controller = new AbortController();
    let monitorError: Error | undefined;
    let renewing = false;
    const timer = setInterval(() => {
      if (renewing || monitorError || !activeJob) return;
      renewing = true;
      void heartbeat(activeJob).then((ok) => {
        if (!ok) { monitorError = new Error("Targeted Gemini verification lost its lease"); controller.abort(); }
      }).catch((error: unknown) => {
        monitorError = error instanceof Error ? error : new Error("Gemini verification heartbeat failed");
        controller.abort();
      }).finally(() => { renewing = false; });
    }, 10_000);
    timer.unref?.();

    try {
      const sourceBytes = await readFile(source.object_path);
      const sourceFacts = measureDecodedWav(decodeWav(sourceBytes, { maxDurationSeconds: config.MAX_SOURCE_SECONDS }));
      const sourceAnalysis = await analyzePreview({
        job: activeJob,
        path: source.object_path,
        hash: source.content_hash,
        purpose: "source-analysis",
        signal: controller.signal,
        ...sourceFacts
      });
      const previewBytes = await readFile(revision.preview_path);
      const previewHash = createHash("sha256").update(previewBytes).digest("hex");
      const previewAnalysis = await analyzePreview({
        job: activeJob,
        path: revision.preview_path,
        hash: previewHash,
        purpose: "preview-critique",
        signal: controller.signal,
        durationSeconds: Number(revision.duration_seconds),
        peak: Number(revision.peak),
        rms: Number(revision.rms),
        nonSilentRatio: Number(revision.non_silent_ratio)
      });
      if (monitorError) throw monitorError;
      await recordAudioAnalysis({ ownerId, projectId: project.id, revisionId: revision.id, analysis: sourceAnalysis });
      await recordAudioAnalysis({ ownerId, projectId: project.id, revisionId: revision.id, analysis: previewAnalysis });
      if (sourceAnalysis.status !== "available" || previewAnalysis.status !== "available") {
        await failJob(activeJob, "GEMINI_LIVE_VERIFICATION_FAILED", `Source=${sourceAnalysis.status}; preview=${previewAnalysis.status}`);
        activeJob = null;
        throw new Error(`Gemini verification returned source=${sourceAnalysis.status}, preview=${previewAnalysis.status}; it will not retry automatically`);
      }
      const committed = await commitRevision(activeJob, {
        composition: validateComposition(revision.composition),
        previewPath: revision.preview_path,
        previewHash: revision.preview_hash ?? previewHash,
        stems: revision.stems,
        waveformPeaks: revision.waveform_peaks,
        durationSeconds: Number(revision.duration_seconds),
        peak: Number(revision.peak),
        rms: Number(revision.rms),
        nonSilentRatio: Number(revision.non_silent_ratio),
        title: revision.title,
        summary: revision.change_summary,
        protectedTrackHashes: revision.protected_track_hashes,
        producer: revision.producer
      });
      activeJob = null;
      const effects = await getPool().query<{ provider: string; model: string; state: string; actual_cost_microusd: string }>(
        "SELECT provider,model,state,actual_cost_microusd::text FROM effect WHERE job_id=$1 ORDER BY created_at",
        [created.id]
      );
      process.stdout.write(`${JSON.stringify({
        ok: true,
        reusedStoredEvidence: false,
        projectId: project.id,
        jobId: created.id,
        revisionId: committed.revisionId,
        reusedRevision: committed.reused,
        source: { status: sourceAnalysis.status, hash: sourceAnalysis.assetHash, model: sourceAnalysis.model, usage: sourceAnalysis.usage, costUsd: sourceAnalysis.costMicrousd / 1_000_000 },
        preview: { status: previewAnalysis.status, hash: previewAnalysis.assetHash, model: previewAnalysis.model, repairAction: previewAnalysis.repairAction, usage: previewAnalysis.usage, costUsd: previewAnalysis.costMicrousd / 1_000_000 },
        effects: effects.rows.map((effect) => ({ ...effect, costUsd: Number(effect.actual_cost_microusd) / 1_000_000 }))
      })}\n`);
    } finally {
      clearInterval(timer);
    }
  }
} catch (error) {
  if (activeJob) await failJob(activeJob, "GEMINI_LIVE_VERIFICATION_ERROR", error instanceof Error ? error.message : "Unknown targeted Gemini verification error").catch(() => undefined);
  throw error;
} finally {
  await closePool();
}
