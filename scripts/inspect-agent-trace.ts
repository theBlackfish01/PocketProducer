import { closePool, getPool } from "@pocket/core";

const pool = getPool();
const job = await pool.query<{ id: string }>("SELECT job_id AS id FROM effect WHERE provider='openai' ORDER BY created_at DESC LIMIT 1");
const jobId = job.rows[0]?.id;
if (!jobId) throw new Error("No OpenAI agent checkpoint found");
const writes = await pool.query<{ blob: Buffer }>("SELECT blob FROM checkpoint_writes WHERE thread_id=$1 AND channel='messages' AND type='json' ORDER BY checkpoint_id,idx", [jobId]);
const trace: unknown[] = [];
for (const row of writes.rows) {
  try {
    const decoded = JSON.parse(row.blob.toString("utf8")) as unknown;
    const value = (Array.isArray(decoded) ? decoded[0] : decoded) as Record<string, unknown>;
    const kwargs = value.kwargs && typeof value.kwargs === "object" ? value.kwargs as Record<string, unknown> : value;
    const constructor = Array.isArray(value.id) ? value.id.at(-1) : typeof value.role === "string" ? value.role : "unknown";
    const toolCalls = Array.isArray(kwargs.tool_calls) ? kwargs.tool_calls.map((call) => call && typeof call === "object" && "name" in call ? String(call.name) : "unknown") : [];
    const content = typeof kwargs.content === "string" ? kwargs.content.slice(0, 140) : Array.isArray(kwargs.content) ? kwargs.content.map((part) => part && typeof part === "object" && "type" in part ? String(part.type) : typeof part) : typeof kwargs.content;
    trace.push({ constructor, content, toolCalls, usage: kwargs.usage_metadata ?? null, shape: Object.keys(value) });
  } catch {
    trace.push({ parse: "failed" });
  }
}
process.stdout.write(`${JSON.stringify({ jobId, trace }, null, 2)}\n`);
await closePool();
