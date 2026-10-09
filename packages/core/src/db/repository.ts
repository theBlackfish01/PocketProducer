import type pg from "pg";
import { getConfig } from "../config.js";
import { getPool } from "./pool.js";
import { appendPublicJobEvent } from "../native/activity.js";
import { cachedRevisionFingerprint, revisionFingerprint, type NativeFingerprint } from "../native/fingerprint.js";
import { nativeDocumentSchema } from "../native/model.js";
import { stopIssue } from "../errors.js";

export const DEV_SUBJECT = "dev-loopback";

export interface OwnedProject {
  id: string;
  title: string;
  currentRevisionId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  workspaceStatus?: "working" | "attention" | "ready" | "new";
  fingerprint?: NativeFingerprint | null;
}

export interface JobRecord {
  id: string;
  ownerId: string;
  projectId: string;
  kind: "native-generation" | "native-revision" | "native-sync";
  state: string;
  stage: string | null;
  request: Record<string, unknown>;
  baseRevisionId: string | null;
  expectedHeadRevisionId: string | null;
  leaseOwner: string;
  leaseGeneration: number;
  attemptId: string;
  leaseUntil: string;
  deadlineAt: string;
  attempts: number;
  cancellationRequestedAt: string | null;
}

export type JobControlCode = "CANCELLED" | "LEASE_LOST" | "DEADLINE_EXCEEDED" | "MONITOR_UNAVAILABLE";

export class JobControlError extends Error {
  readonly code: JobControlCode;
  constructor(code: JobControlCode, message: string) {
    super(message);
    this.name = "JobControlError";
    this.code = code;
  }
}

async function insertJobEvent(client: pg.PoolClient, jobId: string, eventType: string, payload: Record<string, unknown>): Promise<number> {
  const allocated = await client.query<{ sequence: number }>(
    "UPDATE job SET next_event_sequence=next_event_sequence+1 WHERE id=$1 RETURNING next_event_sequence-1 AS sequence",
    [jobId]
  );
  const sequence = Number(allocated.rows[0]?.sequence);
  if (!Number.isInteger(sequence)) throw new Error("Unable to allocate job event sequence");
  await client.query("INSERT INTO job_event(job_id,sequence,event_type,payload) VALUES($1,$2,$3,$4)", [jobId, sequence, eventType, payload]);
  await appendPublicJobEvent(client, jobId, sequence, eventType, payload);
  return sequence;
}

export async function devOwnerId(): Promise<string> {
  const result = await getPool().query<{ id: string }>("SELECT id FROM app_user WHERE provider_subject = $1", [DEV_SUBJECT]);
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Development user missing; run pnpm db:migrate");
  return id;
}

// One owner-scoped display projection shared by list and detail. Never rename a
// user's explicit title or persist a draft title onto the accepted project.
const displayTitleSql = `CASE WHEN p.title <> 'Untitled listening room' THEN p.title ELSE COALESCE(
  (SELECT r.document->>'title' FROM native_revision r WHERE r.id=h.revision_id AND r.owner_id=p.owner_id),
  (SELECT operation->>'title' FROM job j JOIN native_job_step s ON s.job_id=j.id,
    jsonb_array_elements(s.operations) WITH ORDINALITY AS ops(operation,position)
    WHERE j.project_id=p.id AND j.owner_id=p.owner_id AND j.kind IN ('native-generation','native-revision')
      AND j.state IN ('queued','running','needs_attention','succeeded')
      AND operation->>'kind'='setTitle'
    ORDER BY j.created_at DESC,s.ordinal DESC,position DESC LIMIT 1), p.title) END`;

