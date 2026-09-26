import { randomUUID } from "node:crypto";
import type pg from "pg";
import { canonicalHash } from "../domain/composition.js";
import { getConfig } from "../config.js";
import { getPool } from "../db/pool.js";
import { JobControlError, type JobRecord } from "../db/repository.js";
import { nativeDiff, nativeDocumentSchema, nativeMusicHash, pinnedContext, type NativeDocument, type NativeOperation } from "./model.js";
import { NATIVE_MAPPING_VERSION } from "./adapter.js";
import type { NativeSampleResources } from "./adapter.js";
import { jobNativeRunLimits, minimumNextNativeReservationUsd, nativeProfileSchema, nativeRunLimits, nativeRunLimitsSchema, originalNativeRequest } from "./profile.js";
import { nativeCreativeStateSchema, nativePlanSchema, nativeStageSchema, type NativeCreativeState, type NativePlan, type NativeStage } from "./plan.js";
import { nativeReviewSchema, type NativeReview } from "./critique.js";
import { appendPublicActivity } from "./activity.js";

export interface NativeRevisionRecord { id: string; parentRevisionId: string | null; ordinal: number; document: NativeDocument; documentHash: string; changeSummary: string; structuralDiff: ReturnType<typeof nativeDiff>; producer: Record<string, unknown>; createdAt: string }
type HeadRow = { revision_id: string };

async function head(client: pg.PoolClient, ownerId: string, projectId: string, lock = false): Promise<string | null> {
  const result = await client.query<HeadRow>(`SELECT revision_id FROM native_project_head WHERE owner_id=$1 AND project_id=$2${lock ? " FOR UPDATE" : ""}`, [ownerId, projectId]);
  return result.rows[0]?.revision_id ?? null;
}

