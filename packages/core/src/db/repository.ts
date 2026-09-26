import { randomUUID } from "node:crypto";
import type pg from "pg";
import { canonicalHash, validateComposition, type Composition } from "../domain/composition.js";
import type { AudioAnalysis } from "../providers/gemini.js";
import { NEXUS_MAPPING_VERSION, type AudiotoolExportCheckpoint, type ExportStepCheckpoint } from "../nexus/adapter.js";
import { getConfig } from "../config.js";
import { getPool } from "./pool.js";
import { appendPublicJobEvent } from "../native/activity.js";

export const DEV_SUBJECT = "dev-loopback";

export interface OwnedProject {
  id: string;
  title: string;
  currentRevisionId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  workspaceStatus?: "working" | "attention" | "ready" | "new";
}

export interface JobRecord {
  id: string;
  ownerId: string;
  projectId: string;
  kind: "generation" | "revision" | "export" | "native-generation" | "native-revision" | "native-sync";
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

export async function listProjects(ownerId: string): Promise<OwnedProject[]> {
  const result = await getPool().query(`SELECT p.id,p.title,p.current_revision_id,p.version,p.created_at,p.updated_at,
    CASE WHEN EXISTS(SELECT 1 FROM job j WHERE j.project_id=p.id AND j.kind IN ('native-generation','native-revision') AND j.state IN ('queued','running','cancel_requested')) THEN 'working'
    WHEN EXISTS(SELECT 1 FROM job j WHERE j.project_id=p.id AND j.kind IN ('native-generation','native-revision') AND j.state='needs_attention') THEN 'attention'
    WHEN EXISTS(SELECT 1 FROM native_project_head h WHERE h.project_id=p.id) THEN 'ready' ELSE 'new' END AS workspace_status
    FROM project p WHERE p.owner_id=$1 AND p.deleted_at IS NULL ORDER BY p.updated_at DESC`, [ownerId]);
  return result.rows.map((row) => ({
    id: String(row.id), title: String(row.title), currentRevisionId: row.current_revision_id ? String(row.current_revision_id) : null,
    version: Number(row.version), createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(), workspaceStatus: row.workspace_status as NonNullable<OwnedProject["workspaceStatus"]>
  }));
}

export async function createProject(ownerId: string, title: string): Promise<OwnedProject> {
  const result = await getPool().query("INSERT INTO project(owner_id,title) VALUES($1,$2) RETURNING id,title,current_revision_id,version,created_at,updated_at", [ownerId, title]);
  const row = result.rows[0];
  if (!row) throw new Error("Project insert failed");
  return { id: String(row.id), title: String(row.title), currentRevisionId: null, version: Number(row.version), createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() };
}

export async function requireProject(ownerId: string, projectId: string) {
  const result = await getPool().query("SELECT id,title,current_revision_id,version,created_at,updated_at FROM project WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL", [projectId, ownerId]);
  const row = result.rows[0];
  if (!row) throw Object.assign(new Error("Project not found"), { statusCode: 404 });
  return { id: String(row.id), title: String(row.title), currentRevisionId: row.current_revision_id ? String(row.current_revision_id) : null, version: Number(row.version), createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() } satisfies OwnedProject;
}

export async function createJob(input: {
  ownerId: string; projectId: string; kind: JobRecord["kind"]; idempotencyKey: string; request: Record<string, unknown>;
  baseRevisionId?: string | null; expectedHeadRevisionId?: string | null;
}): Promise<{ id: string; duplicate: boolean }> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const normalizedRequestHash = canonicalHash({
      version: "command-v2",
      ownerId: input.ownerId,
      projectId: input.projectId,
      kind: input.kind,
      request: input.request,
      baseRevisionId: input.baseRevisionId ?? null
    });
    const existing = await client.query<{
      id: string;
      request: Record<string, unknown>;
      base_revision_id: string | null;
    }>(
      "SELECT id,request,base_revision_id FROM job WHERE owner_id=$1 AND project_id=$2 AND kind=$3 AND idempotency_key=$4 FOR UPDATE",
      [input.ownerId, input.projectId, input.kind, input.idempotencyKey]
    );
    if (existing.rows[0]) {
      const prior = existing.rows[0];
      const samePayload = canonicalHash({ request: prior.request, baseRevisionId: prior.base_revision_id }) ===
        canonicalHash({ request: input.request, baseRevisionId: input.baseRevisionId ?? null });
      if (!samePayload) throw Object.assign(new Error("Idempotency key reused with a different request"), { statusCode: 409 });
      await client.query("COMMIT");
      return { id: prior.id, duplicate: true };
    }
    const projectResult = await client.query<{ current_revision_id: string | null }>(
      "SELECT current_revision_id FROM project WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE",
      [input.projectId, input.ownerId]
    );
    const project = projectResult.rows[0];
    if (!project) throw Object.assign(new Error("Project not found"), { statusCode: 404 });

