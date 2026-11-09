import type pg from "pg";
import { canonicalHash } from "../domain/hash.js";

export interface ReadEvidence { tool: string; arguments: unknown; content: string; truncated: boolean }
const reusable = new Set(["read_file", "read_native_example", "read_native_recipe", "discover_native_capabilities", "inspect_native_capability"]);

/** Bounded, local read facts only. This module deliberately imports no agent/SDK. */
export function checkpointReadEvidence(values: unknown[], prior: ReadEvidence[] = []): ReadEvidence[] {
  const retained = new Map<string, ReadEvidence>();
  const add = (entry: ReadEvidence) => {
    if (!entry || typeof entry.tool !== "string" || typeof entry.content !== "string") return;
    if (!reusable.has(entry.tool) || (entry.tool === "read_file" && !(JSON.stringify(entry.arguments) ?? "").includes("/skills/"))) return;
    const key = canonicalHash([entry.tool, entry.arguments]);
    retained.delete(key);
    retained.set(key, { ...entry, content: entry.content.slice(0, 6000), truncated: entry.truncated || entry.content.length > 6000 });
  };
  for (const entry of prior) add(entry);
  const calls = new Map<string, { name: string; args: unknown }>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== "object") return;
    const entry = value as Record<string, unknown>;
    const data = (entry.kwargs ?? entry) as Record<string, unknown>;
    if (!data || typeof data !== "object") return;
    if (Array.isArray(data.tool_calls)) for (const call of data.tool_calls) {
      if (typeof call?.id === "string" && reusable.has(call.name)) calls.set(call.id, call);
    }
    if (typeof data.tool_call_id !== "string" || typeof data.content !== "string" || data.status === "error" || data.content.startsWith("Error")) return;
    const call = calls.get(data.tool_call_id);
    if (call) add({ tool: call.name, arguments: call.args, content: data.content, truncated: false });
  };
  values.forEach(visit);
  let size = 0;
  const result: ReadEvidence[] = [];
  for (const entry of [...retained.values()].reverse()) {
    const length = JSON.stringify(entry).length;
    if (size + length > 24000 || result.length >= 12) continue;
    result.unshift(entry); size += length;
  }
  return result;
}

export async function readCheckpointEvidence(client: Pick<pg.PoolClient, "query">, jobId: string): Promise<ReadEvidence[]> {
  const saved = await client.query<{ evidence: ReadEvidence[] }>("SELECT evidence FROM native_checkpoint_read_cache WHERE job_id=$1", [jobId]);
  const rows = await client.query<{ blob: Buffer }>(`SELECT blob FROM (
    SELECT blob,checkpoint_id,idx FROM checkpoint_writes
    WHERE (thread_id=$1 OR thread_id LIKE $2) AND channel='messages' AND type='json'
    ORDER BY checkpoint_id DESC,idx DESC LIMIT 256
  ) recent ORDER BY checkpoint_id,idx`, [jobId, `${jobId}:%`]);
  const values: unknown[] = [];
  for (const row of rows.rows) { try { values.push(JSON.parse(row.blob.toString("utf8"))); } catch { /* Unknown serializers require fresh discovery. */ } }
  return checkpointReadEvidence(values, saved.rows[0]?.evidence ?? []);
}

export async function preserveCheckpointEvidence(client: pg.PoolClient, jobId: string): Promise<number> {
  const evidence = await readCheckpointEvidence(client, jobId);
  if (evidence.length) await client.query(`INSERT INTO native_checkpoint_read_cache(job_id,evidence) VALUES($1,$2)
    ON CONFLICT(job_id) DO UPDATE SET evidence=EXCLUDED.evidence,updated_at=now()`, [jobId, JSON.stringify(evidence)]);
  return evidence.length ? Buffer.byteLength(JSON.stringify(evidence), "utf8") : 0;
}
