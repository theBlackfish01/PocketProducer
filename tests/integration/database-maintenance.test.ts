import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { checkpoint, createNativeJob, createProject, dispatchOutbox, claimJobById, getConfig, getPool, getNativeRevision, nativeSnapshot, jobSnapshot } from "@pocket/core";
import { processJob } from "@pocket/worker";
import { createApi } from "../../apps/api/src/server.js";
import { createDatabaseMaintenance, databaseStorageReport, ensureDatabaseHeadroom, pruneCheckpoints, storagePressure } from "@pocket/core/maintenance";

let ownerId: string;
const projects: string[] = [];
const threads: string[] = [];
const originalLease = getConfig().JOB_LEASE_SECONDS;

beforeAll(async () => {
  getConfig().JOB_LEASE_SECONDS = 45;
  ownerId = (await getPool().query<{ id: string }>("INSERT INTO app_user(provider_subject,display_name) VALUES($1,'Retention test') RETURNING id", [`maintenance-${randomUUID()}`])).rows[0]!.id;
  await checkpoint();
});

afterAll(async () => {
  getConfig().JOB_LEASE_SECONDS = originalLease;
  getConfig().DATABASE_VOLUME_CAPACITY_MB = 0;
  for (const thread of threads) await (await checkpoint()).deleteThread(thread);
  for (const project of projects) {
    await getPool().query("DELETE FROM native_revision_sync WHERE project_id=$1", [project]);
    await getPool().query("DELETE FROM native_sync WHERE project_id=$1", [project]);
    await getPool().query("DELETE FROM native_project_head WHERE project_id=$1", [project]);
    await getPool().query("UPDATE job SET result_native_revision_id=NULL WHERE project_id=$1", [project]);
    await getPool().query("DELETE FROM native_revision WHERE project_id=$1", [project]);
    await getPool().query("DELETE FROM job WHERE project_id=$1", [project]);
    await getPool().query("DELETE FROM project WHERE id=$1", [project]);
  }
  await getPool().query("DELETE FROM app_user WHERE id=$1", [ownerId]);
});

async function addCheckpoint(jobId: string, suffix = `:${randomUUID()}`, namespace = "") {
  const thread = `${jobId}${suffix}`;
  const saver = await checkpoint();
  const saved = await saver.put({ configurable: { thread_id: thread, checkpoint_ns: namespace } }, {
    v: 4, id: randomUUID(), ts: new Date().toISOString(),
    channel_values: { messages: [{ role: "user", content: "Private retention fixture" }] }, channel_versions: { messages: 1 }, versions_seen: {}
  }, { source: "input", step: 0, parents: {} }, { messages: 1 });
  await saver.putWrites(saved, [["messages", [{ role: "assistant", content: "Saved fixture" }]]], "task");
  threads.push(thread);
  return thread;
}

async function completed() {
  const project = await createProject(ownerId, "Retention fixture");
  projects.push(project.id);
  const job = await createNativeJob({ ownerId, projectId: project.id, kind: "native-generation", idempotencyKey: randomUUID(), request: { direction: "Make a spacious rhythmic fixture", sourceAssetIds: [] }, expectedHeadId: null });
  await dispatchOutbox();
  const claimed = await claimJobById(job.id, "retention-fixture");
  expect(claimed).not.toBeNull();
  await processJob(claimed!);
  expect((await jobSnapshot(ownerId, job.id)).state).toBe("succeeded");
  // The deterministic fixture intentionally has no provider graph. Supply the
  // settled graph metadata here so each retention exclusion is tested alone.
  await getPool().query(`INSERT INTO native_producer_completion(job_id,document_hash,step_count,result)
    SELECT creator_job_id,document_hash,1,producer FROM native_revision WHERE creator_job_id=$1`, [job.id]);
  await getPool().query(`INSERT INTO effect(job_id,step,idempotency_key,input_hash,state,provider,model,cost_status,actual_cost_microusd)
    VALUES($1,'test-model','settled-model','fixture','succeeded','openai','gpt-6-luna','observed',42)`, [job.id]);
  await getPool().query("UPDATE job SET updated_at=now()-interval '8 days' WHERE id=$1", [job.id]);
  const thread = await addCheckpoint(job.id);
  return { projectId: project.id, jobId: job.id, thread };
}