    if (input.baseRevisionId) {
      const base = await client.query("SELECT 1 FROM revision WHERE id=$1 AND owner_id=$2 AND project_id=$3", [input.baseRevisionId, input.ownerId, input.projectId]);
      if (base.rowCount !== 1) throw Object.assign(new Error("Base revision is not part of this project"), { statusCode: 422 });
    }
    const sourceAssetId = typeof input.request.sourceAssetId === "string" ? input.request.sourceAssetId : undefined;
    if (sourceAssetId) {
      const source = await client.query("SELECT 1 FROM asset WHERE id=$1 AND owner_id=$2 AND project_id=$3 AND kind='source' AND readiness='ready'", [sourceAssetId, input.ownerId, input.projectId]);
      if (source.rowCount !== 1) throw Object.assign(new Error("Source asset is not available in this project"), { statusCode: 422 });
    }

    const expectedHead = input.expectedHeadRevisionId === undefined ? project.current_revision_id : input.expectedHeadRevisionId;
    if (input.expectedHeadRevisionId !== undefined && project.current_revision_id !== input.expectedHeadRevisionId) {
      throw Object.assign(new Error("Current version changed; refresh before continuing"), { statusCode: 409 });
    }
    const deadlineSeconds = getConfig().MAX_JOB_SECONDS;
    const result = await client.query<{ id: string }>(
      `INSERT INTO job(owner_id,project_id,kind,idempotency_key,request_hash,request,base_revision_id,expected_head_revision_id,state,deadline_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'queued',now()+make_interval(secs=>$9)) RETURNING id`,
      [input.ownerId, input.projectId, input.kind, input.idempotencyKey, normalizedRequestHash, input.request, input.baseRevisionId ?? null, expectedHead ?? null, deadlineSeconds]
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error("Job insert failed");
    await client.query("INSERT INTO job_event(job_id,sequence,event_type,payload) VALUES($1,1,'accepted',$2)", [id, { message: "Request accepted", expectedHeadRevisionId: expectedHead ?? null }]);
    await client.query("INSERT INTO outbox(job_id,topic) VALUES($1,$2)", [id, `job.${input.kind}`]);
    await client.query("COMMIT");
    return { id, duplicate: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function dispatchOutbox(): Promise<number> {
  const result = await getPool().query("UPDATE outbox SET delivered_at=now(),attempts=attempts+1 WHERE delivered_at IS NULL AND available_at<=now() RETURNING id");
  return result.rowCount ?? 0;
}

export async function settleExpiredJobs(jobId?: string): Promise<number> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const expired = await client.query<{ id: string; state: string; cancellation_requested_at: Date | null }>(
      `SELECT id,state,cancellation_requested_at FROM job
       WHERE deadline_at<=now()
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
       WHERE deadline_at>now()
         AND (state='queued' OR (state IN ('running','cancel_requested') AND lease_until < now()))
         AND EXISTS (SELECT 1 FROM outbox WHERE outbox.job_id=job.id AND delivered_at IS NOT NULL)
       ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
     ) UPDATE job SET state=CASE WHEN job.state='cancel_requested' THEN 'cancel_requested' ELSE 'running' END,
       stage=CASE WHEN job.state='cancel_requested' THEN NULL WHEN kind='export' THEN 'exporting' ELSE 'analyzing' END,
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
       stage=CASE WHEN state='cancel_requested' THEN NULL WHEN kind='export' THEN 'exporting' ELSE 'analyzing' END,
       lease_owner=$2,lease_generation=lease_generation+1,attempt_id=gen_random_uuid(),lease_until=now()+make_interval(secs=>$3),attempts=attempts+1,updated_at=now()
     WHERE id=$1 AND deadline_at>now() AND (state='queued' OR (state IN ('running','cancel_requested') AND lease_until<now()))
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

export type ProjectExportState = "disabled" | "awaiting_authorization" | "exporting" | "failed" | "uncertain" | "completed";

const exportOperationKey = (revisionId: string) => `${revisionId}:audiotool:${NEXUS_MAPPING_VERSION}`;

async function assertExportAttempt(client: pg.PoolClient, job: JobRecord): Promise<void> {
  const control = await attemptControlCode(client, job, true);
  if (control) throw new JobControlError(control, controlMessage(control));
}

async function upsertExportStep(client: pg.PoolClient, exportId: string, job: JobRecord, stepKey: string, step: ExportStepCheckpoint): Promise<void> {
  await client.query(
    `INSERT INTO project_export_step(export_id,step_key,state,attempt_id,lease_generation,remote_id,evidence)
     VALUES($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT(export_id,step_key) DO UPDATE SET state=EXCLUDED.state,attempt_id=EXCLUDED.attempt_id,
       lease_generation=EXCLUDED.lease_generation,remote_id=COALESCE(EXCLUDED.remote_id,project_export_step.remote_id),
       evidence=EXCLUDED.evidence,updated_at=now()`,
    [exportId, stepKey, step.state, job.attemptId, job.leaseGeneration, step.remoteId ?? null, step.evidence ?? {}]
  );
}

export async function recordExportProgress(job: JobRecord, input: { fidelity: Record<string, unknown>; manifestPath: string; checkpoint?: AudiotoolExportCheckpoint }): Promise<void> {
  if (!job.baseRevisionId) throw new Error("Export job is missing its revision");
  const client = await getPool().connect();
  let committed = false;
  try {
    await client.query("BEGIN");
    await assertExportAttempt(client, job);
    const existing = await client.query<{ id: string; job_id: string; state: ProjectExportState; active_job: boolean }>(
      `SELECT pe.id,pe.job_id,pe.state,
         EXISTS(SELECT 1 FROM job j WHERE j.id=pe.job_id AND j.state='running' AND j.lease_until>now() AND j.deadline_at>now()) AS active_job
       FROM project_export pe WHERE pe.owner_id=$1 AND pe.operation_key=$2 FOR UPDATE`,
      [job.ownerId, exportOperationKey(job.baseRevisionId)]
    );
    const prior = existing.rows[0];
    if (prior && prior.job_id !== job.id) {
      if (prior.state === "completed") throw new Error("EXPORT_ALREADY_COMPLETED");
      if (prior.state === "uncertain") throw new Error("EXPORT_OUTCOME_UNCERTAIN");
      if (prior.state === "exporting" && prior.active_job) throw new Error("EXPORT_OPERATION_IN_PROGRESS");
      if (prior.state === "exporting") {
        await client.query("UPDATE project_export_step SET state='uncertain',updated_at=now() WHERE export_id=$1 AND state='in_flight'", [prior.id]);
        await client.query("UPDATE project_export SET state='uncertain',error_message='A prior worker ended while an Audiotool mutation was in flight.',updated_at=now() WHERE id=$1", [prior.id]);
        await client.query("COMMIT");
        committed = true;
        throw new Error("EXPORT_OUTCOME_UNCERTAIN");
      }
    }
    const remoteProjectId = input.checkpoint?.remoteProjectId;
    const remoteEffects = input.checkpoint ?? {};
    const row = await client.query<{ id: string }>(
      `INSERT INTO project_export(owner_id,project_id,revision_id,job_id,provider,state,fidelity,manifest_path,remote_project_id,remote_effects,operation_key,mapping_version)
       VALUES($1,$2,$3,$4,'audiotool','exporting',$5,$6,$7,$8,$9,$10)
       ON CONFLICT(revision_id,provider) DO UPDATE SET job_id=EXCLUDED.job_id,state='exporting',fidelity=EXCLUDED.fidelity,
         manifest_path=EXCLUDED.manifest_path,remote_project_id=COALESCE(EXCLUDED.remote_project_id,project_export.remote_project_id),
         remote_effects=EXCLUDED.remote_effects,error_message=NULL,operation_key=$9,mapping_version=$10,updated_at=now()
       RETURNING id`,
      [job.ownerId, job.projectId, job.baseRevisionId, job.id, input.fidelity, input.manifestPath, remoteProjectId ?? null, remoteEffects, exportOperationKey(job.baseRevisionId), NEXUS_MAPPING_VERSION]
    );
    const exportId = row.rows[0]?.id;
    if (!exportId) throw new Error("Unable to persist export operation");
    if (input.checkpoint) {
      await upsertExportStep(client, exportId, job, "project:create", input.checkpoint.project);
      for (const [trackId, step] of Object.entries(input.checkpoint.uploads)) await upsertExportStep(client, exportId, job, `upload:${trackId}`, step);
      await upsertExportStep(client, exportId, job, "arrangement:insert", input.checkpoint.arrangement);
    }
    await client.query("COMMIT");
    committed = true;
  } catch (error) {
    if (!committed) await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function exportResumeState(ownerId: string, revisionId: string): Promise<{
  state?: ProjectExportState;
  remoteProjectId?: string;
  remoteUrl?: string;
  errorMessage?: string;
  checkpoint?: AudiotoolExportCheckpoint;
}> {
  const result = await getPool().query("SELECT state,remote_project_id,remote_url,error_message,remote_effects FROM project_export WHERE owner_id=$1 AND revision_id=$2 AND provider='audiotool'", [ownerId, revisionId]);
  const row = result.rows[0];
  const effects = row?.remote_effects && typeof row.remote_effects === "object" ? row.remote_effects as Record<string, unknown> : {};
  let checkpoint = effects.project && effects.uploads && effects.arrangement ? effects as unknown as AudiotoolExportCheckpoint : undefined;
  // Migration compatibility for v2 rows that only persisted the uploaded map.
  // A known remote project/upload can be resumed, while arrangement mutation is
  // deliberately treated as not yet dispatched.
  if (!checkpoint && row?.remote_project_id && effects.uploadedSamples && typeof effects.uploadedSamples === "object") {
    const uploadedSamples = effects.uploadedSamples as Record<string, string>;
    checkpoint = {
      remoteProjectId: String(row.remote_project_id),
      uploadedSamples,
      project: { state: "succeeded", remoteId: String(row.remote_project_id) },
      uploads: Object.fromEntries(Object.entries(uploadedSamples).map(([trackId, remoteId]) => [trackId, { state: "succeeded" as const, remoteId }])),
      arrangement: { state: "never_dispatched" }
    };
  }
  return {
    ...(row?.state ? { state: String(row.state) as ProjectExportState } : {}),
    ...(row?.remote_project_id ? { remoteProjectId: String(row.remote_project_id) } : {}),
    ...(row?.remote_url ? { remoteUrl: String(row.remote_url) } : {}),
    ...(row?.error_message ? { errorMessage: String(row.error_message) } : {}),
    ...(checkpoint ? { checkpoint } : {})
  };
}

export async function commitExportPreparation(job: JobRecord, input: { state: Exclude<ProjectExportState, "exporting">; fidelity: Record<string, unknown>; manifestPath: string; errorMessage?: string; remoteProjectId?: string; remoteUrl?: string; remoteEffects?: unknown }): Promise<void> {
  if (!job.baseRevisionId) throw new Error("Export job is missing its revision");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await assertExportAttempt(client, job);
    await client.query(
      `INSERT INTO project_export(owner_id,project_id,revision_id,job_id,provider,state,fidelity,manifest_path,error_message,remote_project_id,remote_url,remote_effects,operation_key,mapping_version)
       VALUES($1,$2,$3,$4,'audiotool',$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT(revision_id,provider) DO UPDATE SET job_id=EXCLUDED.job_id,state=EXCLUDED.state,fidelity=EXCLUDED.fidelity,
         manifest_path=EXCLUDED.manifest_path,error_message=EXCLUDED.error_message,remote_project_id=COALESCE(EXCLUDED.remote_project_id,project_export.remote_project_id),
         remote_url=COALESCE(EXCLUDED.remote_url,project_export.remote_url),remote_effects=EXCLUDED.remote_effects,
         operation_key=EXCLUDED.operation_key,mapping_version=EXCLUDED.mapping_version,updated_at=now()`,
      [job.ownerId, job.projectId, job.baseRevisionId, job.id, input.state, input.fidelity, input.manifestPath, input.errorMessage ?? null, input.remoteProjectId ?? null, input.remoteUrl ?? null, input.remoteEffects ?? {}, exportOperationKey(job.baseRevisionId), NEXUS_MAPPING_VERSION]
    );
    const jobState = input.state === "failed" ? "failed" : input.state === "uncertain" ? "needs_attention" : "succeeded";
    const errorCode = input.state === "failed" ? "EXPORT_FAILED" : input.state === "uncertain" ? "EXPORT_OUTCOME_UNCERTAIN" : null;
    await client.query("UPDATE job SET state=$2,stage=NULL,result_revision_id=$3,error_code=$4,error_message=$5,lease_until=NULL,lease_owner=NULL,attempt_id=NULL,updated_at=now() WHERE id=$1", [job.id, jobState, job.baseRevisionId, errorCode, input.errorMessage ?? null]);
    await insertJobEvent(client, job.id, jobState === "succeeded" ? "succeeded" : jobState, { localManifestReady: true, exportState: input.state, remoteProjectId: input.remoteProjectId ?? null });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export interface RevisionInput {
  composition: Composition; previewPath: string; stems: Record<string, string>; waveformPeaks: number[]; durationSeconds: number;
  previewHash?: string; peak: number; rms: number; nonSilentRatio: number; title: string; summary: string; protectedTrackHashes: Record<string, string>; producer: Record<string, unknown>;
  analysisRecords?: Array<{ analysis: AudioAnalysis; associateWithRevision: boolean }>;
}

async function persistAudioAnalysis(
  client: pg.PoolClient,
  input: { ownerId: string; projectId: string; revisionId: string | null; analysis: AudioAnalysis }
): Promise<string> {
  const model = input.analysis.model ?? "unconfigured";
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO audio_analysis(owner_id,project_id,revision_id,asset_hash,provider,model,purpose,prompt_version,interval_start,interval_end,measured,observations,uncertainty,status,usage,model_cost_usd)
     VALUES($1,$2,$3,$4,'gemini',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT(owner_id,project_id,asset_hash,provider,model,purpose,prompt_version,interval_start,interval_end,status)
     DO NOTHING RETURNING id`,
    [input.ownerId, input.projectId, input.revisionId, input.analysis.assetHash, model, input.analysis.purpose, input.analysis.promptVersion, input.analysis.inspectedInterval.start, input.analysis.inspectedInterval.end, JSON.stringify(input.analysis.measured), JSON.stringify(input.analysis.observations), input.analysis.uncertainty, input.analysis.status, JSON.stringify(input.analysis.usage), input.analysis.costMicrousd / 1_000_000]
  );
  let analysisId = inserted.rows[0]?.id;
  if (!analysisId) {
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM audio_analysis WHERE owner_id=$1 AND project_id=$2 AND asset_hash=$3 AND provider='gemini'
       AND model=$4 AND purpose=$5 AND prompt_version=$6 AND interval_start=$7 AND interval_end=$8 AND status=$9`,
      [input.ownerId, input.projectId, input.analysis.assetHash, model, input.analysis.purpose, input.analysis.promptVersion, input.analysis.inspectedInterval.start, input.analysis.inspectedInterval.end, input.analysis.status]
    );
    analysisId = existing.rows[0]?.id;
  }
  if (!analysisId) throw new Error("Audio analysis persistence did not resolve an immutable record");
  if (input.revisionId) {
    await client.query(
      `INSERT INTO audio_analysis_revision(analysis_id,revision_id,owner_id,project_id)
       VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [analysisId, input.revisionId, input.ownerId, input.projectId]
    );
  }
  return analysisId;
}

export async function commitRevision(job: JobRecord, input: RevisionInput): Promise<{ revisionId: string; selected: boolean; reused: boolean }> {
  const composition = validateComposition(input.composition);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<{ current_revision_id: string | null; deleted_at: Date | null }>("SELECT current_revision_id,deleted_at FROM project WHERE id=$1 AND owner_id=$2 FOR UPDATE", [job.projectId, job.ownerId]);
    const project = current.rows[0];
    if (!project || project.deleted_at) throw new Error("Project no longer available");
    const jobState = await client.query<{ state: string; lease_generation: number; attempt_id: string | null; lease_owner: string | null; lease_valid: boolean; deadline_valid: boolean; cancellation_requested_at: Date | null }>("SELECT state,lease_generation,attempt_id,lease_owner,lease_until>now() AS lease_valid,deadline_at>now() AS deadline_valid,cancellation_requested_at FROM job WHERE id=$1 FOR UPDATE", [job.id]);
    const active = jobState.rows[0];
    if (active?.cancellation_requested_at || active?.state === "cancel_requested") throw new JobControlError("CANCELLED", "Cancellation fence rejected commit");
    if (!active || active.lease_generation !== job.leaseGeneration || active.attempt_id !== job.attemptId || active.lease_owner !== job.leaseOwner || active.state !== "running" || !active.lease_valid) {
      throw new JobControlError("LEASE_LOST", "Job lease rejected commit");
    }
    if (!active.deadline_valid) throw new JobControlError("DEADLINE_EXCEEDED", "Job deadline rejected commit");
    const compositionHash = canonicalHash(composition);
    const existing = await client.query<{ id: string }>("SELECT id FROM revision WHERE project_id=$1 AND composition_hash=$2", [job.projectId, compositionHash]);
    const ordinalResult = await client.query<{ next: number }>("SELECT COALESCE(MAX(ordinal),0)+1 AS next FROM revision WHERE project_id=$1", [job.projectId]);
    const ordinal = Number(ordinalResult.rows[0]?.next ?? 1);
    const reused = Boolean(existing.rows[0]);
    const id = existing.rows[0]?.id ?? randomUUID();
    if (!reused) {
      await client.query(
        `INSERT INTO revision(id,owner_id,project_id,parent_revision_id,creator_job_id,ordinal,title,composition,composition_hash,preview_path,preview_hash,stems,waveform_peaks,duration_seconds,peak,rms,non_silent_ratio,change_summary,protected_track_hashes,producer)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [id, job.ownerId, job.projectId, job.baseRevisionId, job.id, ordinal, input.title, JSON.stringify(composition), compositionHash, input.previewPath, input.previewHash ?? null, JSON.stringify(input.stems), JSON.stringify(input.waveformPeaks), input.durationSeconds, input.peak, input.rms, input.nonSilentRatio, input.summary, JSON.stringify(input.protectedTrackHashes), JSON.stringify(input.producer)]
      );
    }
    for (const record of input.analysisRecords ?? []) {
      await persistAudioAnalysis(client, {
        ownerId: job.ownerId,
        projectId: job.projectId,
        revisionId: record.associateWithRevision ? id : null,
        analysis: record.analysis
      });
    }
    if (job.baseRevisionId) {
      await client.query(
        `INSERT INTO audio_analysis_revision(analysis_id,revision_id,owner_id,project_id)
         SELECT aar.analysis_id,$2,$3,$4
         FROM audio_analysis_revision aar
         JOIN audio_analysis aa ON aa.id=aar.analysis_id
         WHERE aar.revision_id=$1 AND aa.purpose='source-analysis'
         ON CONFLICT DO NOTHING`,
        [job.baseRevisionId, id, job.ownerId, job.projectId]
      );
    }
    const expected = job.expectedHeadRevisionId;
    const mayAdvance = (project.current_revision_id ?? null) === (expected ?? null);
    if (mayAdvance) await client.query("UPDATE project SET current_revision_id=$2,version=version+1,updated_at=now() WHERE id=$1", [job.projectId, id]);
    await client.query("UPDATE job SET state='succeeded',stage=NULL,result_revision_id=$2,lease_until=NULL,lease_owner=NULL,attempt_id=NULL,updated_at=now() WHERE id=$1", [job.id, id]);
    await insertJobEvent(client, job.id, "succeeded", { revisionId: id, selected: mayAdvance, reused });
    await client.query("COMMIT");
    return { revisionId: id, selected: mayAdvance, reused };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getRevision(ownerId: string, revisionId: string) {
  const result = await getPool().query("SELECT * FROM revision WHERE id=$1 AND owner_id=$2", [revisionId, ownerId]);
  if (!result.rows[0]) throw Object.assign(new Error("Revision not found"), { statusCode: 404 });
  return result.rows[0];
}

export async function listRevisions(ownerId: string, projectId: string) {
  const result = await getPool().query("SELECT id,parent_revision_id,ordinal,title,composition_hash,preview_hash,duration_seconds,peak,rms,waveform_peaks,change_summary,protected_track_hashes,producer,created_at FROM revision WHERE owner_id=$1 AND project_id=$2 ORDER BY ordinal DESC", [ownerId, projectId]);
  return result.rows.map((row) => ({
    id: String(row.id), parentRevisionId: row.parent_revision_id ? String(row.parent_revision_id) : null, ordinal: Number(row.ordinal), title: String(row.title),
    compositionHash: String(row.composition_hash), previewHash: row.preview_hash ? String(row.preview_hash) : null,
    durationSeconds: Number(row.duration_seconds), peak: Number(row.peak), rms: Number(row.rms), waveformPeaks: row.waveform_peaks as number[],
    changeSummary: String(row.change_summary), protectedTrackHashes: row.protected_track_hashes as Record<string, string>, producer: row.producer as Record<string, unknown>,
    audioUrl: `/api/v1/revisions/${String(row.id)}/audio`, createdAt: new Date(row.created_at).toISOString()
  }));
}

export async function getProjectSnapshot(ownerId: string, projectId: string) {
  const project = await requireProject(ownerId, projectId);
  const assets = await getPool().query("SELECT id,name,mime_type,duration_seconds,sample_rate,channels,readiness,provenance,created_at FROM asset WHERE owner_id=$1 AND project_id=$2 ORDER BY created_at DESC", [ownerId, projectId]);
  const revisions = await listRevisions(ownerId, projectId);
  const activeJob = await getPool().query("SELECT id,kind,state,stage,error_code,error_message,result_revision_id,created_at,updated_at FROM job WHERE owner_id=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 1", [ownerId, projectId]);
  const analyses = await getPool().query(
    `SELECT aa.id,COALESCE(aar.revision_id,aa.revision_id) AS revision_id,aa.asset_hash,aa.status,aa.provider,aa.model,
       aa.purpose,aa.prompt_version,aa.measured,aa.observations,aa.uncertainty,aa.usage,aa.model_cost_usd,aa.created_at
     FROM audio_analysis aa
     LEFT JOIN audio_analysis_revision aar ON aar.analysis_id=aa.id
     WHERE aa.owner_id=$1 AND aa.project_id=$2 ORDER BY aa.created_at DESC LIMIT 24`,
    [ownerId, projectId]
  );
  const current = project.currentRevisionId ? await getRevision(ownerId, project.currentRevisionId) : null;
  return {
    project,
    assets: assets.rows.map((row) => ({
      id: String(row.id), name: String(row.name), mimeType: String(row.mime_type), durationSeconds: Number(row.duration_seconds), sampleRate: Number(row.sample_rate),
      channels: Number(row.channels), readiness: String(row.readiness), provenance: String(row.provenance), audioUrl: `/api/v1/assets/${String(row.id)}/audio`, createdAt: new Date(row.created_at).toISOString()
    })),
    revisions,
    analyses: analyses.rows.map((row) => ({
      id: String(row.id), revisionId: row.revision_id ? String(row.revision_id) : null, assetHash: String(row.asset_hash), status: String(row.status), provider: String(row.provider), model: String(row.model),
      purpose: String(row.purpose), promptVersion: String(row.prompt_version), measured: row.measured, observations: row.observations, uncertainty: String(row.uncertainty),
      usage: row.usage, modelCostUsd: Number(row.model_cost_usd), createdAt: new Date(row.created_at).toISOString()
    })),
    latestJob: activeJob.rows[0] ?? null,
    currentRevision: current ? {
      id: String(current.id), title: String(current.title), ordinal: Number(current.ordinal), compositionHash: String(current.composition_hash), previewHash: current.preview_hash ? String(current.preview_hash) : null,
      durationSeconds: Number(current.duration_seconds), waveformPeaks: current.waveform_peaks as number[], composition: current.composition as Composition,
      changeSummary: String(current.change_summary), producer: current.producer as Record<string, unknown>, audioUrl: `/api/v1/revisions/${String(current.id)}/audio`
    } : null
  };
}

export async function recordAudioAnalysis(input: { ownerId: string; projectId: string; revisionId: string | null; analysis: AudioAnalysis }): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await persistAudioAnalysis(client, input);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function jobSnapshot(ownerId: string, jobId: string) {
  const result = await getPool().query("SELECT id,project_id,kind,state,stage,attempts,result_revision_id,error_code,error_message,estimated_cost_usd,actual_cost_usd,created_at,updated_at FROM job WHERE id=$1 AND owner_id=$2", [jobId, ownerId]);
  if (!result.rows[0]) throw Object.assign(new Error("Job not found"), { statusCode: 404 });
  const events = await getPool().query("SELECT sequence,event_type,payload,created_at FROM job_event WHERE job_id=$1 ORDER BY sequence", [jobId]);
  return { ...result.rows[0], events: events.rows };
}

export async function findCommandJob(ownerId: string, projectId: string, kind: JobRecord["kind"], idempotencyKey: string) {
  const result = await getPool().query<{ id: string }>(
    "SELECT id FROM job WHERE owner_id=$1 AND project_id=$2 AND kind=$3 AND idempotency_key=$4",
    [ownerId, projectId, kind, idempotencyKey]
  );
  const id = result.rows[0]?.id;
  return id ? jobSnapshot(ownerId, id) : null;
}

export async function selectRevision(ownerId: string, projectId: string, revisionId: string, expectedHead: string | null): Promise<void> {
  const result = await getPool().query(
    "UPDATE project SET current_revision_id=$3,version=version+1,updated_at=now() WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL AND current_revision_id IS NOT DISTINCT FROM $4 AND EXISTS(SELECT 1 FROM revision WHERE id=$3 AND project_id=$1 AND owner_id=$2) RETURNING id",
    [projectId, ownerId, revisionId, expectedHead]
  );
  if (result.rowCount !== 1) throw Object.assign(new Error("Current version changed; refresh before restoring"), { statusCode: 409 });
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

export async function renderAssets(ownerId: string, projectId: string) {
  const result = await getPool().query<{ id: string; object_path: string }>("SELECT id,object_path FROM asset WHERE owner_id=$1 AND project_id=$2 AND readiness='ready' AND kind='source'", [ownerId, projectId]);
  return result.rows.map((row) => ({ id: row.id, path: row.object_path }));
}
