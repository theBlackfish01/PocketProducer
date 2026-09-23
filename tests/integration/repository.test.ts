import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  analyzePreview,
  audiotoolSessionStatus,
  cancelJob,
  claimNextJob,
  claimJobById,
  closePool,
  commitCancelled,
  commitRevision,
  compileArrangement,
  createJob,
  createProject,
  deterministicPlan,
  deleteAudiotoolSession,
  dispatchOutbox,
  encodeWav,
  expireJob,
  failJob,
  getPool,
  appendAttemptEvent,
  heartbeat,
  completeProviderEffect,
  failProviderEffect,
  markEffectDispatched,
  reserveProviderEffect,
  requeueJob,
  recordAudioAnalysis,
  recordExportProgress,
  exportResumeState,
  settleExpiredJobs,
  jobSnapshot,
  loadAudiotoolSession,
  requireProject,
  saveAudiotoolSession,
  selectRevision,
  needsAttentionJob,
  type GeminiGenerateClient
} from "@pocket/core";

const subjectA = `test-owner-a-${randomUUID()}`;
const subjectB = `test-owner-b-${randomUUID()}`;
let ownerA = "";
let ownerB = "";
let projectId = "";
let secondProjectId = "";
const projectIds: string[] = [];

async function waitForState(jobId: string, wanted: (state: string) => boolean, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await getPool().query<{ state: string }>("SELECT state FROM job WHERE id=$1", [jobId]);
    const state = result.rows[0]?.state ?? "missing";
    if (wanted(state)) return state;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 30));
  }
  throw new Error(`Timed out waiting for job ${jobId}`);
}

function startWorkerProcess(label: string): ChildProcess {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  return spawn(process.execPath, ["--import", "tsx", resolve("apps/worker/src/worker.ts")], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      APP_ENV: "test",
      DATABASE_URL: databaseUrl,
      OBJECT_STORAGE_LOCAL_ROOT: `.local/repair-process-${label}`,
      FIXTURE_MODE: "true",
      DEV_LOCAL_AUTH: "true",
      OPENAI_API_KEY: "",
      GEMINI_API_KEY: "",
      GOOGLE_API_KEY: "",
      JOB_LEASE_SECONDS: "3",
      MAX_AUDIO_CRITIQUE_PASSES: "0"
    }
  });
}

async function stopWorkerProcess(child: ChildProcess, force = false): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill(force ? "SIGKILL" : "SIGTERM");
  await new Promise<void>((resolveExit) => {
    const timer = setTimeout(resolveExit, 5_000);
    child.once("exit", () => { clearTimeout(timer); resolveExit(); });
  });
}

beforeAll(async () => {
  const owners = await getPool().query<{ id: string; provider_subject: string }>(
    "INSERT INTO app_user(provider_subject,display_name) VALUES($1,'Test owner A'),($2,'Test owner B') RETURNING id,provider_subject",
    [subjectA, subjectB]
  );
  ownerA = owners.rows.find((row) => row.provider_subject === subjectA)?.id ?? "";
  ownerB = owners.rows.find((row) => row.provider_subject === subjectB)?.id ?? "";
  projectId = (await createProject(ownerA, "Repository integration")).id;
  secondProjectId = (await createProject(ownerA, "Repository integration second project")).id;
  projectIds.push(projectId, secondProjectId);
});

afterAll(async () => {
  await getPool().query("UPDATE project SET current_revision_id=NULL WHERE id=ANY($1::uuid[])", [projectIds]);
  await getPool().query("UPDATE job SET result_revision_id=NULL,base_revision_id=NULL,expected_head_revision_id=NULL WHERE project_id=ANY($1::uuid[])", [projectIds]);
  await getPool().query("DELETE FROM project_export WHERE project_id=ANY($1::uuid[])", [projectIds]);
  await getPool().query("DELETE FROM audio_analysis WHERE project_id=ANY($1::uuid[])", [projectIds]);
  await getPool().query("DELETE FROM revision WHERE project_id=ANY($1::uuid[])", [projectIds]);
  await getPool().query("DELETE FROM job WHERE project_id=ANY($1::uuid[])", [projectIds]);
  await getPool().query("DELETE FROM project WHERE id=ANY($1::uuid[])", [projectIds]);
  await getPool().query("DELETE FROM app_user WHERE provider_subject IN ($1,$2)", [subjectA, subjectB]);
  await closePool();
});

