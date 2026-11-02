import { randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, it } from "vitest";
import { checkpoint, claimJobById, closePool, createNativeJob, createNativeLibrary, createProject, dispatchOutbox, getConfig, getPool, jobSnapshot, loadNativePlan, nativeDraftView, nativeFormOperations, nativeFormSchema, nativePlanSchema, nativeSnapshot, NativeToolSession, resumeNativePartialJob, saveNativePlan, seedNativeDocument } from "@pocket/core";
import { AIMessage, fakeModel } from "@pocket/core/test-support";
import { discardExecutionCheckpoints } from "@pocket/core/maintenance";
import { processJob } from "@pocket/worker";

const config = getConfig(), original = { ...config };
const database = `checkpoint_reset_${randomUUID().replaceAll("-", "")}_test`;
let created = false, owner = "", historicalThread = "";
// A separate database is essential: this command resets ALL execution threads.
// Never touch the shared integration database's fixtures, even in serial runs.
beforeAll(async () => {
  await getPool().query(`CREATE DATABASE "${database}"`);
  created = true;
  await closePool();
  const url = new URL(original.DATABASE_URL);
  url.pathname = `/${database}`;
  config.DATABASE_URL = url.toString();
  config.JOB_LEASE_SECONDS = 45;
  config.HOSTED_MAINTENANCE = true;
  await promisify(execFile)(process.execPath, ["--import", "tsx", "packages/core/src/db/migrate.ts"], { env: { ...process.env, DATABASE_URL: config.DATABASE_URL } });
  owner = (await getPool().query<{ id: string }>("INSERT INTO app_user(provider_subject,display_name) VALUES($1,'Reset fixture') RETURNING id", [randomUUID()])).rows[0]!.id;
  historicalThread = `old-${randomUUID()}`;
  await putCheckpoint(historicalThread, randomBytes(256 * 1024).toString("hex"));
}, 30_000);
afterAll(async () => {
  await closePool();
  Object.assign(config, original);
  if (created) await getPool().query(`DROP DATABASE "${database}"`);
});

async function putCheckpoint(thread: string, content = "Fixture") {
  const saver = await checkpoint();
  const saved = await saver.put({ configurable: { thread_id: thread, checkpoint_ns: "" } }, {
    v: 4, id: randomUUID(), ts: new Date().toISOString(), channel_values: { messages: [{ role: "user", content }] }, channel_versions: { messages: 1 }, versions_seen: {}
  }, { source: "input", step: 0, parents: {} }, { messages: 1 });
  await saver.putWrites(saved, [["messages", [{ role: "assistant", content }]]], "task");
}
async function graphCounts() {
  return (await getPool().query("SELECT (SELECT count(*) FROM checkpoints)::int AS checkpoints,(SELECT count(*) FROM checkpoint_blobs)::int AS blobs,(SELECT count(*) FROM checkpoint_writes)::int AS writes")).rows[0];
}
async function tablesBytes() {
  return Number((await getPool().query("SELECT (pg_total_relation_size('checkpoints')+pg_total_relation_size('checkpoint_blobs')+pg_total_relation_size('checkpoint_writes'))::text AS bytes")).rows[0].bytes);
}
async function createJob() {
  const project = await createProject(owner, "Reset test");
  const job = await createNativeJob({ ownerId: owner, projectId: project.id, kind: "native-generation", idempotencyKey: randomUUID(), request: { direction: "A quiet four-bar phrase", sourceAssetIds: [] }, expectedHeadId: null });
  return { ...job, projectId: project.id };
}

it("refuses a reset outside explicit maintenance mode", async () => {
  config.HOSTED_MAINTENANCE = false;
  try { await expect(discardExecutionCheckpoints()).rejects.toThrow("REQUIRES_MAINTENANCE"); }
  finally { config.HOSTED_MAINTENANCE = true; }
  expect(await graphCounts()).toEqual({ checkpoints: 1, blobs: 1, writes: 1 });
});

it.each(["queued", "running", "cancel_requested", "leased-terminal"])("refuses reset with %s work and leaves history intact", async (state) => {
  const job = await createJob();
  await getPool().query("UPDATE job SET state=$2,lease_owner=$3 WHERE id=$1", [job.id, state === "leased-terminal" ? "cancelled" : state, state === "leased-terminal" ? "stale-owner" : null]);
  try { await expect(discardExecutionCheckpoints()).rejects.toThrow("HAS_ACTIVE_JOBS"); }
  finally { await getPool().query("UPDATE job SET state='cancelled',lease_owner=NULL WHERE id=$1", [job.id]); }
  expect(await graphCounts()).toEqual({ checkpoints: 1, blobs: 1, writes: 1 });
});

it("does not race scheduled retention", async () => {
  const other = await getPool().connect();
  try {
    await other.query("BEGIN");
    await other.query("SELECT pg_advisory_xact_lock(hashtext('pocket-checkpoint-retention'))");
    await expect(discardExecutionCheckpoints()).rejects.toThrow("MAINTENANCE_BUSY");
  } finally { await other.query("ROLLBACK"); other.release(); }
});

