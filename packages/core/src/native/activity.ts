import type pg from "pg";
import { z } from "zod";
import { getPool } from "../db/pool.js";
import { getConfig } from "../config.js";
import { nativeRunLimits } from "./profile.js";

// Public presentation contract. Never spread request, model, trace or tool objects here.
export const activityPayloadSchema = z.object({
  version: z.literal(1).default(1),
  kind: z.enum(["request", "approach", "music", "working", "checking", "saved", "selected", "paused", "failed", "stopping", "stopped", "continued", "allowance", "audiotool"]),
  text: z.string().max(32_768),
  historical: z.boolean().optional(),
  revisionId: z.uuid().optional(), baseRevisionId: z.uuid().nullable().optional(),
  selected: z.boolean().optional(), ordinal: z.number().int().positive().optional(),
  step: z.number().int().positive().optional(), documentHash: z.string().max(128).optional(),
  sectionId: z.string().max(96).optional(), partId: z.string().max(96).optional(),
  sourceIds: z.array(z.uuid()).max(24).optional(), keptPartIds: z.array(z.string().max(96)).max(32).optional(),
  profile: z.enum(["standard", "extended"]).optional(),
  scope: z.string().max(1_200).optional(),
}).strict();
export type ActivityPayload = z.infer<typeof activityPayloadSchema>;
export interface PublicActivity { cursor: number; jobId: string | null; createdAt: string; payload: ActivityPayload }

/** Called inside the state transaction, after domain locks/writes. The clock is the
 * final shared lock: never acquire another project/job lock after publishing.
 * Its lock survives to COMMIT so a later cursor cannot commit before this one. */
export async function appendPublicActivity(client: pg.PoolClient, context: { ownerId: string; projectId: string; jobId?: string }, origin: string, raw: ActivityPayload): Promise<void> {
  const payload = activityPayloadSchema.parse(raw);
  await client.query("INSERT INTO project_activity_clock(project_id) VALUES($1) ON CONFLICT DO NOTHING", [context.projectId]);
  await client.query("SELECT cursor FROM project_activity_clock WHERE project_id=$1 FOR UPDATE", [context.projectId]);
  const duplicate = await client.query("SELECT 1 FROM project_activity WHERE project_id=$1 AND origin=$2", [context.projectId, origin]);
  if (duplicate.rowCount) return;
  const allocated = await client.query<{ cursor: string }>("UPDATE project_activity_clock SET cursor=cursor+1 WHERE project_id=$1 RETURNING cursor::text", [context.projectId]);
  await client.query("INSERT INTO project_activity(project_id,owner_id,cursor,origin,job_id,payload) VALUES($1,$2,$3,$4,$5,$6)", [context.projectId, context.ownerId, allocated.rows[0]!.cursor, origin, context.jobId ?? null, JSON.stringify(payload)]);
}

export async function appendPublicJobEvent(client: pg.PoolClient, jobId: string, sequence: number, event: string, payload: Record<string, unknown>): Promise<void> {
  const row = (await client.query<{ owner_id: string; project_id: string; kind: string; stage: string | null }>("SELECT owner_id,project_id,kind,stage FROM job WHERE id=$1", [jobId])).rows[0];
  if (!row?.kind.startsWith("native-")) return;
  const messages: Record<string, [ActivityPayload["kind"], string]> = {
    failed: ["failed", "This request could not finish. Your saved versions are unchanged."],
    needs_attention: ["paused", payload.code === "NATIVE_PARTIAL" ? "Work is saved in progress. Review the next step before continuing." : "This request needs review before it can continue. Your saved music is safe."],
    cancel_requested: ["stopping", "Stopping this request…"], cancelled: ["stopped", "Request stopped. Your saved versions are unchanged."],
    retrying: ["working", "Resuming the saved work after an interruption."],
  };
  const stage = row.stage;
  // Capability diagnostics remain in private job events and the Sounds view.
  // Do not interrupt every text-only request with irrelevant sample listening.
  if (event === "capabilities") return;
  const message = messages[event] ?? (event === "stage" ? stage === "validating" ? ["checking", "Checking the arrangement and the material you asked to keep."] as const : stage === "constructing" ? ["working", "Shaping your arrangement. Confirmed changes will appear here."] as const : stage === "discovering" ? ["working", "Preparing the sounds and musical approach."] as const : null : null);
  if (!message) return;
  const syncText = event === "cancel_requested" ? "Stopping the Audiotool copy request…" : event === "cancelled" ? "Audiotool copy request stopped. Your local arrangement remains available." : event === "failed" || event === "needs_attention" ? "The Audiotool copy needs attention. Your local arrangement remains available." : "Checking the Audiotool copy. Your local arrangement remains available.";
  await appendPublicActivity(client, { ownerId: row.owner_id, projectId: row.project_id, jobId }, `job:${jobId}:${sequence}`, { version: 1, kind: row.kind === "native-sync" ? "audiotool" : message[0], text: row.kind === "native-sync" ? syncText : message[1] });
}

