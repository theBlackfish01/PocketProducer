import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { getConfig } from "@pocket/core";
import { AIMessage, fakeModel, focusedNativeReview, nativeFormatRecoveryAvailable } from "@pocket/core/test-support";
import { canonicalHash, claimJobById, createNativeJob, createNativeLibrary, createProject, dispatchOutbox, getPool, jobSnapshot, loadNativePlan, nativeDraftView, nativeSnapshot, nativePlanSchema, nativeCreativeStateSchema, nativeReviewContextHash, NativeToolSession, seedNativeDocument, nativeFormOperations, saveNativePlan, saveNativeCreativeState, saveNativeReview, advanceNativePlan, reserveProviderEffect, markEffectDispatched, needsAttentionJob, resumeNativePartialJob, type JobRecord } from "@pocket/core";
import { processJob } from "@pocket/worker";
import { nativeFormSchema } from "@pocket/core";
import { boundOpenAiRequest } from "@pocket/core/test-support";
import { listProjects, requireProject, abandonNativePartialJob } from "@pocket/core";
import { completeProviderEffect, failProviderEffect, reconcileNativeStepConflict } from "@pocket/core";
import { nativeDocumentSchema } from "@pocket/core";
import { nativeReviewResponseFormat } from "@pocket/core/test-support";

let owner = "";
const config = getConfig(), originalConfig = { ...config };
afterEach(async () => {
  Object.assign(config, originalConfig);
  await getPool().query("DELETE FROM owner_usage_limit WHERE owner_id=$1", [owner]);
});
const direction = "A 4-bar melody";
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
async function create(profile: "standard" | "extended" = "standard", model = "gpt-6-sol"): Promise<JobRecord> {
  const project = await createProject(owner, "Finishing recovery test");
  const made = await createNativeJob({ ownerId: owner, projectId: project.id, kind: "native-generation", idempotencyKey: randomUUID(), request: { direction, profile, model }, expectedHeadId: null });
  await dispatchOutbox();
  return (await claimJobById(made.id, "finishing-test"))!;
}
async function prepared(profile: "standard" | "extended" = "standard", model = "gpt-6-sol") {
  const job = await create(profile, model);
  const session = new NativeToolSession(job, seedNativeDocument(direction), true, createNativeLibrary(null));
  await saveNativePlan(job, plan);
  await session.apply("initial", nativeFormOperations(nativeFormSchema.parse(form), []));
  return { job, session };
}

it("finishes through one compound tool without buying a goodbye turn, retaining subjective suggestions", async () => {
  const { job } = await prepared("standard", "gpt-6-luna");
  const producer = fakeModel().respondWithTools([{ name: "finish_native_arrangement", args: {} }]);
  const reviewer = fakeModel().respond(new AIMessage(JSON.stringify({ verdict: "A useful sparse statement with room to develop.", findings: [{ priority: "medium", sectionId: "whole", partId: "lead", observation: "Only one opening gesture", suggestedChange: "Consider a quiet answering note in a later revision" }], noChangeReason: null })));
  await processJob(job, { scriptedModel: producer, scriptedReviewer: reviewer, library: createNativeLibrary(null) });
  expect(await jobSnapshot(owner, job.id)).toMatchObject({ state: "succeeded" });
  expect(producer.callCount).toBe(1);
  expect(reviewer.callCount).toBe(1);
  expect(await loadNativePlan(job.id)).toMatchObject({ stage: "reviewed", reviewCount: 1, review: { modelUsed: true, findings: [{ priority: "medium" }] } });
  expect((await nativeSnapshot(owner, job.projectId)).versions).toHaveLength(1);
  const calls = (await getPool().query("SELECT state,cost_status FROM effect WHERE job_id=$1 AND step='producer-model-call' AND prompt_version='deep-producer-v2'", [job.id])).rows;
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ state: "succeeded", cost_status: "observed" });
});

it("completes procedural inspection and review after a normal final response without reopening creation", async () => {
  const { job } = await prepared();
  const producer = fakeModel().respond(new AIMessage("The requested musical statement is complete."));
  const reviewer = fakeModel().respond(good());
  await processJob(job, { scriptedModel: producer, scriptedReviewer: reviewer, library: createNativeLibrary(null) });
  expect(await jobSnapshot(owner, job.id)).toMatchObject({ state: "succeeded" });
  expect(producer.callCount).toBe(1);
  expect(reviewer.callCount).toBe(1);
  const saved = await loadNativePlan(job.id);
  expect(saved!.inspectedDocumentHash).toBe(saved!.review!.documentHash);
  expect(saved!.stage).toBe("reviewed");
});

it("defers review for missing objective requirements and bounds identical incomplete final responses", async () => {
  const { job, session } = await prepared();
  await session.apply("wrong-length", [{ kind: "setStructure", bars: 8, sections: [{ id: "whole", name: "Whole", startBar: 0, endBar: 8, intent: "A short statement" }] }]);
  const producer = fakeModel().respondWithTools([{ name: "review_native_score", args: {} }])
    .respondWithTools([{ name: "finish_native_arrangement", args: {} }])
    .respond(new AIMessage("Finished")).respond(new AIMessage("Finished"));
  const reviewer = fakeModel();
  await processJob(job, { scriptedModel: producer, scriptedReviewer: reviewer, library: createNativeLibrary(null) });
  expect(await jobSnapshot(owner, job.id)).toMatchObject({ state: "needs_attention", error_code: "NATIVE_PARTIAL" });
  expect(JSON.stringify(producer.calls[1]!.messages)).toContain("no review call was spent");
  expect(reviewer.callCount).toBe(0);
  expect(producer.callCount).toBe(4);
  expect((await loadNativePlan(job.id))!.reviewCount).toBe(0);
  expect((await nativeSnapshot(owner, job.projectId)).versions).toHaveLength(0);
});

