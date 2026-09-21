import { createHash } from "node:crypto";
import {
  claimJobById, closePool, createJob, createProject, devOwnerId, dispatchOutbox, encodeWav, getConfig, getPool,
  getProjectSnapshot, insertAsset, jobSnapshot, storeImmutableAudio
} from "@pocket/core";
import { processJob } from "@pocket/worker";

const marker = "Live integrated provider verification v1";
type EffectRow = { provider: string; model: string | null; state: string; actual_cost_microusd: string; output: unknown };
const config = getConfig();
if (!config.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured in the root .env");
if (!(config.GEMINI_API_KEY ?? config.GOOGLE_API_KEY)) throw new Error("GEMINI_API_KEY is not configured in the root .env");
if (config.FIXTURE_MODE) throw new Error("The opt-in live runner refuses FIXTURE_MODE=true");
if (config.INITIAL_BUILD_API_BUDGET_USD <= 0 || config.MAX_JOB_COST_USD < 0.18 || config.MAX_MODEL_CALLS_PER_JOB < 4) {
  throw new Error("Configured provider limits are too strict for one bounded source → producer → preview verification; limits were not changed");
}

const ownerId = await devOwnerId();
try {
  const prior = await getPool().query<{ id: string }>("SELECT id FROM project WHERE owner_id=$1 AND title=$2 ORDER BY created_at DESC LIMIT 1", [ownerId, marker]);
  let projectId = prior.rows[0]?.id;
  let jobId: string | undefined;
  if (projectId) {
    const existing = await getPool().query<{ id: string; state: string }>("SELECT id,state FROM job WHERE project_id=$1 AND kind='generation' ORDER BY created_at DESC LIMIT 1", [projectId]);
    jobId = existing.rows[0]?.id;
    if (existing.rows[0]?.state === "succeeded") {
      const snapshot = await getProjectSnapshot(ownerId, projectId);
      const effects = await getPool().query<EffectRow>("SELECT provider,model,state,actual_cost_microusd::text,output FROM effect WHERE job_id=$1 ORDER BY created_at", [jobId]);
      const total = effects.rows.reduce((sum, row) => sum + Number(row.actual_cost_microusd), 0);
      process.stdout.write(`${JSON.stringify({ ok: true, reusedStoredEvidence: true, projectId, jobId, revisionId: snapshot.currentRevision?.id, previewHash: snapshot.currentRevision?.previewHash, analyses: snapshot.analyses.map((item) => ({ purpose: item.purpose, status: item.status, model: item.model, revisionId: item.revisionId, costUsd: item.modelCostUsd })), effects: effects.rows.map((row) => ({ provider: row.provider, model: row.model, state: row.state, costUsd: Number(row.actual_cost_microusd) / 1_000_000 })), totalCostUsd: total / 1_000_000 })}\n`);
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
      ownerId, projectId, kind: "generation", idempotencyKey: "live-integrated-gemini-v1",
      request: { direction: "Build a warm restrained instrumental. Use the short source as a subtle texture if its analysis supports that role, and let the lift rise gently.", sourceAssetId: assetId }
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
  const firstSnapshot = await getProjectSnapshot(ownerId, projectId);
  const effectsBefore = await getPool().query<EffectRow>("SELECT provider,model,state,actual_cost_microusd::text,output FROM effect WHERE job_id=$1 ORDER BY created_at", [jobId]);
  const secondSnapshot = await getProjectSnapshot(ownerId, projectId);
  const effectCountAfter = Number((await getPool().query("SELECT count(*)::text AS count FROM effect WHERE job_id=$1", [jobId])).rows[0]?.count ?? 0);
  if (effectsBefore.rowCount !== effectCountAfter) throw new Error("Reload unexpectedly created a provider effect");
  const previewPath = await getPool().query<{ preview_path: string }>("SELECT preview_path FROM revision WHERE id=$1", [firstSnapshot.currentRevision?.id]);
  const previewBytes = await import("node:fs/promises").then(({ readFile }) => readFile(previewPath.rows[0]!.preview_path));
  const totalMicrousd = effectsBefore.rows.reduce((sum, row) => sum + Number(row.actual_cost_microusd), 0);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    reusedStoredEvidence: false,
    projectId,
    jobId,
    revisionId: firstSnapshot.currentRevision?.id,
    sourceHash: firstSnapshot.analyses.find((item) => item.purpose === "source-analysis")?.assetHash ?? null,
    previewHash: createHash("sha256").update(previewBytes).digest("hex"),
    producer: firstSnapshot.currentRevision?.producer.provider,
    sourceIncluded: firstSnapshot.currentRevision?.composition.sourceAssetIds.length === 1,
    analyses: secondSnapshot.analyses.map((item) => ({ purpose: item.purpose, status: item.status, model: item.model, revisionId: item.revisionId, costUsd: item.modelCostUsd })),
    effects: effectsBefore.rows.map((row) => ({ provider: row.provider, model: row.model, state: row.state, costUsd: Number(row.actual_cost_microusd) / 1_000_000 })),
    totalCostUsd: totalMicrousd / 1_000_000,
    elapsedMs: Date.now() - startedAt,
    reloadReusedStoredAnalysis: effectsBefore.rowCount === effectCountAfter
  })}\n`);
} finally {
  await closePool();
}