export async function listProjects(ownerId: string): Promise<OwnedProject[]> {
  const result = await getPool().query(`SELECT p.id,${displayTitleSql} AS title,h.revision_id AS current_revision_id,p.version,p.created_at,p.updated_at,
    CASE WHEN EXISTS(SELECT 1 FROM job j WHERE j.project_id=p.id AND j.kind IN ('native-generation','native-revision') AND j.state IN ('queued','running','cancel_requested')) THEN 'working'
    WHEN EXISTS(SELECT 1 FROM job j WHERE j.project_id=p.id AND j.kind IN ('native-generation','native-revision') AND j.state='needs_attention') THEN 'attention'
    WHEN EXISTS(SELECT 1 FROM native_project_head h WHERE h.project_id=p.id) THEN 'ready' ELSE 'new' END AS workspace_status
    FROM project p LEFT JOIN native_project_head h ON h.project_id=p.id WHERE p.owner_id=$1 AND p.deleted_at IS NULL ORDER BY p.updated_at DESC`, [ownerId]);
  const fingerprints = await currentFingerprints(ownerId, result.rows.flatMap((row) => row.current_revision_id ? [String(row.current_revision_id)] : []));
  return result.rows.map((row) => ({
    id: String(row.id), title: String(row.title), currentRevisionId: row.current_revision_id ? String(row.current_revision_id) : null,
    version: Number(row.version), createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(), workspaceStatus: row.workspace_status as NonNullable<OwnedProject["workspaceStatus"]>,
    fingerprint: row.current_revision_id ? fingerprints.get(String(row.current_revision_id)) ?? null : null
  }));
}

// Owner-scoped: only revisions selected by this owner's own list are read or cached.
async function currentFingerprints(ownerId: string, revisionIds: string[]): Promise<Map<string, NativeFingerprint>> {
  const found = new Map<string, NativeFingerprint>();
  const missing = revisionIds.filter((id) => { const cached = cachedRevisionFingerprint(id); if (cached) found.set(id, cached); return !cached; });
  if (!missing.length) return found;
  const rows = await getPool().query<{ id: string; document: unknown }>("SELECT id,document FROM native_revision WHERE owner_id=$1 AND id=ANY($2::uuid[])", [ownerId, missing]);
  for (const row of rows.rows) {
    const parsed = nativeDocumentSchema.safeParse(row.document);
    if (parsed.success) found.set(String(row.id), revisionFingerprint(String(row.id), parsed.data));
  }
  return found;
}

export async function createProject(ownerId: string, title: string): Promise<OwnedProject> {
  const result = await getPool().query("INSERT INTO project(owner_id,title) VALUES($1,$2) RETURNING id,title,current_revision_id,version,created_at,updated_at", [ownerId, title]);
  const row = result.rows[0];
  if (!row) throw new Error("Project insert failed");
  return { id: String(row.id), title: String(row.title), currentRevisionId: null, version: Number(row.version), createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() };
}

export async function requireProject(ownerId: string, projectId: string) {
  const result = await getPool().query(`SELECT p.id,${displayTitleSql} AS title,h.revision_id AS current_revision_id,p.version,p.created_at,p.updated_at FROM project p LEFT JOIN native_project_head h ON h.project_id=p.id WHERE p.id=$1 AND p.owner_id=$2 AND p.deleted_at IS NULL`, [projectId, ownerId]);
  const row = result.rows[0];
  if (!row) throw Object.assign(new Error("Project not found"), { statusCode: 404 });
  return { id: String(row.id), title: String(row.title), currentRevisionId: row.current_revision_id ? String(row.current_revision_id) : null, version: Number(row.version), createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() } satisfies OwnedProject;
}

export async function dispatchOutbox(): Promise<number> {
  const result = await getPool().query("UPDATE outbox SET delivered_at=now(),attempts=attempts+1 WHERE delivered_at IS NULL AND available_at<=now() AND EXISTS(SELECT 1 FROM job WHERE job.id=outbox.job_id AND kind IN ('native-generation','native-revision','native-sync') AND EXISTS(SELECT 1 FROM project p WHERE p.id=job.project_id AND p.deleted_at IS NULL)) RETURNING id");
  return result.rowCount ?? 0;
}