it("explains repeated finish blockers and still accepts the targeted correction without extra reviews", async () => {
  const { job, session } = await prepared("standard", "gpt-6-luna");
  await session.apply("wrong-length", [{ kind: "setStructure", bars: 8, sections: [{ id: "whole", name: "Whole", startBar: 0, endBar: 8, intent: "A short statement" }] }]);
  const producer = fakeModel().respondWithTools([{ name: "finish_native_arrangement", args: {} }])
    .respondWithTools([{ name: "finish_native_arrangement", args: {} }])
    .respondWithTools([{ name: "apply_native_batch", args: { stepKey: "correct-length", operations: [{ kind: "setStructure", bars: 4, sections: [{ id: "whole", name: "Whole", startBar: 0, endBar: 4, intent: "A short statement" }] }] } }])
    .respondWithTools([{ name: "finish_native_arrangement", args: {} }]);
  const reviewer = fakeModel().respond(good());
  await processJob(job, { scriptedModel: producer, scriptedReviewer: reviewer, library: createNativeLibrary(null) });
  expect(JSON.stringify(producer.calls[2]!.messages)).toContain("Calling finish again or changing metadata will not resolve");
  expect(await jobSnapshot(owner, job.id)).toMatchObject({ state: "succeeded" });
  expect(producer.callCount).toBe(4);
  expect(reviewer.callCount).toBe(1);
  expect((await nativeSnapshot(owner, job.projectId)).versions).toHaveLength(1);
});

it("preserves the last current review against optional edits but allows exact confirmed-step replay", async () => {
  const { job, session } = await prepared();
  await session.apply("confirmed-mix", [{ kind: "setMix", partId: "lead", gain: 0.5 }]);
  const review = { documentHash: canonicalHash(session.document), contextHash: nativeReviewContextHash(direction, plan), verdict: "Useful statement", findings: [], noChangeReason: "Complete", modelUsed: true };
  await saveNativeReview(job, review);
  await getPool().query("UPDATE native_job_plan SET creative_review_count=4 WHERE job_id=$1", [job.id]);
  const producer = fakeModel()
    .respondWithTools([{ name: "configure_native_sound", args: { stepKey: "optional", operations: [{ kind: "setMix", partId: "lead", gain: 0.1 }] } }])
    .respondWithTools([{ name: "configure_native_sound", args: { stepKey: "confirmed-mix", operations: [{ kind: "setMix", partId: "lead", gain: 0.5 }] } }])
    .respondWithTools([{ name: "finish_native_arrangement", args: {} }]);
  const reviewer = fakeModel();
  await processJob(job, { scriptedModel: producer, scriptedReviewer: reviewer, library: createNativeLibrary(null) });
  expect(await jobSnapshot(owner, job.id)).toMatchObject({ state: "succeeded" });
  expect(JSON.stringify(producer.calls[1]!.messages)).toContain("last available review");
  expect(JSON.stringify(producer.calls[2]!.messages)).toContain("replayed");
  expect(reviewer.callCount).toBe(0);
  expect((await nativeSnapshot(owner, job.projectId)).current!.documentHash).toBe(review.documentHash);
  expect((await getPool().query("SELECT 1 FROM native_job_step WHERE job_id=$1 AND step_key='optional'", [job.id])).rowCount).toBe(0);
});

it("rejects changed arguments for a confirmed step key without aborting the producer or duplicating work", async () => {
  const job = await create();
  const first = { stepKey: "shape", operations: [{ kind: "setMix", partId: "lead", gain: 0.5 }] };
  const changed = { stepKey: "shape", operations: [{ kind: "setMix", partId: "lead", gain: 0.1 }] };
  const model = fakeModel()
    .respondWithTools([{ name: "compose_native_form", args: form }])
    .respondWithTools([{ name: "configure_native_sound", args: first }])
    .respondWithTools([{ name: "configure_native_sound", args: changed }])
    .respondWithTools([{ name: "configure_native_sound", args: first }])
    .respond(new AIMessage("The confirmed shape already satisfies the direction."));
  await processJob(job, { scriptedModel: model, library: createNativeLibrary(null) });
  const result = await jobSnapshot(owner, job.id);
  expect(result.state, result.error_message ?? "").toBe("succeeded");
  expect(JSON.stringify(model.calls[3]!.messages)).toContain("already committed different operations");
  expect(JSON.stringify(model.calls[3]!.messages)).toContain("No new changes were applied");
  expect(JSON.stringify(model.calls[4]!.messages)).toContain('replayed');
  const snapshot = await nativeSnapshot(owner, job.projectId);
  expect(snapshot.current!.document.parts.find(part => part.id === "lead")!.gain).toBe(0.5);
  const steps = (await getPool().query("SELECT step_key FROM native_job_step WHERE job_id=$1 ORDER BY ordinal", [job.id])).rows;
  expect(steps.filter(step => step.step_key === "shape")).toHaveLength(1);
  const effects = (await getPool().query("SELECT state,cost_status FROM effect WHERE job_id=$1", [job.id])).rows;
  expect(effects.every(effect => effect.state === "succeeded" && effect.cost_status === "observed")).toBe(true);
  const replay = new NativeToolSession(job, seedNativeDocument(direction));
  await replay.replay();
  await expect(replay.apply("shape", [{ kind: "setMix", partId: "lead", gain: 0.1 }])).rejects.toThrow("already committed different operations");
  expect(canonicalHash(replay.document)).toBe(snapshot.current!.documentHash);
  expect(await replay.apply("shape", [{ kind: "setMix", partId: "lead", gain: 0.5 }])).toMatchObject({ replayed: true });
});

