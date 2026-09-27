import type pg from "pg";
import { getConfig } from "../config.js";
import type { JobRecord } from "../db/repository.js";
import { getPool } from "../db/pool.js";
import { jobNativeRunLimits } from "../native/profile.js";
import { assertSharedUsage } from "./limits.js";

export type ProviderName = "openai" | "gemini" | "gateway" | "audiotool";
export type EffectState = "reserved" | "dispatched" | "succeeded" | "failed" | "uncertain";

export interface EffectReservation {
  id: string;
  state: EffectState;
  created: boolean;
  cachedOutput?: unknown;
}

function usdToMicrousd(value: number): number {
  return Math.round(value * 1_000_000);
}

async function lockBudget(client: pg.PoolClient): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('pocket-producer-provider-budget-v1'))");
}

async function assertAttempt(client: pg.PoolClient, job: JobRecord): Promise<void> {
  const active = await client.query(
    `SELECT 1 FROM job WHERE id=$1 AND lease_owner=$2 AND lease_generation=$3 AND attempt_id=$4
       AND state='running' AND cancellation_requested_at IS NULL AND lease_until>now() AND deadline_at>now() FOR UPDATE`,
    [job.id, job.leaseOwner, job.leaseGeneration, job.attemptId]
  );
  if (active.rowCount !== 1) throw new Error("Provider execution context lost its active job lease");
}