export async function settleExpiredJobs(jobId?: string): Promise<number> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const expired = await client.query<{ id: string; state: string; cancellation_requested_at: Date | null }>(
      `SELECT id,state,cancellation_requested_at FROM job
       WHERE kind IN ('native-generation','native-revision','native-sync') AND EXISTS(SELECT 1 FROM project p WHERE p.id=job.project_id AND p.deleted_at IS NULL) AND deadline_at<=now()
         AND state IN ('queued','running','cancel_requested')
         AND (state='queued' OR lease_until IS NULL OR lease_until<=now())
         AND ($1::uuid IS NULL OR id=$1)
       ORDER BY project_id,created_at FOR UPDATE SKIP LOCKED LIMIT 50`,
      [jobId ?? null]
    );
    // All job locks are already held. Acquire public activity clocks in the same
    // project order across sweepers, including disjoint jobs in shared projects.
    for (const row of expired.rows) {
      const cancelled = Boolean(row.cancellation_requested_at) || row.state === "cancel_requested";
      await client.query(
        `UPDATE job SET state=$2,stage=NULL,error_code=$3,error_message=$4,
           lease_until=NULL,lease_owner=NULL,attempt_id=NULL,updated_at=now()
         WHERE id=$1`,
        [row.id, cancelled ? "cancelled" : "failed", cancelled ? null : "DEADLINE_EXCEEDED", cancelled ? null : "The bounded job deadline expired before it could complete."]
      );
      await insertJobEvent(client, row.id, cancelled ? "cancelled" : "failed", cancelled
        ? { message: "Cancellation settled after the worker lease ended." }
        : { code: "DEADLINE_EXCEEDED", message: "The bounded job deadline expired before it could complete." });
    }
    await client.query("COMMIT");
    return expired.rowCount ?? 0;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function claimNextJob(workerId: string): Promise<JobRecord | null> {
  await settleExpiredJobs();
  const leaseSeconds = getConfig().JOB_LEASE_SECONDS;
  const result = await getPool().query(
    `WITH candidate AS (
       SELECT id FROM job
       WHERE kind IN ('native-generation','native-revision','native-sync') AND EXISTS(SELECT 1 FROM project p WHERE p.id=job.project_id AND p.deleted_at IS NULL) AND deadline_at>now()
         AND (state='queued' OR (state IN ('running','cancel_requested') AND lease_until < now()))
         AND EXISTS (SELECT 1 FROM outbox WHERE outbox.job_id=job.id AND delivered_at IS NOT NULL)
       ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
     ) UPDATE job SET state=CASE WHEN job.state='cancel_requested' THEN 'cancel_requested' ELSE 'running' END,
       stage=CASE WHEN job.state='cancel_requested' THEN NULL WHEN kind='native-sync' THEN 'synchronizing' ELSE 'constructing' END,
       lease_owner=$1,lease_generation=lease_generation+1,attempt_id=gen_random_uuid(),lease_until=now()+make_interval(secs=>$2),attempts=attempts+1,updated_at=now()
     WHERE id=(SELECT id FROM candidate)
     RETURNING id,owner_id,project_id,kind,state,stage,request,base_revision_id,expected_head_revision_id,lease_owner,lease_generation,attempt_id,lease_until,deadline_at,attempts,cancellation_requested_at`,
    [workerId, leaseSeconds]
  );
  const row = result.rows[0];
  return row ? {
    id: String(row.id), ownerId: String(row.owner_id), projectId: String(row.project_id), kind: row.kind as JobRecord["kind"],
    state: String(row.state), stage: row.stage ? String(row.stage) : null, request: row.request as Record<string, unknown>,
    baseRevisionId: row.base_revision_id ? String(row.base_revision_id) : null, expectedHeadRevisionId: row.expected_head_revision_id ? String(row.expected_head_revision_id) : null,
    leaseOwner: String(row.lease_owner), leaseGeneration: Number(row.lease_generation), attemptId: String(row.attempt_id),
    leaseUntil: new Date(row.lease_until).toISOString(), deadlineAt: new Date(row.deadline_at).toISOString(),
    attempts: Number(row.attempts), cancellationRequestedAt: row.cancellation_requested_at ? new Date(row.cancellation_requested_at).toISOString() : null
  } : null;
}