it("reconciles only a verified local key collision while preserving paid receipts and requiring explicit continuation", async () => {
  const { job, session } = await prepared();
  const aggregate = await reserveProviderEffect({ job, provider: "openai", step: "native-producer-result", idempotencyKey: `collision:${job.id}`, inputHash: job.id, model: "gpt-6-sol", promptVersion: "native-producer-v2", reservationMicrousd: 0 });
  await markEffectDispatched(aggregate.id, job);
  const call = await reserveProviderEffect({ job, provider: "openai", step: "producer-model-call", idempotencyKey: `call:${job.id}`, inputHash: job.id, model: "gpt-6-sol", promptVersion: "deep-producer-v2", reservationMicrousd: 1000 });
  await markEffectDispatched(call.id, job);
  await completeProviderEffect({ effectId: call.id, job, output: { confirmed: true }, actualCostMicrousd: 123 });
  await failProviderEffect({ effectId: aggregate.id, job, errorClass: "Error", uncertain: false });
  await needsAttentionJob(job, "PROVIDER_OUTCOME_UNCERTAIN", "NATIVE_STEP_REPLAY_CONFLICT");
  const hash = canonicalHash(session.document);
  const paidBefore = (await getPool().query("SELECT * FROM effect WHERE id=$1", [call.id])).rows[0];
  const stepsBefore = (await getPool().query("SELECT * FROM native_job_step WHERE job_id=$1", [job.id])).rows;
  await expect(reconcileNativeStepConflict(randomUUID(), job.projectId, job.id, hash)).rejects.toThrow("Project not found");
  await expect(reconcileNativeStepConflict(owner, job.projectId, job.id, "f".repeat(64))).rejects.toThrow("differs");
  await getPool().query("UPDATE effect SET cost_status='unknown' WHERE id=$1", [call.id]);
  await expect(reconcileNativeStepConflict(owner, job.projectId, job.id, hash)).rejects.toThrow("external outcome");
  await getPool().query("UPDATE effect SET cost_status='observed' WHERE id=$1", [call.id]);
  await getPool().query("UPDATE native_job_step SET result_hash=$2 WHERE job_id=$1", [job.id, "f".repeat(64)]);
  await expect(reconcileNativeStepConflict(owner, job.projectId, job.id, hash)).rejects.toThrow("NATIVE_HISTORY_INCONSISTENT");
  await getPool().query("UPDATE native_job_step SET result_hash=$2 WHERE job_id=$1", [job.id, hash]);
  await getPool().query("UPDATE native_job_step SET operation_hash=$2 WHERE job_id=$1", [job.id, "f".repeat(64)]);
  await expect(reconcileNativeStepConflict(owner, job.projectId, job.id, hash)).rejects.toThrow("operation receipts are inconsistent");
  await getPool().query("UPDATE native_job_step SET operation_hash=$2 WHERE job_id=$1", [job.id, stepsBefore[0].operation_hash]);
  await getPool().query("UPDATE job SET request=jsonb_set(request,'{expectedNativeHeadId}',to_jsonb($2::text)) WHERE id=$1", [job.id, randomUUID()]);
  await expect(reconcileNativeStepConflict(owner, job.projectId, job.id, hash)).rejects.toThrow("differs");
  await getPool().query("UPDATE job SET request=$2 WHERE id=$1", [job.id, job.request]);
  expect((await getPool().query("SELECT state FROM effect WHERE id=$1", [aggregate.id])).rows[0].state).toBe("failed");
  await reconcileNativeStepConflict(owner, job.projectId, job.id, hash);
  expect(await jobSnapshot(owner, job.id)).toMatchObject({ state: "needs_attention", error_code: "NATIVE_PARTIAL" });
  expect((await nativeDraftView(owner, job.projectId, job.id))).toMatchObject({ documentHash: hash, canContinue: true });
  expect((await getPool().query("SELECT * FROM effect WHERE id=$1", [call.id])).rows[0]).toEqual(paidBefore);
  expect((await getPool().query("SELECT * FROM native_job_step WHERE job_id=$1", [job.id])).rows).toEqual(stepsBefore);
  expect((await nativeSnapshot(owner, job.projectId)).versions).toHaveLength(0);
  await resumeNativePartialJob(owner, job.projectId, job.id);
  expect((await jobSnapshot(owner, job.id)).state).toBe("queued");
});

it("sends meter, duration and incomplete-preview evidence in actual critic input", async () => {
  const { job, session } = await prepared();
  await session.apply("rhythm", [
    { kind: "setMeter", meter: { numerator: 3, denominator: 4 } },
    { kind: "addPart", part: { id: "drums", name: "Pulse", role: "percussion", device: { type: "heisenberg", parameters: {} }, gain: 0.5, pan: 0,
      notes: Array.from({ length: 12 }, (_, i) => ({ id: `hit-${i}`, startTick: i * 480, durationTicks: 240, pitch: i % 3 === 2 ? 38 : 42, velocity: 1 })), placements: [], sourceRegions: [], effects: [], automation: [] } }
  ]);
  const reviewer = fakeModel().respond(good());
  await focusedNativeReview({ job, direction, document: session.document, plan, attempt: 1, scriptedReviewer: reviewer });
  const body = JSON.parse(reviewer.calls[0]!.messages[1]!.text) as { confirmedScore: { timing: unknown; sections: { parts: { id: string; omittedPreviewOnsets: number; rhythmWindow: { notes: number[][] } }[] }[] } };
  expect(body.confirmedScore.timing).toMatchObject({ ticksPerBar: 2880, ticksPerQuarter: 960, meter: { numerator: 3, denominator: 4 } });
  const drums = body.confirmedScore.sections[0]!.parts.find(part => part.id === "drums")!;
  expect(drums.omittedPreviewOnsets).toBe(4);
  expect(drums.rhythmWindow).toMatchObject({ endTick: 5760, totalOnsets: 12, omittedOnsets: 0 });
  expect(drums.rhythmWindow.notes).toContainEqual([5280, 38, 1, 240]);
  expect(reviewer.calls[0]!.messages[0]!.text).toContain("never infer missing later notes");
});

it("charges a truncated Luna response without applying its tools and gates retries on the actual failed envelope", async () => {
  config.NATIVE_MODEL_OUTPUT_TOKENS = 32768;
  const job = await create("standard", "gpt-6-luna");
  expect(job.request._nativeRun).toMatchObject({ model: "gpt-6-luna", reasoningEffort: "xhigh", maxOutputTokens: 32768, maxJobCostUsd: 5 });
  const truncated = Object.assign(new AIMessage({ content: "", tool_calls: [{ id: "unfinished", name: "configure_native_sound", args: { stepKey: "must-not-commit", operations: [{ kind: "setMix", partId: "lead", gain: 0.1 }] } }], response_metadata: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } } }), { usage_metadata: { input_tokens: 1000, output_tokens: 32768, total_tokens: 33768, output_token_details: { reasoning: 32000 } } });
  const producer = fakeModel().respondWithTools([{ name: "compose_native_form", args: form }]).respond(truncated);
  await processJob(job, { scriptedModel: producer, library: createNativeLibrary(null) });
  const snapshot = await jobSnapshot(owner, job.id);
  expect(snapshot).toMatchObject({ state: "needs_attention", error_code: "NATIVE_PARTIAL" });
  expect(snapshot.error_message).toContain("output_limit=32768");
  const draft = await nativeDraftView(owner, job.projectId, job.id);
  expect(draft).toMatchObject({ canContinue: false, stepCount: 1 });
  expect(draft.document!.parts.find(p => p.id === "lead")!.gain).toBe(0.6);
  expect((await nativeSnapshot(owner, job.projectId)).versions).toHaveLength(0);
  const effects = (await getPool().query("SELECT state,cost_status,output FROM effect WHERE job_id=$1 AND step='producer-model-call' ORDER BY created_at", [job.id])).rows;
  expect(effects).toHaveLength(2);
  expect(effects.every(e => e.state === "succeeded" && e.cost_status === "observed")).toBe(true);
  expect(effects[0].output.completion.outputLimit).toBe(32768);
  expect(effects[1].output.completion).toMatchObject({ incomplete: true, reason: "max_output_tokens", outputLimit: 32768, outputTokens: 32768, reasoningTokens: 32000 });
  await expect(resumeNativePartialJob(owner, job.projectId, job.id)).rejects.toThrow();
  // Emulate a previously truncated hidden-cap job. Its stored allowance need
  // not increase: the fixed dispatcher now actually honours that allowance.
  await getPool().query("UPDATE job SET error_message=$2 WHERE id=$1", [job.id, "OPENAI_INCOMPLETE_RESPONSE: increase the captured output allowance before continuing this confirmed draft"]);
  expect((await nativeDraftView(owner, job.projectId, job.id)).canContinue).toBe(true);
  await getPool().query("UPDATE effect SET cost_status='unknown' WHERE job_id=$1 AND step='producer-model-call'", [job.id]);
  expect((await nativeDraftView(owner, job.projectId, job.id)).canContinue).toBe(false);
  await getPool().query("UPDATE effect SET cost_status='observed' WHERE job_id=$1 AND step='producer-model-call'", [job.id]);
  await resumeNativePartialJob(owner, job.projectId, job.id);
  expect((await jobSnapshot(owner, job.id)).state).toBe("queued");
  expect((await nativeDraftView(owner, job.projectId, job.id)).documentHash).toBe(draft.documentHash);
  expect((await getPool().query("SELECT count(*)::int AS n FROM effect WHERE job_id=$1 AND step='producer-model-call'", [job.id])).rows[0].n).toBe(2);
});

