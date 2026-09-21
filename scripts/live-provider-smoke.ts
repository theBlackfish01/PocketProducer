import { createHash } from "node:crypto";
import {
  claimJobById, closePool, createJob, createProject, devOwnerId, dispatchOutbox, encodeWav, getConfig, getPool,
  getProjectSnapshot, insertAsset, jobSnapshot, storeImmutableAudio
} from "@pocket/core";
import { processJob } from "@pocket/worker";

const marker = "Live integrated provider verification v1";
const liveDirection = "Build a warm restrained instrumental. Use the short source as a subtle texture if its analysis supports that role, and let the lift rise gently.";
const liveIdempotencyKey = "live-integrated-gemini-v1";
type EffectRow = { provider: string; model: string | null; state: string; actual_cost_microusd: string; output: unknown };
const config = getConfig();
if (!config.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured in the root .env");
if (!(config.GEMINI_API_KEY ?? config.GOOGLE_API_KEY)) throw new Error("GEMINI_API_KEY is not configured in the root .env");
if (config.FIXTURE_MODE) throw new Error("The opt-in live runner refuses FIXTURE_MODE=true");
if (config.INITIAL_BUILD_API_BUDGET_USD <= 0 || config.MAX_JOB_COST_USD < 0.18 || config.MAX_MODEL_CALLS_PER_JOB < 4) {
  throw new Error("Configured provider limits are too strict for one bounded source → producer → preview verification; limits were not changed");
}

const ownerId = await devOwnerId();

async function verifyIntegratedEvidence(projectId: string, jobId: string) {
  const job = await jobSnapshot(ownerId, jobId);
  if (job.state !== "succeeded" || !job.result_revision_id) throw new Error(`Integrated live job is ${job.state}, not a successful capability proof`);
  const snapshot = await getProjectSnapshot(ownerId, projectId);
  const revision = await getPool().query<{ preview_path: string; preview_hash: string | null }>("SELECT preview_path,preview_hash FROM revision WHERE id=$1 AND owner_id=$2", [job.result_revision_id, ownerId]);
  const previewPath = revision.rows[0]?.preview_path;
  if (!previewPath) throw new Error("Integrated result has no durable preview");
  const previewHash = createHash("sha256").update(await import("node:fs/promises").then(({ readFile }) => readFile(previewPath))).digest("hex");
  const source = await getPool().query<{ id: string; content_hash: string }>("SELECT id,content_hash FROM asset WHERE owner_id=$1 AND project_id=$2 AND kind='source' ORDER BY created_at LIMIT 1", [ownerId, projectId]);
  const sourceRow = source.rows[0];
  if (!sourceRow) throw new Error("Integrated result has no owned source");
  const analyses = await getPool().query<{ purpose: string; status: string; asset_hash: string; model: string; usage: { totalTokens?: number }; associated: boolean }>(
    `SELECT aa.purpose,aa.status,aa.asset_hash,aa.model,aa.usage,
       EXISTS(SELECT 1 FROM audio_analysis_revision aar WHERE aar.analysis_id=aa.id AND aar.revision_id=$3) AS associated
     FROM audio_analysis aa WHERE aa.owner_id=$1 AND aa.project_id=$2`,
    [ownerId, projectId, job.result_revision_id]
  );
  const sourceAnalysis = analyses.rows.find((row) => row.purpose === "source-analysis" && row.status === "available" && row.asset_hash === sourceRow.content_hash && row.associated && Number(row.usage.totalTokens ?? 0) > 0);
  const availableCritique = analyses.rows.find((row) => row.purpose === "preview-critique" && row.status === "available" && Number(row.usage.totalTokens ?? 0) > 0);
  const finalAnalysis = analyses.rows.find((row) => row.purpose === "preview-critique" && row.asset_hash === previewHash && row.associated && new Set(["available", "uncritiqued"]).has(row.status));
  if (!sourceAnalysis || !availableCritique || !finalAnalysis) throw new Error("Integrated run did not prove successful source analysis, preview critique, and final-audio analysis truth");
  if (snapshot.currentRevision?.producer.provider !== "openai-deep-agent" || snapshot.currentRevision.id !== job.result_revision_id) throw new Error("Integrated run did not retain the OpenAI Deep Agent result as the current revision");
  const lineage = snapshot.currentRevision.producer.sourceLineage as { audiblyUsed?: boolean } | undefined;
  if (!lineage?.audiblyUsed) throw new Error("Integrated run attached a source but did not prove audible source use");
  const effects = await getPool().query<EffectRow & { cost_status: string }>("SELECT provider,model,state,cost_status,actual_cost_microusd::text,output FROM effect WHERE job_id=$1 ORDER BY created_at", [jobId]);
  if (!effects.rows.some((row) => row.provider === "openai" && row.state === "succeeded") || effects.rows.filter((row) => row.provider === "gemini" && row.state === "succeeded").length !== 2) {
    throw new Error("Integrated effect ledger does not prove one successful producer path and two successful Gemini analyses");
  }
  const request = { direction: liveDirection, sourceAssetId: sourceRow.id };
  const before = effects.rows.length;
  const replay = await createJob({ ownerId, projectId, kind: "generation", idempotencyKey: liveIdempotencyKey, request });
  const after = Number((await getPool().query("SELECT count(*)::text AS count FROM effect WHERE job_id=$1", [jobId])).rows[0]?.count ?? 0);
  if (!replay.duplicate || replay.id !== jobId || after !== before) throw new Error("Integrated command replay created additional provider work");
  return { snapshot, effects: effects.rows, previewHash, sourceHash: sourceRow.content_hash, finalAnalysisStatus: finalAnalysis.status };
}

try {
  const prior = await getPool().query<{ id: string }>("SELECT id FROM project WHERE owner_id=$1 AND title=$2 ORDER BY created_at DESC LIMIT 1", [ownerId, marker]);
  let projectId = prior.rows[0]?.id;
  let jobId: string | undefined;
  if (projectId) {
    const existing = await getPool().query<{ id: string; state: string }>("SELECT id,state FROM job WHERE project_id=$1 AND kind='generation' ORDER BY created_at DESC LIMIT 1", [projectId]);
    jobId = existing.rows[0]?.id;
    if (existing.rows[0]?.state === "succeeded") {
      if (!jobId) throw new Error("Stored live verification has no job identity");
      const evidence = await verifyIntegratedEvidence(projectId, jobId);
      const total = evidence.effects.reduce((sum, row) => sum + Number(row.actual_cost_microusd), 0);
      process.stdout.write(`${JSON.stringify({ ok: true, reusedStoredEvidence: true, projectId, jobId, revisionId: evidence.snapshot.currentRevision?.id, previewHash: evidence.previewHash, sourceHash: evidence.sourceHash, finalAnalysisStatus: evidence.finalAnalysisStatus, analyses: evidence.snapshot.analyses.map((item) => ({ purpose: item.purpose, status: item.status, model: item.model, revisionId: item.revisionId, costUsd: item.modelCostUsd })), effects: evidence.effects.map((row) => ({ provider: row.provider, model: row.model, state: row.state, costStatus: row.cost_status, costUsd: Number(row.actual_cost_microusd) / 1_000_000 })), totalCostUsd: total / 1_000_000 })}\n`);
      process.exitCode = 0;
      await closePool();
      process.exit();
    }
    if (existing.rows[0] && !new Set(["queued", "running"]).has(existing.rows[0].state)) throw new Error(`Prior live verification is ${existing.rows[0].state}; it will not be repeated automatically`);
  } else {
    projectId = (await createProject(ownerId, marker)).id;
  }

  if (!jobId) {
    const sampleRate = 48_000;
    const frames = Math.floor(sampleRate * 0.75);
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    for (let index = 0; index < frames; index += 1) {
      const time = index / sampleRate;
      const envelope = Math.exp(-time * 7);
      const sample = Math.sin(2 * Math.PI * 196 * time) * envelope * 0.42;
      left[index] = sample;
      right[index] = sample * 0.94;
    }
    const wav = encodeWav(left, right, sampleRate);
    const stored = await storeImmutableAudio(ownerId, projectId, wav);
    const assetId = await insertAsset({ ownerId, projectId, name: "owned-live-gemini-source.wav", hash: stored.hash, path: stored.path, durationSeconds: frames / sampleRate, sampleRate, channels: 2, provenance: "Deterministically synthesized owned live-verification fixture" });
    const created = await createJob({
      ownerId, projectId, kind: "generation", idempotencyKey: liveIdempotencyKey,
      request: { direction: liveDirection, sourceAssetId: assetId }
    });
    jobId = created.id;
  }

  await dispatchOutbox();
  const claimed = await claimJobById(jobId, `live-integrated-${process.pid}`);
  if (!claimed) {
    const current = await jobSnapshot(ownerId, jobId);
    throw new Error(`Live verification job could not be claimed safely (current state: ${current.state})`);
  }
  const startedAt = Date.now();
  await processJob(claimed);
  const settled = await jobSnapshot(ownerId, jobId);
  if (settled.state !== "succeeded") throw new Error(`Integrated live verification settled as ${settled.state}: ${settled.error_message ?? "no provider detail"}`);
  const evidence = await verifyIntegratedEvidence(projectId, jobId);
  const totalMicrousd = evidence.effects.reduce((sum, row) => sum + Number(row.actual_cost_microusd), 0);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    reusedStoredEvidence: false,
    projectId,
    jobId,
    revisionId: evidence.snapshot.currentRevision?.id,
    sourceHash: evidence.sourceHash,
    previewHash: evidence.previewHash,
    producer: evidence.snapshot.currentRevision?.producer.provider,
    sourceAudiblyUsed: true,
    finalAnalysisStatus: evidence.finalAnalysisStatus,
    analyses: evidence.snapshot.analyses.map((item) => ({ purpose: item.purpose, status: item.status, model: item.model, revisionId: item.revisionId, costUsd: item.modelCostUsd })),
    effects: evidence.effects.map((row) => ({ provider: row.provider, model: row.model, state: row.state, costStatus: row.cost_status, costUsd: Number(row.actual_cost_microusd) / 1_000_000 })),
    totalCostUsd: totalMicrousd / 1_000_000,
    elapsedMs: Date.now() - startedAt,
    commandReplayReusedStoredEffects: true
  })}\n`);
} finally {
  await closePool();
}
