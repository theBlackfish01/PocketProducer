import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  analyzePreview, claimJobById, closePool, commitRevision, createJob, decodeWav, devOwnerId, dispatchOutbox, failJob,
  getConfig, getPool, measureDecodedWav, validateComposition, type AudioAnalysis
} from "@pocket/core";
import { withLeaseMonitor } from "@pocket/worker";

const sourceProjectTitle = "Live integrated provider verification v1";
const idempotencyKey = "live-gemini-audio-v2";
const direction = "Targeted Gemini audio verification after bounded-output repair";
const config = getConfig();
if (!(config.GEMINI_API_KEY ?? config.GOOGLE_API_KEY)) throw new Error("GEMINI_API_KEY is not configured in the root .env");
if (config.FIXTURE_MODE) throw new Error("The opt-in Gemini runner refuses FIXTURE_MODE=true");
if (config.INITIAL_BUILD_API_BUDGET_USD <= 0 || config.MAX_JOB_COST_USD < 0.02 || config.MAX_MODEL_CALLS_PER_JOB < 2) {
  throw new Error("Configured provider limits are too strict for two bounded Gemini audio calls; limits were not changed");
}

type SourceRow = { id: string; content_hash: string; object_path: string };
type RevisionRow = {
  id: string; title: string; composition: unknown; preview_path: string; preview_hash: string | null; stems: Record<string, string>;
  waveform_peaks: number[]; duration_seconds: number; peak: number; rms: number; non_silent_ratio: number; change_summary: string;
  protected_track_hashes: Record<string, string>; producer: Record<string, unknown>;
};

const ownerId = await devOwnerId();
let activeJob: Awaited<ReturnType<typeof claimJobById>> = null;

async function assertStoredEvidence(input: { projectId: string; revisionId: string; jobId: string; sourceHash: string; previewHash: string }) {
  const rows = await getPool().query<{
    purpose: string; status: string; asset_hash: string; model: string; prompt_version: string; usage: AudioAnalysis["usage"];
    associated: boolean; model_cost_usd: string;
  }>(
    `SELECT aa.purpose,aa.status,aa.asset_hash,aa.model,aa.prompt_version,aa.usage,aa.model_cost_usd::text,
       EXISTS(SELECT 1 FROM audio_analysis_revision aar WHERE aar.analysis_id=aa.id AND aar.revision_id=$3) AS associated
     FROM audio_analysis aa
     WHERE aa.owner_id=$1 AND aa.project_id=$2 AND aa.purpose IN ('source-analysis','preview-critique')`,
    [ownerId, input.projectId, input.revisionId]
  );
  const source = rows.rows.find((row) => row.purpose === "source-analysis" && row.asset_hash === input.sourceHash && row.status === "available" && row.associated);
  const preview = rows.rows.find((row) => row.purpose === "preview-critique" && row.asset_hash === input.previewHash && row.status === "available" && row.associated);
  for (const [label, analysis] of [["source", source], ["preview", preview]] as const) {
    if (!analysis || analysis.model !== config.GEMINI_MODEL || analysis.prompt_version !== "audio-analysis-v2" || Number(analysis.usage.totalTokens ?? 0) <= 0) {
      throw new Error(`Stored ${label} Gemini evidence does not prove an available typed analysis for the expected audio hash`);
    }
  }
  const effects = await getPool().query<{ provider: string; model: string; state: string; cost_status: string; actual_cost_microusd: string }>(
    "SELECT provider,model,state,cost_status,actual_cost_microusd::text FROM effect WHERE job_id=$1 ORDER BY created_at",
    [input.jobId]
  );
  if (effects.rows.length !== 2 || effects.rows.some((effect) => effect.provider !== "gemini" || effect.model !== config.GEMINI_MODEL || effect.state !== "succeeded" || effect.cost_status !== "observed")) {
    throw new Error("Targeted Gemini evidence does not contain exactly two observed successful effects");
  }
  return { analyses: [source, preview], effects: effects.rows };
}