it("keeps current inspection coverage in the real producer input so final reads need not repeat", async () => {
  const job = await create();
  const producer = fakeModel().respondWithTools([{ name: "compose_native_form", args: form }])
    .respondWithTools([{ name: "inspect_native_section", args: { sectionId: "whole" } }])
    .respondWithTools([{ name: "configure_native_sound", args: { stepKey: "refine-after-inspection", operations: [{ kind: "setMix", partId: "lead", gain: 0.5 }] } }])
    .respond(new AIMessage("Finished"));
  await processJob(job, { scriptedModel: producer, library: createNativeLibrary(null) });
  const input = producer.calls[2]!.messages.map(m => m.text).join("\n");
  expect(input).toContain('"inspectedSectionIds":["whole"]');
  expect(input).toContain('"requiredSectionCount":1');
  expect(input).toContain("Do not repeat procedural reads");
  const afterEdit = producer.calls[3]!.messages.map(m => m.text).join("\n");
  expect(afterEdit).toContain('"inspectedSectionIds":[]');
  expect((await jobSnapshot(owner, job.id)).state).toBe("succeeded");
});

it.each([128000, 110000])("fits a large arranged score into the %i critic envelope without losing the brief or section coverage", async (limit) => {
  // Test the specified captured envelope independently of local .env / CI's 96k default.
  // afterEach restores the installation configuration; production limits are unchanged.
  config.MAX_OPENAI_INPUT_TOKENS = limit;
  const { job, session } = await prepared();
  job.request._nativeRun = { ...(job.request._nativeRun as object), maxInputTokens: limit };
  const document = nativeDocumentSchema.parse({ ...session.document, bars: 96,
    sections: Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, name: `Section ${i + 1}`, startBar: i * 8, endBar: (i + 1) * 8 })),
    parts: Array.from({ length: 12 }, (_, i) => ({ ...session.document.parts[0]!, id: `p${i}`, name: `Instrument ${i + 1}`,
      notes: Array.from({ length: 384 }, (_, n) => ({ id: `n${n}`, startTick: n * 960, durationTicks: 480, pitch: 48 + i, velocity: 0.6 })),
      automation: ["gain", "pan", "device.filter.cutoffFrequencyHz", "device.filter.resonance"].map((target, j) => ({ id: `curve${j}`, target, points: [{ tick: 0, value: 0.2, interpolation: "linear" }, { tick: 368639, value: 0.8 }] }))
    })) });
  const reviewer = fakeModel().respond(good());
  const exactBrief = "A 96-bar ensemble with a developing middle and altered return. Keep every section." + (limit === 110000 ? " Preserve the theme.".repeat(1600) : "");
  const previousReviews = [{ documentHash: canonicalHash(document), verdict: "The return needs development.", findings: [{ priority: "medium" as const, sectionId: "s11", partId: "p0", observation: "The return repeats the opening.", suggestedChange: "Change its rhythm." }], noChangeReason: null, modelUsed: true }];
  const review = await focusedNativeReview({ job, direction: exactBrief, document, plan, previousReviews, attempt: 1, scriptedReviewer: reviewer });
  expect(review.modelUsed).toBe(true);
  const request = reviewer.calls[0]!;
  expect(boundOpenAiRequest([request.messages], 1600, limit, { response_format: nativeReviewResponseFormat }).inputTokenBound).toBeLessThanOrEqual(limit);
  const body = JSON.parse(request.messages[1]!.text) as { originalBrief: string; previousReviews: { findings: unknown }[]; confirmedScore: { documentHash: string; sections: { id: string; parts: unknown[] }[]; evidenceLayout: { mode: string } } };
  expect(body.originalBrief).toBe(exactBrief);
  expect(body.previousReviews[0]!.findings).toEqual(previousReviews[0]!.findings);
  expect(body.confirmedScore.documentHash).toBe(canonicalHash(document));
  expect(body.confirmedScore.sections.map((s: { id: string }) => s.id)).toEqual(document.sections.map(s => s.id));
  expect(body.confirmedScore.sections.every((s: { parts: unknown[] }) => s.parts.length === 12)).toBe(true);
  expect(body.confirmedScore.evidenceLayout).toBeDefined();
  if (limit === 110000) expect(body.confirmedScore.evidenceLayout.mode).toBe("bounded-tuples");
});

it("rejects irreducible critic input before reserving or dispatching, without shortening the brief", async () => {
  const { job, session } = await prepared();
  const before = (await getPool().query("SELECT id FROM effect WHERE job_id=$1", [job.id])).rows;
  const reviewer = fakeModel().respond(good());
  await expect(focusedNativeReview({ job, direction: "x".repeat(128000), document: session.document, plan, attempt: 1, scriptedReviewer: reviewer })).rejects.toThrow("OPENAI_INPUT_LIMIT_EXCEEDED");
  expect(reviewer.calls).toHaveLength(0);
  expect((await getPool().query("SELECT id FROM effect WHERE job_id=$1", [job.id])).rows).toEqual(before);
});

