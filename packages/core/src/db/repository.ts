import { randomUUID } from "node:crypto";
import type pg from "pg";
import { canonicalHash, validateComposition, type Composition } from "../domain/composition.js";
import type { AudioAnalysis } from "../providers/gemini.js";
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
  leaseGeneration: number;
  attempts: number;
  cancellationRequestedAt: string | null;
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
  const requestHash = canonicalHash(input.request);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM project WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE", [input.projectId, input.ownerId]);
    const existing = await client.query<{ id: string; request_hash: string }>("SELECT id,request_hash FROM job WHERE owner_id=$1 AND kind=$2 AND idempotency_key=$3", [input.ownerId, input.kind, input.idempotencyKey]);
    if (existing.rows[0]) {
      if (existing.rows[0].request_hash !== requestHash) throw Object.assign(new Error("Idempotency key reused with a different request"), { statusCode: 409 });
      await client.query("COMMIT");
      return { id: existing.rows[0].id, duplicate: true };
    }
    const result = await client.query<{ id: string }>(
      "INSERT INTO job(owner_id,project_id,kind,idempotency_key,request_hash,request,base_revision_id,expected_head_revision_id,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'queued') RETURNING id",
      [input.ownerId, input.projectId, input.kind, input.idempotencyKey, requestHash, input.request, input.baseRevisionId ?? null, input.expectedHeadRevisionId ?? null]
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error("Job insert failed");
    await client.query("INSERT INTO job_event(job_id,sequence,event_type,payload) VALUES($1,1,'accepted',$2)", [id, { message: "Request accepted" }]);
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
  const result = await getPool().query(
    `WITH candidate AS (
       SELECT id FROM job
       WHERE (state='queued' OR (state='running' AND lease_until < now()))
         AND EXISTS (SELECT 1 FROM outbox WHERE outbox.job_id=job.id AND delivered_at IS NOT NULL)
       ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
     ) UPDATE job SET state='running',stage=CASE WHEN kind='export' THEN 'exporting' ELSE 'analyzing' END,
       lease_owner=$1,lease_generation=lease_generation+1,lease_until=now()+interval '45 seconds',attempts=attempts+1,updated_at=now()
     WHERE id=(SELECT id FROM candidate)
     RETURNING id,owner_id,project_id,kind,state,stage,request,base_revision_id,expected_head_revision_id,lease_generation,attempts,cancellation_requested_at`,
    [workerId]
  );
  const row = result.rows[0];
  return row ? {
    id: String(row.id), ownerId: String(row.owner_id), projectId: String(row.project_id), kind: row.kind as JobRecord["kind"],
    state: String(row.state), stage: row.stage ? String(row.stage) : null, request: row.request as Record<string, unknown>,
    baseRevisionId: row.base_revision_id ? String(row.base_revision_id) : null, expectedHeadRevisionId: row.expected_head_revision_id ? String(row.expected_head_revision_id) : null,
    leaseGeneration: Number(row.lease_generation), attempts: Number(row.attempts), cancellationRequestedAt: row.cancellation_requested_at ? new Date(row.cancellation_requested_at).toISOString() : null
  } : null;
}

export async function appendJobEvent(jobId: string, eventType: string, payload: Record<string, unknown>, stage?: string): Promise<void> {
  await getPool().query(
    `WITH next AS (SELECT COALESCE(MAX(sequence),0)+1 AS sequence FROM job_event WHERE job_id=$1)
     INSERT INTO job_event(job_id,sequence,event_type,payload) SELECT $1,sequence,$2,$3 FROM next`, [jobId, eventType, payload]
  );
  if (stage) await getPool().query("UPDATE job SET stage=$2,updated_at=now() WHERE id=$1", [jobId, stage]);
}

export async function heartbeat(job: JobRecord, workerId: string): Promise<boolean> {
  const result = await getPool().query("UPDATE job SET lease_until=now()+interval '45 seconds',updated_at=now() WHERE id=$1 AND lease_owner=$2 AND lease_generation=$3 AND state='running'", [job.id, workerId, job.leaseGeneration]);
  return result.rowCount === 1;
}

