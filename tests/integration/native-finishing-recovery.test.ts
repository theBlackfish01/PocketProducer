import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { AIMessage, fakeModel, focusedNativeReview, nativeFormatRecoveryAvailable } from "@pocket/core/test-support";
import { canonicalHash, claimJobById, createNativeJob, createNativeLibrary, createProject, dispatchOutbox, getPool, jobSnapshot, loadNativePlan, nativeDraftView, nativeSnapshot, nativePlanSchema, nativeCreativeStateSchema, nativeReviewContextHash, NativeToolSession, seedNativeDocument, nativeFormOperations, saveNativePlan, saveNativeCreativeState, saveNativeReview, advanceNativePlan, reserveProviderEffect, markEffectDispatched, needsAttentionJob, resumeNativePartialJob, type JobRecord } from "@pocket/core";
import { processJob } from "@pocket/worker";
import { nativeFormSchema } from "@pocket/core";

let owner = "";
const direction = "A four-bar melody";
const plan = nativePlanSchema.parse({ intent: "A warm melodic phrase", sections: [{ name: "Whole", purpose: "A short musical statement" }], soundGoals: ["Soft lead"], hardConstraints: ["Four bars"], developmentTasks: ["A deliberate pause"], creativeState: { identity: "Quiet", unfinishedTasks: ["Check the phrase"] } });
const form = { title: "Recovery phrase", tempoBpm: 92, meter: { numerator: 4, denominator: 4 }, sections: [{ id: "whole", name: "Whole", bars: 4 }], parts: [{ id: "lead", name: "Lead", role: "melody", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, motifs: [], placements: [], freeNotes: [{ beat: 0, durationBeats: 1, pitch: 64, velocity: 0.7 }] }] };
const good = () => new AIMessage(JSON.stringify({ verdict: "The phrase leaves deliberate space.", findings: [], noChangeReason: "The sparse requested statement is present." }));
beforeAll(async () => { owner = (await getPool().query<{ id: string }>("INSERT INTO app_user(provider_subject,display_name) VALUES($1,'Finishing test') RETURNING id", [`finish-${randomUUID()}`])).rows[0]!.id; });
afterAll(async () => {
  const projects = (await getPool().query<{ id: string }>("SELECT id FROM project WHERE owner_id=$1", [owner])).rows.map((row) => row.id);
  await getPool().query("DELETE FROM native_sync WHERE project_id=ANY($1::uuid[])", [projects]);
  await getPool().query("DELETE FROM native_project_head WHERE project_id=ANY($1::uuid[])", [projects]);
  await getPool().query("UPDATE job SET result_native_revision_id=NULL WHERE owner_id=$1", [owner]);
  await getPool().query("DELETE FROM native_revision WHERE owner_id=$1", [owner]);
  await getPool().query("DELETE FROM job WHERE owner_id=$1", [owner]);
  await getPool().query("DELETE FROM project WHERE owner_id=$1", [owner]);
  await getPool().query("DELETE FROM app_user WHERE id=$1", [owner]);
});
async function create(): Promise<JobRecord> {
  const project = await createProject(owner, "Finishing recovery test");
  const made = await createNativeJob({ ownerId: owner, projectId: project.id, kind: "native-generation", idempotencyKey: randomUUID(), request: { direction }, expectedHeadId: null });
  await dispatchOutbox();
  return (await claimJobById(made.id, "finishing-test"))!;
}
async function prepared() {
  const job = await create();
  const session = new NativeToolSession(job, seedNativeDocument(direction), true, createNativeLibrary(null));
  await saveNativePlan(job, plan);
  await session.apply("initial", nativeFormOperations(nativeFormSchema.parse(form), []));
  return { job, session };
}

it("repairs invalid critic JSON once through production tools, preserves bookkeeping and reuses the review", async () => {
  const job = await create();
  const producer = fakeModel().respondWithTools([{ name: "record_native_plan", args: plan }])
    .respondWithTools([{ name: "compose_native_form", args: form }])
    .respondWithTools([{ name: "review_native_score", args: {} }])
    .respondWithTools([{ name: "record_native_creative_state", args: { ...plan.creativeState, unfinishedTasks: [], guidanceRefs: ["already-read"] } }])
    .respondWithTools([{ name: "record_native_plan", args: plan }])
    .respondWithTools([{ name: "review_native_score", args: {} }]).respond(new AIMessage("Finished"));
  const reviewer = fakeModel().respond(new AIMessage("{ broken JSON")).respond(good());
  await processJob(job, { scriptedModel: producer, scriptedReviewer: reviewer, library: createNativeLibrary(null) });
  expect((await jobSnapshot(owner, job.id)).state).toBe("succeeded");
  expect(reviewer.callCount).toBe(2);
  expect(JSON.stringify(reviewer.calls[1]?.messages)).toContain("invalid_json");
  const saved = await loadNativePlan(job.id);
  expect(saved?.review).toMatchObject({ modelUsed: true, formatRecovery: true });
  expect(saved?.reviewCount).toBe(1);
  const effects = (await getPool().query("SELECT prompt_version,output FROM effect WHERE job_id=$1 AND prompt_version LIKE 'native-symbolic-review%'", [job.id])).rows;
  expect(effects).toHaveLength(2);
  expect(effects.some((row) => row.output.review.diagnostic?.code === "invalid_json")).toBe(true);
  expect((await nativeSnapshot(owner, job.projectId)).current?.document.parts[0]?.notes[0]?.pitch).toBe(64);
}, 30_000);