it("replays a settled same-score critic receipt after evidence formatting changes, without a new paid call", async () => {
  const { job, session } = await prepared();
  const reviewer = fakeModel().respond(good());
  const input = { job, direction, document: session.document, plan, attempt: 0, scriptedReviewer: reviewer };
  const first = await focusedNativeReview(input);
  // Simulate a settled pre-upgrade request envelope. Its semantic identity
  // still binds the same job, score, requirements, model and review attempt.
  await getPool().query("UPDATE effect SET input_hash=$2 WHERE job_id=$1 AND prompt_version='native-symbolic-review-v2'", [job.id, canonicalHash({ earlierEnvelope: true })]);
  const before = (await getPool().query("SELECT * FROM effect WHERE job_id=$1", [job.id])).rows;
  expect(await focusedNativeReview(input)).toEqual(first);
  expect(reviewer.callCount).toBe(1);
  expect((await getPool().query("SELECT * FROM effect WHERE job_id=$1", [job.id])).rows).toEqual(before);
  await getPool().query("UPDATE effect SET state='uncertain',cost_status='unknown' WHERE job_id=$1 AND prompt_version='native-symbolic-review-v2'", [job.id]);
  await expect(focusedNativeReview(input)).rejects.toThrow(/unconfirmed|uncertain/);
  expect(reviewer.callCount).toBe(1);
  await getPool().query("UPDATE effect SET state='succeeded',cost_status='observed',output=jsonb_set(output,'{review,contextHash}',to_jsonb($2::text)) WHERE job_id=$1 AND prompt_version='native-symbolic-review-v2'", [job.id, 'f'.repeat(64)]);
  await expect(focusedNativeReview(input)).rejects.toThrow(/INPUT_MISMATCH/);
  expect(reviewer.callCount).toBe(1);
});

it("sends actual shared ambience settings to the focused critic, not only send IDs", async () => {
  const { job, session } = await prepared();
  const bus = { id: "room", name: "Small shared room", roomSize: 0.24, preDelayMs: 26, damp: 0.68 };
  await session.apply("ambience", [{ kind: "setReverbBus", bus }, { kind: "setSend", partId: "lead", busId: "room", gain: 0.09 },
    { kind: "setStructure", bars: 4, tempoBpm: 92, sections: [{ id: "first", name: "First", startBar: 0, endBar: 1, intent: "Start" }, { id: "middle", name: "Middle", startBar: 1, endBar: 2, intent: "Open" }, { id: "end", name: "End", startBar: 2, endBar: 4, intent: "Settle" }] },
    { kind: "addAutomation", partId: "lead", automation: { id: "crossing-tone", target: "gain", points: [{ tick: 0, value: 0.1, interpolation: "linear" }, { tick: 11520, value: 0.7 }] } }
  ]);
  const reviewer = fakeModel().respond(good());
  await focusedNativeReview({ job, direction, document: session.document, plan, attempt: 0, scriptedReviewer: reviewer });
  const payload = JSON.parse(reviewer.calls[0]!.messages.find((message) => message.type === "human")!.text);
  expect(payload.confirmedScore.sharedProcessing).toEqual({ reverbBus: bus, delayBus: null, groups: [], master: null });
  expect(payload.confirmedScore.soundEvidence[0].sends).toEqual([{ busId: "room", gain: 0.09 }]);
  expect(payload.confirmedScore.sections[1].parts[0].automation[0].first).toBeCloseTo(0.3);
  expect(payload.confirmedScore.sections[1].parts[0].automation[0].last).toBeCloseTo(0.5, 3);
  expect(reviewer.calls[0]!.messages.find((message) => message.type === "system")!.text).toContain('"maxLength":300');
  expect(reviewer.calls[0]!.messages.find((message) => message.type === "system")!.text).toContain("absence of listening is a standing limitation, not a defect");
});

it("compacts final system/schema/reasoning input through the real producer before accounting dispatch", async () => {
  const job = await create();
  const model = fakeModel().respondWithTools([{ name: "record_native_plan", args: plan }]);
  for (let i = 0; i < 5; i++) model.respond(new AIMessage({ content: "", response_metadata: { output: [{ type: "reasoning", encrypted_content: `opaque-${i}:` + "x".repeat(24000) }] }, tool_calls: [{ id: `read-${i}`, name: "discover_native_capabilities", args: { query: "heisenberg parameter ranges" } }] }));
  model.respondWithTools([{ name: "compose_native_form", args: form }]).respond(new AIMessage("Finished"));
  await processJob(job, { scriptedModel: model, library: createNativeLibrary(null) });
  const state = await jobSnapshot(owner, job.id);
  expect(state.state, state.error_message ?? "").toBe("succeeded");
  const finalRead = model.calls[6]!.messages;
  expect(JSON.stringify(finalRead)).toContain("opaque-4:");
  expect(JSON.stringify(finalRead)).not.toContain("opaque-0:");
  expect(finalRead.some((message) => message.type === "system")).toBe(true);
  expect(() => boundOpenAiRequest([finalRead], 900, 128000)).not.toThrow();
  const effects = (await getPool().query("SELECT state FROM effect WHERE job_id=$1 AND step='producer-model-call'", [job.id])).rows;
  expect(effects).toHaveLength(model.callCount);
  expect(effects.every((effect) => effect.state === "succeeded")).toBe(true);
}, 30_000);

it("keeps initial creative bookkeeping out of refining in either parallel tool order", async () => {
  for (const creativeFirst of [true, false]) {
    const job = await create();
    await saveNativePlan(job, plan);
    const save = () => saveNativeCreativeState(job, nativeCreativeStateSchema.parse({ identity: "Amber idea", palette: [], decisions: ["Choose a compact ensemble"] }));
    const hash = canonicalHash(seedNativeDocument(direction));
    if (creativeFirst) { await save(); await advanceNativePlan(job, "building", hash); }
    else { await advanceNativePlan(job, "building", hash); await save(); }
    expect((await loadNativePlan(job.id))?.stage).toBe("building");
  }
});