it("rolls back all three tables when truncation fails", async () => {
  const before = await graphCounts();
  await getPool().query("CREATE FUNCTION fail_reset() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END $$; CREATE TRIGGER refuse_reset AFTER TRUNCATE ON checkpoints FOR EACH STATEMENT EXECUTE FUNCTION fail_reset()");
  try { await expect(discardExecutionCheckpoints()).rejects.toThrow("fixture failure"); }
  finally { await getPool().query("DROP TRIGGER refuse_reset ON checkpoints; DROP FUNCTION fail_reset()"); }
  expect(await graphCounts()).toEqual(before);
});

it("physically reclaims history while preserving saved music, drafts, plans and spending; resumed production still finishes", async () => {
  const completed = await createJob();
  await dispatchOutbox();
  await processJob((await claimJobById(completed.id, "reset-fixture"))!);
  expect(await jobSnapshot(owner, completed.id)).toMatchObject({ state: "succeeded" });
  const saved = await nativeSnapshot(owner, completed.projectId);

  const made = await createJob();
  await dispatchOutbox();
  const job = (await claimJobById(made.id, "reset-partial"))!;
  const plan = nativePlanSchema.parse({ intent: "A quiet phrase", sections: [{ name: "Whole", purpose: "Short statement" }], soundGoals: ["Soft lead"], hardConstraints: [], developmentTasks: ["Check the ending"], creativeState: { identity: "Quiet", unfinishedTasks: [] } });
  await saveNativePlan(job, plan);
  const session = new NativeToolSession(job, seedNativeDocument("A quiet four-bar phrase"), true, createNativeLibrary(null));
  await session.apply("initial", nativeFormOperations(nativeFormSchema.parse({ title: "Saved phrase", tempoBpm: 92, meter: { numerator: 4, denominator: 4 }, sections: [{ id: "whole", name: "Whole", bars: 4 }], parts: [{ id: "lead", name: "Lead", role: "melody", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, motifs: [], placements: [], freeNotes: [{ beat: 0, durationBeats: 1, pitch: 64, velocity: 0.7 }] }] }), []));
  // A real graph run pauses after ignoring review feedback. No provider access.
  const reviewer = fakeModel().respond(new AIMessage(JSON.stringify({ verdict: "A useful phrase", findings: [{ priority: "medium", sectionId: "whole", partId: "lead", observation: "The ending could answer the opening", suggestedChange: "Consider a final reply" }], noChangeReason: null })));
  await processJob(job, { scriptedModel: fakeModel().respond(new AIMessage("Finished.")).respond(new AIMessage("Finished.")), scriptedReviewer: reviewer, library: createNativeLibrary(null) });
  expect(await jobSnapshot(owner, job.id)).toMatchObject({ state: "needs_attention", error_code: "NATIVE_PARTIAL" });
  const draft = await nativeDraftView(owner, job.projectId, job.id);
  const planBefore = await loadNativePlan(job.id);
  const effects = (await getPool().query("SELECT * FROM effect ORDER BY id")).rows;
  const steps = (await getPool().query("SELECT * FROM native_job_step ORDER BY job_id,ordinal")).rows;
  const bytes = await tablesBytes();
  expect(bytes).toBeGreaterThan(200_000);
  const result = await discardExecutionCheckpoints();
  expect(result.discardedRows).toBeGreaterThan(3);
  expect(await graphCounts()).toEqual({ checkpoints: 0, blobs: 0, writes: 0 });
  expect(bytes - await tablesBytes()).toBeGreaterThan(200_000);
  expect(await nativeSnapshot(owner, completed.projectId)).toEqual(saved);
  expect(await nativeDraftView(owner, job.projectId, job.id)).toEqual(draft);
  expect(await loadNativePlan(job.id)).toEqual(planBefore);
  expect((await getPool().query("SELECT * FROM effect ORDER BY id")).rows).toEqual(effects);
  expect((await getPool().query("SELECT * FROM native_job_step ORDER BY job_id,ordinal")).rows).toEqual(steps);
  expect(await (await checkpoint()).getTuple({ configurable: { thread_id: historicalThread } })).toBeUndefined();

  config.HOSTED_MAINTENANCE = false;
  await resumeNativePartialJob(owner, job.projectId, job.id);
  const resumed = (await claimJobById(job.id, "reset-resume"))!;
  expect(resumed.attemptId).not.toBe(job.attemptId);
  await processJob(resumed, { scriptedModel: fakeModel().respondWithTools([{ name: "finish_native_arrangement", args: { acceptRemainingSuggestions: true } }]), scriptedReviewer: fakeModel(), library: createNativeLibrary(null) });
  expect(await jobSnapshot(owner, job.id)).toMatchObject({ state: "succeeded" });
  expect((await nativeSnapshot(owner, job.projectId)).current!.document.parts[0]!.notes[0]!.pitch).toBe(64);
  expect((await graphCounts()).checkpoints).toBeGreaterThan(0);
}, 30_000);
