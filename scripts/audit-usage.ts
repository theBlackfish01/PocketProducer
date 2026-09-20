import { closePool, getPool } from "@pocket/core";

const pool = getPool();
const jobs = await pool.query(
  "SELECT j.id,j.state,j.error_code,j.actual_cost_usd,e.state AS effect_state,e.cost_usd,e.output FROM job j JOIN effect e ON e.job_id=j.id WHERE e.provider='openai' ORDER BY j.created_at DESC LIMIT 10"
);
const total = await pool.query("SELECT COALESCE(SUM(actual_cost_usd),0)::text AS tracked_cost_usd FROM job");
const tables = await pool.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'checkpoint%' ORDER BY table_name");
const checkpointCounts: Record<string, number> = {};
for (const row of tables.rows) {
  if (!/^[a-z_]+$/.test(row.table_name)) continue;
  const count = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${row.table_name}`);
  checkpointCounts[row.table_name] = Number(count.rows[0]?.count ?? 0);
}
const latestJobId = typeof jobs.rows[0]?.id === "string" ? jobs.rows[0].id : "";
const usage = { inputTokens: 0, outputTokens: 0, messagesWithUsage: 0 };
if (latestJobId) {
  const messageWrites = await pool.query<{ blob: Buffer }>("SELECT blob FROM checkpoint_writes WHERE thread_id=$1 AND channel='messages' AND type='json'", [latestJobId]);
  const seen = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const metadata = record.usage_metadata;
    const id = typeof record.id === "string" ? record.id : undefined;
    if (metadata && typeof metadata === "object" && (!id || !seen.has(id))) {
      const tokenRecord = metadata as Record<string, unknown>;
      usage.inputTokens += typeof tokenRecord.input_tokens === "number" ? tokenRecord.input_tokens : 0;
      usage.outputTokens += typeof tokenRecord.output_tokens === "number" ? tokenRecord.output_tokens : 0;
      usage.messagesWithUsage += 1;
      if (id) seen.add(id);
    }
    for (const child of Object.values(record)) visit(child);
  };
  for (const row of messageWrites.rows) {
    try { visit(JSON.parse(row.blob.toString("utf8")) as unknown); } catch { /* Keep the usage audit readable if a serializer changes. */ }
  }
}
const checkpointEstimatedCostUsd = usage.inputTokens / 1_000_000 * 10 + usage.outputTokens / 1_000_000 * 50;
process.stdout.write(`${JSON.stringify({ trackedCostUsd: Number(total.rows[0]?.tracked_cost_usd ?? 0), checkpointUsage: usage, checkpointEstimatedCostUsd, jobs: jobs.rows, checkpointCounts }, null, 2)}\n`);
await closePool();