export async function isCancelled(job: JobRecord): Promise<boolean> {
  const result = await getPool().query<{ state: string; cancellation_requested_at: Date | null }>("SELECT state,cancellation_requested_at FROM job WHERE id=$1", [job.id]);
  return Boolean(result.rows[0]?.cancellation_requested_at) || result.rows[0]?.state === "cancel_requested";
}

export async function failJob(job: JobRecord, code: string, message: string): Promise<void> {
  await getPool().query("UPDATE job SET state='failed',stage=NULL,error_code=$2,error_message=$3,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_generation=$4", [job.id, code, message.slice(0, 500), job.leaseGeneration]);
  await appendJobEvent(job.id, "failed", { code, message: message.slice(0, 240) });
}

export async function cancelJob(ownerId: string, jobId: string): Promise<void> {
  const result = await getPool().query("UPDATE job SET state=CASE WHEN state IN ('queued','running') THEN 'cancel_requested' ELSE state END,cancellation_requested_at=CASE WHEN state IN ('queued','running') THEN now() ELSE cancellation_requested_at END,updated_at=now() WHERE id=$1 AND owner_id=$2 RETURNING state", [jobId, ownerId]);
  if (!result.rows[0]) throw Object.assign(new Error("Job not found"), { statusCode: 404 });
}

export async function commitCancelled(job: JobRecord): Promise<void> {
  await getPool().query("UPDATE job SET state='cancelled',stage=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_generation=$2", [job.id, job.leaseGeneration]);
  await appendJobEvent(job.id, "cancelled", { message: "Request cancelled before commit" });
}

export interface RevisionInput {
  composition: Composition; previewPath: string; stems: Record<string, string>; waveformPeaks: number[]; durationSeconds: number;
  peak: number; rms: number; nonSilentRatio: number; title: string; summary: string; protectedTrackHashes: Record<string, string>; producer: Record<string, unknown>;
}