function serializeActivity(row: { cursor: string; job_id: string | null; created_at: Date; payload: unknown }): PublicActivity {
  return { cursor: Number(row.cursor), jobId: row.job_id, createdAt: row.created_at.toISOString(), payload: activityPayloadSchema.parse(row.payload) };
}

export async function readProjectActivity(ownerId: string, projectId: string, options: { after?: number | undefined; before?: number | undefined; limit?: number | undefined } = {}) {
  const client = await getPool().connect();
  try {
    // Head, active request and cursor come from one snapshot. No gap before tailing.
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const project = await client.query("SELECT 1 FROM project WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL", [projectId, ownerId]);
    if (!project.rowCount) throw Object.assign(new Error("Session not found"), { statusCode: 404 });
    const cursor = Number((await client.query("SELECT cursor FROM project_activity_clock WHERE project_id=$1", [projectId])).rows[0]?.cursor ?? 0);
    const limit = Math.max(1, Math.min(options.limit ?? 40, 100));
    // A restored database can have a lower watermark than a browser remembers.
    // Return a fresh bounded snapshot instead of waiting forever for that cursor.
    const reset = options.after !== undefined && options.after > cursor;
    const forward = options.after !== undefined && !reset;
    const rows = await client.query<{ cursor: string; job_id: string | null; created_at: Date; payload: unknown }>(`SELECT cursor::text,job_id,created_at,payload FROM project_activity WHERE project_id=$1 AND owner_id=$2 AND cursor ${forward ? ">" : "<"} $3 ORDER BY cursor ${forward ? "ASC" : "DESC"} LIMIT $4`, [projectId, ownerId, forward ? options.after : options.before ?? cursor + 1, limit]);
    const events = (forward ? rows.rows : rows.rows.reverse()).map(serializeActivity);
    const job = (await client.query("SELECT id,project_id,kind,state,stage,error_code,result_native_revision_id,updated_at FROM job WHERE project_id=$1 AND owner_id=$2 AND kind IN ('native-generation','native-revision') ORDER BY CASE WHEN state IN ('queued','running','cancel_requested') THEN 0 WHEN state='needs_attention' THEN 1 ELSE 2 END,created_at DESC LIMIT 1", [projectId, ownerId])).rows[0] ?? null;
    const head = (await client.query<{ revision_id: string }>("SELECT revision_id FROM native_project_head WHERE project_id=$1 AND owner_id=$2", [projectId, ownerId])).rows[0]?.revision_id ?? null;
    const step = job ? (await client.query<{ ordinal: number; result_hash: string }>("SELECT ordinal,result_hash FROM native_job_step WHERE job_id=$1 ORDER BY ordinal DESC LIMIT 1", [job.id])).rows[0] ?? null : null;
    const unsafe = (await client.query("SELECT 1 FROM effect e JOIN job j ON j.id=e.job_id WHERE j.project_id=$1 AND j.owner_id=$2 AND j.kind IN ('native-generation','native-revision') AND j.state IN ('failed','cancelled','needs_attention') AND (e.cost_status='unknown' OR e.state IN ('dispatched','uncertain')) AND e.step<>'native-producer-result' LIMIT 1", [projectId, ownerId])).rowCount !== 0;
    const paused = Boolean((await client.query("SELECT 1 FROM job WHERE project_id=$1 AND owner_id=$2 AND kind IN ('native-generation','native-revision') AND state='needs_attention' LIMIT 1", [projectId, ownerId])).rowCount);
    const active = job && ["queued", "running", "cancel_requested"].includes(job.state);
    const site = await client.query<{ committed: string }>("SELECT COALESCE(SUM(CASE WHEN state IN ('reserved','dispatched','uncertain') THEN GREATEST(reservation_microusd,actual_cost_microusd) ELSE actual_cost_microusd END),0)::text AS committed FROM effect");
    const remaining = Math.max(0, getConfig().INITIAL_BUILD_API_BUDGET_USD - Number(site.rows[0]!.committed) / 1_000_000);
    await client.query("COMMIT");
    return { events, cursor, reset, nextCursor: forward ? events.at(-1)?.cursor ?? options.after! : cursor, hasOlder: (events[0]?.cursor ?? 1) > 1, job, headId: head, draft: step ? { step: step.ordinal, hash: step.result_hash } : null,
      actions: { canSubmit: !active && !unsafe && !paused, canStop: Boolean(active && job?.state !== "cancel_requested"), canAbandon: !unsafe && job?.state === "needs_attention" && job?.error_code === "NATIVE_PARTIAL", issue: unsafe ? "uncertain" : paused ? "paused" : null },
      allowance: { remainingUsd: remaining, standardUsd: Math.min(remaining, nativeRunLimits("standard").maxJobCostUsd), extendedUsd: Math.min(remaining, nativeRunLimits("extended").maxJobCostUsd) } };
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
