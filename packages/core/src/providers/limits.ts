import type pg from "pg";
import { getConfig } from "../config.js";
import type { ModelProvider } from "./models.js";

export function providerPoolLimit(provider: ModelProvider): number {
  const c = getConfig();
  return provider === "gateway" ? c.GATEWAY_POOL_BUDGET_USD : provider === "gemini" ? c.GEMINI_POOL_BUDGET_USD : c.OPENAI_POOL_BUDGET_USD ?? c.INITIAL_BUILD_API_BUDGET_USD;
}

// Caller holds the shared budget advisory lock. No remote request inside this transaction.
export async function assertSharedUsage(client: pg.PoolClient, ownerId: string, provider: ModelProvider, reserve: number): Promise<void> {
  if (!Number.isSafeInteger(reserve) || reserve < 0) throw new Error("Invalid model reservation");
  const config = getConfig();
  const result = await client.query<{ total: string; pool: string; owner: string; owner_limit: string | null }>(`
    WITH charges AS (
      SELECT e.provider, COALESCE(j.owner_id,p.owner_id) AS owner_id,
        CASE WHEN e.state IN ('reserved','dispatched','uncertain') THEN GREATEST(e.reservation_microusd,e.actual_cost_microusd) ELSE e.actual_cost_microusd END AS amount
      FROM effect e LEFT JOIN job j ON j.id=e.job_id LEFT JOIN prompt_assistance p ON p.id=e.prompt_assistance_id
    ) SELECT COALESCE(sum(amount),0)::text AS total,
      COALESCE(sum(amount) FILTER (WHERE provider=$2),0)::text AS pool,
      COALESCE(sum(amount) FILTER (WHERE owner_id=$1),0)::text AS owner,
      (SELECT limit_microusd::text FROM owner_usage_limit WHERE owner_id=$1) AS owner_limit FROM charges`, [ownerId, provider]);
  const row = result.rows[0]!;
  if (Number(row.total) + reserve > config.INITIAL_BUILD_API_BUDGET_USD * 1e6) throw new Error("MODEL_BUDGET_EXCEEDED:SITE");
  if (Number(row.pool) + reserve > providerPoolLimit(provider) * 1e6) throw new Error(`MODEL_BUDGET_EXCEEDED:PROVIDER:${provider}`);
  if (Number(row.owner) + reserve > Number(row.owner_limit ?? config.DEFAULT_USER_BUDGET_USD * 1e6)) throw new Error("MODEL_BUDGET_EXCEEDED:USER");
}