export async function createNativeJob(input: { ownerId: string; projectId: string; kind: "native-generation" | "native-revision" | "native-sync"; idempotencyKey: string; request: Record<string, unknown>; expectedHeadId: string | null }): Promise<{ id: string; duplicate: boolean }> {
  const requestWithLimits = input.kind === "native-sync" ? input.request : { ...input.request, _nativeRun: nativeRunLimits(nativeProfileSchema.parse(input.request.profile ?? "standard")) };
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<{ id: string; request: Record<string, unknown> }>("SELECT id,request FROM job WHERE owner_id=$1 AND project_id=$2 AND kind=$3 AND idempotency_key=$4 FOR UPDATE", [input.ownerId, input.projectId, input.kind, input.idempotencyKey]);
    if (existing.rows[0]) {
      const priorRequest = { ...existing.rows[0].request };
      delete priorRequest._nativeRun;
      delete priorRequest._nativeRunCurrent;
      const priorComparable = input.kind === "native-sync" ? priorRequest : { ...priorRequest, profile: priorRequest.profile ?? "standard" };
      const incomingComparable = input.kind === "native-sync" ? input.request : { ...input.request, profile: input.request.profile ?? "standard" };
      if (canonicalHash(priorComparable) !== canonicalHash(incomingComparable)) throw Object.assign(new Error("Idempotency key reused with a different request"), { statusCode: 409 });
      await client.query("COMMIT");
      return { id: existing.rows[0].id, duplicate: true };
    }
    const priorSameRequest = await client.query<{ id: string; state: string; error_code: string | null }>(
      "SELECT id,state,error_code FROM job WHERE owner_id=$1 AND project_id=$2 AND kind=$3 AND (request - '_nativeRun' - '_nativeRunCurrent')=$4::jsonb ORDER BY created_at DESC LIMIT 1",
      [input.ownerId, input.projectId, input.kind, JSON.stringify(input.request)]
    );
    if (priorSameRequest.rows[0]?.state === "needs_attention") throw Object.assign(new Error("Prior native command needs reconciliation; a new key cannot bypass it"), { statusCode: 409 });
    if (["failed", "cancelled"].includes(priorSameRequest.rows[0]?.state ?? "")) {
      const unknown = await client.query("SELECT 1 FROM effect WHERE job_id=$1 AND (state IN ('dispatched','uncertain') OR cost_status='unknown') AND NOT ($2::boolean AND step='native-producer-result') LIMIT 1", [priorSameRequest.rows[0]!.id, priorSameRequest.rows[0]!.error_code === "NATIVE_ABANDONED"]);
      if (unknown.rowCount) throw Object.assign(new Error("Prior provider outcome or cost is uncertain; reconcile it before a fresh attempt"), { statusCode: 409 });
    }
    const project = await client.query("SELECT id FROM project WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE", [input.projectId, input.ownerId]);
    if (project.rowCount !== 1) throw Object.assign(new Error("Project not found"), { statusCode: 404 });
    // Recheck receipts after waiting for the room lock: concurrent identical keys
    // must return the accepted command rather than fail the active-request guard.
    const raced = await client.query<{ id: string; request: Record<string, unknown> }>("SELECT id,request FROM job WHERE owner_id=$1 AND project_id=$2 AND kind=$3 AND idempotency_key=$4", [input.ownerId, input.projectId, input.kind, input.idempotencyKey]);
    if (raced.rows[0]) {
      const prior = { ...raced.rows[0].request }; delete prior._nativeRun; delete prior._nativeRunCurrent;
      if (canonicalHash({ ...prior, profile: prior.profile ?? "standard" }) !== canonicalHash({ ...input.request, profile: input.request.profile ?? "standard" })) throw Object.assign(new Error("Idempotency key reused with a different request"), { statusCode: 409 });
      await client.query("COMMIT"); return { id: raced.rows[0].id, duplicate: true };
    }
    if (input.kind !== "native-sync") {
      const competing = await client.query("SELECT 1 FROM job WHERE owner_id=$1 AND project_id=$2 AND kind IN ('native-generation','native-revision') AND state IN ('queued','running','cancel_requested','needs_attention') LIMIT 1", [input.ownerId, input.projectId]);
      if (competing.rowCount) throw Object.assign(new Error("A request is already active or waiting for your decision. Open Producer to continue it."), { statusCode: 409 });
      const uncertain = await client.query("SELECT 1 FROM effect e JOIN job j ON j.id=e.job_id WHERE j.project_id=$1 AND j.owner_id=$2 AND j.kind IN ('native-generation','native-revision') AND (e.cost_status='unknown' OR e.state IN ('dispatched','uncertain')) AND e.step<>'native-producer-result' LIMIT 1", [input.projectId, input.ownerId]);
      if (uncertain.rowCount) throw Object.assign(new Error("An earlier request has an uncertain outcome. Review it before starting another."), { statusCode: 409 });
    }
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
    const hash = canonicalHash({ version: "native-command-v1", ...input, request: requestWithLimits });
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO job(owner_id,project_id,kind,idempotency_key,request_hash,request,state,deadline_at)
       VALUES($1,$2,$3,$4,$5,$6,'queued',now()+make_interval(secs=>$7)) RETURNING id`,
      [input.ownerId, input.projectId, input.kind, input.idempotencyKey, hash, requestWithLimits, jobNativeRunLimits(requestWithLimits)?.deadlineSeconds ?? getConfig().MAX_JOB_SECONDS]
    );
    const id = inserted.rows[0]!.id;
    await client.query("INSERT INTO job_event(job_id,sequence,event_type,payload) VALUES($1,1,'accepted',$2)", [id, { message: "Native construction request accepted", expectedNativeHeadId: current }]);
    await client.query("INSERT INTO outbox(job_id,topic) VALUES($1,$2)", [id, `job.${input.kind}`]);
    const baseDocument = current ? (await client.query<{ document: unknown }>("SELECT document FROM native_revision WHERE id=$1 AND owner_id=$2 AND project_id=$3", [current, input.ownerId, input.projectId])).rows[0]?.document : null;
    const base = baseDocument ? nativeDocumentSchema.parse(baseDocument) : null;
    const desired = input.request.protectionChange && typeof input.request.protectionChange === "object" && "desiredPartIds" in input.request.protectionChange && Array.isArray(input.request.protectionChange.desiredPartIds) ? input.request.protectionChange.desiredPartIds : base?.protectedPartIds ?? [];
    const kept = base?.parts.filter((part) => desired.includes(part.id)) ?? [];
    const scope = [base?.sections.find((section) => section.id === input.request.targetSectionId)?.name ?? "Whole piece", base?.parts.find((part) => part.id === input.request.targetPartId)?.name, kept.length ? `Asked to keep ${kept.map((part) => part.name).join(", ")}` : null].filter(Boolean).join(" · ").slice(0, 1_200);
    if (input.kind !== "native-sync") await appendPublicActivity(client, { ...input, jobId: id }, `request:${id}`, {
      version: 1, kind: "request", text: typeof input.request.direction === "string" ? input.request.direction.slice(0, 32_768) : "", baseRevisionId: current,
      profile: nativeProfileSchema.parse(input.request.profile ?? "standard"), sourceIds: assetIds as string[], keptPartIds: kept.map((part) => part.id), scope,
      ...(typeof input.request.targetSectionId === "string" ? { sectionId: input.request.targetSectionId } : {}),
      ...(typeof input.request.targetPartId === "string" ? { partId: input.request.targetPartId } : {}),
    });
    await client.query("COMMIT");
    return { id, duplicate: false };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function abandonNativePartialJob(ownerId: string, projectId: string, jobId: string): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const project = await client.query("SELECT 1 FROM project WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE", [projectId, ownerId]);
    if (!project.rowCount) throw Object.assign(new Error("Session not found"), { statusCode: 404 });
    const row = (await client.query<{ kind: string; state: string; error_code: string | null }>("SELECT kind,state,error_code FROM job WHERE id=$1 AND project_id=$2 AND owner_id=$3 FOR UPDATE", [jobId, projectId, ownerId])).rows[0];
    if (!row || !["native-generation", "native-revision"].includes(row.kind)) throw Object.assign(new Error("Request not found"), { statusCode: 404 });
    if (row.state === "cancelled" && row.error_code === "NATIVE_ABANDONED") { await client.query("COMMIT"); return; }
    if (row.state !== "needs_attention" || row.error_code !== "NATIVE_PARTIAL") throw Object.assign(new Error("Only safely paused work can be abandoned. Stop active work first."), { statusCode: 409 });
    const effects = await client.query<{ id: string; step: string; state: string; cost_status: string; reservation_microusd: string }>("SELECT id,step,state,cost_status,reservation_microusd::text FROM effect WHERE job_id=$1 FOR UPDATE", [jobId]);
    if (effects.rows.some((effect) => effect.step !== "native-producer-result" && (effect.cost_status === "unknown" || ["dispatched", "uncertain"].includes(effect.state)))) throw Object.assign(new Error("An external outcome is still uncertain; reconcile it before abandoning this request."), { statusCode: 409 });
    // Unlike continuation, abandonment need not match the old head. It cannot
    // accept music or spend: retain every step, effect and charged/reserved amount.
    await client.query("UPDATE job SET state='cancelled',stage=NULL,error_code='NATIVE_ABANDONED',error_message=NULL,cancellation_requested_at=COALESCE(cancellation_requested_at,now()),lease_until=NULL,lease_owner=NULL,attempt_id=NULL,lease_generation=lease_generation+1,updated_at=now() WHERE id=$1", [jobId]);
    await client.query("INSERT INTO job_event(job_id,sequence,event_type,payload) SELECT id,next_event_sequence,'abandoned',$2 FROM job WHERE id=$1", [jobId, { message: "Paused work abandoned explicitly; saved music, draft and spending retained" }]);
    await client.query("UPDATE job SET next_event_sequence=next_event_sequence+1 WHERE id=$1", [jobId]);
    await appendPublicActivity(client, { ownerId, projectId, jobId }, `abandoned:${jobId}`, { version: 1, kind: "stopped", text: "You abandoned this paused request. Saved versions, unfinished work and past spending are retained." });
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function resumeNativePartialJob(ownerId: string, projectId: string, jobId: string): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const project = await client.query("SELECT 1 FROM project WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE", [projectId, ownerId]);
    if (!project.rowCount) throw Object.assign(new Error("Project not found"), { statusCode: 404 });
    const activeConstruction = await client.query("SELECT 1 FROM job WHERE project_id=$1 AND owner_id=$2 AND id<>$3 AND kind IN ('native-generation','native-revision') AND state IN ('queued','running','cancel_requested') LIMIT 1", [projectId, ownerId, jobId]);
    if (activeConstruction.rowCount) throw Object.assign(new Error("Another construction request is active in this session"), { statusCode: 409 });
    const result = await client.query<{ kind: string; state: string; error_code: string | null; error_message: string | null; request: Record<string, unknown> }>("SELECT kind,state,error_code,error_message,request FROM job WHERE id=$1 AND owner_id=$2 AND project_id=$3 FOR UPDATE", [jobId, ownerId, projectId]);
    const job = result.rows[0];
    if (!job) throw Object.assign(new Error("Request not found"), { statusCode: 404 });
    if (!["native-generation", "native-revision"].includes(job.kind) || job.state !== "needs_attention" || job.error_code !== "NATIVE_PARTIAL") throw Object.assign(new Error("Only an unfinished native draft can continue"), { statusCode: 409 });
    const expectedHead = typeof job.request.expectedNativeHeadId === "string" ? job.request.expectedNativeHeadId : null;
    if (await head(client, ownerId, projectId, true) !== expectedHead) throw Object.assign(new Error("The selected version changed; this saved draft cannot continue against a different head"), { statusCode: 409 });
    const effects = await client.query<{ id: string; step: string; state: string; cost_status: string; reservation_microusd: string }>("SELECT id,step,state,cost_status,reservation_microusd::text FROM effect WHERE job_id=$1 FOR UPDATE", [jobId]);
    if (effects.rows.some((effect) => effect.step !== "native-producer-result" && (effect.state !== "succeeded" || effect.cost_status !== "observed"))) throw Object.assign(new Error("A provider outcome still needs reconciliation"), { statusCode: 409 });
    const callCount = effects.rows.filter((effect) => effect.step === "producer-model-call").length;
    const limits = jobNativeRunLimits(job.request);
    if (callCount >= (limits?.maxCalls ?? getConfig().MAX_MODEL_CALLS_PER_JOB)) throw Object.assign(new Error("The request has reached its configured model-call limit; continuation needs an explicitly approved limit change"), { statusCode: 409 });
    if (limits) {
      const amounts = await client.query<{ job_committed: string; site_committed: string }>(`SELECT
        COALESCE(SUM(CASE WHEN job_id=$1 THEN CASE WHEN state IN ('reserved','dispatched','uncertain') THEN GREATEST(reservation_microusd,actual_cost_microusd) ELSE actual_cost_microusd END ELSE 0 END),0)::text AS job_committed,
        COALESCE(SUM(CASE WHEN state IN ('reserved','dispatched','uncertain') THEN GREATEST(reservation_microusd,actual_cost_microusd) ELSE actual_cost_microusd END),0)::text AS site_committed FROM effect`, [jobId]);
      const hasMusic = await client.query("SELECT 1 FROM native_job_step WHERE job_id=$1 LIMIT 1", [jobId]);
      const minimum = minimumNextNativeReservationUsd(limits, Boolean(hasMusic.rowCount));
      if (limits.maxJobCostUsd - Number(amounts.rows[0]!.job_committed) / 1_000_000 < minimum || getConfig().INITIAL_BUILD_API_BUDGET_USD - Number(amounts.rows[0]!.site_committed) / 1_000_000 < minimum) throw Object.assign(new Error("A next model call cannot fit the current request or installation allowance; increase the applicable limit before continuing"), { statusCode: 409 });
    }
    const aggregate = effects.rows.find((effect) => effect.step === "native-producer-result");
    const hasMusic = await client.query("SELECT 1 FROM native_job_step WHERE job_id=$1 LIMIT 1", [jobId]);
    const legacyZeroStepPause = aggregate?.state === "failed" && aggregate.cost_status === "observed" && Number(aggregate.reservation_microusd) === 0 && !hasMusic.rowCount
      && /(?:MODEL_BUDGET_EXCEEDED|MODEL_CALL_LIMIT_EXCEEDED|OPENAI_INPUT_LIMIT_EXCEEDED|OPENAI_INCOMPLETE_RESPONSE)/.test(job.error_message ?? "");
    if (legacyZeroStepPause) {
      // Repair only the old zero-step budget/limit bug under this project's
      // owner/job lock. Model effects above must all be known; no call is sent.
      await client.query("UPDATE effect SET state='dispatched',updated_at=now() WHERE id=$1 AND state='failed'", [aggregate.id]);
      await client.query("INSERT INTO job_event(job_id,sequence,event_type,payload) SELECT id,next_event_sequence,'aggregate_repaired',$2 FROM job WHERE id=$1", [jobId, { message: "Restored the zero-cost producer aggregate for a known zero-step pause; no model call or spending occurred" }]);
      await client.query("UPDATE job SET next_event_sequence=next_event_sequence+1 WHERE id=$1", [jobId]);
    }
    if (aggregate?.state !== "dispatched" && !legacyZeroStepPause) throw Object.assign(new Error("No safely resumable producer effect remains"), { statusCode: 409 });
    await client.query("UPDATE job SET state='queued',stage=NULL,error_code=NULL,error_message=NULL,deadline_at=now()+make_interval(secs=>$2),updated_at=now() WHERE id=$1", [jobId, limits?.deadlineSeconds ?? getConfig().MAX_JOB_SECONDS]);
    await client.query("INSERT INTO job_event(job_id,sequence,event_type,payload) SELECT id,next_event_sequence,'continued',$2 FROM job WHERE id=$1", [jobId, { message: "Continuing confirmed native work under the original request and budget" }]);
    await client.query("UPDATE job SET next_event_sequence=next_event_sequence+1 WHERE id=$1", [jobId]);
    await appendPublicActivity(client, { ownerId, projectId, jobId }, `continued:${jobId}:${randomUUID()}`, { version: 1, kind: "continued", text: "Continuing your saved work with the same request and spending record." });
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function extendNativePartialJob(ownerId: string, projectId: string, jobId: string, requested?: { maxCalls?: number | undefined; maxInputTokens?: number | undefined; maxOutputTokens?: number | undefined; deadlineSeconds?: number | undefined; maxJobCostUsd?: number | undefined }): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const project = await client.query("SELECT 1 FROM project WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE", [projectId, ownerId]);
    if (!project.rowCount) throw Object.assign(new Error("Project not found"), { statusCode: 404 });
    const result = await client.query<{ kind: string; state: string; error_code: string | null; error_message: string | null; request: Record<string, unknown> }>("SELECT kind,state,error_code,error_message,request FROM job WHERE id=$1 AND project_id=$2 AND owner_id=$3 FOR UPDATE", [jobId, projectId, ownerId]);
    const row = result.rows[0];
    if (!row || !["native-generation", "native-revision"].includes(row.kind)) throw Object.assign(new Error("Native construction request not found"), { statusCode: 404 });
    if (row.state !== "needs_attention" || row.error_code !== "NATIVE_PARTIAL") throw Object.assign(new Error("Only a safely paused construction draft can extend its allowance"), { statusCode: 409 });
    const old = jobNativeRunLimits(row.request);
    if (!old || (!requested && old.profile !== "standard")) throw Object.assign(new Error("This request has no available profile extension"), { statusCode: 409 });
    const expectedHead = typeof row.request.expectedNativeHeadId === "string" ? row.request.expectedNativeHeadId : null;
    const currentHead = await head(client, ownerId, projectId, true);
    if (currentHead !== expectedHead) throw Object.assign(new Error("The selected version changed; this draft cannot extend"), { statusCode: 409 });
    const effects = await client.query<{ step: string; state: string; cost_status: string; reservation_microusd: string }>("SELECT step,state,cost_status,reservation_microusd::text FROM effect WHERE job_id=$1 FOR UPDATE", [jobId]);
    if (effects.rows.some((effect) => effect.step !== "native-producer-result" && (effect.state !== "succeeded" || effect.cost_status !== "observed"))) throw Object.assign(new Error("A provider outcome needs reconciliation before extension"), { statusCode: 409 });
    const aggregate = effects.rows.find((effect) => effect.step === "native-producer-result");
    const steps = await client.query("SELECT 1 FROM native_job_step WHERE job_id=$1 LIMIT 1", [jobId]);
    const recoverableLegacy = aggregate?.state === "failed" && aggregate.cost_status === "observed" && Number(aggregate.reservation_microusd) === 0 && !steps.rowCount && /(?:MODEL_BUDGET_EXCEEDED|MODEL_CALL_LIMIT_EXCEEDED|OPENAI_INPUT_LIMIT_EXCEEDED|OPENAI_INCOMPLETE_RESPONSE)/.test(row.error_message ?? "");
    if (aggregate?.state !== "dispatched" && !recoverableLegacy) throw Object.assign(new Error("No safely resumable producer effect remains"), { statusCode: 409 });
    const config = getConfig();
    const target = requested ? { maxCalls: config.MAX_MODEL_CALLS_PER_JOB, maxInputTokens: config.MAX_OPENAI_INPUT_TOKENS, maxOutputTokens: config.NATIVE_MODEL_OUTPUT_TOKENS, deadlineSeconds: config.MAX_JOB_SECONDS, maxJobCostUsd: config.MAX_JOB_COST_USD } : nativeRunLimits("extended");
    if (requested && Object.keys(requested).some((key) => !["maxCalls", "maxInputTokens", "maxOutputTokens", "deadlineSeconds", "maxJobCostUsd"].includes(key))) throw Object.assign(new Error("Unknown allowance dimension"), { statusCode: 422 });
    const proposed = requested ? { ...old, ...Object.fromEntries(Object.entries(requested).filter(([, value]) => value !== undefined)) } : { ...old, profile: "extended" as const, maxCalls: Math.max(old.maxCalls, target.maxCalls), maxInputTokens: Math.max(old.maxInputTokens, target.maxInputTokens), maxOutputTokens: Math.max(old.maxOutputTokens, target.maxOutputTokens), deadlineSeconds: Math.max(old.deadlineSeconds, target.deadlineSeconds), maxJobCostUsd: Math.max(old.maxJobCostUsd, target.maxJobCostUsd) };
    const next = nativeRunLimitsSchema.parse(proposed);
    for (const field of ["maxCalls", "maxInputTokens", "maxOutputTokens", "deadlineSeconds", "maxJobCostUsd"] as const) {
      if (next[field] < old[field] || next[field] > target[field]) throw Object.assign(new Error(`${field} must stay between the captured and installation limits`), { statusCode: 422 });
    }
    if (next.maxCalls === old.maxCalls && next.maxInputTokens === old.maxInputTokens && next.maxOutputTokens === old.maxOutputTokens && next.deadlineSeconds === old.deadlineSeconds && next.maxJobCostUsd === old.maxJobCostUsd) throw Object.assign(new Error("The configured installation has no higher allowance available"), { statusCode: 409 });
    const updatedRequest = { ...originalNativeRequest(row.request), _nativeRunCurrent: next };
    await client.query("UPDATE job SET request=$2::jsonb,updated_at=now() WHERE id=$1", [jobId, JSON.stringify(updatedRequest)]);
    await client.query("INSERT INTO job_event(job_id,sequence,event_type,payload) SELECT id,next_event_sequence,'allowance_extended',$2 FROM job WHERE id=$1", [jobId, { before: { profile: old.profile, maxCalls: old.maxCalls, maxJobCostUsd: old.maxJobCostUsd }, after: { profile: next.profile, maxCalls: next.maxCalls, maxJobCostUsd: next.maxJobCostUsd }, message: "Explicitly extended this saved construction request; prior effects and steps remain attached" }]);
    await client.query("UPDATE job SET next_event_sequence=next_event_sequence+1 WHERE id=$1", [jobId]);
    await appendPublicActivity(client, { ownerId, projectId, jobId }, `allowance:${jobId}:${canonicalHash(next)}`, { version: 1, kind: "allowance", text: "You increased this request’s limits. Past spending stays attached; work resumes only when you choose Continue." });
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

export async function nativeDraftView(ownerId: string, projectId: string, jobId: string) {
  const found = await getPool().query<{ kind: string; state: string; error_code: string | null; error_message: string | null; request: Record<string, unknown> }>(
    "SELECT j.kind,j.state,j.error_code,j.error_message,j.request FROM job j JOIN project p ON p.id=j.project_id WHERE j.id=$1 AND j.owner_id=$2 AND p.owner_id=$2 AND j.project_id=$3 AND p.deleted_at IS NULL",
    [jobId, ownerId, projectId]
  );
  const row = found.rows[0];
  if (!row || !["native-generation", "native-revision"].includes(row.kind)) throw Object.assign(new Error("Native request not found"), { statusCode: 404 });
  const request = row.request;
  const baseRevisionId = typeof request.baseNativeRevisionId === "string" ? request.baseNativeRevisionId : null;
  const direction = typeof request.direction === "string" ? request.direction : "Construct an editable piece";
  const { NativeToolSession, seedNativeDocument } = await import("./producer.js");
  const { applyNativeOperations, setNativeProtections } = await import("./model.js");
  const base = baseRevisionId ? (await getNativeRevision(ownerId, projectId, baseRevisionId)).document : seedNativeDocument(direction);
  const protectionChange = request.protectionChange && typeof request.protectionChange === "object" ? request.protectionChange as { expectedPartIds?: unknown; desiredPartIds?: unknown } : null;
  const requestedLocks = Array.isArray(request.protectedPartIds) ? request.protectedPartIds.filter((value): value is string => typeof value === "string") : [];
  const start = protectionChange && Array.isArray(protectionChange.expectedPartIds) && Array.isArray(protectionChange.desiredPartIds)
    ? setNativeProtections(base, protectionChange.expectedPartIds as string[], protectionChange.desiredPartIds as string[])
    : requestedLocks.length ? applyNativeOperations(base, [{ kind: "protect", partIds: requestedLocks, motifIds: [] }]) : base;
  const session = new NativeToolSession({ id: jobId, request } as JobRecord, start);
  await session.replay();
  const currentHead = await getPool().query<{ revision_id: string }>("SELECT revision_id FROM native_project_head WHERE owner_id=$1 AND project_id=$2", [ownerId, projectId]);
  const expectedHead = typeof request.expectedNativeHeadId === "string" ? request.expectedNativeHeadId : null;
  const headMatches = (currentHead.rows[0]?.revision_id ?? null) === expectedHead;
  const effects = await getPool().query<{ state: string; cost_status: string }>("SELECT state,cost_status FROM effect WHERE job_id=$1 AND step='producer-model-call'", [jobId]);
  const aggregate = await getPool().query<{ state: string; cost_status: string; reservation_microusd: string }>("SELECT state,cost_status,reservation_microusd::text FROM effect WHERE job_id=$1 AND step='native-producer-result'", [jobId]);
  const otherEffects = await getPool().query<{ state: string; cost_status: string }>("SELECT state,cost_status FROM effect WHERE job_id=$1 AND step<>'native-producer-result' AND step<>'producer-model-call'", [jobId]);
  const effectsKnown = [...effects.rows, ...otherEffects.rows].every((effect) => effect.state === "succeeded" && effect.cost_status === "observed");
  const runLimits = jobNativeRunLimits(request);
  const callLimit = runLimits?.maxCalls ?? getConfig().MAX_MODEL_CALLS_PER_JOB;
  const budgetRows = await getPool().query<{ job_spent: string; job_reserved: string; job_unknown: string; site_committed: string }>(`SELECT
    COALESCE(SUM(actual_cost_microusd) FILTER (WHERE job_id=$1),0)::text AS job_spent,
    COALESCE(SUM(GREATEST(reservation_microusd-actual_cost_microusd,0)) FILTER (WHERE job_id=$1 AND state IN ('reserved','dispatched','uncertain')),0)::text AS job_reserved,
    COALESCE(SUM(GREATEST(reservation_microusd,actual_cost_microusd)) FILTER (WHERE job_id=$1 AND cost_status='unknown'),0)::text AS job_unknown,
    COALESCE(SUM(CASE WHEN state IN ('reserved','dispatched','uncertain') THEN GREATEST(reservation_microusd,actual_cost_microusd) ELSE actual_cost_microusd END),0)::text AS site_committed FROM effect`, [jobId]);
  const budget = budgetRows.rows[0]!;
  const spentUsd = Number(budget.job_spent) / 1_000_000;
  const reservedUsd = Number(budget.job_reserved) / 1_000_000;
  const siteRemainingUsd = Math.max(0, getConfig().INITIAL_BUILD_API_BUDGET_USD - Number(budget.site_committed) / 1_000_000);
  const stopped = row.error_message ?? "";
  const aggregateRow = aggregate.rows[0];
  const legacyZeroStepPause = aggregateRow?.state === "failed" && aggregateRow.cost_status === "observed" && Number(aggregateRow.reservation_microusd) === 0 && session.applied.length === 0
    && /(?:MODEL_BUDGET_EXCEEDED|MODEL_CALL_LIMIT_EXCEEDED|OPENAI_INPUT_LIMIT_EXCEEDED|OPENAI_INCOMPLETE_RESPONSE)/.test(stopped);
  const aggregateRecoverable = aggregateRow?.state === "dispatched" || legacyZeroStepPause;
  const minimumNextCallUsd = runLimits ? minimumNextNativeReservationUsd(runLimits, session.applied.length > 0) : 0;
  const siteBudgetBlocked = siteRemainingUsd < minimumNextCallUsd;
  const budgetBlocked = siteBudgetBlocked || (runLimits?.maxJobCostUsd ?? 0) - spentUsd - reservedUsd < minimumNextCallUsd;
  const inputBlocked = /OPENAI_INPUT_LIMIT_EXCEEDED/.test(stopped) && (runLimits?.maxInputTokens ?? 0) <= (jobNativeRunLimits(originalNativeRequest(request))?.maxInputTokens ?? 0);
  const outputBlocked = /OPENAI_INCOMPLETE_RESPONSE/.test(stopped) && (runLimits?.maxOutputTokens ?? 0) <= (jobNativeRunLimits(originalNativeRequest(request))?.maxOutputTokens ?? 0);
  const canContinue = row.state === "needs_attention" && row.error_code === "NATIVE_PARTIAL" && headMatches && aggregateRecoverable && effects.rows.length < callLimit && effectsKnown && !budgetBlocked && !inputBlocked && !outputBlocked;
  const config = getConfig();
  const target = runLimits?.profile === "standard" ? nativeRunLimits("extended") : null;
  const maximum = { maxCalls: config.MAX_MODEL_CALLS_PER_JOB, maxInputTokens: config.MAX_OPENAI_INPUT_TOKENS, maxOutputTokens: config.NATIVE_MODEL_OUTPUT_TOKENS, deadlineSeconds: config.MAX_JOB_SECONDS, maxJobCostUsd: config.MAX_JOB_COST_USD };
  const canExtend = row.state === "needs_attention" && row.error_code === "NATIVE_PARTIAL" && headMatches && aggregateRecoverable && effectsKnown && !siteBudgetBlocked && !!runLimits && (Object.keys(maximum) as Array<keyof typeof maximum>).some((field) => maximum[field] > runLimits[field]);
  const continuationReason = canContinue ? null : !headMatches ? "The selected version changed; this draft cannot continue against a different version." : !effectsKnown ? "A provider outcome needs reconciliation before continuation." : !aggregateRecoverable ? "This request has no safely resumable producer state; its original stop reason remains available." : siteBudgetBlocked ? "The installation-wide API allowance cannot reserve another call; increasing this request alone will not help." : effects.rows.length >= callLimit ? "This request has used its captured model-call allowance; increase it before continuing." : budgetBlocked ? "This request's own cost allowance is exhausted; increase it explicitly before continuing." : inputBlocked || outputBlocked ? "This request needs a higher input or output allowance before continuing." : row.state !== "needs_attention" ? "This request is not waiting for continuation." : "This draft cannot safely continue.";
  return { jobId, state: row.state, selected: false, baseRevisionId, headMatches, stepCount: session.applied.length, document: session.applied.length ? session.document : null, documentHash: session.applied.length ? canonicalHash(session.document) : null, plan: await loadNativePlan(jobId), runLimits, budget: { spentUsd, reservedUsd, unknownUsd: Number(budget.job_unknown) / 1_000_000, siteRemainingUsd, minimumNextCallUsd, modelCalls: effects.rows.length }, extensionCeiling: maximum, suggestedProfileExtension: target, canContinue, canExtend, continuationReason, stopReason: stopped };
}

export async function loadNativePlan(jobId: string): Promise<{ plan: NativePlan; stage: NativeStage; inspectedDocumentHash: string | null; review: NativeReview | null; reviewCount: number } | null> {
  const result = await getPool().query<{ plan: unknown; stage: string; inspected_document_hash: string | null; creative_review: unknown; creative_review_count: number }>("SELECT plan,stage,inspected_document_hash,creative_review,creative_review_count FROM native_job_plan WHERE job_id=$1", [jobId]);
  const row = result.rows[0];
  return row ? { plan: nativePlanSchema.parse(row.plan), stage: nativeStageSchema.parse(row.stage), inspectedDocumentHash: row.inspected_document_hash, review: row.creative_review ? nativeReviewSchema.parse(row.creative_review) : null, reviewCount: row.creative_review_count } : null;
}

export async function saveNativePlan(job: JobRecord, raw: NativePlan): Promise<void> {
  const plan = nativePlanSchema.parse(raw);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await assertSyncLease(client, job);
    await client.query("INSERT INTO native_job_plan(job_id,plan,stage) VALUES($1,$2,'planned') ON CONFLICT(job_id) DO UPDATE SET plan=CASE WHEN EXCLUDED.plan ? 'creativeState' OR NOT (native_job_plan.plan ? 'creativeState') THEN EXCLUDED.plan ELSE jsonb_set(EXCLUDED.plan,'{creativeState}',native_job_plan.plan->'creativeState',true) END,stage='planned',inspected_document_hash=NULL,creative_review=NULL,updated_at=now()", [job.id, JSON.stringify(plan)]);
    await appendPublicActivity(client, { ...job, jobId: job.id }, `plan:${job.id}:${canonicalHash(plan)}`, { version: 1, kind: "approach", text: plan.intent.slice(0, 1_200) });
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function saveNativeCreativeState(job: JobRecord, raw: NativeCreativeState): Promise<void> {
  const state = nativeCreativeStateSchema.parse(raw);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await assertSyncLease(client, job);
    const updated = await client.query("UPDATE native_job_plan SET plan=jsonb_set(plan,'{creativeState}',$2::jsonb,true),creative_review=NULL,updated_at=now() WHERE job_id=$1", [job.id, JSON.stringify(state)]);
    if (!updated.rowCount) throw new Error("Record the durable production plan before saving creative decisions");
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function saveNativeReview(job: JobRecord, review: NativeReview): Promise<void> {
  const checked = nativeReviewSchema.parse(review);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await assertSyncLease(client, job);
    const latest = await client.query<{ result_hash: string }>("SELECT result_hash FROM native_job_step WHERE job_id=$1 ORDER BY ordinal DESC LIMIT 1", [job.id]);
    if (latest.rows[0]?.result_hash !== checked.documentHash) throw new Error("Focused review is stale against confirmed music");
    const plan = await client.query<{ creative_review_count: number }>("SELECT creative_review_count FROM native_job_plan WHERE job_id=$1 FOR UPDATE", [job.id]);
    if (!plan.rows[0]) throw new Error("Record a production plan before reviewing");
    if (checked.modelUsed && plan.rows[0].creative_review_count >= 2) throw new Error("Focused review allowance for this request is exhausted");
    await client.query("UPDATE native_job_plan SET creative_review=$2::jsonb,creative_review_count=creative_review_count+$3,updated_at=now() WHERE job_id=$1", [job.id, JSON.stringify(checked), checked.modelUsed ? 1 : 0]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function advanceNativePlan(job: JobRecord, stage: Exclude<NativeStage, "planned">, documentHash: string): Promise<void> {
  const rank = { planned: 0, building: 1, refining: 2, reviewed: 3 };
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await assertSyncLease(client, job);
    const current = await client.query<{ stage: NativeStage }>("SELECT stage FROM native_job_plan WHERE job_id=$1 FOR UPDATE", [job.id]);
    if (!current.rows[0]) throw new Error("Record a producer plan before advancing its stage");
    if (rank[stage] < rank[current.rows[0].stage]) throw new Error("Producer stage cannot move backwards");
    await client.query("UPDATE native_job_plan SET stage=$2,inspected_document_hash=$3,updated_at=now() WHERE job_id=$1", [job.id, stage, documentHash]);
    await appendPublicActivity(client, { ...job, jobId: job.id }, `approach-stage:${job.id}:${stage}:${documentHash}`, { version: 1, kind: stage === "reviewed" ? "checking" : "working", text: stage === "building" ? "Building the sections around the musical approach." : stage === "refining" ? "Developing the musical detail." : "The musical structure has been reviewed. Final checks come before saving a version." });
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function loadNativeSteps(jobId: string): Promise<Array<{ key: string; operations: NativeOperation[]; predecessorHash: string | null; resultHash: string }>> {
  const result = await getPool().query("SELECT step_key,operations,predecessor_hash,result_hash FROM native_job_step WHERE job_id=$1 ORDER BY ordinal", [jobId]);
  return result.rows.map((row) => ({ key: String(row.step_key), operations: row.operations as NativeOperation[], predecessorHash: typeof row.predecessor_hash === "string" ? row.predecessor_hash : null, resultHash: String(row.result_hash) }));
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

export async function saveNativeStep(job: JobRecord, key: string, operations: NativeOperation[], predecessorHash: string, document: NativeDocument): Promise<void> {
  if (!/^[a-z0-9-]{1,96}$/.test(key)) throw new Error("Invalid native step key");
  const operationHash = canonicalHash(operations);
  const resultHash = canonicalHash(document);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const active = await client.query("SELECT 1 FROM job WHERE id=$1 AND owner_id=$2 AND state='running' AND lease_generation=$3 AND attempt_id=$4 AND lease_owner=$5 AND lease_until>now() AND deadline_at>now() AND cancellation_requested_at IS NULL FOR UPDATE", [job.id, job.ownerId, job.leaseGeneration, job.attemptId, job.leaseOwner]);
    if (active.rowCount !== 1) throw new JobControlError("LEASE_LOST", "Native step lost its lease or was cancelled");
    const prior = await client.query<{ operation_hash: string; result_hash: string; predecessor_hash: string | null }>("SELECT operation_hash,result_hash,predecessor_hash FROM native_job_step WHERE job_id=$1 AND step_key=$2", [job.id, key]);
    if (prior.rows[0]) {
      if (prior.rows[0].operation_hash !== operationHash || prior.rows[0].result_hash !== resultHash || (prior.rows[0].predecessor_hash && prior.rows[0].predecessor_hash !== predecessorHash)) throw new Error("NATIVE_STEP_REPLAY_CONFLICT");
    } else {
      const latest = await client.query<{ ordinal: number; result_hash: string }>("SELECT ordinal,result_hash FROM native_job_step WHERE job_id=$1 ORDER BY ordinal DESC LIMIT 1", [job.id]);
      if (latest.rows[0] && latest.rows[0].result_hash !== predecessorHash) throw new Error("NATIVE_STEP_PREDECESSOR_CONFLICT");
      await client.query("INSERT INTO native_job_step(job_id,step_key,ordinal,predecessor_hash,operation_hash,operations,result_hash,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [job.id, key, (latest.rows[0]?.ordinal ?? 0) + 1, predecessorHash, operationHash, JSON.stringify(operations), resultHash, JSON.stringify({ documentHash: resultHash, applied: operations.length })]);
      const names = [...new Set(operations.flatMap((op) => "partId" in op && typeof op.partId === "string" ? document.parts.filter((part) => part.id === op.partId).map((part) => part.name) : []))];
      await appendPublicActivity(client, { ...job, jobId: job.id }, `step:${job.id}:${key}`, { version: 1, kind: "music", text: names.length ? `Updated ${names.slice(0, 4).join(", ")}${names.length > 4 ? ` and ${names.length - 4} more parts` : ""}.` : `Saved a musical change: ${document.sections.length} sections and ${document.parts.length} parts now in progress.`, step: (latest.rows[0]?.ordinal ?? 0) + 1, documentHash: resultHash });
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
    const version = (await client.query<{ ordinal: number }>("SELECT ordinal FROM native_revision WHERE id=$1", [revisionId])).rows[0]!.ordinal;
    await appendPublicActivity(client, { ...job, jobId: job.id }, `saved:${job.id}`, { version: 1, kind: "saved", text: `Saved Version ${version}.${selected ? " It is now your current arrangement." : " Your selected version has not changed."}`, revisionId, baseRevisionId: expected, ordinal: version, selected });
    await client.query("COMMIT");
    return { revisionId, selected };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function selectNativeRevision(ownerId: string, projectId: string, revisionId: string, expectedHeadId: string): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const project = await client.query("SELECT 1 FROM project WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE", [projectId, ownerId]);
    if (!project.rowCount) throw Object.assign(new Error("Session not found"), { statusCode: 404 });
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
    const selectedVersion = (await client.query<{ ordinal: number; version: number }>("SELECT r.ordinal,h.version FROM native_revision r JOIN native_project_head h ON h.revision_id=r.id WHERE r.id=$1 AND h.project_id=$2", [revisionId, projectId])).rows[0]!;
    await appendPublicActivity(client, { ownerId, projectId }, `selection:${selectedVersion.version}`, { version: 1, kind: "selected", text: `You chose Version ${selectedVersion.ordinal} as your current arrangement.`, revisionId, ordinal: selectedVersion.ordinal, selected: true });
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