export async function claimJobById(jobId: string, workerId: string): Promise<JobRecord | null> {
  await settleExpiredJobs(jobId);
  const leaseSeconds = getConfig().JOB_LEASE_SECONDS;
  const result = await getPool().query(
    `UPDATE job SET state=CASE WHEN state='cancel_requested' THEN 'cancel_requested' ELSE 'running' END,
       stage=CASE WHEN state='cancel_requested' THEN NULL WHEN kind='native-sync' THEN 'synchronizing' ELSE 'constructing' END,
       lease_owner=$2,lease_generation=lease_generation+1,attempt_id=gen_random_uuid(),lease_until=now()+make_interval(secs=>$3),attempts=attempts+1,updated_at=now()
     WHERE id=$1 AND kind IN ('native-generation','native-revision','native-sync') AND EXISTS(SELECT 1 FROM project p WHERE p.id=job.project_id AND p.deleted_at IS NULL) AND deadline_at>now() AND (state='queued' OR (state IN ('running','cancel_requested') AND lease_until<now()))
       AND EXISTS (SELECT 1 FROM outbox WHERE outbox.job_id=job.id AND delivered_at IS NOT NULL)
     RETURNING id,owner_id,project_id,kind,state,stage,request,base_revision_id,expected_head_revision_id,lease_owner,lease_generation,attempt_id,lease_until,deadline_at,attempts,cancellation_requested_at`,
    [jobId, workerId, leaseSeconds]
  );
  const row = result.rows[0];
  return row ? {
    id: String(row.id), ownerId: String(row.owner_id), projectId: String(row.project_id), kind: row.kind as JobRecord["kind"],
    state: String(row.state), stage: row.stage ? String(row.stage) : null, request: row.request as Record<string, unknown>,
    baseRevisionId: row.base_revision_id ? String(row.base_revision_id) : null, expectedHeadRevisionId: row.expected_head_revision_id ? String(row.expected_head_revision_id) : null,
    leaseOwner: String(row.lease_owner), leaseGeneration: Number(row.lease_generation), attemptId: String(row.attempt_id),
    leaseUntil: new Date(row.lease_until).toISOString(), deadlineAt: new Date(row.deadline_at).toISOString(), attempts: Number(row.attempts),
    cancellationRequestedAt: row.cancellation_requested_at ? new Date(row.cancellation_requested_at).toISOString() : null
  } : null;
}