it("retains actual current musical observations when production compaction evicts inspection replay", async () => {
  const job = await create();
  const model = fakeModel().respondWithTools([{ name: "compose_native_form", args: form }])
    .respond(new AIMessage({ content: "", response_metadata: { output: [{ type: "reasoning", encrypted_content: "inspection-opaque:" + "x".repeat(100000) }] }, tool_calls: [
      { id: "part-facts", name: "inspect_native_part", args: { partId: "lead" } },
      { id: "section-facts", name: "inspect_native_section", args: { sectionId: "whole" } }
    ] }))
    .respondWithTools([{ name: "apply_native_batch", args: { stepKey: "refine", operations: [{ kind: "setMix", partId: "lead", gain: 0.55 }] } }])
    .respond(new AIMessage("Finished"));
  await processJob(job, { scriptedModel: model, library: createNativeLibrary(null) });
  const state = await jobSnapshot(owner, job.id);
  expect(state.state, state.error_message ?? "").toBe("succeeded");
  const checklist = model.calls[2]!.messages.findLast((message) => message.text.startsWith("Production checklist"))!;
  const context = JSON.parse(checklist.text.slice(checklist.text.indexOf("{"))) as { currentObservations: { tool: string; content: string }[] };
  const partRead = context.currentObservations.find((entry) => entry.tool === "inspect_native_part")!;
  expect(JSON.parse(partRead.content)).toMatchObject({ part: { id: "lead", notes: [{ pitch: 64 }] }, totalMaterializedNotes: 1 });
  expect(JSON.stringify(model.calls[2]!.messages)).not.toContain("inspection-opaque");
  const afterEdit = model.calls[3]!.messages.findLast((message) => message.text.startsWith("Production checklist"))!;
  expect(afterEdit.text).toContain('"currentObservations":[]');
  expect((await nativeSnapshot(owner, job.projectId)).current!.document.parts[0]!.gain).toBe(0.55);
}, 30_000);

it.each([96000, 128000])("survives a mixed oversized error exchange before initial music at a %i input ceiling", async (inputCeiling) => {
  config.MAX_OPENAI_INPUT_TOKENS = inputCeiling;
  const job = await create();
  const model = fakeModel().respondWithTools([{ name: "record_native_plan", args: plan }])
    .respond(new AIMessage({ content: "", response_metadata: { output: [{ type: "reasoning", encrypted_content: "x".repeat(60000) }] }, tool_calls: [
      { id: "bad", name: "inspect_native_section", args: { sectionId: "missing" } }, { id: "sound", name: "inspect_editable_sound", args: { partId: "starting-voice" } },
      { id: "skill", name: "read_file", args: { file_path: "/skills/native-arrangement/SKILL.md", limit: 1000 } }
    ] }))
    .respondWithTools([{ name: "select_native_tools", args: { focus: "batch" } }])
    .respondWithTools([{ name: "apply_native_batch", args: { stepKey: "build", operations: nativeFormOperations(nativeFormSchema.parse(form), []) } }])
    .respond(new AIMessage("Finished"));
  await processJob(job, { scriptedModel: model, library: createNativeLibrary(null) });
  const state = await jobSnapshot(owner, job.id);
  expect(state.state, state.error_message ?? "").toBe("succeeded");
  const messages = JSON.stringify(model.calls[3]?.messages);
  expect(messages).toContain("Prior completed tool failures");
  expect(messages).not.toContain("x".repeat(1000));
  expect(messages).toContain("For new music, use compose_native_scene");
  const checklist = model.calls[3]!.messages.findLast(message => message.text.startsWith("Production checklist"))!;
  const guidance = JSON.parse(checklist.text.slice(checklist.text.indexOf("{"))) as { priorGuidance: unknown[]; omittedGuidance: number };
  // Recalled skill excerpts are optional under input pressure; essential
  // instructions and explicit omission accounting must remain at either cap.
  if (JSON.stringify(guidance.priorGuidance).includes("Prefer `compose_native_scene`")) expect(guidance.priorGuidance.length).toBeGreaterThan(0);
  else expect(guidance.omittedGuidance).toBeGreaterThan(0);
  const rows = (await getPool().query("SELECT output->'inputReservationBytes' AS bounds FROM effect WHERE job_id=$1 AND step='producer-model-call'", [job.id])).rows;
  expect(rows.every((row) => row.bounds.envelope < 80000)).toBe(true);
}, 30_000);

it("constructs, develops, shapes and inspects through compound tools with replay-safe receipts", async () => {
  const job = await create();
  const scene = { stepKey: "scene", replaceSeed: true, title: "Tick scene", structure: { bars: 4, sections: [{ id: "whole", name: "Whole", startBar: 0, endBar: 4 }] },
    parts: [{ id: "lead", name: "Lead", role: "melody", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0,
      automation: [{ id: "gain-curve", target: "gain", points: [{ tick: 0, value: 0.5 }, { tick: 15360, value: 0.5 }] }] }],
    patterns: [{ id: "theme", partId: "lead", name: "Theme", lengthTicks: 3840, events: [[691, 1201, 64, 0.7]] }],
    placements: [{ partId: "lead", placement: { id: "first", motifId: "theme", startTick: 0, repeats: 2, transpose: 0 } }, { partId: "lead", placement: { id: "last", motifId: "theme", startTick: 7680, repeats: 2, transpose: 0 } }],
    inspect: { sectionIds: ["not-there"] } };
  const producer = fakeModel().respondWithTools([{ name: "compose_native_scene", args: scene }])
    .respondWithTools([{ name: "compose_native_scene", args: { ...scene, inspect: { sectionIds: ["whole"], soundPartIds: ["lead"] } } }])
    .respondWithTools([{ name: "inspect_editable_sound", args: { partId: "lead" } }, { name: "apply_native_batch", args: { stepKey: "wrong", operations: [{ kind: "setMix", partId: "missing", gain: 0.5 }] } }])
    .respondWithTools([{ name: "develop_native_theme", args: { stepKey: "develop", operations: [{ kind: "varyMotifInstance", partId: "lead", placementId: "last", newMotifId: "answer", name: "Answer", pitchShiftSemitones: 7 }], inspect: { sectionIds: ["whole"] } } }])
    .respondWithTools([{ name: "shape_native_sections", args: { stepKey: "shape", operations: [{ kind: "editSectionAutomation", partId: "lead", sectionId: "whole", automationId: "gain-curve", points: [{ tick: 0, value: 0.5, interpolation: "linear" }, { tick: 15000, value: 0.7 }, { tick: 15360, value: 0.5 }] }], inspect: { sectionIds: ["whole"] } } }])
    .respond(new AIMessage("Finished"));
  await processJob(job, { scriptedModel: producer, library: createNativeLibrary(null) });
  const snapshot = await jobSnapshot(owner, job.id);
  expect(snapshot.state, snapshot.error_message ?? "").toBe("succeeded");
  expect(JSON.stringify(producer.calls[1]?.messages)).toContain('committed');
  expect(JSON.stringify(producer.calls[1]?.messages)).toContain('inspectionError');
  expect(JSON.stringify(producer.calls[2]?.messages)).toContain('replayed');
  expect(JSON.stringify(producer.calls[3]?.messages)).toContain('Unknown part missing');
  expect(JSON.stringify(producer.calls[3]?.messages)).toContain('automationValueRange');
  const current = (await nativeSnapshot(owner, job.projectId)).current!.document;
  expect(current.motifs.find((m) => m.id === "answer")?.notes[0]?.pitch).toBe(71);
  expect(current.motifs.find((m) => m.id === "theme")?.notes[0]?.startTick).toBe(691);
  expect((await nativeDraftView(owner, job.projectId, job.id)).stepCount).toBe(3);
}, 30_000);

