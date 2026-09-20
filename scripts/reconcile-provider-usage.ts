import { closePool, estimateCheckpointUsage, getPool, openAiCost } from "@pocket/core";

const pool = getPool();
const effects = await pool.query<{ id: string; job_id: string; output: Record<string, unknown> | null }>(
  "SELECT id,job_id,output FROM effect WHERE provider='openai' AND state='failed' AND cost_usd=0"
);
let reconciled = 0;
let costUsd = 0;
for (const effect of effects.rows) {
  const usage = await estimateCheckpointUsage(effect.job_id);
  const cost = openAiCost(usage);
  await pool.query("UPDATE effect SET cost_usd=$2,output=COALESCE(output,'{}'::jsonb) || $3::jsonb,updated_at=now() WHERE id=$1", [effect.id, cost, { usage }]);
  await pool.query("UPDATE job SET actual_cost_usd=$2,updated_at=now() WHERE id=$1", [effect.job_id, cost]);
  reconciled += 1;
  costUsd += cost;
}
process.stdout.write(`${JSON.stringify({ reconciled, costUsd })}\n`);
await closePool();
