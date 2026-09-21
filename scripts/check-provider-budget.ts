import { closePool, getConfig, getPool } from "@pocket/core";

const config = getConfig();
const result = await getPool().query<{ total: string }>(
  `SELECT COALESCE(SUM(CASE WHEN state IN ('reserved','dispatched','uncertain')
    THEN GREATEST(reservation_microusd,actual_cost_microusd) ELSE actual_cost_microusd END),0)::text AS total FROM effect`
);
const byProvider = await getPool().query<{ provider: string; state: string; effects: string; actual: string; held: string }>(
  `SELECT provider,state,count(*)::text AS effects,COALESCE(SUM(actual_cost_microusd),0)::text AS actual,
    COALESCE(SUM(CASE WHEN state IN ('reserved','dispatched','uncertain') THEN GREATEST(reservation_microusd,actual_cost_microusd) ELSE actual_cost_microusd END),0)::text AS held
   FROM effect GROUP BY provider,state ORDER BY provider,state`
);
const unknown = await getPool().query<{ provider: string; effects: string; held: string }>(
  `SELECT provider,count(*)::text AS effects,
     COALESCE(SUM(GREATEST(reservation_microusd,actual_cost_microusd)),0)::text AS held
   FROM effect WHERE cost_status='unknown' GROUP BY provider ORDER BY provider`
);
process.stdout.write(`${JSON.stringify({
  overallLimitUsd: config.INITIAL_BUILD_API_BUDGET_USD,
  jobLimitUsd: config.MAX_JOB_COST_USD,
  maxCalls: config.MAX_MODEL_CALLS_PER_JOB,
  geminiModel: config.GEMINI_MODEL,
  openaiModel: config.OPENAI_MODEL,
  spentOrReservedUsd: Number(result.rows[0]?.total ?? 0) / 1_000_000,
  remainingUpperBoundUsd: Math.max(0, config.INITIAL_BUILD_API_BUDGET_USD - Number(result.rows[0]?.total ?? 0) / 1_000_000),
  exactRemainingKnown: unknown.rowCount === 0,
  geminiConfigured: Boolean(config.GEMINI_API_KEY ?? config.GOOGLE_API_KEY),
  openaiConfigured: Boolean(config.OPENAI_API_KEY),
  byProviderAndState: byProvider.rows.map((row) => ({ provider: row.provider, state: row.state, effects: Number(row.effects), actualCostUsd: Number(row.actual) / 1_000_000, spentOrReservedUsd: Number(row.held) / 1_000_000 })),
  unknownUsageLiabilities: unknown.rows.map((row) => ({ provider: row.provider, effects: Number(row.effects), heldReservationUsd: Number(row.held) / 1_000_000 }))
})}\n`);
await closePool();
