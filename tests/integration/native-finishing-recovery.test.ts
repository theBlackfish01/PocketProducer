import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { getConfig } from "@pocket/core";
import { AIMessage, fakeModel, focusedNativeReview, nativeFormatRecoveryAvailable } from "@pocket/core/test-support";
import { canonicalHash, claimJobById, createNativeJob, createNativeLibrary, createProject, dispatchOutbox, getPool, jobSnapshot, loadNativePlan, nativeDraftView, nativeSnapshot, nativePlanSchema, nativeCreativeStateSchema, nativeReviewContextHash, NativeToolSession, seedNativeDocument, nativeFormOperations, saveNativePlan, saveNativeCreativeState, saveNativeReview, advanceNativePlan, reserveProviderEffect, markEffectDispatched, needsAttentionJob, resumeNativePartialJob, type JobRecord } from "@pocket/core";
import { processJob } from "@pocket/worker";
import { nativeFormSchema } from "@pocket/core";
import { boundOpenAiRequest } from "@pocket/core/test-support";
import { listProjects, requireProject, abandonNativePartialJob } from "@pocket/core";

let owner = "";
const config = getConfig(), originalConfig = { ...config };
afterEach(async () => {
  Object.assign(config, originalConfig);
  await getPool().query("DELETE FROM owner_usage_limit WHERE owner_id=$1", [owner]);
});
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

it("survives a mixed oversized error exchange followed by selecting batch before initial music", async () => {
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
  expect(messages).toContain("Prefer `compose_native_scene`");
  expect(messages).toContain("priorGuidance");
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