it("keeps review and inspection on bookkeeping, invalidates changed goals and rejects late stale reviews", async () => {
  const { job, session } = await prepared();
  const review = await focusedNativeReview({ job, direction, document: session.document, plan, attempt: 0, scriptedReviewer: fakeModel().respond(good()) });
  await saveNativeReview(job, review);
  await advanceNativePlan(job, "reviewed", canonicalHash(session.document));
  await saveNativeCreativeState(job, nativeCreativeStateSchema.parse({ ...plan.creativeState, unfinishedTasks: [], guidanceRefs: ["done"] }));
  await saveNativePlan(job, plan);
  expect(await loadNativePlan(job.id)).toMatchObject({ stage: "reviewed", inspectedDocumentHash: review.documentHash, review, reviewCount: 1 });
  await saveNativePlan(job, { ...plan, soundGoals: ["Sharper lead"] });
  expect(await loadNativePlan(job.id)).toMatchObject({ stage: "planned", review: null, reviewCount: 1 });
  await expect(saveNativeReview(job, review)).rejects.toThrow(/stale against current requirements/);
});

it("continues an input-limit draft at its original cap and recovers an exhausted unusable historical critic", async () => {
  const { job, session } = await prepared();
  const operationHash = canonicalHash({ version: "native-producer-v2", jobId: job.id, request: job.request, model: "gpt-6-sol" });
  const aggregate = await reserveProviderEffect({ job, provider: "openai", step: "native-producer-result", idempotencyKey: `native-producer:${operationHash}`, inputHash: operationHash, model: "gpt-6-sol", promptVersion: "native-producer-v2", reservationMicrousd: 0 });
  await markEffectDispatched(aggregate.id, job);
  const unusable = { documentHash: canonicalHash(session.document), verdict: "Only symbolic inspection available", findings: [], noChangeReason: "No model result", modelUsed: false };
  await getPool().query("UPDATE native_job_plan SET creative_review_count=4,creative_review_history=$2::jsonb,creative_review=NULL WHERE job_id=$1", [job.id, JSON.stringify([unusable])]);
  await needsAttentionJob(job, "NATIVE_PARTIAL", "OPENAI_INPUT_LIMIT_EXCEEDED:135036:128000");
  expect((await nativeDraftView(owner, job.projectId, job.id)).canContinue).toBe(true);
  await resumeNativePartialJob(owner, job.projectId, job.id);
  await dispatchOutbox();
  const resumed = (await claimJobById(job.id, "finishing-resumed"))!;
  const reviewer = fakeModel().respond(good());
  const producer = fakeModel().respondWithTools([{ name: "review_native_score", args: {} }]).respond(new AIMessage("Finished"));
  await processJob(resumed, { scriptedModel: producer, scriptedReviewer: reviewer, library: createNativeLibrary(null) });
  expect((await jobSnapshot(owner, job.id)).state).toBe("succeeded");
  expect(reviewer.callCount).toBe(1);
  expect(await loadNativePlan(job.id)).toMatchObject({ reviewCount: 5, review: { modelUsed: true, formatRecovery: true } });
  expect((await nativeDraftView(owner, job.projectId, job.id)).stepCount).toBe(1);
  expect((await getPool().query("SELECT state FROM effect WHERE job_id=$1 AND step='native-producer-result'", [job.id])).rows).toEqual([{ state: "succeeded" }]);
  expect((await getPool().query("SELECT request FROM job WHERE id=$1", [job.id])).rows[0].request._nativeRun).toEqual(job.request._nativeRun);
}, 30_000);

it("retains failed recovery diagnostics, never grants another recovery, and replays a settled result without a new call", async () => {
  const { job, session } = await prepared();
  const reviewer = fakeModel().respond(new AIMessage("bad")).respond(new AIMessage("also bad"));
  const input = { job, direction, document: session.document, plan, attempt: 0, scriptedReviewer: reviewer };
  const review = await focusedNativeReview(input);
  expect(review).toMatchObject({ modelUsed: false, diagnostic: { code: "invalid_json" }, formatRecovery: true, contextHash: nativeReviewContextHash(direction, plan) });
  expect(await nativeFormatRecoveryAvailable(job.id)).toBe(false);
  expect(await focusedNativeReview(input)).toEqual(review);
  expect(reviewer.callCount).toBe(2);
});