describe("durable job repository", () => {
  it("encrypts the owner-bound Audiotool worker session and supports disconnect", async () => {
    const tokens = { accessToken: `access-${randomUUID()}`, refreshToken: `refresh-${randomUUID()}`, expiresAt: Date.now() + 3_600_000 };
    await saveAudiotoolSession(ownerA, "Local Audiotool tester", tokens);
    expect(await loadAudiotoolSession(ownerA)).toEqual({ userName: "Local Audiotool tester", tokens });
    expect(await audiotoolSessionStatus(ownerA)).toMatchObject({ connected: true, userName: "Local Audiotool tester" });
    const stored = await getPool().query("SELECT token_ciphertext FROM audiotool_session WHERE owner_id=$1", [ownerA]);
    expect(String(stored.rows[0]?.token_ciphertext)).not.toContain(tokens.accessToken);
    expect(await loadAudiotoolSession(ownerB)).toBeNull();
    await deleteAudiotoolSession(ownerA);
    expect(await audiotoolSessionStatus(ownerA)).toMatchObject({ connected: false, userName: null });
  });

  it("keeps a usable short-lived Audiotool grant without pretending it can refresh", async () => {
    const tokens = { accessToken: `access-${randomUUID()}`, refreshToken: "", expiresAt: Date.now() + 300_000 };
    await saveAudiotoolSession(ownerA, "Short-lived grant", tokens);
    expect(await loadAudiotoolSession(ownerA)).toEqual({ userName: "Short-lived grant", tokens });
    expect(await audiotoolSessionStatus(ownerA)).toMatchObject({ connected: true });
    await saveAudiotoolSession(ownerA, "Short-lived grant", { ...tokens, expiresAt: Date.now() - 1_000 });
    expect(await audiotoolSessionStatus(ownerA)).toMatchObject({ connected: false });
    await deleteAudiotoolSession(ownerA);
  });

  it("deduplicates identical requests and rejects key reuse", async () => {
    const idempotencyKey = `test-${randomUUID()}`;
    const first = await createJob({ ownerId: ownerA, projectId, kind: "generation", idempotencyKey, request: { direction: "Warm and spacious" } });
    const duplicate = await createJob({ ownerId: ownerA, projectId, kind: "generation", idempotencyKey, request: { direction: "Warm and spacious" } });
    expect(duplicate).toEqual({ id: first.id, duplicate: true });
    await expect(createJob({ ownerId: ownerA, projectId, kind: "generation", idempotencyKey, request: { direction: "Entirely different" } })).rejects.toMatchObject({ statusCode: 409 });
    const otherProject = await createJob({ ownerId: ownerA, projectId: secondProjectId, kind: "generation", idempotencyKey, request: { direction: "Warm and spacious" } });
    expect(otherProject.id).not.toBe(first.id);
    await dispatchOutbox();
    for (let index = 0; index < 2; index += 1) {
      const cleanup = await claimNextJob(`idempotency-cleanup-${index}`);
      if (cleanup) await failJob(cleanup, "TEST_COMPLETE", "Idempotency setup complete");
    }
  });

  it("reclaims an expired lease with a new fencing generation", async () => {
    const created = await createJob({ ownerId: ownerA, projectId, kind: "generation", idempotencyKey: `restart-${randomUUID()}`, request: { direction: "Lease restart fixture" } });
    await dispatchOutbox();
    const firstClaim = await claimNextJob("worker-before-restart");
    expect(firstClaim?.id).toBe(created.id);
    await getPool().query("UPDATE job SET lease_until=now()-interval '1 second' WHERE id=$1", [firstClaim?.id]);
    const secondClaim = await claimNextJob("worker-after-restart");
    expect(secondClaim?.id).toBe(firstClaim?.id);
    expect(secondClaim?.leaseGeneration).toBe((firstClaim?.leaseGeneration ?? 0) + 1);
    if (secondClaim) await failJob(secondClaim, "TEST_COMPLETE", "Expected integration-test terminal state");
    expect((await jobSnapshot(ownerA, secondClaim?.id ?? "")).state).toBe("failed");
  });

  it("records failed and cancelled revision jobs without crossing ownership", async () => {
    const cancelled = await createJob({ ownerId: ownerA, projectId, kind: "revision", idempotencyKey: `cancel-${randomUUID()}`, request: { direction: "Simplify drums and keep melody" } });
    await cancelJob(ownerA, cancelled.id);
    await cancelJob(ownerA, cancelled.id);
    const cancelledSnapshot = await jobSnapshot(ownerA, cancelled.id);
    expect(cancelledSnapshot.state).toBe("cancelled");
    const cancellationEvents = cancelledSnapshot.events as Array<{ event_type: string }>;
    expect(cancellationEvents.filter((event) => event.event_type === "cancelled")).toHaveLength(1);

    const failed = await createJob({ ownerId: ownerA, projectId, kind: "revision", idempotencyKey: `fail-${randomUUID()}`, request: { direction: "Unsupported revision scope" } });
    await dispatchOutbox();
    const claimed = await claimNextJob("revision-failure-worker");
    expect(claimed?.id).toBe(failed.id);
    if (claimed) await failJob(claimed, "UNSUPPORTED_REVISION", "Expected failed revision test");
    expect((await jobSnapshot(ownerA, failed.id)).state).toBe("failed");
    await expect(requireProject(ownerB, projectId)).rejects.toMatchObject({ statusCode: 404 });
    await expect(jobSnapshot(ownerB, cancelled.id)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("settles running cancellation and fences stale progress and failure writes", async () => {
    const created = await createJob({ ownerId: ownerA, projectId, kind: "generation", idempotencyKey: `running-cancel-${randomUUID()}`, request: { direction: "Warm and restrained" } });
    await dispatchOutbox();
    let claimed = await claimNextJob("running-cancel-worker");
    while (claimed && claimed.id !== created.id) {
      await failJob(claimed, "TEST_DRAIN", "Drain earlier test work");
      claimed = await claimNextJob("running-cancel-worker");
    }
    expect(claimed?.id).toBe(created.id);
    await cancelJob(ownerA, created.id);
    if (!claimed) throw new Error("Expected claimed job");
    await commitCancelled(claimed);
    expect((await jobSnapshot(ownerA, created.id)).state).toBe("cancelled");
    await expect(appendAttemptEvent(claimed, "late_progress", { stale: true }, "planning")).rejects.toMatchObject({ code: "LEASE_LOST" });
    expect(await failJob(claimed, "STALE", "Must not overwrite terminal cancellation")).toBe(false);
  });

  it("renews a live lease and prevents an expired attempt from committing", async () => {
    const created = await createJob({ ownerId: ownerA, projectId, kind: "generation", idempotencyKey: `lease-${randomUUID()}`, request: { direction: "Warm and restrained" } });
    await dispatchOutbox();
    const first = await claimNextJob("lease-worker-one");
    expect(first?.id).toBe(created.id);
    if (!first) throw new Error("Expected first lease");
    expect(await heartbeat(first)).toBeNull();
    await getPool().query("UPDATE job SET lease_until=now()-interval '1 second' WHERE id=$1", [first.id]);
    const second = await claimNextJob("lease-worker-two");
    expect(second?.id).toBe(first.id);
    expect(await failJob(first, "STALE", "Stale attempt must be fenced")).toBe(false);
    await expect(appendAttemptEvent(first, "late_progress", { stale: true })).rejects.toMatchObject({ code: "LEASE_LOST" });
    if (second) await failJob(second, "TEST_COMPLETE", "Expected integration-test terminal state");
  });

  it("settles queued and running deadline expiry exactly once with typed control", async () => {
    const queued = await createJob({ ownerId: ownerA, projectId, kind: "generation", idempotencyKey: `expired-queued-${randomUUID()}`, request: { direction: "Expired before claim" } });
    await dispatchOutbox();
    await getPool().query("UPDATE job SET deadline_at=now()-interval '1 second' WHERE id=$1", [queued.id]);
    expect(await claimJobById(queued.id, "must-not-claim-expired")).toBeNull();
    const queuedSnapshot = await jobSnapshot(ownerA, queued.id);
    expect(queuedSnapshot).toMatchObject({ state: "failed", error_code: "DEADLINE_EXCEEDED" });
    await settleExpiredJobs(queued.id);
    expect((queuedSnapshot.events as Array<{ event_type: string }>).filter((event) => event.event_type === "failed")).toHaveLength(1);

    const running = await createJob({ ownerId: ownerA, projectId, kind: "generation", idempotencyKey: `expired-running-${randomUUID()}`, request: { direction: "Expire during stage" } });
    await dispatchOutbox();
    const attempt = await claimJobById(running.id, "deadline-stage-worker");
    if (!attempt) throw new Error("Expected running deadline attempt");
    await getPool().query("UPDATE job SET deadline_at=now()-interval '1 second' WHERE id=$1", [running.id]);
    await expect(appendAttemptEvent(attempt, "late-stage", {}, "rendering")).rejects.toMatchObject({ code: "DEADLINE_EXCEEDED" });
    expect(await heartbeat(attempt)).toBe("DEADLINE_EXCEEDED");
    expect(await expireJob(attempt)).toBe(true);
    expect(await jobSnapshot(ownerA, running.id)).toMatchObject({ state: "failed", error_code: "DEADLINE_EXCEEDED" });
  });

  it("bounds transient retry to one requeue and then settles the second attempt", async () => {
    const created = await createJob({ ownerId: ownerA, projectId, kind: "generation", idempotencyKey: `retry-bound-${randomUUID()}`, request: { direction: "Retry boundary" } });
    await dispatchOutbox();
    const first = await claimJobById(created.id, "retry-worker-one");
    if (!first) throw new Error("Expected first retry attempt");
    expect(first.attempts).toBe(1);
    expect(await requeueJob(first, "TRANSIENT_RETRY", "network fixture")).toBe(true);
    const second = await claimJobById(created.id, "retry-worker-two");
    if (!second) throw new Error("Expected second retry attempt");
    expect(second.attempts).toBe(2);
    expect(await failJob(second, "JOB_FAILED", "retry allowance exhausted")).toBe(true);
    const snapshot = await jobSnapshot(ownerA, created.id);
    expect(snapshot).toMatchObject({ state: "failed", attempts: 2, error_code: "JOB_FAILED" });
    expect((snapshot.events as Array<{ event_type: string }>).filter((event) => event.event_type === "retrying")).toHaveLength(1);
  });

  it("finalizes provider effects once and retains late/unknown usage liability", async () => {
    const created = await createJob({ ownerId: ownerA, projectId, kind: "generation", idempotencyKey: `effect-finalize-${randomUUID()}`, request: { direction: "Accounting fixture" } });
    await dispatchOutbox();
    const attempt = await claimJobById(created.id, "effect-finalizer");
    if (!attempt) throw new Error("Expected accounting attempt");
    const first = await reserveProviderEffect({ job: attempt, provider: "openai", step: "mock-call", idempotencyKey: "call:one", inputHash: "input-one", model: "gpt-6-astra", promptVersion: "test", reservationMicrousd: 10_000 });
    await markEffectDispatched(first.id, attempt);
    expect(await completeProviderEffect({ effectId: first.id, job: attempt, output: { result: "kept" }, actualCostMicrousd: 1_234, providerRequestId: "request-one" })).toBe("succeeded");
    expect(await completeProviderEffect({ effectId: first.id, job: attempt, output: { result: "must-not-replace" }, actualCostMicrousd: 9_999 })).toBe("succeeded");
    await failProviderEffect({ effectId: first.id, job: attempt, errorClass: "LateGenericFailure", uncertain: false });
    const one = await getPool().query("SELECT state,output,actual_cost_microusd FROM effect WHERE id=$1", [first.id]);
    expect(one.rows[0]).toMatchObject({ state: "succeeded", output: { result: "kept" } });
    expect(Number(one.rows[0]?.actual_cost_microusd)).toBe(1_234);

    const late = await reserveProviderEffect({ job: attempt, provider: "gemini", step: "mock-late", idempotencyKey: "call:late", inputHash: "input-late", model: "gemini-3-flash-preview", promptVersion: "test", reservationMicrousd: 8_000 });
    await markEffectDispatched(late.id, attempt);
    await getPool().query("UPDATE job SET lease_until=now()-interval '1 second' WHERE id=$1", [attempt.id]);
    expect(await completeProviderEffect({ effectId: late.id, job: attempt, output: { usage: { totalTokens: 44 } }, actualCostMicrousd: 321 })).toBe("uncertain");
    expect(await completeProviderEffect({ effectId: late.id, job: attempt, output: { usage: { totalTokens: 99 } }, actualCostMicrousd: 999 })).toBe("uncertain");
    const lateRow = await getPool().query("SELECT state,output,actual_cost_microusd,cost_status FROM effect WHERE id=$1", [late.id]);
    expect(lateRow.rows[0]).toMatchObject({ state: "uncertain", output: { usage: { totalTokens: 44 } }, cost_status: "observed" });
    expect(Number(lateRow.rows[0]?.actual_cost_microusd)).toBe(321);
    const jobCost = await getPool().query("SELECT actual_cost_microusd FROM job WHERE id=$1", [attempt.id]);
    expect(Number(jobCost.rows[0]?.actual_cost_microusd)).toBe(1_555);
    const recovery = await claimJobById(attempt.id, "effect-recovery");
    if (recovery) {
      const unknown = await reserveProviderEffect({ job: recovery, provider: "gemini", step: "mock-unknown", idempotencyKey: "call:unknown", inputHash: "input-unknown", model: "gemini-3-flash-preview", promptVersion: "test", reservationMicrousd: 7_000 });
      await markEffectDispatched(unknown.id, recovery);
      await failProviderEffect({ effectId: unknown.id, job: recovery, errorClass: "NetworkTimeout", uncertain: true });
      expect((await getPool().query("SELECT state,cost_status FROM effect WHERE id=$1", [unknown.id])).rows[0]).toMatchObject({ state: "uncertain", cost_status: "unknown" });
      await failJob(recovery, "TEST_COMPLETE", "Accounting terminal cleanup");
    }
  });

  it("serializes concurrent provider reservations against one job allowance", async () => {
    const created = await createJob({ ownerId: ownerA, projectId, kind: "generation", idempotencyKey: `concurrent-budget-${randomUUID()}`, request: { direction: "Concurrent accounting fixture" } });
    await dispatchOutbox();
    const attempt = await claimJobById(created.id, "concurrent-budget-worker");
    if (!attempt) throw new Error("Expected concurrent budget attempt");
    const reserve = (suffix: string) => reserveProviderEffect({
      job: attempt, provider: "openai" as const, step: `mock-${suffix}`, idempotencyKey: `concurrent:${suffix}`,
      inputHash: `input-${suffix}`, model: "gpt-6-astra", promptVersion: "test", reservationMicrousd: 150_000
    });
    const outcomes = await Promise.allSettled([reserve("a"), reserve("b")]);
    const successes = outcomes.filter((outcome): outcome is PromiseFulfilledResult<Awaited<ReturnType<typeof reserve>>> => outcome.status === "fulfilled");
    const failures = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(String(failures[0]?.reason)).toContain("MODEL_BUDGET_EXCEEDED");
    expect(Number((await getPool().query("SELECT count(*)::text AS count FROM effect WHERE job_id=$1", [attempt.id])).rows[0]?.count)).toBe(1);
    await failProviderEffect({ effectId: successes[0]!.value.id, job: attempt, errorClass: "FixtureComplete", uncertain: false });
    await failJob(attempt, "TEST_COMPLETE", "Concurrent budget admission verified");
  });

  it("fences a concurrent and then stale Nexus export across distinct jobs", async () => {
    const exportProjectId = (await createProject(ownerA, "Nexus recovery evidence")).id;
    projectIds.push(exportProjectId);
    const generation = await createJob({ ownerId: ownerA, projectId: exportProjectId, kind: "generation", idempotencyKey: `export-base-${randomUUID()}`, request: { direction: "Export base" } });
    await dispatchOutbox();
    const generationAttempt = await claimJobById(generation.id, "export-base-worker");
    if (!generationAttempt) throw new Error("Expected export base attempt");
    const base = await commitRevision(generationAttempt, {
      composition: compileArrangement(deterministicPlan("Warm export base", false), undefined, 17),
      previewPath: "C:/test/export-base.wav", stems: { drums: "C:/test/export-drums.wav" }, waveformPeaks: [0.2], durationSeconds: 10,
      peak: 0.2, rms: 0.1, nonSilentRatio: 0.5, title: "Export base", summary: "Export fixture", protectedTrackHashes: {}, producer: { provider: "fixture" }
    });
    const baseRevisionId = base.revisionId;
    const first = await createJob({ ownerId: ownerA, projectId: exportProjectId, kind: "export", idempotencyKey: `export-a-${randomUUID()}`, request: {}, baseRevisionId, expectedHeadRevisionId: baseRevisionId });
    const second = await createJob({ ownerId: ownerA, projectId: exportProjectId, kind: "export", idempotencyKey: `export-b-${randomUUID()}`, request: {}, baseRevisionId, expectedHeadRevisionId: baseRevisionId });
    await dispatchOutbox();
    const firstAttempt = await claimJobById(first.id, "export-worker-a");
    const secondAttempt = await claimJobById(second.id, "export-worker-b");
    if (!firstAttempt || !secondAttempt) throw new Error("Expected both independent export jobs to be claimable");
    const checkpoint = {
      remoteProjectId: "projects/durable-test",
      uploadedSamples: {},
      project: { state: "succeeded" as const, remoteId: "projects/durable-test" },
      uploads: {},
      arrangement: { state: "in_flight" as const }
    };
    const progress = { fidelity: { level: "editable-stem" }, manifestPath: "C:/test/nexus.json", checkpoint };
    await recordExportProgress(firstAttempt, progress);
    await expect(recordExportProgress(secondAttempt, progress)).rejects.toThrow("EXPORT_OPERATION_IN_PROGRESS");
    await failJob(firstAttempt, "TEST_WORKER_LOST", "Simulated export worker ended");
    await expect(recordExportProgress(secondAttempt, progress)).rejects.toThrow("EXPORT_OUTCOME_UNCERTAIN");
    expect(await exportResumeState(ownerA, baseRevisionId)).toMatchObject({ state: "uncertain", remoteProjectId: "projects/durable-test" });
    expect((await getPool().query("SELECT pes.state FROM project_export_step pes JOIN project_export pe ON pe.id=pes.export_id WHERE pe.revision_id=$1 AND step_key='arrangement:insert'", [baseRevisionId])).rows[0]?.state).toBe("uncertain");
    await needsAttentionJob(secondAttempt, "EXPORT_OUTCOME_UNCERTAIN", "Durable export reconciliation required");
  });

  it("stores stale generation work without selecting it and reuses identical compositions", async () => {
    const firstCreated = await createJob({ ownerId: ownerA, projectId: secondProjectId, kind: "generation", idempotencyKey: `head-a-${randomUUID()}`, request: { direction: "Warm and restrained" } });
    const secondCreated = await createJob({ ownerId: ownerA, projectId: secondProjectId, kind: "generation", idempotencyKey: `head-b-${randomUUID()}`, request: { direction: "Brighter and rising" } });
    await dispatchOutbox();
    const first = await claimNextJob("head-worker-a");
    const second = await claimNextJob("head-worker-b");
    expect(new Set([first?.id, second?.id])).toEqual(new Set([firstCreated.id, secondCreated.id]));
    if (!first || !second) throw new Error("Expected two claimed generation jobs");
    const compositionA = compileArrangement(deterministicPlan("Warm and restrained", false), undefined, 1);
    const compositionB = compileArrangement(deterministicPlan("Brighter energetic rising", false), undefined, 2);
    const artifact = (suffix: string) => ({
      previewPath: `C:/test/${suffix}.wav`, stems: { drums: `C:/test/${suffix}-drums.wav` }, waveformPeaks: [0.2], durationSeconds: 10,
      peak: 0.2, rms: 0.1, nonSilentRatio: 0.5, title: suffix, summary: suffix, protectedTrackHashes: {}, producer: { provider: "fixture" }
    });
    const committedA = await commitRevision(first, { composition: first.id === firstCreated.id ? compositionA : compositionB, ...artifact("a") });
    const committedB = await commitRevision(second, { composition: second.id === secondCreated.id ? compositionB : compositionA, ...artifact("b") });
    expect([committedA.selected, committedB.selected].sort()).toEqual([false, true]);

    const accepted = committedA.selected ? committedA : committedB;
    const acceptedComposition = committedA.selected ? (first.id === firstCreated.id ? compositionA : compositionB) : (second.id === secondCreated.id ? compositionB : compositionA);
    const duplicate = await createJob({ ownerId: ownerA, projectId: secondProjectId, kind: "generation", idempotencyKey: `identical-${randomUUID()}`, request: { direction: "Repeat exactly" } });
    await dispatchOutbox();
    const duplicateClaim = await claimNextJob("identical-worker");
    expect(duplicateClaim?.id).toBe(duplicate.id);
    if (!duplicateClaim) throw new Error("Expected duplicate composition job");
    const reused = await commitRevision(duplicateClaim, { composition: acceptedComposition, ...artifact("identical") });
    expect(reused).toMatchObject({ revisionId: accepted.revisionId, selected: true, reused: true });
  });

  it("replays a completed command before changed-head preconditions and preserves effect counts", async () => {
    const idempotencyKey = `completed-replay-${randomUUID()}`;
    const request = { direction: "Replay this accepted command exactly" };
    const firstCreated = await createJob({ ownerId: ownerA, projectId: secondProjectId, kind: "generation", idempotencyKey, request });
    await dispatchOutbox();
    const firstAttempt = await claimJobById(firstCreated.id, "completed-replay-first");
    if (!firstAttempt) throw new Error("Expected first replay attempt");
    const artifact = (name: string) => ({
      previewPath: `C:/test/${name}.wav`, stems: { drums: `C:/test/${name}-drums.wav` }, waveformPeaks: [0.2], durationSeconds: 10,
      peak: 0.2, rms: 0.1, nonSilentRatio: 0.5, title: name, summary: name, protectedTrackHashes: {}, producer: { provider: "fixture" }
    });
    const firstRevision = await commitRevision(firstAttempt, { composition: compileArrangement(deterministicPlan("Warm replay", false), undefined, 91_001), ...artifact("replay-first") });

    const newer = await createJob({ ownerId: ownerA, projectId: secondProjectId, kind: "generation", idempotencyKey: `newer-head-${randomUUID()}`, request: { direction: "Move the project head" } });
    await dispatchOutbox();
    const newerAttempt = await claimJobById(newer.id, "completed-replay-newer");
    if (!newerAttempt) throw new Error("Expected newer head attempt");
    const newerRevision = await commitRevision(newerAttempt, { composition: compileArrangement(deterministicPlan("Energetic rising", false), undefined, 91_002), ...artifact("replay-newer") });
    expect(newerRevision.selected).toBe(true);

    const effectsBefore = await getPool().query<{ count: string }>("SELECT count(*)::text AS count FROM effect WHERE job_id=$1", [firstCreated.id]);
    expect(await createJob({ ownerId: ownerA, projectId: secondProjectId, kind: "generation", idempotencyKey, request })).toEqual({ id: firstCreated.id, duplicate: true });
    await selectRevision(ownerA, secondProjectId, firstRevision.revisionId, newerRevision.revisionId);
    expect(await createJob({ ownerId: ownerA, projectId: secondProjectId, kind: "generation", idempotencyKey, request })).toEqual({ id: firstCreated.id, duplicate: true });
    const effectsAfter = await getPool().query<{ count: string }>("SELECT count(*)::text AS count FROM effect WHERE job_id=$1", [firstCreated.id]);
    expect(effectsAfter.rows[0]?.count).toBe(effectsBefore.rows[0]?.count);
  });

  it("associates one immutable source analysis with multiple revisions without moving history", async () => {
    const revisions = await getPool().query<{ id: string }>("SELECT id FROM revision WHERE project_id=$1 ORDER BY ordinal DESC LIMIT 2", [secondProjectId]);
    const revisionA = revisions.rows[0]?.id;
    const revisionB = revisions.rows[1]?.id;
    if (!revisionA || !revisionB) throw new Error("Expected two revisions for analysis association");
    const analysis = {
      status: "available" as const,
      assetHash: `shared-source-${randomUUID()}`,
      model: "gemini-3-flash-preview",
      promptVersion: "audio-analysis-v2" as const,
      purpose: "source-analysis" as const,
      inspectedInterval: { start: 0, end: 1 },
      measured: { durationSeconds: 1, peak: 0.2, rms: 0.1, nonSilentRatio: 0.6 },
      observations: ["A restrained texture"],
      uncertainty: "Subjective fixture observation",
      suggestedActions: ["use-as-texture"],
      suggestedSourceRole: "texture" as const,
      repairAction: "none" as const,
      usage: { promptTokens: 10, candidateTokens: 2, thoughtsTokens: 1, totalTokens: 13 },
      costMicrousd: 12
    };
    await recordAudioAnalysis({ ownerId: ownerA, projectId: secondProjectId, revisionId: revisionA, analysis });
    await recordAudioAnalysis({ ownerId: ownerA, projectId: secondProjectId, revisionId: revisionB, analysis });
    const stored = await getPool().query(
      `SELECT aa.revision_id,array_agg(aar.revision_id ORDER BY aar.revision_id) AS linked
       FROM audio_analysis aa JOIN audio_analysis_revision aar ON aar.analysis_id=aa.id
       WHERE aa.owner_id=$1 AND aa.asset_hash=$2 GROUP BY aa.id`,
      [ownerA, analysis.assetHash]
    );
    expect(stored.rows[0]?.revision_id).toBe(revisionA);
    expect(new Set((stored.rows[0]?.linked as string[]) ?? [])).toEqual(new Set([revisionA, revisionB]));
  });

  it("recovers after an actual worker process kill and admits one of two contending workers", async () => {
    const restartProjectId = (await createProject(ownerA, "Process restart evidence")).id;
    const contentionProjectId = (await createProject(ownerA, "Contending worker evidence")).id;
    projectIds.push(restartProjectId, contentionProjectId);
    const restart = await createJob({ ownerId: ownerA, projectId: restartProjectId, kind: "generation", idempotencyKey: `process-restart-${randomUUID()}`, request: { direction: "Warm sparse restart evidence" } });
    await dispatchOutbox();
    const firstWorker = startWorkerProcess("killed");
    try {
      await waitForState(restart.id, (state) => state === "running", 15_000);
      await stopWorkerProcess(firstWorker, true);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 3_400));
      const restartedWorker = startWorkerProcess("restarted");
      try {
        expect(await waitForState(restart.id, (state) => ["succeeded", "failed"].includes(state), 45_000)).toBe("succeeded");
      } finally {
        await stopWorkerProcess(restartedWorker);
      }
    } finally {
      await stopWorkerProcess(firstWorker, true);
    }
    const restartEvidence = await getPool().query("SELECT attempts,lease_generation,(SELECT count(*) FROM revision WHERE creator_job_id=job.id) AS revisions FROM job WHERE id=$1", [restart.id]);
    expect(restartEvidence.rows[0]).toMatchObject({ attempts: 2, lease_generation: 2 });
    expect(Number(restartEvidence.rows[0]?.revisions)).toBe(1);

    const contention = await createJob({ ownerId: ownerA, projectId: contentionProjectId, kind: "generation", idempotencyKey: `process-contention-${randomUUID()}`, request: { direction: "Warm restrained contention evidence" } });
    await dispatchOutbox();
    const workerA = startWorkerProcess("contender-a");
    const workerB = startWorkerProcess("contender-b");
    try {
      expect(await waitForState(contention.id, (state) => ["succeeded", "failed"].includes(state), 45_000)).toBe("succeeded");
    } finally {
      await Promise.all([stopWorkerProcess(workerA), stopWorkerProcess(workerB)]);
    }
    const contentionEvidence = await getPool().query("SELECT attempts,lease_generation,(SELECT count(*) FROM revision WHERE creator_job_id=job.id) AS revisions FROM job WHERE id=$1", [contention.id]);
    expect(contentionEvidence.rows[0]).toMatchObject({ attempts: 1, lease_generation: 1 });
    expect(Number(contentionEvidence.rows[0]?.revisions)).toBe(1);

    const cancelProjectId = (await createProject(ownerA, "Cancellation death recovery evidence")).id;
    projectIds.push(cancelProjectId);
    const cancelled = await createJob({ ownerId: ownerA, projectId: cancelProjectId, kind: "generation", idempotencyKey: `process-cancel-${randomUUID()}`, request: { direction: "Cancellation death evidence" } });
    await dispatchOutbox();
    const doomedWorker = startWorkerProcess("cancelled");
    try {
      await waitForState(cancelled.id, (state) => state === "running", 15_000);
      await stopWorkerProcess(doomedWorker, true);
      await cancelJob(ownerA, cancelled.id);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 3_400));
      const recoveryWorker = startWorkerProcess("cancel-recovery");
      try {
        expect(await waitForState(cancelled.id, (state) => state === "cancelled", 30_000)).toBe("cancelled");
      } finally {
        await stopWorkerProcess(recoveryWorker);
      }
    } finally {
      await stopWorkerProcess(doomedWorker, true);
    }
    const cancellationEvidence = await getPool().query("SELECT attempts,lease_generation,(SELECT count(*) FROM revision WHERE creator_job_id=job.id) AS revisions FROM job WHERE id=$1", [cancelled.id]);
    expect(cancellationEvidence.rows[0]).toMatchObject({ attempts: 2, lease_generation: 2 });
    expect(Number(cancellationEvidence.rows[0]?.revisions)).toBe(0);
  }, 120_000);

  it("accounts for Gemini once, reuses its typed result, and does not replay an uncertain dispatch", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pocket-gemini-mock-"));
    const path = join(directory, "owned-source.wav");
    await writeFile(path, encodeWav(new Float32Array(4_800), new Float32Array(4_800), 48_000));

    const successJob = await createJob({ ownerId: ownerA, projectId, kind: "generation", idempotencyKey: `gemini-success-${randomUUID()}`, request: { direction: "Use the source as texture" } });
    await dispatchOutbox();
    const successClaim = await claimNextJob("gemini-mock-success");
    expect(successClaim?.id).toBe(successJob.id);
    if (!successClaim) throw new Error("Expected Gemini mock job");
    let calls = 0;
    const successClient: GeminiGenerateClient = {
      generateContent: ((request: Parameters<GeminiGenerateClient["generateContent"]>[0]) => {
        calls += 1;
        expect(request.config).toMatchObject({ maxOutputTokens: 2_048, thinkingConfig: { thinkingLevel: "MINIMAL" } });
        expect(request.config).not.toHaveProperty("temperature");
        return Promise.resolve({
          text: JSON.stringify({ observations: ["Soft transient"], musicalCharacter: ["Airy"], suggestedRole: "texture", confidence: "medium" }),
          usageMetadata: { promptTokenCount: 320, candidatesTokenCount: 24, thoughtsTokenCount: 8, totalTokenCount: 352 }
        });
      }) as unknown as GeminiGenerateClient["generateContent"]
    };
    const sourceHash = `source-${randomUUID()}`;
    const input = { job: successClaim, client: successClient, path, hash: sourceHash, purpose: "source-analysis" as const, durationSeconds: 0.1, peak: 0, rms: 0, nonSilentRatio: 0 };
    const first = await analyzePreview(input);
    const replay = await analyzePreview(input);
    expect(first).toMatchObject({ status: "available", suggestedSourceRole: "texture", model: "gemini-3-flash-preview" });
    expect(replay).toEqual(first);
    expect(calls).toBe(1);
    const ledger = await getPool().query("SELECT state,actual_cost_microusd FROM effect WHERE job_id=$1", [successClaim.id]);
    expect(ledger.rows).toEqual([expect.objectContaining({ state: "succeeded" })]);
    expect(Number(ledger.rows[0]?.actual_cost_microusd)).toBeGreaterThan(0);
    await failJob(successClaim, "TEST_COMPLETE", "Provider mock verified");

    const uncertainJob = await createJob({ ownerId: ownerA, projectId, kind: "generation", idempotencyKey: `gemini-uncertain-${randomUUID()}`, request: { direction: "Mock a timeout" } });
    await dispatchOutbox();
    const uncertainClaim = await claimNextJob("gemini-mock-timeout");
    expect(uncertainClaim?.id).toBe(uncertainJob.id);
    if (!uncertainClaim) throw new Error("Expected Gemini timeout mock job");
    let timeoutCalls = 0;
    const timeoutClient: GeminiGenerateClient = {
      generateContent: () => { timeoutCalls += 1; return Promise.reject(new TypeError("fetch failed after dispatch")); }
    };
    const uncertainInput = { job: uncertainClaim, client: timeoutClient, path, hash: `timeout-${randomUUID()}`, purpose: "preview-critique" as const, durationSeconds: 0.1, peak: 0, rms: 0, nonSilentRatio: 0 };
    expect((await analyzePreview(uncertainInput)).status).toBe("failed");
    const withheld = await analyzePreview(uncertainInput);
    expect(withheld).toMatchObject({ status: "unavailable" });
    expect(withheld.uncertainty).toContain("not repeated");
    expect(timeoutCalls).toBe(1);
    expect((await getPool().query("SELECT state,cost_status FROM effect WHERE job_id=$1", [uncertainClaim.id])).rows[0]).toMatchObject({ state: "uncertain", cost_status: "unknown" });
    await failJob(uncertainClaim, "TEST_COMPLETE", "Uncertain provider mock verified");

    const malformedJob = await createJob({ ownerId: ownerA, projectId, kind: "generation", idempotencyKey: `gemini-malformed-${randomUUID()}`, request: { direction: "Mock invalid structured output" } });
    await dispatchOutbox();
    const malformedClaim = await claimNextJob("gemini-mock-malformed");
    expect(malformedClaim?.id).toBe(malformedJob.id);
    if (!malformedClaim) throw new Error("Expected Gemini malformed-output job");
    let malformedCalls = 0;
    const malformedClient: GeminiGenerateClient = {
      generateContent: (() => { malformedCalls += 1; return Promise.resolve({ text: "{}", candidates: [{ finishReason: "STOP" }], usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 2, thoughtsTokenCount: 100, totalTokenCount: 122 } }); }) as unknown as GeminiGenerateClient["generateContent"]
    };
    const malformedInput = { job: malformedClaim, client: malformedClient, path, hash: `malformed-${randomUUID()}`, purpose: "source-analysis" as const, durationSeconds: 0.1, peak: 0, rms: 0, nonSilentRatio: 0 };
    expect(await analyzePreview(malformedInput)).toMatchObject({ status: "failed", observations: [] });
    const malformedLedger = (await getPool().query("SELECT state,actual_cost_microusd,output FROM effect WHERE job_id=$1", [malformedClaim.id])).rows[0];
    expect(malformedLedger?.state).toBe("failed");
    expect(Number(malformedLedger?.actual_cost_microusd)).toBeGreaterThan(0);
    expect(malformedLedger?.output).toMatchObject({ errorClass: "ZodError", finishReason: "STOP", thoughtsTokens: 100 });
    expect((await analyzePreview(malformedInput)).status).toBe("unavailable");
    expect(malformedCalls).toBe(1);
    await failJob(malformedClaim, "TEST_COMPLETE", "Malformed provider mock verified");

    const budgetJob = await createJob({ ownerId: ownerA, projectId, kind: "generation", idempotencyKey: `gemini-budget-${randomUUID()}`, request: { direction: "Mock exhausted budget" } });
    await dispatchOutbox();
    const budgetClaim = await claimNextJob("gemini-mock-budget");
    expect(budgetClaim?.id).toBe(budgetJob.id);
    if (!budgetClaim) throw new Error("Expected Gemini budget job");
    await getPool().query(
      `INSERT INTO effect(id,job_id,step,idempotency_key,input_hash,state,provider,model,prompt_version,reservation_microusd,actual_cost_microusd,cost_usd)
       VALUES($1,$2,'budget-fixture','budget-fixture','budget-fixture','succeeded','gemini','fixture','fixture',0,250000,0.25)`,
      [randomUUID(), budgetClaim.id]
    );
    let budgetCalls = 0;
    const budgetClient: GeminiGenerateClient = { generateContent: () => { budgetCalls += 1; return Promise.reject(new Error("must not dispatch")); } };
    const budgeted = await analyzePreview({ job: budgetClaim, client: budgetClient, path, hash: `budget-${randomUUID()}`, purpose: "preview-critique", durationSeconds: 0.1, peak: 0, rms: 0, nonSilentRatio: 0 });
    expect(budgeted).toMatchObject({ status: "unavailable" });
    expect(budgeted.uncertainty).toContain("budget");
    expect(budgetCalls).toBe(0);
    await failJob(budgetClaim, "TEST_COMPLETE", "Budget provider mock verified");
  });

  it("upgrades a populated prior schema idempotently without rewriting history", async () => {
    const schema = `repair_upgrade_${randomUUID().replaceAll("-", "")}`;
    const client = await getPool().connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}",public`);
      for (const name of ["001_initial.sql", "002_provider_usage.sql", "003_repair_invariants.sql", "004_audiotool_session.sql"]) {
        await client.query(await readFile(resolve("packages/core/src/db/migrations", name), "utf8"));
      }
      const owner = (await client.query<{ id: string }>("SELECT id FROM app_user WHERE provider_subject='dev-loopback'")).rows[0]!.id;
      const project = (await client.query<{ id: string }>("INSERT INTO project(owner_id,title) VALUES($1,'Upgrade fixture') RETURNING id", [owner])).rows[0]!.id;
      const job = (await client.query<{ id: string }>(
        "INSERT INTO job(owner_id,project_id,kind,idempotency_key,request_hash,request,state,deadline_at) VALUES($1,$2,'generation','upgrade-key','hash','{}','succeeded',now()+interval '1 minute') RETURNING id",
        [owner, project]
      )).rows[0]!.id;
      const revision = (await client.query<{ id: string }>(
        `INSERT INTO revision(owner_id,project_id,creator_job_id,ordinal,title,composition,composition_hash,preview_path,stems,waveform_peaks,duration_seconds,peak,rms,non_silent_ratio,change_summary,producer)
         VALUES($1,$2,$3,1,'Immutable prior revision','{}','immutable-hash','C:/prior.wav','{}','[]',1,0.2,0.1,0.5,'prior','{}') RETURNING id`,
        [owner, project, job]
      )).rows[0]!.id;
      await client.query("UPDATE project SET current_revision_id=$2 WHERE id=$1", [project, revision]);
      await client.query(
        `INSERT INTO audio_analysis(owner_id,project_id,revision_id,asset_hash,provider,model,purpose,prompt_version,interval_start,interval_end,measured,observations,uncertainty,status)
         VALUES($1,$2,$3,'asset-hash','gemini','gemini-3-flash-preview','source-analysis','audio-analysis-v2',0,1,'{}','[]','prior observation','available')`,
        [owner, project, revision]
      );
      await client.query(
        `INSERT INTO effect(job_id,step,idempotency_key,input_hash,state,provider,model,prompt_version,dispatched_at)
         VALUES($1,'source-analysis','prior-effect','prior-input','failed','gemini','gemini-3-flash-preview','audio-analysis-v2',now())`,
        [job]
      );
      await client.query(
        `INSERT INTO project_export(owner_id,project_id,revision_id,job_id,provider,state,fidelity,remote_project_id,remote_effects)
         VALUES($1,$2,$3,$4,'audiotool','completed','{}','projects/prior','{"uploadedSamples":{"drums":"samples/prior"}}')`,
        [owner, project, revision, job]
      );
      const repairMigration = await readFile(resolve("packages/core/src/db/migrations/005_repair_recovery.sql"), "utf8");
      await client.query(repairMigration);
      await client.query(repairMigration);
      const uncertaintyMigration = await readFile(resolve("packages/core/src/db/migrations/006_transport_uncertainty.sql"), "utf8");
      await client.query(uncertaintyMigration);
      await client.query(uncertaintyMigration);
      expect((await client.query("SELECT cost_status,actual_cost_microusd FROM effect WHERE job_id=$1", [job])).rows[0]).toMatchObject({ cost_status: "unknown", actual_cost_microusd: "0" });
      expect(Number((await client.query("SELECT count(*)::text AS count FROM audio_analysis_revision WHERE revision_id=$1", [revision])).rows[0]?.count)).toBe(1);
      expect((await client.query("SELECT operation_key,mapping_version,remote_effects FROM project_export WHERE revision_id=$1", [revision])).rows[0]).toMatchObject({ mapping_version: "nexus-stem-v3", remote_effects: { uploadedSamples: { drums: "samples/prior" } } });
      expect((await client.query("SELECT composition_hash,preview_path FROM revision WHERE id=$1", [revision])).rows[0]).toMatchObject({ composition_hash: "immutable-hash", preview_path: "C:/prior.wav" });
    } finally {
      await client.query("RESET search_path").catch(() => undefined);
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
      client.release();
    }
  });
});