it("keeps incremental scenes and recent inspection context after music, with focused sound and full edits on demand", async () => {
  const job = await create("standard", "gpt-6-luna");
  const opening = { stepKey: "opening", replaceSeed: true, structure: { bars: 4, sections: [{ id: "whole", name: "Whole", startBar: 0, endBar: 4 }] },
    parts: [{ id: "lead", name: "Lead", role: "melody", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0 }],
    patterns: [{ id: "opening", partId: "lead", name: "Opening", lengthTicks: 3840, events: [[0, 960, 64, 0.7]] }],
    placements: [{ partId: "lead", placement: { id: "first", motifId: "opening", startTick: 0, repeats: 2, transpose: 0 } }] };
  const sound = { stepKey: "sound", operations: [
    { kind: "setMix", partId: "lead", gain: 0.5 },
    { kind: "addAutomation", partId: "lead", automation: { id: "tone", target: "device.filter.cutoffFrequencyHz", points: [{ tick: 0, value: 0.2, interpolation: "linear" }, { tick: 15360, value: 0.6 }] } }
  ], inspect: { sectionIds: ["whole"], soundPartIds: ["lead"] } };
  const model = fakeModel().respondWithTools([{ name: "compose_native_scene", args: opening }])
    .respond(new AIMessage({ content: "", response_metadata: { output: [{ type: "reasoning", encrypted_content: "recent-inspection:" + "x".repeat(20000) }] }, tool_calls: [
      { id: "part", name: "inspect_native_part", args: { partId: "lead", noteLimit: 12 } },
      { id: "section", name: "inspect_native_section", args: { sectionId: "whole" } }
    ] }))
    .respondWithTools([{ name: "compose_native_scene", args: { stepKey: "answer", patterns: [{ id: "answer", partId: "lead", name: "Answer", lengthTicks: 3840, events: [[480, 1440, 67, 0.6]] }], placements: [{ partId: "lead", placement: { id: "last", motifId: "answer", startTick: 7680, repeats: 2, transpose: 0 } }] } }])
    .respondWithTools([{ name: "select_native_tools", args: { focus: "sound" } }])
    .respondWithTools([{ name: "configure_native_sound", args: sound }])
    .respondWithTools([{ name: "configure_native_sound", args: sound }])
    .respondWithTools([{ name: "select_native_tools", args: { focus: "batch" } }])
    .respondWithTools([{ name: "apply_native_batch", args: { stepKey: "mix", operations: [{ kind: "setMix", partId: "lead", pan: 0.1 }] } }])
    .respondWithTools([{ name: "select_native_tools", args: { focus: "none" } }])
    .respondWithTools([{ name: "select_native_tools", args: { focus: "scene" } }])
    .respond(new AIMessage("Finished"));
  const menus: string[] = [];
  const bind = model.bindTools.bind(model);
  model.bindTools = (tools) => { menus.push(JSON.stringify(tools.map((entry) => "name" in entry ? entry.name : entry))); return bind(tools); };
  await processJob(job, { scriptedModel: model, library: createNativeLibrary(null) });
  const state = await jobSnapshot(owner, job.id);
  expect(state.state, state.error_message ?? "").toBe("succeeded");
  const names = (index: number) => menus[index];
  expect(names(2)).toContain('"compose_native_scene"');
  expect(names(2)).not.toContain('"apply_native_batch"');
  expect(JSON.stringify(model.calls[2]!.messages)).toContain("recent-inspection:");
  expect(names(4)).toContain('"configure_native_sound"');
  expect(names(4)).not.toContain('"compose_native_scene"');
  expect(names(7)).toContain('"apply_native_batch"');
  expect(names(7)).not.toContain('"configure_native_sound"');
  expect(names(9)).toContain('"compose_native_scene"');
  expect(model.calls[4]!.messages.map((message) => message.text).join("\n")).toContain('"activeToolMenu":{"focus":"sound","constructionTools":["configure_native_sound"]');
  expect(model.calls[10]!.messages.map((message) => message.text).join("\n")).toContain('"alreadyActive":true');
  const envelopes = (await getPool().query("SELECT output->'inputReservationBytes'->>'envelope' AS bytes FROM effect WHERE job_id=$1 AND step='producer-model-call' ORDER BY created_at", [job.id])).rows;
  expect(Number(envelopes[2]?.bytes)).toBeLessThan(50_000);
  expect(Number(envelopes[4]?.bytes)).toBeLessThan(50_000);
  const score = (await nativeSnapshot(owner, job.projectId)).current!.document;
  expect(score.parts[0]).toMatchObject({ gain: 0.5, pan: 0.1 });
  expect(score.parts[0]!.automation).toHaveLength(1);
  expect(score.motifs.map((m) => m.id)).toEqual(["opening", "answer"]);
  expect((await nativeDraftView(owner, job.projectId, job.id)).stepCount).toBe(4);
}, 30_000);

it("projects confirmed draft titles without renaming explicit titles or exposing another owner's work", async () => {
  const { job, session } = await prepared();
  expect((await requireProject(owner, job.projectId)).title).toBe("Finishing recovery test");
  await getPool().query("UPDATE project SET title='Untitled listening room' WHERE id=$1", [job.projectId]);
  expect((await requireProject(owner, job.projectId)).title).toBe(session.document.title);
  expect((await listProjects(owner)).find((p) => p.id === job.projectId)?.title).toBe(session.document.title);
  expect(await listProjects(randomUUID())).toEqual([]);
  await expect(requireProject(randomUUID(), job.projectId)).rejects.toThrow("Project not found");
  await needsAttentionJob(job, "NATIVE_PARTIAL", "OPENAI_INPUT_LIMIT_EXCEEDED:131409:128000");
  await abandonNativePartialJob(owner, job.projectId, job.id);
  expect((await requireProject(owner, job.projectId)).title).toBe("Untitled listening room");
});

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