it("reattaches a settled recovery after interruption without another critic call", async () => {
  const { job, session } = await prepared();
  const operationHash = canonicalHash({ version: "native-producer-v2", jobId: job.id, request: job.request, model: "gpt-6-sol" });
  const aggregate = await reserveProviderEffect({ job, provider: "openai", step: "native-producer-result", idempotencyKey: `native-producer:${operationHash}`, inputHash: operationHash, model: "gpt-6-sol", promptVersion: "native-producer-v2", reservationMicrousd: 0 });
  await markEffectDispatched(aggregate.id, job);
  const unusable = { documentHash: canonicalHash(session.document), verdict: "Unusable review", findings: [], noChangeReason: "Missing review", modelUsed: false };
  await getPool().query("UPDATE native_job_plan SET creative_review_count=4,creative_review_history=$2::jsonb,creative_review=NULL WHERE job_id=$1", [job.id, JSON.stringify([unusable])]);
  await focusedNativeReview({ job, direction, document: session.document, plan, attempt: 4, recovery: { diagnostic: { code: "historical_unusable", paths: [], finishReason: null } }, scriptedReviewer: fakeModel().respond(good()) });
  // Simulate interruption between durable provider settlement and plan save.
  await needsAttentionJob(job, "NATIVE_PARTIAL", "Interrupted after review settlement");
  expect((await nativeDraftView(owner, job.projectId, job.id)).canContinue).toBe(true);
  await resumeNativePartialJob(owner, job.projectId, job.id);
  await dispatchOutbox();
  const resumed = (await claimJobById(job.id, "review-reattach"))!;
  const reviewer = fakeModel();
  await processJob(resumed, { scriptedModel: fakeModel().respondWithTools([{ name: "review_native_score", args: {} }]).respond(new AIMessage("Finished")), scriptedReviewer: reviewer, library: createNativeLibrary(null) });
  expect((await jobSnapshot(owner, job.id)).state).toBe("succeeded");
  expect(reviewer.callCount).toBe(0);
  expect(await loadNativePlan(job.id)).toMatchObject({ reviewCount: 5, review: { modelUsed: true, formatRecovery: true } });
  expect((await getPool().query("SELECT id FROM effect WHERE job_id=$1 AND prompt_version='native-symbolic-review-repair-v1'", [job.id])).rowCount).toBe(1);
}, 30_000);

it("pauses exhausted substantive reviews immediately and rejects a doomed continuation", async () => {
  const { job, session } = await prepared();
  const old = { documentHash: canonicalHash(session.document), verdict: "Needs a real musical edit", findings: [], noChangeReason: "Historical review", modelUsed: true };
  await getPool().query("UPDATE native_job_plan SET creative_review_count=4,creative_review_history=$2::jsonb,creative_review=NULL WHERE job_id=$1", [job.id, JSON.stringify([old])]);
  const reviewer = fakeModel();
  const producer = fakeModel().respondWithTools([{ name: "review_native_score", args: {} }]);
  await processJob(job, { scriptedModel: producer, scriptedReviewer: reviewer, library: createNativeLibrary(null) });
  expect(await jobSnapshot(owner, job.id)).toMatchObject({ state: "needs_attention", error_message: expect.stringContaining("REVIEW_EXHAUSTED") });
  expect(producer.callCount).toBe(1);
  expect(reviewer.callCount).toBe(0);
  expect(await nativeDraftView(owner, job.projectId, job.id)).toMatchObject({ canContinue: false, continuationReason: expect.stringContaining("final review") });
  await expect(resumeNativePartialJob(owner, job.projectId, job.id)).rejects.toThrow(/review allowance/);
});

it("bounds varied inspection loops in real model input and retains the pending musical finding", async () => {
  const job = await create();
  const producer = fakeModel().respondWithTools([{ name: "record_native_plan", args: plan }]).respondWithTools([{ name: "compose_native_form", args: form }]).respondWithTools([{ name: "review_native_score", args: {} }]);
  for (let i = 0; i < 30; i++) producer.respondWithTools([{ name: "inspect_native_part", args: { partId: "lead", noteOffset: i } }]);
  const reviewer = fakeModel().respond(new AIMessage(JSON.stringify({ verdict: "A reply would develop the phrase.", findings: [{ priority: "high", sectionId: "whole", partId: "lead", observation: "Only one opening note", suggestedChange: "Add a quieter lower reply" }], noChangeReason: null })));
  await processJob(job, { scriptedModel: producer, scriptedReviewer: reviewer, library: createNativeLibrary(null) });
  expect(await jobSnapshot(owner, job.id)).toMatchObject({ state: "needs_attention", error_message: expect.stringContaining("REPEATED_NO_PROGRESS") });
  expect(producer.callCount).toBeLessThan(30);
  expect(JSON.stringify(producer.calls.at(-1)?.messages)).toContain("Add a quieter lower reply");
  expect(JSON.stringify(producer.calls.at(-1)?.messages)).toContain("omitted");
  expect((await nativeDraftView(owner, job.projectId, job.id)).stepCount).toBe(1);
}, 30_000);