export async function appendJobEvent(jobId: string, eventType: string, payload: Record<string, unknown>, stage?: string): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    if (stage) await client.query("UPDATE job SET stage=$2,updated_at=now() WHERE id=$1", [jobId, stage]);
    await insertJobEvent(client, jobId, eventType, payload);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function attemptControlCode(client: pg.PoolClient, job: JobRecord, lock = false): Promise<JobControlCode | null> {
  const result = await client.query<{
    state: string;
    lease_owner: string | null;
    lease_generation: number;
    attempt_id: string | null;
    cancelled: boolean;
    lease_expired: boolean;
    deadline_expired: boolean;
  }>(
    `SELECT state,lease_owner,lease_generation,attempt_id,
       cancellation_requested_at IS NOT NULL OR state='cancel_requested' AS cancelled,
       lease_until IS NULL OR lease_until<=now() AS lease_expired,
       deadline_at<=now() AS deadline_expired
     FROM job WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
    [job.id]
  );
  const row = result.rows[0];
  if (!row || row.lease_owner !== job.leaseOwner || row.lease_generation !== job.leaseGeneration || row.attempt_id !== job.attemptId) return "LEASE_LOST";
  if (row.cancelled) return "CANCELLED";
  if (row.deadline_expired) return "DEADLINE_EXCEEDED";
  if (row.state !== "running" || row.lease_expired) return "LEASE_LOST";
  return null;
}

function controlMessage(code: JobControlCode): string {
  if (code === "CANCELLED") return "Cancellation requested";
  if (code === "DEADLINE_EXCEEDED") return "Job deadline expired";
  if (code === "MONITOR_UNAVAILABLE") return "Worker could not verify its database lease";
  return "Worker attempt no longer owns a live lease";
}

export async function appendAttemptEvent(job: JobRecord, eventType: string, payload: Record<string, unknown>, stage?: string): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const control = await attemptControlCode(client, job, true);
    if (control) throw new JobControlError(control, controlMessage(control));
    await client.query("UPDATE job SET stage=COALESCE($2,stage),updated_at=now() WHERE id=$1", [job.id, stage ?? null]);
    await insertJobEvent(client, job.id, eventType, payload);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function heartbeat(job: JobRecord): Promise<JobControlCode | null> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const control = await attemptControlCode(client, job, true);
    if (control) {
      await client.query("ROLLBACK");
      return control;
    }
  const leaseSeconds = getConfig().JOB_LEASE_SECONDS;
    await client.query(
    `UPDATE job SET lease_until=now()+make_interval(secs=>$5),updated_at=now()
     WHERE id=$1 AND lease_owner=$2 AND lease_generation=$3 AND attempt_id=$4`,
    [job.id, job.leaseOwner, job.leaseGeneration, job.attemptId, leaseSeconds]
  );
    await client.query("COMMIT");
    return null;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function isCancelled(job: JobRecord): Promise<boolean> {
  const result = await getPool().query<{ state: string; cancellation_requested_at: Date | null }>(
    "SELECT state,cancellation_requested_at FROM job WHERE id=$1 AND lease_generation=$2 AND attempt_id=$3",
    [job.id, job.leaseGeneration, job.attemptId]
  );
  if (!result.rows[0]) throw new JobControlError("LEASE_LOST", "Job attempt no longer owns the lease");
  return Boolean(result.rows[0]?.cancellation_requested_at) || result.rows[0]?.state === "cancel_requested";
}

export async function failJob(job: JobRecord, code: string, message: string): Promise<boolean> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE job SET state='failed',stage=NULL,error_code=$5,error_message=$6,lease_until=NULL,lease_owner=NULL,attempt_id=NULL,updated_at=now()
       WHERE id=$1 AND lease_owner=$2 AND lease_generation=$3 AND attempt_id=$4 AND state='running' AND cancellation_requested_at IS NULL AND lease_until>now()
       RETURNING id`,
      [job.id, job.leaseOwner, job.leaseGeneration, job.attemptId, code, message.slice(0, 500)]
    );
    if (result.rowCount !== 1) {
      await client.query("ROLLBACK");
      return false;
    }
    await insertJobEvent(client, job.id, "failed", { code, message: message.slice(0, 240) });
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function needsAttentionJob(job: JobRecord, code: string, message: string): Promise<boolean> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE job SET state='needs_attention',stage=NULL,error_code=$5,error_message=$6,lease_until=NULL,lease_owner=NULL,attempt_id=NULL,updated_at=now()
       WHERE id=$1 AND lease_owner=$2 AND lease_generation=$3 AND attempt_id=$4 AND state='running' AND cancellation_requested_at IS NULL
       RETURNING id`,
      [job.id, job.leaseOwner, job.leaseGeneration, job.attemptId, code, message.slice(0, 500)]
    );
    if (result.rowCount === 1) await insertJobEvent(client, job.id, "needs_attention", { code, message: message.slice(0, 240) });
    await client.query("COMMIT");
    return result.rowCount === 1;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function cancelJob(ownerId: string, jobId: string): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const selected = await client.query<{ state: string }>("SELECT state FROM job WHERE id=$1 AND owner_id=$2 FOR UPDATE", [jobId, ownerId]);
    const row = selected.rows[0];
    if (!row) throw Object.assign(new Error("Job not found"), { statusCode: 404 });
    if (row.state === "queued") {
      await client.query("UPDATE job SET state='cancelled',stage=NULL,cancellation_requested_at=COALESCE(cancellation_requested_at,now()),lease_until=NULL,updated_at=now() WHERE id=$1", [jobId]);
      await insertJobEvent(client, jobId, "cancelled", { message: "Queued request cancelled before execution" });
    } else if (row.state === "running") {
      await client.query("UPDATE job SET state='cancel_requested',cancellation_requested_at=COALESCE(cancellation_requested_at,now()),updated_at=now() WHERE id=$1", [jobId]);
      await insertJobEvent(client, jobId, "cancel_requested", { message: "Cancellation requested for the active attempt" });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function commitCancelled(job: JobRecord): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE job SET state='cancelled',stage=NULL,lease_until=NULL,lease_owner=NULL,attempt_id=NULL,updated_at=now()
       WHERE id=$1 AND lease_owner=$2 AND lease_generation=$3 AND attempt_id=$4 AND state='cancel_requested' RETURNING id`,
      [job.id, job.leaseOwner, job.leaseGeneration, job.attemptId]
    );
    if (result.rowCount === 1) await insertJobEvent(client, job.id, "cancelled", { message: "Active request settled as cancelled" });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function requeueJob(job: JobRecord, code: string, message: string): Promise<boolean> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE job SET state='queued',stage=NULL,lease_until=NULL,lease_owner=NULL,attempt_id=NULL,error_code=$5,error_message=$6,updated_at=now()
       WHERE id=$1 AND lease_owner=$2 AND lease_generation=$3 AND attempt_id=$4 AND state='running'
         AND cancellation_requested_at IS NULL AND lease_until>now() AND deadline_at>now()
       RETURNING id`,
      [job.id, job.leaseOwner, job.leaseGeneration, job.attemptId, code, message.slice(0, 500)]
    );
    if (result.rowCount !== 1) {
      await client.query("ROLLBACK");
      return false;
    }
    await insertJobEvent(client, job.id, "retrying", { attempt: job.attempts, code, message: message.slice(0, 240) });
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function expireJob(job: JobRecord): Promise<boolean> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE job SET state='failed',stage=NULL,error_code='DEADLINE_EXCEEDED',error_message='The bounded job deadline expired.',lease_until=NULL,lease_owner=NULL,attempt_id=NULL,updated_at=now()
       WHERE id=$1 AND lease_owner=$2 AND lease_generation=$3 AND attempt_id=$4 AND state='running' RETURNING id`,
      [job.id, job.leaseOwner, job.leaseGeneration, job.attemptId]
    );
    if (result.rowCount === 1) await insertJobEvent(client, job.id, "failed", { code: "DEADLINE_EXCEEDED", message: "The bounded job deadline expired." });
    await client.query("COMMIT");
    return result.rowCount === 1;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getProjectSnapshot(ownerId: string, projectId: string) {
  const project = await requireProject(ownerId, projectId);
  const assets = await getPool().query("SELECT id,name,mime_type,provenance,created_at,duration_seconds,sample_rate,channels,readiness FROM asset WHERE owner_id=$1 AND project_id=$2 AND kind='source' AND readiness='ready' ORDER BY created_at", [ownerId, projectId]);
  return { project, assets: assets.rows.map((row) => ({ id: String(row.id), name: String(row.name), mimeType: String(row.mime_type), provenance: String(row.provenance), createdAt: new Date(row.created_at).toISOString(), durationSeconds: Number(row.duration_seconds), sampleRate: Number(row.sample_rate), channels: Number(row.channels), readiness: String(row.readiness), audioUrl: `/api/v1/assets/${row.id}/audio` })) };
}