it("stops finishing passes when the required review cannot be obtained, preserving the draft", async () => {
  const { job, session } = await prepared();
  const stale = { documentHash: canonicalHash(session.document), verdict: "Earlier substantive review", findings: [], noChangeReason: "Earlier requirements were met", modelUsed: true, contextHash: "0".repeat(64) };
  await getPool().query("UPDATE native_job_plan SET creative_review_count=4,creative_review_history=$2::jsonb,creative_review=NULL WHERE job_id=$1", [job.id, JSON.stringify([stale])]);
  const producer = fakeModel().respond(new AIMessage("The review is unavailable; the draft remains."));
  const reviewer = fakeModel();
  await processJob(job, { scriptedModel: producer, scriptedReviewer: reviewer, library: createNativeLibrary(null) });
  const state = await jobSnapshot(owner, job.id);
  expect(state.state).toBe("needs_attention");
  expect(state.error_message).toContain("REVIEW_EXHAUSTED");
  expect(producer.callCount).toBe(1);
  expect(reviewer.callCount).toBe(0);
  expect((await nativeSnapshot(owner, job.projectId)).current).toBeNull();
  expect((await nativeDraftView(owner, job.projectId, job.id)).document).toEqual(session.document);
});

it.each(["standard", "extended"] as const)("reattaches a settled %s recovery after interruption without another critic call", async (profile) => {
  const { job, session } = await prepared(profile);
  const reviewLimit = profile === "extended" ? 6 : 4;
  const operationHash = canonicalHash({ version: "native-producer-v2", jobId: job.id, request: job.request, model: "gpt-6-sol" });
  const aggregate = await reserveProviderEffect({ job, provider: "openai", step: "native-producer-result", idempotencyKey: `native-producer:${operationHash}`, inputHash: operationHash, model: "gpt-6-sol", promptVersion: "native-producer-v2", reservationMicrousd: 0 });
  await markEffectDispatched(aggregate.id, job);
  const unusable = { documentHash: canonicalHash(session.document), verdict: "Unusable review", findings: [], noChangeReason: "Missing review", modelUsed: false };
  await getPool().query("UPDATE native_job_plan SET creative_review_count=$3,creative_review_history=$2::jsonb,creative_review=NULL WHERE job_id=$1", [job.id, JSON.stringify([unusable]), reviewLimit]);
  // Raising DB capacity must not allow another ordinary review or an unbacked repair.
  const candidate = { ...unusable, modelUsed: true, contextHash: nativeReviewContextHash(direction, plan) };
  await expect(saveNativeReview(job, candidate)).rejects.toThrow(/exhausted/);
  await expect(saveNativeReview(job, { ...candidate, formatRecovery: true })).rejects.toThrow(/exhausted/);
  await focusedNativeReview({ job, direction, document: session.document, plan, attempt: reviewLimit, recovery: { diagnostic: { code: "historical_unusable", paths: [], finishReason: null } }, scriptedReviewer: fakeModel().respond(good()) });
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
  expect(await loadNativePlan(job.id)).toMatchObject({ reviewCount: reviewLimit + 1, review: { modelUsed: true, formatRecovery: true } });
  expect((await getPool().query("SELECT id FROM effect WHERE job_id=$1 AND prompt_version='native-symbolic-review-repair-v1'", [job.id])).rowCount).toBe(1);
  expect(await nativeFormatRecoveryAvailable(job.id)).toBe(false);
}, 30_000);

it.each([
  ["user", "gpt-6-sol", "openai"],
  ["provider", "gpt-6-sol", "openai"],
  ["provider", "gemini-3.7-flash", "gemini"],
  ["provider", "deepseek/deepseek-v4-pro-0813", "gateway"],
] as const)("blocks continuation for exhausted %s allowance on %s without changing the saved job", async (scope, model, provider) => {
  const { job } = await prepared("standard", model);
  const aggregate = await reserveProviderEffect({ job, provider, step: "native-producer-result", idempotencyKey: `paused:${job.id}`, inputHash: job.id, model, promptVersion: "native-producer-v2", reservationMicrousd: 0 });
  await markEffectDispatched(aggregate.id, job);
  await needsAttentionJob(job, "NATIVE_PARTIAL", "Waiting for allowance");
  expect((await nativeDraftView(owner, job.projectId, job.id)).canContinue).toBe(true);
  const effectsBefore = (await getPool().query("SELECT * FROM effect WHERE job_id=$1", [job.id])).rows;
  const poolKey = provider === "openai" ? "OPENAI_POOL_BUDGET_USD" : provider === "gemini" ? "GEMINI_POOL_BUDGET_USD" : "GATEWAY_POOL_BUDGET_USD";
  if (scope === "user") await getPool().query("INSERT INTO owner_usage_limit(owner_id,limit_microusd) VALUES($1,0)", [owner]);
  else config[poolKey] = 0;
  const reason = scope === "user" ? /user allowance/ : /provider's shared allowance/;
  const draft = await nativeDraftView(owner, job.projectId, job.id);
  expect(draft).toMatchObject({ canContinue: false, canExtend: false, stepCount: 1 });
  expect(draft.continuationReason).toMatch(reason);
  await expect(resumeNativePartialJob(owner, job.projectId, job.id)).rejects.toThrow(reason);
  expect((await jobSnapshot(owner, job.id)).state).toBe("needs_attention");
  expect((await getPool().query("SELECT * FROM effect WHERE job_id=$1", [job.id])).rows).toEqual(effectsBefore);
  Object.assign(config, originalConfig);
  await getPool().query("DELETE FROM owner_usage_limit WHERE owner_id=$1", [owner]);
  expect((await nativeDraftView(owner, job.projectId, job.id)).canContinue).toBe(true);
  await resumeNativePartialJob(owner, job.projectId, job.id);
  expect((await jobSnapshot(owner, job.id)).state).toBe("queued");
  expect((await getPool().query("SELECT * FROM effect WHERE job_id=$1", [job.id])).rows).toEqual(effectsBefore);
});

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
