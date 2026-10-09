import type pg from "pg";
import { getConfig } from "../config.js";
import type { ModelProvider } from "./models.js";
import { coded } from "../errors.js";

export function providerPoolLimit(provider: ModelProvider): number {
  const c = getConfig();
  return provider === "gateway" ? c.GATEWAY_POOL_BUDGET_USD : provider === "gemini" ? c.GEMINI_POOL_BUDGET_USD : c.OPENAI_POOL_BUDGET_USD ?? c.INITIAL_BUILD_API_BUDGET_USD;
}

export function modelPoolLimit(model?: string): number | undefined {
  const c = getConfig();
  return model === "gpt-6-sol" ? c.SOL_POOL_BUDGET_USD : model === "gpt-6-luna" ? c.LUNA_POOL_BUDGET_USD : undefined;
}
export type UsageBlock = "SITE" | "PROVIDER" | "USER" | "MODEL";

// Eligibility reads are advisory. Reservations call this under the shared budget lock.
export async function sharedUsageBlock(client: pg.PoolClient | pg.Pool, ownerId: string, provider: ModelProvider, reserve: number, model?: string): Promise<UsageBlock | null> {
  if (!Number.isSafeInteger(reserve) || reserve < 0) throw new Error("Invalid model reservation");
  const config = getConfig();
  const result = await client.query<{ total: string; pool: string; model_pool: string; owner: string; owner_limit: string | null }>(`
    WITH charges AS (
      SELECT e.provider, e.model, COALESCE(j.owner_id,p.owner_id) AS owner_id,
        CASE WHEN e.state IN ('reserved','dispatched','uncertain') THEN GREATEST(e.reservation_microusd,e.actual_cost_microusd) ELSE e.actual_cost_microusd END AS amount
      FROM effect e LEFT JOIN job j ON j.id=e.job_id LEFT JOIN prompt_assistance p ON p.id=e.prompt_assistance_id
    ) SELECT COALESCE(sum(amount),0)::text AS total,
      COALESCE(sum(amount) FILTER (WHERE provider=$2),0)::text AS pool,
      COALESCE(sum(amount) FILTER (WHERE provider=$2 AND model=$3),0)::text AS model_pool,
      COALESCE(sum(amount) FILTER (WHERE owner_id=$1),0)::text AS owner,
      (SELECT limit_microusd::text FROM owner_usage_limit WHERE owner_id=$1) AS owner_limit FROM charges`, [ownerId, provider, model ?? null]);
  const row = result.rows[0]!;
  // Route away from an exhausted model first, then recheck every shared gate
  // using the replacement's reservation. This never bypasses the owner cap.
  const modelLimit = modelPoolLimit(model);
  if (modelLimit !== undefined && Number(row.model_pool) + reserve > modelLimit * 1e6) return "MODEL";
  if (Number(row.total) + reserve > config.INITIAL_BUILD_API_BUDGET_USD * 1e6) return "SITE";
  if (Number(row.pool) + reserve > providerPoolLimit(provider) * 1e6) return "PROVIDER";
  if (Number(row.owner) + reserve > Number(row.owner_limit ?? config.DEFAULT_USER_BUDGET_USD * 1e6)) return "USER";
  return null;
}

// Caller holds the shared budget advisory lock. No remote request inside this transaction.
export async function assertSharedUsage(client: pg.PoolClient, ownerId: string, provider: ModelProvider, reserve: number, model?: string): Promise<void> {
  const blocked = await sharedUsageBlock(client, ownerId, provider, reserve, model);
  // LangChain may reconstruct callback errors and discard custom properties.
  // Include the exact rejected reservation in the private machine-readable code.
  if (blocked) throw coded(`MODEL_BUDGET_EXCEEDED:${blocked}${blocked === "PROVIDER" ? `:${provider}` : blocked === "MODEL" ? `:${model}:reservation=${reserve}` : ""}`, { pool: blocked, provider, ...(blocked === "MODEL" && model ? { model, reservation: reserve } : {}) });
}
