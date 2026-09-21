import { randomUUID } from "node:crypto";
import type pg from "pg";
import { canonicalHash, validateComposition, type Composition } from "../domain/composition.js";
import type { AudioAnalysis } from "../providers/gemini.js";
import { getConfig } from "../config.js";
import { getPool } from "./pool.js";

export const DEV_SUBJECT = "dev-loopback";

export interface OwnedProject {
  id: string;
  title: string;
  currentRevisionId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface JobRecord {
  id: string;
  ownerId: string;
  projectId: string;
  kind: "generation" | "revision" | "export";
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

export type JobControlCode = "CANCELLED" | "LEASE_LOST" | "DEADLINE_EXCEEDED";

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
  return sequence;
}

export async function devOwnerId(): Promise<string> {
  const result = await getPool().query<{ id: string }>("SELECT id FROM app_user WHERE provider_subject = $1", [DEV_SUBJECT]);
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Development user missing; run pnpm db:migrate");
  return id;
}

export async function listProjects(ownerId: string): Promise<OwnedProject[]> {
  const result = await getPool().query("SELECT id, title, current_revision_id, version, created_at, updated_at FROM project WHERE owner_id=$1 AND deleted_at IS NULL ORDER BY updated_at DESC", [ownerId]);
  return result.rows.map((row) => ({
    id: String(row.id), title: String(row.title), currentRevisionId: row.current_revision_id ? String(row.current_revision_id) : null,
    version: Number(row.version), createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString()
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
    const requestHash = canonicalHash({
      ownerId: input.ownerId,
      projectId: input.projectId,
      kind: input.kind,
      request: input.request,
      baseRevisionId: input.baseRevisionId ?? null,
      expectedHeadRevisionId: expectedHead ?? null
    });
    const existing = await client.query<{ id: string; request_hash: string }>(
      "SELECT id,request_hash FROM job WHERE owner_id=$1 AND project_id=$2 AND kind=$3 AND idempotency_key=$4",
      [input.ownerId, input.projectId, input.kind, input.idempotencyKey]
    );
    if (existing.rows[0]) {
      if (existing.rows[0].request_hash !== requestHash) throw Object.assign(new Error("Idempotency key reused with a different request"), { statusCode: 409 });
      await client.query("COMMIT");
      return { id: existing.rows[0].id, duplicate: true };
    }
    const deadlineSeconds = getConfig().MAX_JOB_SECONDS;
    const result = await client.query<{ id: string }>(
      `INSERT INTO job(owner_id,project_id,kind,idempotency_key,request_hash,request,base_revision_id,expected_head_revision_id,state,deadline_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'queued',now()+make_interval(secs=>$9)) RETURNING id`,
      [input.ownerId, input.projectId, input.kind, input.idempotencyKey, requestHash, input.request, input.baseRevisionId ?? null, expectedHead ?? null, deadlineSeconds]
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

export async function claimNextJob(workerId: string): Promise<JobRecord | null> {
  const leaseSeconds = getConfig().JOB_LEASE_SECONDS;
  const result = await getPool().query(
    `WITH candidate AS (
       SELECT id FROM job
       WHERE (state='queued' OR (state IN ('running','cancel_requested') AND lease_until < now()))
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
  const leaseSeconds = getConfig().JOB_LEASE_SECONDS;
  const result = await getPool().query(
    `UPDATE job SET state=CASE WHEN state='cancel_requested' THEN 'cancel_requested' ELSE 'running' END,
       stage=CASE WHEN state='cancel_requested' THEN NULL WHEN kind='export' THEN 'exporting' ELSE 'analyzing' END,
       lease_owner=$2,lease_generation=lease_generation+1,attempt_id=gen_random_uuid(),lease_until=now()+make_interval(secs=>$3),attempts=attempts+1,updated_at=now()
     WHERE id=$1 AND (state='queued' OR (state IN ('running','cancel_requested') AND lease_until<now()))
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

export async function appendAttemptEvent(job: JobRecord, eventType: string, payload: Record<string, unknown>, stage?: string): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const active = await client.query<{ state: string; cancellation_requested_at: Date | null; deadline_at: Date }>(
      `UPDATE job SET stage=COALESCE($5,stage),updated_at=now()
       WHERE id=$1 AND lease_owner=$2 AND lease_generation=$3 AND attempt_id=$4 AND lease_until>now() AND deadline_at>now()
       RETURNING state,cancellation_requested_at,deadline_at`,
      [job.id, job.leaseOwner, job.leaseGeneration, job.attemptId, stage ?? null]
    );
    const row = active.rows[0];
    if (!row) throw new JobControlError("LEASE_LOST", "Worker lease or deadline rejected progress");
    if (row.cancellation_requested_at || row.state === "cancel_requested") throw new JobControlError("CANCELLED", "Cancellation requested");
    if (row.state !== "running") throw new JobControlError("LEASE_LOST", "Job is no longer running");
    await insertJobEvent(client, job.id, eventType, payload);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function heartbeat(job: JobRecord): Promise<boolean> {
  const leaseSeconds = getConfig().JOB_LEASE_SECONDS;
  const result = await getPool().query(
    `UPDATE job SET lease_until=now()+make_interval(secs=>$5),updated_at=now()
     WHERE id=$1 AND lease_owner=$2 AND lease_generation=$3 AND attempt_id=$4 AND state='running'
       AND cancellation_requested_at IS NULL AND lease_until>now() AND deadline_at>now()`,
    [job.id, job.leaseOwner, job.leaseGeneration, job.attemptId, leaseSeconds]
  );
  return result.rowCount === 1;
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

async function assertExportAttempt(client: pg.PoolClient, job: JobRecord): Promise<void> {
  const active = await client.query(
    `SELECT 1 FROM job WHERE id=$1 AND lease_owner=$2 AND lease_generation=$3 AND attempt_id=$4 AND state='running'
     AND cancellation_requested_at IS NULL AND lease_until>now() AND deadline_at>now() FOR UPDATE`,
    [job.id, job.leaseOwner, job.leaseGeneration, job.attemptId]
  );
  if (active.rowCount !== 1) throw new JobControlError("LEASE_LOST", "Export attempt lost its lease");
}

export async function recordExportProgress(job: JobRecord, input: { fidelity: Record<string, unknown>; manifestPath: string; remoteProjectId?: string; remoteEffects?: Record<string, unknown> }): Promise<void> {
  if (!job.baseRevisionId) throw new Error("Export job is missing its revision");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await assertExportAttempt(client, job);
    await client.query(
      `INSERT INTO project_export(owner_id,project_id,revision_id,job_id,provider,state,fidelity,manifest_path,remote_project_id,remote_effects)
       VALUES($1,$2,$3,$4,'audiotool','exporting',$5,$6,$7,$8)
       ON CONFLICT(revision_id,provider) DO UPDATE SET job_id=EXCLUDED.job_id,state='exporting',fidelity=EXCLUDED.fidelity,
         manifest_path=EXCLUDED.manifest_path,remote_project_id=COALESCE(EXCLUDED.remote_project_id,project_export.remote_project_id),
         remote_effects=EXCLUDED.remote_effects,error_message=NULL,updated_at=now()`,
      [job.ownerId, job.projectId, job.baseRevisionId, job.id, input.fidelity, input.manifestPath, input.remoteProjectId ?? null, input.remoteEffects ?? {}]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function exportResumeState(ownerId: string, revisionId: string): Promise<{ remoteProjectId?: string; uploadedSamples?: Record<string, string> }> {
  const result = await getPool().query("SELECT remote_project_id,remote_effects FROM project_export WHERE owner_id=$1 AND revision_id=$2 AND provider='audiotool'", [ownerId, revisionId]);
  const row = result.rows[0];
  const effects = row?.remote_effects && typeof row.remote_effects === "object" ? row.remote_effects as Record<string, unknown> : {};
  return {
    ...(row?.remote_project_id ? { remoteProjectId: String(row.remote_project_id) } : {}),
    ...(effects.uploadedSamples && typeof effects.uploadedSamples === "object" ? { uploadedSamples: effects.uploadedSamples as Record<string, string> } : {})
  };
}

export async function commitExportPreparation(job: JobRecord, input: { state: Exclude<ProjectExportState, "exporting">; fidelity: Record<string, unknown>; manifestPath: string; errorMessage?: string; remoteProjectId?: string; remoteUrl?: string; remoteEffects?: Record<string, unknown> }): Promise<void> {
  if (!job.baseRevisionId) throw new Error("Export job is missing its revision");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await assertExportAttempt(client, job);
    await client.query(
      `INSERT INTO project_export(owner_id,project_id,revision_id,job_id,provider,state,fidelity,manifest_path,error_message,remote_project_id,remote_url,remote_effects)
       VALUES($1,$2,$3,$4,'audiotool',$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT(revision_id,provider) DO UPDATE SET job_id=EXCLUDED.job_id,state=EXCLUDED.state,fidelity=EXCLUDED.fidelity,
         manifest_path=EXCLUDED.manifest_path,error_message=EXCLUDED.error_message,remote_project_id=COALESCE(EXCLUDED.remote_project_id,project_export.remote_project_id),
         remote_url=COALESCE(EXCLUDED.remote_url,project_export.remote_url),remote_effects=EXCLUDED.remote_effects,updated_at=now()`,
      [job.ownerId, job.projectId, job.baseRevisionId, job.id, input.state, input.fidelity, input.manifestPath, input.errorMessage ?? null, input.remoteProjectId ?? null, input.remoteUrl ?? null, input.remoteEffects ?? {}]
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
  const analyses = await getPool().query("SELECT id,revision_id,asset_hash,status,provider,model,purpose,prompt_version,measured,observations,uncertainty,usage,model_cost_usd,created_at FROM audio_analysis WHERE owner_id=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 12", [ownerId, projectId]);
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
  const model = input.analysis.model ?? "unconfigured";
  await getPool().query(
    `INSERT INTO audio_analysis(owner_id,project_id,revision_id,asset_hash,provider,model,purpose,prompt_version,interval_start,interval_end,measured,observations,uncertainty,status,usage,model_cost_usd)
     VALUES($1,$2,$3,$4,'gemini',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT(owner_id,project_id,asset_hash,provider,model,purpose,prompt_version,interval_start,interval_end)
     DO UPDATE SET revision_id=EXCLUDED.revision_id,measured=EXCLUDED.measured,observations=EXCLUDED.observations,uncertainty=EXCLUDED.uncertainty,status=EXCLUDED.status,usage=EXCLUDED.usage,model_cost_usd=EXCLUDED.model_cost_usd`,
    [input.ownerId, input.projectId, input.revisionId, input.analysis.assetHash, model, input.analysis.purpose, input.analysis.promptVersion, input.analysis.inspectedInterval.start, input.analysis.inspectedInterval.end, JSON.stringify(input.analysis.measured), JSON.stringify(input.analysis.observations), input.analysis.uncertainty, input.analysis.status, JSON.stringify(input.analysis.usage), input.analysis.costMicrousd / 1_000_000]
  );
}

export async function jobSnapshot(ownerId: string, jobId: string) {
  const result = await getPool().query("SELECT id,project_id,kind,state,stage,attempts,result_revision_id,error_code,error_message,estimated_cost_usd,actual_cost_usd,created_at,updated_at FROM job WHERE id=$1 AND owner_id=$2", [jobId, ownerId]);
  if (!result.rows[0]) throw Object.assign(new Error("Job not found"), { statusCode: 404 });
  const events = await getPool().query("SELECT sequence,event_type,payload,created_at FROM job_event WHERE job_id=$1 ORDER BY sequence", [jobId]);
  return { ...result.rows[0], events: events.rows };
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