export async function reserveProviderEffect(input: {
  job: JobRecord;
  provider: ProviderName;
  step: string;
  idempotencyKey: string;
  inputHash: string;
  model: string;
  promptVersion: string;
  reservationMicrousd: number;
  maxDistinctEffectsForStep?: number;
  maxDistinctEffectsForPromptVersion?: number;
}): Promise<EffectReservation> {
  const config = getConfig();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await lockBudget(client);
    await assertAttempt(client, input.job);
    const prior = await client.query<{ id: string; state: EffectState; output: unknown; input_hash: string; attempt_id: string | null }>(
      "SELECT id,state,output,input_hash,attempt_id FROM effect WHERE job_id=$1 AND idempotency_key=$2 FOR UPDATE",
      [input.job.id, input.idempotencyKey]
    );
    const existing = prior.rows[0];
    if (existing) {
      if (existing.input_hash !== input.inputHash) throw new Error("PROVIDER_EFFECT_INPUT_MISMATCH");
      if (existing.state === "reserved") {
        await client.query(
          "UPDATE effect SET attempt_id=$2,lease_generation=$3,updated_at=now() WHERE id=$1",
          [existing.id, input.job.attemptId, input.job.leaseGeneration]
        );
        await client.query("COMMIT");
        return { id: existing.id, state: "reserved", created: true };
      }
      await client.query("COMMIT");
      return { id: existing.id, state: existing.state, created: false, cachedOutput: existing.state === "succeeded" ? existing.output : undefined };
    }
    if (input.maxDistinctEffectsForStep !== undefined) {
      if (!Number.isSafeInteger(input.maxDistinctEffectsForStep) || input.maxDistinctEffectsForStep < 1) throw new Error("Invalid provider step-effect limit");
      const count = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM effect WHERE job_id=$1 AND step=$2", [input.job.id, input.step]);
      if (Number(count.rows[0]?.count ?? 0) >= input.maxDistinctEffectsForStep) throw new Error("MODEL_STEP_EFFECT_LIMIT_EXCEEDED");
    }
    if (input.maxDistinctEffectsForPromptVersion !== undefined) {
      if (!Number.isSafeInteger(input.maxDistinctEffectsForPromptVersion) || input.maxDistinctEffectsForPromptVersion < 1) throw new Error("Invalid prompt-effect limit");
      const count = await client.query<{ count: string }>("SELECT count(*)::text AS count FROM effect WHERE job_id=$1 AND prompt_version=$2", [input.job.id, input.promptVersion]);
      if (Number(count.rows[0]?.count ?? 0) >= input.maxDistinctEffectsForPromptVersion) throw new Error("MODEL_FORMAT_RECOVERY_EXHAUSTED");
    }
    const callCount = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM effect WHERE job_id=$1 AND reservation_microusd>0",
      [input.job.id]
    );
    const nativeLimits = jobNativeRunLimits(input.job.request);
    if (Number(callCount.rows[0]?.count ?? 0) >= (nativeLimits?.maxCalls ?? config.MAX_MODEL_CALLS_PER_JOB)) throw new Error("MODEL_CALL_LIMIT_EXCEEDED");
    const totals = await client.query<{ overall: string; job: string }>(
      `SELECT
         COALESCE(SUM(CASE WHEN state IN ('reserved','dispatched','uncertain') THEN GREATEST(reservation_microusd,actual_cost_microusd) ELSE actual_cost_microusd END),0)::text AS overall,
         COALESCE(SUM(CASE WHEN job_id=$1 THEN CASE WHEN state IN ('reserved','dispatched','uncertain') THEN GREATEST(reservation_microusd,actual_cost_microusd) ELSE actual_cost_microusd END ELSE 0 END),0)::text AS job
       FROM effect`,
      [input.job.id]
    );
    const overallLimit = usdToMicrousd(config.INITIAL_BUILD_API_BUDGET_USD);
    const jobLimit = usdToMicrousd(Math.min(config.MAX_JOB_COST_USD, nativeLimits?.maxJobCostUsd ?? config.MAX_JOB_COST_USD));
    const overall = Number(totals.rows[0]?.overall ?? 0);
    const job = Number(totals.rows[0]?.job ?? 0);
    if (input.reservationMicrousd < 0) throw new Error("Invalid model reservation");
    if (overall + input.reservationMicrousd > overallLimit) throw new Error("MODEL_BUDGET_EXCEEDED:SITE");
    if (job + input.reservationMicrousd > jobLimit) throw new Error("MODEL_BUDGET_EXCEEDED:JOB");
    if (input.provider !== "audiotool") await assertSharedUsage(client, input.job.ownerId, input.provider, input.reservationMicrousd);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO effect(job_id,step,idempotency_key,input_hash,state,provider,model,prompt_version,reservation_microusd,attempt_id,lease_generation)
       VALUES($1,$2,$3,$4,'reserved',$5,$6,$7,$8,$9,$10) RETURNING id`,
      [input.job.id, input.step, input.idempotencyKey, input.inputHash, input.provider, input.model, input.promptVersion, input.reservationMicrousd, input.job.attemptId, input.job.leaseGeneration]
    );
    const id = inserted.rows[0]?.id;
    if (!id) throw new Error("Unable to reserve provider effect");
    await client.query(
      "UPDATE job SET estimated_cost_microusd=estimated_cost_microusd+$2,estimated_cost_usd=(estimated_cost_microusd+$2)::numeric/1000000 WHERE id=$1",
      [input.job.id, input.reservationMicrousd]
    );
    await client.query("COMMIT");
    return { id, state: "reserved", created: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function markEffectDispatched(effectId: string, job: JobRecord): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await assertAttempt(client, job);
    const result = await client.query(
      "UPDATE effect SET state='dispatched',dispatched_at=now(),updated_at=now() WHERE id=$1 AND job_id=$2 AND state='reserved' AND attempt_id=$3 AND lease_generation=$4",
      [effectId, job.id, job.attemptId, job.leaseGeneration]
    );
    if (result.rowCount !== 1) throw new Error("Provider effect could not enter dispatched state");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function completeProviderEffect(input: { effectId: string; job: JobRecord; output: unknown; actualCostMicrousd: number; providerRequestId?: string }): Promise<"succeeded" | "uncertain"> {
  if (!Number.isSafeInteger(input.actualCostMicrousd) || input.actualCostMicrousd < 0) throw new Error("Invalid provider usage amount");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await lockBudget(client);
    const effect = await client.query<{ reservation_microusd: string; actual_cost_microusd: string; cost_status: string; provider_request_id: string | null; state: EffectState; attempt_id: string | null }>(
      "SELECT reservation_microusd::text,actual_cost_microusd::text,cost_status,provider_request_id,state,attempt_id FROM effect WHERE id=$1 AND job_id=$2 FOR UPDATE",
      [input.effectId, input.job.id]
    );
    const row = effect.rows[0];
    if (!row || row.attempt_id !== input.job.attemptId) throw new Error("Provider effect attempt identity mismatch");
    if (row.provider_request_id && input.providerRequestId && row.provider_request_id !== input.providerRequestId) throw new Error("PROVIDER_REQUEST_ID_CONFLICT");
    const priorActual = Number(row.actual_cost_microusd);
    if (["succeeded", "failed", "uncertain"].includes(row.state) && row.cost_status === "observed" && priorActual !== input.actualCostMicrousd) throw new Error("PROVIDER_USAGE_CONFLICT");
    if (row.state === "succeeded") {
      await client.query("COMMIT");
      return "succeeded";
    }
    if (row.state === "failed" || row.state === "uncertain") {
      if (row.cost_status !== "observed" || (!row.provider_request_id && input.providerRequestId)) {
        await client.query("UPDATE effect SET actual_cost_microusd=$2::bigint,cost_usd=($2::bigint)::numeric/1000000,cost_status='observed',provider_request_id=COALESCE($3,provider_request_id),updated_at=now() WHERE id=$1", [input.effectId, input.actualCostMicrousd, input.providerRequestId ?? null]);
        await client.query("UPDATE job SET actual_cost_microusd=actual_cost_microusd+$2,actual_cost_usd=(actual_cost_microusd+$2)::numeric/1000000 WHERE id=$1", [input.job.id, input.actualCostMicrousd - priorActual]);
      }
      await client.query("COMMIT");
      return "uncertain";
    }
    const reservation = Number(row.reservation_microusd);
    const active = await client.query(
      `SELECT 1 FROM job WHERE id=$1 AND lease_owner=$2 AND lease_generation=$3 AND attempt_id=$4
       AND state='running' AND cancellation_requested_at IS NULL AND lease_until>now() AND deadline_at>now() FOR UPDATE`,
      [input.job.id, input.job.leaseOwner, input.job.leaseGeneration, input.job.attemptId]
    );
    const state: "succeeded" | "uncertain" = active.rowCount === 1 ? "succeeded" : "uncertain";
    await client.query(
      "UPDATE effect SET state=$2,output=$3,provider_request_id=COALESCE($4,provider_request_id),actual_cost_microusd=$5::bigint,cost_usd=($5::bigint)::numeric/1000000,cost_status='observed',completed_at=now(),updated_at=now() WHERE id=$1",
      [input.effectId, state, input.output, input.providerRequestId ?? null, input.actualCostMicrousd]
    );
    await client.query(
      `UPDATE job SET estimated_cost_microusd=GREATEST(0,estimated_cost_microusd-$2),
         actual_cost_microusd=actual_cost_microusd+$3,
         estimated_cost_usd=GREATEST(0,estimated_cost_microusd-$2)::numeric/1000000,
         actual_cost_usd=(actual_cost_microusd+$3)::numeric/1000000 WHERE id=$1`,
      [input.job.id, state === "succeeded" ? reservation : 0, input.actualCostMicrousd - priorActual]
    );
    await client.query("COMMIT");
    return state;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function failProviderEffect(input: { effectId: string; job: JobRecord; errorClass: string; uncertain: boolean; actualCostMicrousd?: number; safeDetails?: Record<string, string | number | boolean | null> }): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await lockBudget(client);
    const effect = await client.query<{ reservation_microusd: string; actual_cost_microusd: string; state: EffectState; attempt_id: string | null }>(
      "SELECT reservation_microusd::text,actual_cost_microusd::text,state,attempt_id FROM effect WHERE id=$1 AND job_id=$2 FOR UPDATE",
      [input.effectId, input.job.id]
    );
    const row = effect.rows[0];
    if (!row || row.attempt_id !== input.job.attemptId) throw new Error("Provider effect attempt identity mismatch");
    if (row.state === "succeeded" || row.state === "failed" || row.state === "uncertain") {
      await client.query("COMMIT");
      return;
    }
    const reservation = Number(row.reservation_microusd);
    const priorActual = Number(row.actual_cost_microusd);
    const actual = input.actualCostMicrousd ?? priorActual;
    const costStatus = input.actualCostMicrousd === undefined && input.uncertain ? "unknown" : "observed";
    await client.query(
      "UPDATE effect SET state=$2,output=$3,actual_cost_microusd=$4::bigint,cost_usd=($4::bigint)::numeric/1000000,cost_status=$5,completed_at=now(),updated_at=now() WHERE id=$1",
      [input.effectId, input.uncertain ? "uncertain" : "failed", { errorClass: input.errorClass, ...(input.safeDetails ?? {}) }, actual, costStatus]
    );
    if (!input.uncertain) {
      await client.query(
        `UPDATE job SET estimated_cost_microusd=GREATEST(0,estimated_cost_microusd-$2),actual_cost_microusd=actual_cost_microusd+$3,
         estimated_cost_usd=GREATEST(0,estimated_cost_microusd-$2)::numeric/1000000,actual_cost_usd=(actual_cost_microusd+$3)::numeric/1000000 WHERE id=$1`,
        [input.job.id, reservation, actual - priorActual]
      );
    } else if (actual !== priorActual) {
      await client.query(
        `UPDATE job SET actual_cost_microusd=actual_cost_microusd+$2,
         actual_cost_usd=(actual_cost_microusd+$2)::numeric/1000000 WHERE id=$1`,
        [input.job.id, actual - priorActual]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