try {
  const project = (await getPool().query<{ id: string; current_revision_id: string }>(
    "SELECT id,current_revision_id FROM project WHERE owner_id=$1 AND title=$2 AND current_revision_id IS NOT NULL ORDER BY created_at DESC LIMIT 1",
    [ownerId, sourceProjectTitle]
  )).rows[0];
  if (!project) throw new Error("Run the integrated live verification once before the targeted Gemini adapter check");
  const source = (await getPool().query<SourceRow>(
    "SELECT id,content_hash,object_path FROM asset WHERE owner_id=$1 AND project_id=$2 AND kind='source' ORDER BY created_at LIMIT 1",
    [ownerId, project.id]
  )).rows[0];
  if (!source) throw new Error("Integrated live evidence has no owned source");
  const request = { direction, sourceAssetId: source.id };
  const created = await createJob({ ownerId, projectId: project.id, kind: "generation", idempotencyKey, request });
  const storedJob = (await getPool().query<{ state: string; result_revision_id: string | null }>("SELECT state,result_revision_id FROM job WHERE id=$1", [created.id])).rows[0];
  const revisionId = storedJob?.result_revision_id ?? project.current_revision_id;
  const revision = (await getPool().query<RevisionRow>("SELECT * FROM revision WHERE owner_id=$1 AND id=$2", [ownerId, revisionId])).rows[0];
  if (!revision) throw new Error("Integrated live evidence has no target revision");
  const previewHash = createHash("sha256").update(await readFile(revision.preview_path)).digest("hex");

  if (created.duplicate && storedJob?.state === "succeeded") {
    const before = Number((await getPool().query("SELECT count(*)::text AS count FROM effect WHERE job_id=$1", [created.id])).rows[0]?.count ?? 0);
    const evidence = await assertStoredEvidence({ projectId: project.id, revisionId: revision.id, jobId: created.id, sourceHash: source.content_hash, previewHash });
    const replay = await createJob({ ownerId, projectId: project.id, kind: "generation", idempotencyKey, request });
    const after = Number((await getPool().query("SELECT count(*)::text AS count FROM effect WHERE job_id=$1", [created.id])).rows[0]?.count ?? 0);
    if (!replay.duplicate || replay.id !== created.id || after !== before) throw new Error("Targeted command replay created new work");
    process.stdout.write(`${JSON.stringify({ ok: true, reusedStoredEvidence: true, projectId: project.id, jobId: created.id, revisionId: revision.id, sourceHash: source.content_hash, previewHash, ...evidence })}\n`);
  } else {
    if (created.duplicate && storedJob && !new Set(["queued", "running"]).has(storedJob.state)) {
      throw new Error(`Prior targeted Gemini verification is ${storedJob.state}; it will not be repeated automatically`);
    }
    await dispatchOutbox();
    activeJob = await claimJobById(created.id, `live-gemini-${process.pid}`);
    if (!activeJob) throw new Error(`Targeted Gemini verification could not claim job ${created.id}`);
    await withLeaseMonitor(activeJob, async (signal) => {
      const sourceBytes = await readFile(source.object_path);
      const sourceFacts = measureDecodedWav(decodeWav(sourceBytes, { maxDurationSeconds: config.MAX_SOURCE_SECONDS }));
      const sourceAnalysis = await analyzePreview({ job: activeJob!, path: source.object_path, hash: source.content_hash, purpose: "source-analysis", signal, ...sourceFacts });
      const previewAnalysis = await analyzePreview({
        job: activeJob!, path: revision.preview_path, hash: previewHash, purpose: "preview-critique", signal,
        durationSeconds: Number(revision.duration_seconds), peak: Number(revision.peak), rms: Number(revision.rms), nonSilentRatio: Number(revision.non_silent_ratio)
      });
      if (sourceAnalysis.status !== "available" || previewAnalysis.status !== "available") {
        throw new Error(`Gemini verification returned source=${sourceAnalysis.status}, preview=${previewAnalysis.status}; it will not retry automatically`);
      }
      await commitRevision(activeJob!, {
        composition: validateComposition(revision.composition), previewPath: revision.preview_path, previewHash: revision.preview_hash ?? previewHash,
        stems: revision.stems, waveformPeaks: revision.waveform_peaks, durationSeconds: Number(revision.duration_seconds), peak: Number(revision.peak),
        rms: Number(revision.rms), nonSilentRatio: Number(revision.non_silent_ratio), title: revision.title, summary: revision.change_summary,
        protectedTrackHashes: revision.protected_track_hashes, producer: revision.producer,
        analysisRecords: [{ analysis: sourceAnalysis, associateWithRevision: true }, { analysis: previewAnalysis, associateWithRevision: true }]
      });
    });
    activeJob = null;
    const evidence = await assertStoredEvidence({ projectId: project.id, revisionId: revision.id, jobId: created.id, sourceHash: source.content_hash, previewHash });
    const replay = await createJob({ ownerId, projectId: project.id, kind: "generation", idempotencyKey, request });
    const countAfterReplay = Number((await getPool().query("SELECT count(*)::text AS count FROM effect WHERE job_id=$1", [created.id])).rows[0]?.count ?? 0);
    if (!replay.duplicate || replay.id !== created.id || countAfterReplay !== evidence.effects.length) throw new Error("Targeted command replay created new provider work");
    process.stdout.write(`${JSON.stringify({ ok: true, reusedStoredEvidence: false, projectId: project.id, jobId: created.id, revisionId: revision.id, sourceHash: source.content_hash, previewHash, ...evidence })}\n`);
  }
} catch (error) {
  if (activeJob) await failJob(activeJob, "GEMINI_LIVE_VERIFICATION_ERROR", error instanceof Error ? error.message : "Unknown targeted Gemini verification error").catch(() => undefined);
  throw error;
} finally {
  await closePool();
}