export async function commitRevision(job: JobRecord, input: RevisionInput): Promise<string> {
  const composition = validateComposition(input.composition);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<{ current_revision_id: string | null; deleted_at: Date | null }>("SELECT current_revision_id,deleted_at FROM project WHERE id=$1 AND owner_id=$2 FOR UPDATE", [job.projectId, job.ownerId]);
    const project = current.rows[0];
    if (!project || project.deleted_at) throw new Error("Project no longer available");
    const jobState = await client.query<{ state: string; lease_generation: number; cancellation_requested_at: Date | null }>("SELECT state,lease_generation,cancellation_requested_at FROM job WHERE id=$1 FOR UPDATE", [job.id]);
    const active = jobState.rows[0];
    if (!active || active.lease_generation !== job.leaseGeneration || active.cancellation_requested_at || active.state !== "running") throw new Error("Job lease or cancellation fence rejected commit");
    const ordinalResult = await client.query<{ next: number }>("SELECT COALESCE(MAX(ordinal),0)+1 AS next FROM revision WHERE project_id=$1", [job.projectId]);
    const ordinal = Number(ordinalResult.rows[0]?.next ?? 1);
    const id = randomUUID();
    await client.query(
      `INSERT INTO revision(id,owner_id,project_id,parent_revision_id,creator_job_id,ordinal,title,composition,composition_hash,preview_path,stems,waveform_peaks,duration_seconds,peak,rms,non_silent_ratio,change_summary,protected_track_hashes,producer)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [id, job.ownerId, job.projectId, job.baseRevisionId, job.id, ordinal, input.title, JSON.stringify(composition), canonicalHash(composition), input.previewPath, JSON.stringify(input.stems), JSON.stringify(input.waveformPeaks), input.durationSeconds, input.peak, input.rms, input.nonSilentRatio, input.summary, JSON.stringify(input.protectedTrackHashes), JSON.stringify(input.producer)]
    );
    const expected = job.kind === "generation" ? project.current_revision_id : job.expectedHeadRevisionId;
    const mayAdvance = (project.current_revision_id ?? null) === (expected ?? null);
    if (mayAdvance) await client.query("UPDATE project SET current_revision_id=$2,version=version+1,updated_at=now() WHERE id=$1", [job.projectId, id]);
    await client.query("UPDATE job SET state='succeeded',stage=NULL,result_revision_id=$2,lease_until=NULL,updated_at=now() WHERE id=$1", [job.id, id]);
    const sequence = await nextSequence(client, job.id);
    await client.query("INSERT INTO job_event(job_id,sequence,event_type,payload) VALUES($1,$2,'succeeded',$3)", [job.id, sequence, { revisionId: id, selected: mayAdvance }]);
    await client.query("COMMIT");
    return id;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function nextSequence(client: pg.PoolClient, jobId: string): Promise<number> {
  const result = await client.query<{ next: number }>("SELECT COALESCE(MAX(sequence),0)+1 AS next FROM job_event WHERE job_id=$1", [jobId]);
  return Number(result.rows[0]?.next ?? 1);
}

export async function getRevision(ownerId: string, revisionId: string) {
  const result = await getPool().query("SELECT * FROM revision WHERE id=$1 AND owner_id=$2", [revisionId, ownerId]);
  if (!result.rows[0]) throw Object.assign(new Error("Revision not found"), { statusCode: 404 });
  return result.rows[0];
}

export async function listRevisions(ownerId: string, projectId: string) {
  const result = await getPool().query("SELECT id,parent_revision_id,ordinal,title,composition_hash,duration_seconds,peak,rms,change_summary,protected_track_hashes,created_at FROM revision WHERE owner_id=$1 AND project_id=$2 ORDER BY ordinal DESC", [ownerId, projectId]);
  return result.rows.map((row) => ({
    id: String(row.id), parentRevisionId: row.parent_revision_id ? String(row.parent_revision_id) : null, ordinal: Number(row.ordinal), title: String(row.title),
    compositionHash: String(row.composition_hash), durationSeconds: Number(row.duration_seconds), peak: Number(row.peak), rms: Number(row.rms),
    changeSummary: String(row.change_summary), protectedTrackHashes: row.protected_track_hashes as Record<string, string>, createdAt: new Date(row.created_at).toISOString()
  }));
}

export async function getProjectSnapshot(ownerId: string, projectId: string) {
  const project = await requireProject(ownerId, projectId);
  const assets = await getPool().query("SELECT id,name,mime_type,duration_seconds,sample_rate,channels,readiness,provenance,created_at FROM asset WHERE owner_id=$1 AND project_id=$2 ORDER BY created_at DESC", [ownerId, projectId]);
  const revisions = await listRevisions(ownerId, projectId);
  const activeJob = await getPool().query("SELECT id,kind,state,stage,error_code,error_message,result_revision_id,created_at,updated_at FROM job WHERE owner_id=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 1", [ownerId, projectId]);
  const analyses = await getPool().query("SELECT id,revision_id,status,provider,model,purpose,prompt_version,measured,observations,uncertainty,usage,model_cost_usd,created_at FROM audio_analysis WHERE owner_id=$1 AND project_id=$2 ORDER BY created_at DESC LIMIT 12", [ownerId, projectId]);
  const current = project.currentRevisionId ? await getRevision(ownerId, project.currentRevisionId) : null;
  return { project, assets: assets.rows, revisions, analyses: analyses.rows, latestJob: activeJob.rows[0] ?? null, currentRevision: current };
}

export async function recordAudioAnalysis(input: { ownerId: string; projectId: string; revisionId: string; analysis: AudioAnalysis }): Promise<void> {
  const model = input.analysis.model ?? "unconfigured";
  await getPool().query(
    `INSERT INTO audio_analysis(owner_id,project_id,revision_id,asset_hash,provider,model,purpose,prompt_version,interval_start,interval_end,measured,observations,uncertainty,status,usage,model_cost_usd)
     VALUES($1,$2,$3,$4,'gemini',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,0)
     ON CONFLICT(asset_hash,provider,model,purpose,prompt_version,interval_start,interval_end)
     DO UPDATE SET revision_id=EXCLUDED.revision_id,measured=EXCLUDED.measured,observations=EXCLUDED.observations,uncertainty=EXCLUDED.uncertainty,status=EXCLUDED.status,usage=EXCLUDED.usage`,
    [input.ownerId, input.projectId, input.revisionId, input.analysis.assetHash, model, input.analysis.purpose, input.analysis.promptVersion, input.analysis.inspectedInterval.start, input.analysis.inspectedInterval.end, JSON.stringify(input.analysis.measured), JSON.stringify(input.analysis.observations), input.analysis.uncertainty, input.analysis.status, JSON.stringify(input.analysis.usage)]
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
