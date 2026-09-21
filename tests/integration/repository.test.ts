import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  analyzePreview,
  audiotoolSessionStatus,
  cancelJob,
  claimNextJob,
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
  failJob,
  getPool,
  appendAttemptEvent,
  heartbeat,
  jobSnapshot,
  loadAudiotoolSession,
  requireProject,
  saveAudiotoolSession,
  type GeminiGenerateClient
} from "@pocket/core";

const subjectA = `test-owner-a-${randomUUID()}`;
const subjectB = `test-owner-b-${randomUUID()}`;
let ownerA = "";
let ownerB = "";
let projectId = "";
let secondProjectId = "";

beforeAll(async () => {
  const owners = await getPool().query<{ id: string; provider_subject: string }>(
    "INSERT INTO app_user(provider_subject,display_name) VALUES($1,'Test owner A'),($2,'Test owner B') RETURNING id,provider_subject",
    [subjectA, subjectB]
  );
  ownerA = owners.rows.find((row) => row.provider_subject === subjectA)?.id ?? "";
  ownerB = owners.rows.find((row) => row.provider_subject === subjectB)?.id ?? "";
  projectId = (await createProject(ownerA, "Repository integration")).id;
  secondProjectId = (await createProject(ownerA, "Repository integration second project")).id;
});

afterAll(async () => {
  await getPool().query("UPDATE project SET current_revision_id=NULL WHERE id IN ($1,$2)", [projectId, secondProjectId]);
  await getPool().query("UPDATE job SET result_revision_id=NULL,base_revision_id=NULL,expected_head_revision_id=NULL WHERE project_id IN ($1,$2)", [projectId, secondProjectId]);
  await getPool().query("DELETE FROM revision WHERE project_id IN ($1,$2)", [projectId, secondProjectId]);
  await getPool().query("DELETE FROM job WHERE project_id IN ($1,$2)", [projectId, secondProjectId]);
  await getPool().query("DELETE FROM project WHERE id IN ($1,$2)", [projectId, secondProjectId]);
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
    expect(await heartbeat(first)).toBe(true);
    await getPool().query("UPDATE job SET lease_until=now()-interval '1 second' WHERE id=$1", [first.id]);
    const second = await claimNextJob("lease-worker-two");
    expect(second?.id).toBe(first.id);
    expect(await failJob(first, "STALE", "Stale attempt must be fenced")).toBe(false);
    await expect(appendAttemptEvent(first, "late_progress", { stale: true })).rejects.toMatchObject({ code: "LEASE_LOST" });
    if (second) await failJob(second, "TEST_COMPLETE", "Expected integration-test terminal state");
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
      generateContent: () => { timeoutCalls += 1; return Promise.reject(new Error("network timeout after dispatch")); }
    };
    const uncertainInput = { job: uncertainClaim, client: timeoutClient, path, hash: `timeout-${randomUUID()}`, purpose: "preview-critique" as const, durationSeconds: 0.1, peak: 0, rms: 0, nonSilentRatio: 0 };
    expect((await analyzePreview(uncertainInput)).status).toBe("failed");
    const withheld = await analyzePreview(uncertainInput);
    expect(withheld).toMatchObject({ status: "unavailable" });
    expect(withheld.uncertainty).toContain("not repeated");
    expect(timeoutCalls).toBe(1);
    expect((await getPool().query("SELECT state FROM effect WHERE job_id=$1", [uncertainClaim.id])).rows[0]?.state).toBe("uncertain");
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
});
