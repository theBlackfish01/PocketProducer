import { randomUUID } from "node:crypto";
import type pg from "pg";
import { canonicalHash } from "../domain/composition.js";
import { getConfig } from "../config.js";
import { getPool } from "../db/pool.js";
import { JobControlError, type JobRecord } from "../db/repository.js";
import { nativeDiff, nativeDocumentSchema, nativeMusicHash, pinnedContext, type NativeDocument, type NativeOperation } from "./model.js";
import { NATIVE_MAPPING_VERSION } from "./adapter.js";
import type { NativeSampleResources } from "./adapter.js";

export interface NativeRevisionRecord { id: string; parentRevisionId: string | null; ordinal: number; document: NativeDocument; documentHash: string; changeSummary: string; structuralDiff: ReturnType<typeof nativeDiff>; producer: Record<string, unknown>; createdAt: string }
type HeadRow = { revision_id: string };

async function head(client: pg.PoolClient, ownerId: string, projectId: string, lock = false): Promise<string | null> {
  const result = await client.query<HeadRow>(`SELECT revision_id FROM native_project_head WHERE owner_id=$1 AND project_id=$2${lock ? " FOR UPDATE" : ""}`, [ownerId, projectId]);
  return result.rows[0]?.revision_id ?? null;
}

export async function createNativeJob(input: { ownerId: string; projectId: string; kind: "native-generation" | "native-revision" | "native-sync"; idempotencyKey: string; request: Record<string, unknown>; expectedHeadId: string | null }): Promise<{ id: string; duplicate: boolean }> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<{ id: string; request: Record<string, unknown> }>("SELECT id,request FROM job WHERE owner_id=$1 AND project_id=$2 AND kind=$3 AND idempotency_key=$4 FOR UPDATE", [input.ownerId, input.projectId, input.kind, input.idempotencyKey]);
    if (existing.rows[0]) {
      if (canonicalHash(existing.rows[0].request) !== canonicalHash(input.request)) throw Object.assign(new Error("Idempotency key reused with a different request"), { statusCode: 409 });
      await client.query("COMMIT");
      return { id: existing.rows[0].id, duplicate: true };
    }
    const priorSameRequest = await client.query<{ id: string; state: string }>(
      "SELECT id,state FROM job WHERE owner_id=$1 AND project_id=$2 AND kind=$3 AND request=$4::jsonb ORDER BY created_at DESC LIMIT 1",
      [input.ownerId, input.projectId, input.kind, JSON.stringify(input.request)]
    );
    if (priorSameRequest.rows[0]?.state === "needs_attention") throw Object.assign(new Error("Prior native command needs reconciliation; a new key cannot bypass it"), { statusCode: 409 });
    if (["failed", "cancelled"].includes(priorSameRequest.rows[0]?.state ?? "")) {
      const unknown = await client.query("SELECT 1 FROM effect WHERE job_id=$1 AND (state IN ('dispatched','uncertain') OR cost_status='unknown') LIMIT 1", [priorSameRequest.rows[0]!.id]);
      if (unknown.rowCount) throw Object.assign(new Error("Prior provider outcome or cost is uncertain; reconcile it before a fresh attempt"), { statusCode: 409 });
    }
    const project = await client.query("SELECT id FROM project WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE", [input.projectId, input.ownerId]);
    if (project.rowCount !== 1) throw Object.assign(new Error("Project not found"), { statusCode: 404 });
    const current = await head(client, input.ownerId, input.projectId, true);
    if (current !== input.expectedHeadId) throw Object.assign(new Error("Native head changed; refresh before continuing"), { statusCode: 409 });
    if (input.kind === "native-generation" && current) throw Object.assign(new Error("This room already has a native construction; revise it instead"), { statusCode: 409 });
    if (input.kind !== "native-generation" && !current) throw Object.assign(new Error("Construct a native project first"), { statusCode: 409 });
    if (input.kind === "native-sync") {
      const activeSync = await client.query("SELECT 1 FROM job WHERE owner_id=$1 AND project_id=$2 AND kind='native-sync' AND state IN ('queued','running','cancel_requested') AND request->>'baseNativeRevisionId'=$3", [input.ownerId, input.projectId, current]);
      if (activeSync.rowCount) throw Object.assign(new Error("A native synchronization for this version is already active"), { statusCode: 409 });
      const unresolved = await client.query("SELECT state FROM native_revision_sync WHERE revision_id=$1 AND owner_id=$2 AND project_id=$3", [current, input.ownerId, input.projectId]);
      if (["create_in_flight", "apply_in_flight", "uncertain", "conflict"].includes(String(unresolved.rows[0]?.state ?? ""))) throw Object.assign(new Error("Native remote outcome requires reconciliation before another synchronization command"), { statusCode: 409 });
      const sourceIds = await client.query<{ asset_id: string }>("SELECT ids.source_id::uuid AS asset_id FROM native_revision r, jsonb_array_elements_text(r.document->'sourceAssetIds') AS ids(source_id) WHERE r.id=$1 AND r.owner_id=$2", [current, input.ownerId]);
      if (sourceIds.rows.length) {
        const uncertainSample = await client.query("SELECT 1 FROM native_sample_upload WHERE owner_id=$1 AND project_id=$2 AND asset_id=ANY($3::uuid[]) AND state IN ('in_flight','uncertain') LIMIT 1", [input.ownerId, input.projectId, sourceIds.rows.map((row) => row.asset_id)]);
        if (uncertainSample.rowCount) throw Object.assign(new Error("An owned sample upload has an unknown remote outcome; reconcile before synchronizing"), { statusCode: 409 });
      }
    }
    const assetIds = Array.isArray(input.request.sourceAssetIds) ? input.request.sourceAssetIds : [];
    if (assetIds.length > 24 || assetIds.some((value) => typeof value !== "string")) throw Object.assign(new Error("Invalid source selection"), { statusCode: 422 });
    for (const assetId of assetIds) {
      const asset = await client.query("SELECT 1 FROM asset WHERE id=$1 AND owner_id=$2 AND project_id=$3 AND kind='source' AND readiness='ready'", [assetId, input.ownerId, input.projectId]);
      if (asset.rowCount !== 1) throw Object.assign(new Error("A selected source is unavailable in this room"), { statusCode: 422 });
    }
    const hash = canonicalHash({ version: "native-command-v1", ...input });
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO job(owner_id,project_id,kind,idempotency_key,request_hash,request,state,deadline_at)
       VALUES($1,$2,$3,$4,$5,$6,'queued',now()+make_interval(secs=>$7)) RETURNING id`,
      [input.ownerId, input.projectId, input.kind, input.idempotencyKey, hash, input.request, getConfig().MAX_JOB_SECONDS]
    );
    const id = inserted.rows[0]!.id;
    await client.query("INSERT INTO job_event(job_id,sequence,event_type,payload) VALUES($1,1,'accepted',$2)", [id, { message: "Native construction request accepted", expectedNativeHeadId: current }]);
    await client.query("INSERT INTO outbox(job_id,topic) VALUES($1,$2)", [id, `job.${input.kind}`]);
    await client.query("COMMIT");
    return { id, duplicate: false };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function resumeNativePartialJob(ownerId: string, projectId: string, jobId: string): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const project = await client.query("SELECT 1 FROM project WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE", [projectId, ownerId]);
    if (!project.rowCount) throw Object.assign(new Error("Project not found"), { statusCode: 404 });
    const result = await client.query<{ kind: string; state: string; error_code: string | null; request: Record<string, unknown> }>("SELECT kind,state,error_code,request FROM job WHERE id=$1 AND owner_id=$2 AND project_id=$3 FOR UPDATE", [jobId, ownerId, projectId]);
    const job = result.rows[0];
    if (!job) throw Object.assign(new Error("Request not found"), { statusCode: 404 });
    if (!["native-generation", "native-revision"].includes(job.kind) || job.state !== "needs_attention" || job.error_code !== "NATIVE_PARTIAL") throw Object.assign(new Error("Only an unfinished native draft can continue"), { statusCode: 409 });
    const expectedHead = typeof job.request.expectedNativeHeadId === "string" ? job.request.expectedNativeHeadId : null;
    if (await head(client, ownerId, projectId, true) !== expectedHead) throw Object.assign(new Error("The selected version changed; this saved draft cannot continue against a different head"), { statusCode: 409 });
    const effects = await client.query<{ step: string; state: string; cost_status: string }>("SELECT step,state,cost_status FROM effect WHERE job_id=$1 FOR UPDATE", [jobId]);
    if (effects.rows.some((effect) => effect.step === "producer-model-call" && (effect.state !== "succeeded" || effect.cost_status !== "observed"))) throw Object.assign(new Error("A model outcome still needs reconciliation"), { statusCode: 409 });
    const callCount = effects.rows.filter((effect) => effect.step === "producer-model-call").length;
    if (callCount >= getConfig().MAX_MODEL_CALLS_PER_JOB) throw Object.assign(new Error("The request has reached its configured model-call limit; continuation needs an explicitly approved limit change"), { statusCode: 409 });
    const unfinished = effects.rows.some((effect) => effect.step === "native-producer-result" && effect.state === "dispatched");
    if (!unfinished) throw Object.assign(new Error("No safely resumable producer effect remains"), { statusCode: 409 });
    await client.query("UPDATE job SET state='queued',stage=NULL,error_code=NULL,error_message=NULL,deadline_at=now()+make_interval(secs=>$2),updated_at=now() WHERE id=$1", [jobId, getConfig().MAX_JOB_SECONDS]);
    await client.query("INSERT INTO job_event(job_id,sequence,event_type,payload) SELECT id,next_event_sequence,'continued',$2 FROM job WHERE id=$1", [jobId, { message: "Continuing confirmed native work under the original request and budget" }]);
    await client.query("UPDATE job SET next_event_sequence=next_event_sequence+1 WHERE id=$1", [jobId]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

function rowRevision(row: Record<string, unknown>): NativeRevisionRecord {
  return {
    id: String(row.id), parentRevisionId: typeof row.parent_revision_id === "string" ? row.parent_revision_id : null,
    ordinal: Number(row.ordinal), document: nativeDocumentSchema.parse(row.document), documentHash: String(row.document_hash),
    changeSummary: String(row.change_summary), structuralDiff: row.structural_diff as ReturnType<typeof nativeDiff>,
    producer: row.producer as Record<string, unknown>, createdAt: new Date(row.created_at as string).toISOString()
  };
}

export async function getNativeRevision(ownerId: string, projectId: string, revisionId: string): Promise<NativeRevisionRecord> {
  const result = await getPool().query("SELECT * FROM native_revision WHERE id=$1 AND owner_id=$2 AND project_id=$3", [revisionId, ownerId, projectId]);
  if (!result.rows[0]) throw Object.assign(new Error("Native version not found"), { statusCode: 404 });
  return rowRevision(result.rows[0]);
}

export async function nativeSnapshot(ownerId: string, projectId: string) {
  const project = await getPool().query("SELECT id FROM project WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL", [projectId, ownerId]);
  if (project.rowCount !== 1) throw Object.assign(new Error("Project not found"), { statusCode: 404 });
  const [headResult, versions, sync] = await Promise.all([
    getPool().query("SELECT revision_id,version FROM native_project_head WHERE owner_id=$1 AND project_id=$2", [ownerId, projectId]),
    getPool().query("SELECT * FROM native_revision WHERE owner_id=$1 AND project_id=$2 ORDER BY ordinal DESC", [ownerId, projectId]),
    getPool().query("SELECT revision_id,state,remote_project_name,remote_url,observed_hash,mapping_version,verified_at,error_message,updated_at FROM native_sync WHERE owner_id=$1 AND project_id=$2", [ownerId, projectId])
  ]);
  const currentId = headResult.rows[0]?.revision_id ? String(headResult.rows[0].revision_id) : null;
  const current = currentId ? versions.rows.find((value) => String(value.id) === currentId) : null;
  const remote = sync.rows[0] ? { state: String(sync.rows[0].state), projectId: sync.rows[0].remote_project_name ? String(sync.rows[0].remote_project_name) : null, observedHash: sync.rows[0].observed_hash ? String(sync.rows[0].observed_hash) : null, mappingVersion: sync.rows[0].mapping_version ? String(sync.rows[0].mapping_version) : null, verifiedAt: sync.rows[0].verified_at ? new Date(sync.rows[0].verified_at).toISOString() : null, url: sync.rows[0].remote_url ? String(sync.rows[0].remote_url) : null, revisionId: String(sync.rows[0].revision_id), error: sync.rows[0].error_message ? String(sync.rows[0].error_message) : null } : { state: "local", projectId: null, observedHash: null, mappingVersion: null, verifiedAt: null, url: null, revisionId: null, error: null };
  return {
    currentRevisionId: currentId, headVersion: Number(headResult.rows[0]?.version ?? 0),
    current: current ? rowRevision(current) : null,
    versions: versions.rows.map(rowRevision),
    comparisons: current ? Object.fromEntries(versions.rows.map((value) => [String(value.id), nativeDiff(nativeDocumentSchema.parse(current.document), nativeDocumentSchema.parse(value.document))])) : {},
    context: current ? pinnedContext(nativeDocumentSchema.parse(current.document), currentId, remote) : null,
    synchronization: remote,
    legacyAudio: "Legacy audio, if present, belongs only to its separate four-stem version; native construction has no preview."
  };
}

export async function loadNativeSteps(jobId: string): Promise<Array<{ key: string; operations: NativeOperation[]; resultHash: string }>> {
  const result = await getPool().query("SELECT step_key,operations,result_hash FROM native_job_step WHERE job_id=$1 ORDER BY ordinal", [jobId]);
  return result.rows.map((row) => ({ key: String(row.step_key), operations: row.operations as NativeOperation[], resultHash: String(row.result_hash) }));
}

export async function loadConfirmedNativeModelCalls(jobId: string): Promise<Array<{ usage: { inputTokens: number; outputTokens: number }; costMicrousd: number }> | null> {
  const result = await getPool().query<{ state: string; cost_status: string; output: unknown; actual_cost_microusd: string }>("SELECT state,cost_status,output,actual_cost_microusd::text FROM effect WHERE job_id=$1 AND step='producer-model-call' ORDER BY created_at", [jobId]);
  if (!result.rows.length || result.rows.some((row) => row.state !== "succeeded" || row.cost_status !== "observed")) return null;
  return result.rows.map((row) => {
    const usage = row.output && typeof row.output === "object" && "usage" in row.output ? (row.output).usage : null;
    if (!usage || typeof usage !== "object" || !("inputTokens" in usage) || !("outputTokens" in usage) || typeof usage.inputTokens !== "number" || typeof usage.outputTokens !== "number") throw new Error("Confirmed model effect has no trusted usage evidence");
    return { usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }, costMicrousd: Number(row.actual_cost_microusd) };
  });
}

export async function nativeModelEffectsSafeToContinue(jobId: string): Promise<boolean> {
  const result = await getPool().query<{ state: string; cost_status: string }>("SELECT state,cost_status FROM effect WHERE job_id=$1 AND step='producer-model-call'", [jobId]);
  return result.rows.every((row) => row.state === "succeeded" && row.cost_status === "observed");
}

export async function loadNativeProducerCompletion(jobId: string, documentHash: string, stepCount: number): Promise<unknown> {
  const result = await getPool().query<{ result: unknown }>("SELECT result FROM native_producer_completion WHERE job_id=$1 AND document_hash=$2 AND step_count=$3", [jobId, documentHash, stepCount]);
  return result.rows[0]?.result ?? null;
}

export async function recordNativeProducerCompletion(job: JobRecord, document: NativeDocument, stepCount: number, result: unknown): Promise<void> {
  if (stepCount < 1) throw new Error("A producer cannot complete without a confirmed musical step");
  const documentHash = canonicalHash(document);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await assertSyncLease(client, job);
    const saved = await client.query<{ document_hash: string; step_count: number; result: unknown }>(
      "SELECT document_hash,step_count,result FROM native_producer_completion WHERE job_id=$1 FOR UPDATE", [job.id]
    );
    if (saved.rows[0]) {
      if (saved.rows[0].document_hash !== documentHash || saved.rows[0].step_count !== stepCount || canonicalHash(saved.rows[0].result) !== canonicalHash(result)) throw new Error("NATIVE_COMPLETION_CONFLICT");
    } else await client.query("INSERT INTO native_producer_completion(job_id,document_hash,step_count,result) VALUES($1,$2,$3,$4)", [job.id, documentHash, stepCount, JSON.stringify(result)]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function adoptUnfinishedNativeProducerEffect(job: JobRecord, effectId: string): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await assertSyncLease(client, job);
    const effect = await client.query<{ state: string; step: string; reservation_microusd: string }>("SELECT state,step,reservation_microusd::text FROM effect WHERE id=$1 AND job_id=$2 FOR UPDATE", [effectId, job.id]);
    if (effect.rows[0]?.state !== "dispatched" || effect.rows[0].step !== "native-producer-result" || Number(effect.rows[0].reservation_microusd) !== 0) throw new Error("Native aggregate effect cannot be adopted");
    const calls = await client.query<{ state: string; cost_status: string }>("SELECT state,cost_status FROM effect WHERE job_id=$1 AND step='producer-model-call' FOR UPDATE", [job.id]);
    if (calls.rows.some((row) => row.state !== "succeeded" || row.cost_status !== "observed")) throw new Error("Unknown native model outcome prevents continuation");
    await client.query("UPDATE effect SET attempt_id=$3,lease_generation=$4,updated_at=now() WHERE id=$1 AND job_id=$2", [effectId, job.id, job.attemptId, job.leaseGeneration]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function recoverConfirmedNativeProducerResult(job: JobRecord, effectId: string, output: unknown): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await assertSyncLease(client, job);
    const effect = await client.query<{ state: string; step: string; reservation_microusd: string }>("SELECT state,step,reservation_microusd::text FROM effect WHERE id=$1 AND job_id=$2 FOR UPDATE", [effectId, job.id]);
    if (effect.rows[0]?.state !== "dispatched" || effect.rows[0].step !== "native-producer-result" || Number(effect.rows[0].reservation_microusd) !== 0) throw new Error("Native aggregate effect is not recoverable");
    const completed = await client.query<{ document_hash: string; step_count: number; result: unknown }>("SELECT document_hash,step_count,result FROM native_producer_completion WHERE job_id=$1 FOR UPDATE", [job.id]);
    if (!completed.rows[0] || canonicalHash(completed.rows[0].result) !== canonicalHash((output as { result?: unknown })?.result)) throw new Error("Native creative turn has no matching durable completion evidence");
    const calls = await client.query<{ state: string; cost_status: string }>("SELECT state,cost_status FROM effect WHERE job_id=$1 AND step='producer-model-call' FOR UPDATE", [job.id]);
    if (!calls.rows.length || calls.rows.some((row) => row.state !== "succeeded" || row.cost_status !== "observed")) throw new Error("A native model call outcome is not confirmed; explicit reconciliation is required");
    await client.query("UPDATE effect SET state='succeeded',output=$3,cost_status='observed',actual_cost_microusd=0,cost_usd=0,attempt_id=$4,lease_generation=$5,completed_at=now(),updated_at=now() WHERE id=$1 AND job_id=$2", [effectId, job.id, output, job.attemptId, job.leaseGeneration]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function saveNativeStep(job: JobRecord, key: string, operations: NativeOperation[], document: NativeDocument): Promise<void> {
  if (!/^[a-z0-9-]{1,96}$/.test(key)) throw new Error("Invalid native step key");
  const operationHash = canonicalHash(operations);
  const resultHash = canonicalHash(document);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const active = await client.query("SELECT 1 FROM job WHERE id=$1 AND owner_id=$2 AND state='running' AND lease_generation=$3 AND attempt_id=$4 AND lease_owner=$5 AND lease_until>now() AND deadline_at>now() AND cancellation_requested_at IS NULL FOR UPDATE", [job.id, job.ownerId, job.leaseGeneration, job.attemptId, job.leaseOwner]);
    if (active.rowCount !== 1) throw new JobControlError("LEASE_LOST", "Native step lost its lease or was cancelled");
    const prior = await client.query<{ operation_hash: string; result_hash: string }>("SELECT operation_hash,result_hash FROM native_job_step WHERE job_id=$1 AND step_key=$2", [job.id, key]);
    if (prior.rows[0]) {
      if (prior.rows[0].operation_hash !== operationHash || prior.rows[0].result_hash !== resultHash) throw new Error("NATIVE_STEP_REPLAY_CONFLICT");
    } else {
      const ordinal = await client.query<{ next: number }>("SELECT COALESCE(MAX(ordinal),0)+1 AS next FROM native_job_step WHERE job_id=$1", [job.id]);
      await client.query("INSERT INTO native_job_step(job_id,step_key,ordinal,operation_hash,operations,result_hash,result) VALUES($1,$2,$3,$4,$5,$6,$7)", [job.id, key, ordinal.rows[0]!.next, operationHash, JSON.stringify(operations), resultHash, JSON.stringify({ documentHash: resultHash, applied: operations.length })]);
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function commitNativeRevision(job: JobRecord, document: NativeDocument, changeSummary: string, producer: Record<string, unknown>): Promise<{ revisionId: string; selected: boolean }> {
  const valid = nativeDocumentSchema.parse(document);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const project = await client.query("SELECT id FROM project WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE", [job.projectId, job.ownerId]);
    if (project.rowCount !== 1) throw new Error("Project no longer available");
    const active = await client.query<{ state: string; lease_generation: number; attempt_id: string; lease_owner: string; valid_lease: boolean; valid_deadline: boolean; cancellation_requested_at: Date | null }>("SELECT state,lease_generation,attempt_id,lease_owner,lease_until>now() AS valid_lease,deadline_at>now() AS valid_deadline,cancellation_requested_at FROM job WHERE id=$1 FOR UPDATE", [job.id]);
    const owned = active.rows[0];
    if (owned?.cancellation_requested_at || owned?.state === "cancel_requested") throw new JobControlError("CANCELLED", "Native commit was cancelled");
    if (!owned || owned.state !== "running" || owned.lease_generation !== job.leaseGeneration || owned.attempt_id !== job.attemptId || owned.lease_owner !== job.leaseOwner || !owned.valid_lease) throw new JobControlError("LEASE_LOST", "Native commit lost its lease");
    if (!owned.valid_deadline) throw new JobControlError("DEADLINE_EXCEEDED", "Native commit exceeded its deadline");
    const expected = typeof job.request.expectedNativeHeadId === "string" ? job.request.expectedNativeHeadId : null;
    const current = await head(client, job.ownerId, job.projectId, true);
    const parent = expected ? await client.query("SELECT * FROM native_revision WHERE id=$1 AND owner_id=$2 AND project_id=$3", [expected, job.ownerId, job.projectId]) : null;
    if (expected && !parent?.rows[0]) throw new Error("Native base revision vanished");
    if (parent?.rows[0] && nativeMusicHash(nativeDocumentSchema.parse(parent.rows[0].document)) === nativeMusicHash(valid)) {
      const oldLocks = nativeDocumentSchema.parse(parent.rows[0].document).protectedPartIds;
      const changedLocks = canonicalHash(oldLocks) !== canonicalHash(valid.protectedPartIds);
      if (!changedLocks || !job.request.protectionChange) throw new Error("Native revision changed no musical structure or user-authorized protection");
    }
    for (const region of valid.parts.flatMap((part) => part.sourceRegions)) {
      const asset = await client.query<{ content_hash: string; duration_seconds: number }>("SELECT content_hash,duration_seconds FROM asset WHERE id=$1 AND owner_id=$2 AND project_id=$3 AND kind='source' AND readiness='ready'", [region.assetId, job.ownerId, job.projectId]);
      if (asset.rows[0]?.content_hash !== region.assetHash) throw new Error("Source hash or ownership changed before native commit");
      if (region.sourceStartSeconds + region.sourceDurationSeconds > Number(asset.rows[0].duration_seconds) + 0.001) throw new Error("Native source interval exceeds the owned asset duration");
    }
    const hash = canonicalHash(valid);
    const existing = await client.query<{ id: string }>("SELECT id FROM native_revision WHERE project_id=$1 AND document_hash=$2", [job.projectId, hash]);
    const revisionId = existing.rows[0]?.id ?? randomUUID();
    if (!existing.rows[0]) {
      const ordinal = await client.query<{ next: number }>("SELECT COALESCE(MAX(ordinal),0)+1 AS next FROM native_revision WHERE project_id=$1", [job.projectId]);
      await client.query("INSERT INTO native_revision(id,owner_id,project_id,parent_revision_id,creator_job_id,ordinal,document,document_hash,change_summary,structural_diff,producer) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [revisionId, job.ownerId, job.projectId, expected, job.id, ordinal.rows[0]!.next, JSON.stringify(valid), hash, changeSummary, JSON.stringify(nativeDiff(parent?.rows[0] ? nativeDocumentSchema.parse(parent.rows[0].document) : null, valid)), JSON.stringify(producer)]);
    }
    const selected = current === expected;
    if (selected) {
      await client.query("INSERT INTO native_project_head(owner_id,project_id,revision_id) VALUES($1,$2,$3) ON CONFLICT(project_id) DO UPDATE SET revision_id=EXCLUDED.revision_id,version=native_project_head.version+1,updated_at=now()", [job.ownerId, job.projectId, revisionId]);
      if (job.kind === "native-generation") await client.query("UPDATE project SET title=$3,updated_at=now() WHERE id=$1 AND owner_id=$2 AND title='Untitled listening room'", [job.projectId, job.ownerId, valid.title]);
      await client.query("INSERT INTO native_sync(owner_id,project_id,revision_id,state) VALUES($1,$2,$3,'local') ON CONFLICT(project_id) DO UPDATE SET revision_id=EXCLUDED.revision_id,state='local',remote_project_name=NULL,remote_url=NULL,observed_hash=NULL,mapping_version=NULL,verified_at=NULL,error_message=NULL,updated_at=now()", [job.ownerId, job.projectId, revisionId]);
    }
    await client.query("UPDATE job SET state='succeeded',stage=NULL,result_native_revision_id=$2,lease_owner=NULL,attempt_id=NULL,lease_until=NULL,updated_at=now() WHERE id=$1", [job.id, revisionId]);
    await client.query("UPDATE job SET next_event_sequence=next_event_sequence+1 WHERE id=$1", [job.id]);
    await client.query("INSERT INTO job_event(job_id,sequence,event_type,payload) SELECT id,next_event_sequence-1,'succeeded',$2 FROM job WHERE id=$1", [job.id, { nativeRevisionId: revisionId, selected, audio: "deferred" }]);
    await client.query("COMMIT");
    return { revisionId, selected };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function selectNativeRevision(ownerId: string, projectId: string, revisionId: string, expectedHeadId: string): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query("UPDATE native_project_head SET revision_id=$4,version=version+1,updated_at=now() WHERE owner_id=$1 AND project_id=$2 AND revision_id=$3 AND EXISTS(SELECT 1 FROM native_revision WHERE id=$4 AND owner_id=$1 AND project_id=$2) RETURNING project_id", [ownerId, projectId, expectedHeadId, revisionId]);
    if (updated.rowCount !== 1) throw Object.assign(new Error("Native head changed; refresh before restoring"), { statusCode: 409 });
    await client.query(`UPDATE native_sync SET revision_id=$3,
      state=COALESCE((SELECT CASE WHEN state IN ('verified','conflict','uncertain','failed') THEN state WHEN state IN ('create_in_flight','apply_in_flight') THEN 'uncertain' ELSE 'local' END FROM native_revision_sync WHERE revision_id=$3 AND owner_id=$1 AND project_id=$2),'local'),
      remote_project_name=(SELECT remote_project_name FROM native_revision_sync WHERE revision_id=$3 AND owner_id=$1 AND project_id=$2),
      remote_url=(SELECT remote_url FROM native_revision_sync WHERE revision_id=$3 AND owner_id=$1 AND project_id=$2),
      observed_hash=(SELECT observed_hash FROM native_revision_sync WHERE revision_id=$3 AND owner_id=$1 AND project_id=$2),
      mapping_version=(SELECT mapping_version FROM native_revision_sync WHERE revision_id=$3 AND owner_id=$1 AND project_id=$2),
      verified_at=(SELECT verified_at FROM native_revision_sync WHERE revision_id=$3 AND owner_id=$1 AND project_id=$2),
      error_message=(SELECT error_message FROM native_revision_sync WHERE revision_id=$3 AND owner_id=$1 AND project_id=$2),updated_at=now()
      WHERE owner_id=$1 AND project_id=$2`, [ownerId, projectId, revisionId]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export interface NativeRemoteCheckpoint { state: "create_in_flight" | "created" | "apply_in_flight" | "verified" | "conflict" | "uncertain" | "failed"; createdNow: boolean; remoteProjectName: string | null; remoteUrl: string | null; expectedDocumentHash: string; observedHash: string | null; errorMessage: string | null }

export async function beginOwnedSampleUpload(job: JobRecord, assetId: string, assetHash: string): Promise<{ state: "in_flight" | "ready" | "uncertain"; createdNow: boolean; sampleName: string | null; durationSeconds: number | null }> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await assertSyncLease(client, job);
    const asset = await client.query<{ content_hash: string; duration_seconds: number }>("SELECT content_hash,duration_seconds FROM asset WHERE id=$1 AND owner_id=$2 AND project_id=$3 AND kind='source' AND readiness='ready' FOR UPDATE", [assetId, job.ownerId, job.projectId]);
    if (asset.rows[0]?.content_hash !== assetHash) throw new Error("Owned source hash changed before native upload");
    const prior = await client.query<{ state: "in_flight" | "ready" | "uncertain"; asset_hash: string; sample_name: string | null; duration_seconds: number | null }>("SELECT state,asset_hash,sample_name,duration_seconds FROM native_sample_upload WHERE asset_id=$1 AND owner_id=$2 AND project_id=$3 FOR UPDATE", [assetId, job.ownerId, job.projectId]);
    if (prior.rows[0] && prior.rows[0].asset_hash !== assetHash) throw new Error("Native sample identity changed for owned source");
    if (!prior.rows[0]) await client.query("INSERT INTO native_sample_upload(asset_id,owner_id,project_id,asset_hash,state,dispatch_job_id) VALUES($1,$2,$3,$4,'in_flight',$5)", [assetId, job.ownerId, job.projectId, assetHash, job.id]);
    await client.query("COMMIT");
    return prior.rows[0] ? { state: prior.rows[0].state, createdNow: false, sampleName: prior.rows[0].sample_name, durationSeconds: prior.rows[0].duration_seconds } : { state: "in_flight", createdNow: true, sampleName: null, durationSeconds: Number(asset.rows[0].duration_seconds) };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function finishOwnedSampleUpload(job: JobRecord, assetId: string, sampleName: string, durationSeconds: number): Promise<void> {
  if (!/^samples\/[a-zA-Z0-9-]{1,120}$/.test(sampleName) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("Invalid ready sample metadata");
  const result = await getPool().query("UPDATE native_sample_upload SET state='ready',sample_name=$4,duration_seconds=$5,error_message=NULL,updated_at=now() WHERE asset_id=$1 AND owner_id=$2 AND project_id=$3 AND dispatch_job_id=$6 AND state IN ('in_flight','uncertain')", [assetId, job.ownerId, job.projectId, sampleName, durationSeconds, job.id]);
  if (result.rowCount !== 1) throw new Error("Native sample upload checkpoint changed before ready outcome");
}

export async function markOwnedSampleUncertain(job: JobRecord, assetId: string, reason: string): Promise<void> {
  await getPool().query("UPDATE native_sample_upload SET state='uncertain',error_message=$4,updated_at=now() WHERE asset_id=$1 AND owner_id=$2 AND project_id=$3 AND dispatch_job_id=$5 AND state='in_flight'", [assetId, job.ownerId, job.projectId, reason.slice(0, 300), job.id]);
}

export async function readyOwnedSampleResources(ownerId: string, projectId: string, assetIds: string[]): Promise<NativeSampleResources> {
  if (!assetIds.length) return {};
  const result = await getPool().query<{ asset_id: string; sample_name: string; duration_seconds: number }>("SELECT asset_id,sample_name,duration_seconds FROM native_sample_upload WHERE owner_id=$1 AND project_id=$2 AND asset_id=ANY($3::uuid[]) AND state='ready'", [ownerId, projectId, assetIds]);
  return Object.fromEntries(result.rows.map((row) => [row.asset_id, { sampleName: row.sample_name, durationSeconds: Number(row.duration_seconds) }]));
}

async function assertSyncLease(client: pg.PoolClient, job: JobRecord) {
  const result = await client.query("SELECT 1 FROM job WHERE id=$1 AND owner_id=$2 AND state='running' AND lease_generation=$3 AND attempt_id=$4 AND lease_owner=$5 AND lease_until>now() AND deadline_at>now() AND cancellation_requested_at IS NULL FOR UPDATE", [job.id, job.ownerId, job.leaseGeneration, job.attemptId, job.leaseOwner]);
  if (result.rowCount !== 1) throw new JobControlError("LEASE_LOST", "Native sync lost its lease or was cancelled");
}

export async function beginNativeSync(job: JobRecord, revisionHash: string): Promise<NativeRemoteCheckpoint> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await assertSyncLease(client, job);
    const revisionId = String(job.request.baseNativeRevisionId);
    const current = await head(client, job.ownerId, job.projectId, true);
    if (current !== revisionId) throw new JobControlError("LEASE_LOST", "Selected native version changed before synchronization");
    const prior = await client.query("SELECT state,remote_project_name,remote_url,expected_document_hash,observed_hash,error_message FROM native_revision_sync WHERE revision_id=$1 AND owner_id=$2 AND project_id=$3 FOR UPDATE", [revisionId, job.ownerId, job.projectId]);
    if (!prior.rows[0]) {
      await client.query("INSERT INTO native_revision_sync(owner_id,project_id,revision_id,state,expected_document_hash) VALUES($1,$2,$3,'create_in_flight',$4)", [job.ownerId, job.projectId, revisionId, revisionHash]);
      await client.query("UPDATE native_sync SET state='applying',error_message=NULL,updated_at=now() WHERE owner_id=$1 AND project_id=$2 AND revision_id=$3", [job.ownerId, job.projectId, revisionId]);
    } else if (prior.rows[0].expected_document_hash !== revisionHash) throw new Error("Native revision hash changed unexpectedly");
    await client.query("COMMIT");
    const row = prior.rows[0];
    return { state: row?.state ?? "create_in_flight", createdNow: !row, remoteProjectName: row?.remote_project_name ?? null, remoteUrl: row?.remote_url ?? null, expectedDocumentHash: revisionHash, observedHash: row?.observed_hash ?? null, errorMessage: row?.error_message ?? null };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function advanceNativeSync(job: JobRecord, expectedState: NativeRemoteCheckpoint["state"], nextState: NativeRemoteCheckpoint["state"], details: { remoteProjectName?: string; remoteUrl?: string; observedHash?: string; errorMessage?: string } = {}): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await assertSyncLease(client, job);
    const revisionId = String(job.request.baseNativeRevisionId);
    const updated = await client.query(
      `UPDATE native_revision_sync SET state=$4,remote_project_name=COALESCE($5,remote_project_name),remote_url=COALESCE($6,remote_url),observed_hash=COALESCE($7,observed_hash),error_message=$8,updated_at=now()
       WHERE owner_id=$1 AND project_id=$2 AND revision_id=$3 AND state=$9 RETURNING revision_id`,
      [job.ownerId, job.projectId, revisionId, nextState, details.remoteProjectName ?? null, details.remoteUrl ?? null, details.observedHash ?? null, details.errorMessage ?? null, expectedState]
    );
    if (updated.rowCount !== 1) throw new Error("NATIVE_SYNC_CHECKPOINT_CONFLICT");
    await client.query("UPDATE native_sync SET state=$4,remote_project_name=COALESCE($5,remote_project_name),remote_url=COALESCE($6,remote_url),observed_hash=COALESCE($7,observed_hash),error_message=$8,updated_at=now() WHERE owner_id=$1 AND project_id=$2 AND revision_id=$3", [job.ownerId, job.projectId, revisionId, nextState === "create_in_flight" || nextState === "created" || nextState === "apply_in_flight" ? "applying" : nextState, details.remoteProjectName ?? null, details.remoteUrl ?? null, details.observedHash ?? null, details.errorMessage ?? null]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function finishNativeSync(job: JobRecord, remoteProjectName: string, remoteUrl: string, observedHash: string, expectedState: "apply_in_flight" | "verified"): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await assertSyncLease(client, job);
    const revisionId = String(job.request.baseNativeRevisionId);
    const updated = await client.query("UPDATE native_revision_sync SET state='verified',remote_project_name=$4,remote_url=$5,observed_hash=$6,mapping_version=$8,verified_at=now(),error_message=NULL,updated_at=now() WHERE owner_id=$1 AND project_id=$2 AND revision_id=$3 AND state=$7 RETURNING revision_id", [job.ownerId, job.projectId, revisionId, remoteProjectName, remoteUrl, observedHash, expectedState, NATIVE_MAPPING_VERSION]);
    if (updated.rowCount !== 1) throw new Error("NATIVE_SYNC_CHECKPOINT_CONFLICT");
    await client.query("UPDATE native_sync SET state='verified',remote_project_name=$4,remote_url=$5,observed_hash=$6,mapping_version=$7,verified_at=now(),error_message=NULL,updated_at=now() WHERE owner_id=$1 AND project_id=$2 AND revision_id=$3", [job.ownerId, job.projectId, revisionId, remoteProjectName, remoteUrl, observedHash, NATIVE_MAPPING_VERSION]);
    await client.query("UPDATE job SET state='succeeded',stage=NULL,lease_owner=NULL,attempt_id=NULL,lease_until=NULL,updated_at=now() WHERE id=$1", [job.id]);
    await client.query("UPDATE job SET next_event_sequence=next_event_sequence+1 WHERE id=$1", [job.id]);
    await client.query("INSERT INTO job_event(job_id,sequence,event_type,payload) SELECT id,next_event_sequence-1,'succeeded',$2 FROM job WHERE id=$1", [job.id, { nativeRevisionId: revisionId, remoteProjectName, synchronization: "verified" }]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
