import type pg from "pg";
import { getPool } from "../db/pool.js";
import { audioAnalysisSchema, geminiAnalysisEffectKey, type AudioAnalysis } from "../providers/gemini.js";

type Queryable = Pick<pg.Pool, "query">;

// A database-session lock coordinates concurrent workers without treating a
// cache miss as permission to send the same paid request twice. A crashed
// worker releases the lock; its dispatched/unknown effect remains a fence.
export async function withSampleAnalysisLock<T>(ownerId: string, cacheKey: string, action: () => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1),hashtext($2))", [ownerId, cacheKey]);
    try { return await action(); }
    finally { await client.query("SELECT pg_advisory_unlock(hashtext($1),hashtext($2))", [ownerId, cacheKey]); }
  } finally { client.release(); }
}

export async function hasUnconfirmedSampleAnalysis(ownerId: string, cacheKey: string, db: Queryable = getPool()): Promise<boolean> {
  const result = await db.query<{ pending: boolean }>(
    `SELECT EXISTS(SELECT 1 FROM effect e JOIN job j ON j.id=e.job_id
      WHERE j.owner_id=$1 AND e.step='library-sample-analysis' AND e.idempotency_key=$2
        AND (e.state IN ('reserved','dispatched','uncertain') OR e.cost_status='unknown')) AS pending`,
    [ownerId, cacheKey]
  );
  return result.rows[0]?.pending ?? false;
}

export async function loadConfirmedSampleOpinion(ownerId: string, cacheKey: string, assetHash: string, model: string, db: Queryable = getPool()): Promise<AudioAnalysis | null> {
  if (cacheKey !== geminiAnalysisEffectKey("library-sample-analysis", assetHash, model)) return null;
  const result = await db.query<{ analysis: unknown }>(
    `SELECT e.output->'analysis' AS analysis FROM effect e JOIN job j ON j.id=e.job_id
      WHERE j.owner_id=$1 AND e.step='library-sample-analysis' AND e.idempotency_key=$2
        AND e.state='succeeded' AND e.cost_status='observed' ORDER BY e.updated_at DESC LIMIT 1`,
    [ownerId, cacheKey]
  );
  const parsed = audioAnalysisSchema.safeParse(result.rows[0]?.analysis);
  return parsed.success && parsed.data.status === "available" && parsed.data.assetHash === assetHash && parsed.data.model === model && parsed.data.promptVersion === "library-sample-analysis-v2" ? parsed.data : null;
}

export async function loadCachedSampleOpinion(ownerId: string, cacheKey: string, assetHash: string, model: string, db: Queryable = getPool()): Promise<AudioAnalysis | null> {
  if (cacheKey !== geminiAnalysisEffectKey("library-sample-analysis", assetHash, model)) return null;
  const result = await db.query<{ analysis: unknown }>("SELECT analysis FROM native_sample_analysis_cache WHERE owner_id=$1 AND cache_key=$2 AND asset_hash=$3 AND model=$4", [ownerId, cacheKey, assetHash, model]);
  const raw = result.rows[0]?.analysis;
  if (!raw) return null;
  const parsed = audioAnalysisSchema.safeParse(raw);
  return parsed.success && parsed.data.status === "available" && parsed.data.purpose === "library-sample-analysis" && parsed.data.promptVersion === "library-sample-analysis-v2" && parsed.data.assetHash === assetHash && parsed.data.model === model ? parsed.data : null;
}

export async function saveCachedSampleOpinion(ownerId: string, cacheKey: string, analysis: AudioAnalysis, db: Queryable = getPool()): Promise<void> {
  const accepted = audioAnalysisSchema.parse(analysis);
  if (accepted.status !== "available" || accepted.purpose !== "library-sample-analysis" || !accepted.model) return;
  if (cacheKey !== geminiAnalysisEffectKey("library-sample-analysis", accepted.assetHash, accepted.model)) throw new Error("Sample analysis cache identity does not match its model and prompt version");
  await db.query("INSERT INTO native_sample_analysis_cache(owner_id,cache_key,asset_hash,model,analysis) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT DO NOTHING", [ownerId, cacheKey, accepted.assetHash, accepted.model, JSON.stringify(accepted)]);
}
