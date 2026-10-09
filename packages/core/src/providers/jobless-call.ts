import { getConfig } from "../config.js";
import { getPool } from "../db/pool.js";
import { tokenCostMicrousd, type TokenUsage } from "./pricing.js";
import { assertSharedUsage } from "./limits.js";

export type JoblessDispatch = () => Promise<{ value: unknown; usage: TokenUsage | null; requestId?: string }>;

/** A small paid provider call that belongs to no composition job (writing help,
 * brief interpretation). It shares the provider ledger, budgets and idempotency
 * of every other call: no transaction is held across the provider, and a crash
 * leaves a durable dispatched liability that neither a replay nor a different
 * key bypasses. Invalid output is still a paid attempt, never a free retry. */
export async function runJoblessProviderCall<T>(input: {
  ownerId: string; projectId: string; key: string;
  step: string; version: string; model: string; reservation: number; hash: string;
  request: Record<string, unknown>;
  errors: { reused: () => Error; unfinished: () => Error; pending: () => Error; unavailable: () => Error; failed: () => Error };
  dispatch: JoblessDispatch;
  accept: (value: unknown) => T;
}): Promise<{ recordId: string; output: T }> {
  const config = getConfig();
  const client = await getPool().connect();
  let effectId: string, recordId: string;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('pocket-producer-provider-budget-v1'))");
    const prior = await client.query<{ id: string; input_hash: string; state: string; output: T }>("SELECT p.id,p.input_hash,e.state,e.output FROM prompt_assistance p JOIN effect e ON e.prompt_assistance_id=p.id WHERE p.owner_id=$1 AND p.idempotency_key=$2", [input.ownerId, input.key]);
    if (prior.rows[0]) {
      const previous = prior.rows[0];
      if (previous.input_hash !== input.hash) throw input.errors.reused();
      if (previous.state !== "succeeded") throw input.errors.unfinished();
      await client.query("COMMIT"); return { recordId: previous.id, output: previous.output };
    }
    const pending = await client.query("SELECT 1 FROM prompt_assistance p JOIN effect e ON e.prompt_assistance_id=p.id WHERE p.owner_id=$1 AND e.state IN ('dispatched','uncertain') AND (p.input_hash=$2 OR p.created_at>now()-interval '65 seconds')", [input.ownerId, input.hash]);
    if (pending.rowCount) throw input.errors.pending();
    const total = await client.query<{ total: string }>("SELECT COALESCE(SUM(CASE WHEN state IN ('reserved','dispatched','uncertain') THEN GREATEST(reservation_microusd,actual_cost_microusd) ELSE actual_cost_microusd END),0)::text AS total FROM effect");
    if (!config.FIXTURE_MODE && (Number(total.rows[0]?.total ?? 0) + input.reservation > config.INITIAL_BUILD_API_BUDGET_USD * 1_000_000 || input.reservation > config.MAX_JOB_COST_USD * 1_000_000)) throw input.errors.unavailable();
    if (!config.FIXTURE_MODE) await assertSharedUsage(client, input.ownerId, "openai", input.reservation, input.model);
    const row = await client.query<{ id: string }>("INSERT INTO prompt_assistance(owner_id,project_id,idempotency_key,input_hash,request) VALUES($1,$2,$3,$4,$5) RETURNING id", [input.ownerId, input.projectId, input.key, input.hash, input.request]);
    const effect = await client.query<{ id: string }>("INSERT INTO effect(prompt_assistance_id,step,idempotency_key,input_hash,state,provider,model,prompt_version,reservation_microusd,cost_status,dispatched_at) VALUES($1,$2,$3,$4,'dispatched','openai',$5,$6,$7,'unknown',now()) RETURNING id", [row.rows[0]!.id, input.step, input.key, input.hash, input.model, input.version, input.reservation]);
    effectId = effect.rows[0]!.id; recordId = row.rows[0]!.id;
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }

  let usage: TokenUsage | null = null;
  let requestId: string | undefined;
  try {
    const generated = await input.dispatch();
    usage = generated.usage; requestId = generated.requestId;
    if (!usage || !config.FIXTURE_MODE && (usage.inputTokens <= 0 || usage.outputTokens <= 0)) throw new Error("The provider response could not be confirmed");
    const output = input.accept(generated.value);
    await getPool().query("UPDATE effect SET state='succeeded',output=$2,actual_cost_microusd=$3::bigint,cost_usd=$3::numeric/1000000,cost_status='observed',provider_request_id=$4,completed_at=now(),updated_at=now() WHERE id=$1 AND state='dispatched'", [effectId, output, config.FIXTURE_MODE ? 0 : tokenCostMicrousd("openai", input.model, usage), requestId ?? null]);
    return { recordId, output };
  } catch {
    // Invalid output is still paid. Missing/ambiguous usage retains its hold.
    const observed = usage !== null && (config.FIXTURE_MODE || usage.inputTokens > 0 && usage.outputTokens > 0);
    await getPool().query("UPDATE effect SET state=$2,cost_status=$3,actual_cost_microusd=$4::bigint,cost_usd=$4::numeric/1000000,provider_request_id=$5,completed_at=now(),updated_at=now() WHERE id=$1 AND state='dispatched'", [effectId, observed ? "failed" : "uncertain", observed ? "observed" : "unknown", usage && !config.FIXTURE_MODE ? tokenCostMicrousd("openai", input.model, usage) : 0, requestId ?? null]);
    throw input.errors.failed();
  }
}

/** Usage reported by the Responses API, including cached and cache-write input. */
export function responsesUsage(usage: { input_tokens: number; output_tokens: number; input_tokens_details?: unknown } | undefined): TokenUsage | null {
  const details = usage?.input_tokens_details as { cached_tokens?: number; cache_write_tokens?: number; cache_creation_tokens?: number } | undefined;
  return usage ? { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, cachedInputTokens: details?.cached_tokens ?? 0, cacheWriteTokens: details?.cache_write_tokens ?? details?.cache_creation_tokens ?? 0 } : null;
}