export async function jobSnapshot(ownerId: string, jobId: string) {
  const result = await getPool().query("SELECT id,project_id,kind,state,stage,attempts,result_native_revision_id,error_code,error_message,estimated_cost_usd,actual_cost_usd,created_at,updated_at FROM job WHERE id=$1 AND owner_id=$2 AND kind IN ('native-generation','native-revision','native-sync') AND EXISTS(SELECT 1 FROM project p WHERE p.id=job.project_id AND p.deleted_at IS NULL)", [jobId, ownerId]);
  if (!result.rows[0]) throw Object.assign(new Error("Job not found"), { statusCode: 404 });
  const events = await getPool().query("SELECT sequence,event_type,payload,created_at FROM job_event WHERE job_id=$1 ORDER BY sequence", [jobId]);
  return { ...result.rows[0], issue_code: stopIssue(result.rows[0].error_code, result.rows[0].error_message), events: events.rows };
}

export async function findCommandJob(ownerId: string, projectId: string, kind: JobRecord["kind"], idempotencyKey: string) {
  const result = await getPool().query<{ id: string }>(
    "SELECT id FROM job WHERE owner_id=$1 AND project_id=$2 AND kind=$3 AND idempotency_key=$4",
    [ownerId, projectId, kind, idempotencyKey]
  );
  const id = result.rows[0]?.id;
  return id ? jobSnapshot(ownerId, id) : null;
}

export async function insertAsset(input: { ownerId: string; projectId: string; name: string; hash: string; path: string; durationSeconds: number; sampleRate: number; channels: number; provenance: string }): Promise<string> {
  const result = await getPool().query<{ id: string }>(
    `INSERT INTO asset(owner_id,project_id,kind,name,content_hash,object_path,mime_type,duration_seconds,sample_rate,channels,readiness,provenance)
     VALUES($1,$2,'source',$3,$4,$5,'audio/wav',$6,$7,$8,'ready',$9)
     ON CONFLICT(owner_id,project_id,content_hash,kind) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
    [input.ownerId, input.projectId, input.name, input.hash, input.path, input.durationSeconds, input.sampleRate, input.channels, input.provenance]
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Asset insert failed");
  return id;
}