it("prunes only settled execution history, preserving versions, steps, ownership and accounting", async () => {
  const fixture = await completed();
  const before = await nativeSnapshot(ownerId, fixture.projectId);
  const steps = await getPool().query("SELECT * FROM native_job_step WHERE job_id=$1", [fixture.jobId]);
  const effects = await getPool().query("SELECT * FROM effect WHERE job_id=$1 ORDER BY id", [fixture.jobId]);
  await addCheckpoint(fixture.jobId, fixture.thread.slice(fixture.jobId.length), "subgraph");
  const dry = await pruneCheckpoints();
  expect(dry.candidateThreads).toBeGreaterThan(0);
  expect(dry.prunedThreads).toBe(0);
  expect(await (await checkpoint()).getTuple({ configurable: { thread_id: fixture.thread } })).toBeDefined();
  const applied = await pruneCheckpoints({ apply: true });
  expect(applied.prunedThreads).toBeGreaterThan(0);
  for (const table of ["checkpoints", "checkpoint_blobs", "checkpoint_writes"]) expect((await getPool().query(`SELECT 1 FROM ${table} WHERE thread_id=$1`, [fixture.thread])).rowCount).toBe(0);
  expect(await nativeSnapshot(ownerId, fixture.projectId)).toEqual(before);
  expect((await getPool().query("SELECT * FROM native_job_step WHERE job_id=$1", [fixture.jobId])).rows).toEqual(steps.rows);
  expect((await getPool().query("SELECT * FROM effect WHERE job_id=$1 ORDER BY id", [fixture.jobId])).rows).toEqual(effects.rows);
  expect((await getNativeRevision(ownerId, fixture.projectId, before.current!.id)).document).toEqual(before.current!.document);
  expect((await pruneCheckpoints({ apply: true })).prunedThreads).toBe(0);
  const revision = await createNativeJob({ ownerId, projectId: fixture.projectId, kind: "native-revision", idempotencyKey: randomUUID(), expectedHeadId: before.current!.id,
    request: { direction: "Make the melody softer", targetPartId: "lead", sourceAssetIds: [], baseNativeRevisionId: before.current!.id, expectedNativeHeadId: before.current!.id } });
  await dispatchOutbox();
  await processJob((await claimJobById(revision.id, "revision-after-retention"))!);
  const revised = await jobSnapshot(ownerId, revision.id);
  expect(revised.state, String(revised.error_message)).toBe("succeeded");
});

it.each(["recent", "paused", "failed", "cancelled", "leased", "uncertain", "reserved", "missing-completion", "copy-uncertain", "unrecognized-thread"])("retains %s history", async (condition) => {
  const f = await completed();
  if (condition === "recent") await getPool().query("UPDATE job SET updated_at=now() WHERE id=$1", [f.jobId]);
  if (["paused", "failed", "cancelled"].includes(condition)) await getPool().query("UPDATE job SET state=$2,updated_at=now() WHERE id=$1", [f.jobId, condition === "paused" ? "needs_attention" : condition]);
  if (condition === "leased") await getPool().query("UPDATE job SET lease_owner='active',lease_until=now()+interval '1 minute' WHERE id=$1", [f.jobId]);
  if (condition === "uncertain" || condition === "reserved") await getPool().query("UPDATE effect SET state=$2,cost_status=$3 WHERE job_id=$1", [f.jobId, condition, condition === "uncertain" ? "unknown" : "observed"]);
  if (condition === "missing-completion") await getPool().query("DELETE FROM native_producer_completion WHERE job_id=$1", [f.jobId]);
  if (condition === "copy-uncertain") await getPool().query("INSERT INTO native_revision_sync(owner_id,project_id,revision_id,state,expected_document_hash) SELECT owner_id,project_id,id,'uncertain',document_hash FROM native_revision WHERE creator_job_id=$1", [f.jobId]);
  if (condition === "unrecognized-thread") {
    await (await checkpoint()).deleteThread(f.thread);
    f.thread = await addCheckpoint(f.jobId, ":unknown-format");
  }
  await pruneCheckpoints({ apply: true });
  expect(await (await checkpoint()).getTuple({ configurable: { thread_id: f.thread } })).toBeDefined();
});

it("skips a locked job and serializes simultaneous cleanup without double deletion", async () => {
  const f = await completed();
  const lock = await getPool().connect();
  try {
    await lock.query("BEGIN");
    await lock.query("SELECT id FROM job WHERE id=$1 FOR UPDATE", [f.jobId]);
    expect((await pruneCheckpoints({ apply: true })).prunedThreads).toBe(0);
  } finally { await lock.query("ROLLBACK"); lock.release(); }
  const runs = await Promise.all([pruneCheckpoints({ apply: true }), pruneCheckpoints({ apply: true })]);
  expect(runs.reduce((sum, r) => sum + r.prunedThreads, 0)).toBe(1);
});

it("rolls back every checkpoint table when cleanup fails midway", async () => {
  const f = await completed();
  await getPool().query(`CREATE FUNCTION maintenance_test_abort() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'intentional retention failure'; END $$`);
  await getPool().query("CREATE TRIGGER maintenance_test_abort BEFORE DELETE ON checkpoint_blobs FOR EACH ROW EXECUTE FUNCTION maintenance_test_abort()");
  try {
    await expect(pruneCheckpoints({ apply: true })).rejects.toThrow("intentional retention failure");
    for (const table of ["checkpoints", "checkpoint_blobs", "checkpoint_writes"]) expect((await getPool().query(`SELECT 1 FROM ${table} WHERE thread_id=$1`, [f.thread])).rowCount).toBeGreaterThan(0);
  } finally {
    await getPool().query("DROP TRIGGER maintenance_test_abort ON checkpoint_blobs");
    await getPool().query("DROP FUNCTION maintenance_test_abort()");
  }
  expect((await pruneCheckpoints({ apply: true })).prunedThreads).toBe(1);
});

it("reports sizes without payloads and gates new work while leaving reads and cancellation available", async () => {
  const report = await databaseStorageReport();
  expect(report.databaseBytes).toBeGreaterThan(0);
  expect(JSON.stringify(report)).not.toContain("Private retention fixture");
  expect([69, 70, 85, 95].map((bytes) => storagePressure(bytes, 100))).toEqual(["normal", "warning", "high", "critical"]);
  const api = await createApi();
  getConfig().DATABASE_VOLUME_CAPACITY_MB = 1;
  try {
    await expect(ensureDatabaseHeadroom()).rejects.toMatchObject({ code: "STORAGE_PRESSURE", statusCode: 503 });
    const projectId = randomUUID();
    for (const action of ["constructions", "revisions", "synchronizations", `requests/${randomUUID()}/continue`]) {
      const reply = await api.inject({ method: "POST", url: `/api/v1/projects/${projectId}/native/${action}`, payload: {} });
      expect(reply.statusCode).toBe(503);
      expect(reply.json().code).toBe("STORAGE_PRESSURE");
    }
    expect((await api.inject({ url: "/healthz" })).statusCode).toBe(200);
    expect((await api.inject({ url: "/api/v1/projects" })).statusCode).toBe(200);
    expect((await api.inject({ method: "POST", url: `/api/v1/jobs/${randomUUID()}/cancel` })).statusCode).not.toBe(503);
    getConfig().DATABASE_VOLUME_CAPACITY_MB = 0;
    await expect(ensureDatabaseHeadroom()).resolves.toBeUndefined();
  } finally { getConfig().DATABASE_VOLUME_CAPACITY_MB = 0; await api.close(); }
});

it("drains only one completed thread per maintenance interval under storage pressure", async () => {
  const first = await completed(), second = await completed();
  const config = getConfig();
  config.CHECKPOINT_RETENTION_ENABLED = true;
  config.DATABASE_VOLUME_CAPACITY_MB = 1;
  try {
    const maintain = createDatabaseMaintenance();
    await maintain();
    const remaining = () => getPool().query("SELECT DISTINCT thread_id FROM checkpoints WHERE thread_id=ANY($1::text[])", [[first.thread, second.thread]]);
    expect((await remaining()).rowCount).toBe(1);
    await maintain();
    expect((await remaining()).rowCount).toBe(1);
  } finally {
    config.CHECKPOINT_RETENTION_ENABLED = false;
    config.DATABASE_VOLUME_CAPACITY_MB = 0;
  }
});


it.each(["needs_attention", "failed", "cancelled"])("expires settled inactive %s history after 24h, preserving bounded discovery", async (state) => {
  const f = await completed();
  const saver = await checkpoint();
  const config = (await saver.getTuple({ configurable: { thread_id: f.thread } }))!.config;
  await saver.putWrites(config, [["messages", [
    { tool_calls: [{ id: "read", name: "read_native_recipe", args: { id: "warm" } }] },
    { tool_call_id: "read", content: "Original local recipe" },
    { tool_calls: [{ id: "score", name: "inspect_native_workspace", args: {} }] },
    { tool_call_id: "score", content: "Mutable score must not survive as current evidence" }
  ]]], "discovery");
  await getPool().query("UPDATE job SET state=$2,updated_at=now()-interval '25 hours' WHERE id=$1", [f.jobId, state]);
  await getPool().query(`INSERT INTO effect(job_id,step,idempotency_key,input_hash,state,provider,model,cost_status,reservation_microusd) VALUES($1,'native-producer-result','wrapper','fixture','dispatched','openai','gpt-6-luna','observed',0)`, [f.jobId]);
  expect((await pruneCheckpoints({ apply: true })).prunedThreads).toBeGreaterThan(0);
  const cache = (await getPool().query("SELECT evidence FROM native_checkpoint_read_cache WHERE job_id=$1", [f.jobId])).rows[0].evidence;
  expect(cache).toEqual([{ tool: "read_native_recipe", arguments: { id: "warm" }, content: "Original local recipe", truncated: false }]);
  expect((await getPool().query("SELECT state FROM effect WHERE job_id=$1 AND step='native-producer-result'", [f.jobId])).rows[0].state).toBe("dispatched");
});

it("cleans orphan writes/blobs and uses one hour for successes without touching recent work", async () => {
  const f = await completed();
  await getPool().query("UPDATE job SET updated_at=now()-interval '59 minutes' WHERE id=$1", [f.jobId]);
  expect((await pruneCheckpoints({ apply: true })).prunedThreads).toBe(0);
  await getPool().query("DELETE FROM checkpoints WHERE thread_id=$1", [f.thread]);
  await getPool().query("UPDATE job SET updated_at=now()-interval '61 minutes' WHERE id=$1", [f.jobId]);
  expect((await pruneCheckpoints({ apply: true })).prunedThreads).toBe(1);
  for (const table of ["checkpoint_writes", "checkpoint_blobs"]) expect((await getPool().query(`SELECT 1 FROM ${table} WHERE thread_id=$1`, [f.thread])).rowCount).toBe(0);
});
