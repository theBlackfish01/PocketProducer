import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { claimJobById, createNativeJob, createProject, dispatchOutbox, getConfig, getPool, reserveProviderEffect, markEffectDispatched, failProviderEffect, completeProviderEffect, handoffNativeToLuna, fundedProducerModels, jobSnapshot, nativeSnapshot, createNativeLibrary, assistMusicalPrompt, type JobRecord } from "@pocket/core";
import { producerChatModel, sharedUsageBlock } from "@pocket/core/test-support";
import { processJob } from "@pocket/worker";
const config = getConfig(), original = { ...config }, owners: string[] = [];
beforeAll(async () => {
  // Dedicated test database only; recover this suite's interrupted fixture cleanup.
  owners.push(...(await getPool().query<{ id: string }>("SELECT id FROM app_user WHERE display_name='Shared demo test'")).rows.map((row) => row.id));
});
beforeEach(() => Object.assign(config, { INITIAL_BUILD_API_BUDGET_USD: 100, OPENAI_POOL_BUDGET_USD: 100, DEFAULT_USER_BUDGET_USD: 100, MAX_JOB_COST_USD: 100, JOB_LEASE_SECONDS: 45, SOL_POOL_BUDGET_USD: undefined, LUNA_POOL_BUDGET_USD: undefined }));
afterEach(() => { Object.assign(config, original, { SOL_POOL_BUDGET_USD: original.SOL_POOL_BUDGET_USD, LUNA_POOL_BUDGET_USD: original.LUNA_POOL_BUDGET_USD }); vi.unstubAllGlobals(); });
afterAll(async () => {
  await getPool().query("DELETE FROM native_sync WHERE project_id IN (SELECT id FROM project WHERE owner_id=ANY($1::uuid[]))", [owners]);
  await getPool().query("DELETE FROM native_project_head WHERE owner_id=ANY($1::uuid[])", [owners]);
  await getPool().query("UPDATE job SET result_native_revision_id=NULL WHERE owner_id=ANY($1::uuid[])", [owners]);
  await getPool().query("DELETE FROM native_revision WHERE owner_id=ANY($1::uuid[])", [owners]);
  await getPool().query("DELETE FROM job WHERE owner_id=ANY($1::uuid[])", [owners]);
  await getPool().query("DELETE FROM project WHERE owner_id=ANY($1::uuid[])", [owners]);
  await getPool().query("DELETE FROM owner_usage_limit WHERE owner_id=ANY($1::uuid[])", [owners]);
  await getPool().query("DELETE FROM app_user WHERE id=ANY($1::uuid[])", [owners]);
});
async function owner() { const id = (await getPool().query("INSERT INTO app_user(provider_subject,display_name) VALUES($1,'Shared demo test') RETURNING id", [randomUUID()])).rows[0].id as string; owners.push(id); return id; }
async function create(model = "gpt-6-sol", ownerId?: string) {
  ownerId ??= await owner();
  const project = await createProject(ownerId, "Shared demo test");
  const input = { ownerId, projectId: project.id, kind: "native-generation" as const, idempotencyKey: randomUUID(), request: { model, direction: "A small melodic sketch" }, expectedHeadId: null };
  const receipt = await createNativeJob(input);
  await dispatchOutbox();
  const job = (await claimJobById(receipt.id, "shared-demo-test"))!;
  return { job, input };
}
function reserve(job: JobRecord, amount: number, model = "gpt-6-sol", step = "producer-model-call") {
  const key = randomUUID(); return reserveProviderEffect({ job, provider: "openai", model, step, idempotencyKey: key, inputHash: key, promptVersion: "shared-demo-test", reservationMicrousd: amount });
}
async function committed(model: string) {
  return Number((await getPool().query("SELECT COALESCE(sum(CASE WHEN state IN ('reserved','dispatched','uncertain') THEN GREATEST(reservation_microusd,actual_cost_microusd) ELSE actual_cost_microusd END),0)::text AS amount FROM effect WHERE provider='openai' AND model=$1", [model])).rows[0].amount);
}

it("serializes different owners' Sol reservations and keeps unknown charges in that pool only", async () => {
  const a = await create(), b = await create();
  const before = await committed("gpt-6-sol"); config.SOL_POOL_BUDGET_USD = (before + 100_000) / 1e6; config.LUNA_POOL_BUDGET_USD = 50;
  const results = await Promise.allSettled([reserve(a.job, 80_000), reserve(b.job, 80_000)]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  const index = results.findIndex((r) => r.status === "fulfilled"), result = results[index]!;
  if (result.status !== "fulfilled") throw new Error("Missing reservation");
  const selected = index === 0 ? a.job : b.job;
  await markEffectDispatched(result.value.id, selected);
  await failProviderEffect({ effectId: result.value.id, job: selected, errorClass: "NetworkUnknown", uncertain: true });
  expect(await sharedUsageBlock(getPool(), b.job.ownerId, "openai", 30_000, "gpt-6-sol")).toBe("MODEL");
  expect(await sharedUsageBlock(getPool(), b.job.ownerId, "openai", 30_000, "gpt-6-luna")).toBeNull();
  expect(await handoffNativeToLuna(selected, 30_000)).toBe(false);
  expect(await committed("gpt-6-sol")).toBe(before + 80_000);
  await completeProviderEffect({ effectId: result.value.id, job: selected, output: { usage: { inputTokens: 1, outputTokens: 1 } }, actualCostMicrousd: 120_000 });
  expect(await committed("gpt-6-sol")).toBe(before + 120_000);
});

it("blocks paid Rewrite/Inspire at the Luna pool before contacting a provider", async () => {
  const ownerId = await owner(), project = await createProject(ownerId, "Shared demo prompt help");
  // Exercise the paid reservation branch with a fake credential and forbidden
  // transport, retaining the dedicated test database and disabled tracing.
  config.APP_ENV = "development"; config.FIXTURE_MODE = false; config.OPENAI_API_KEY = "offline-test"; config.LUNA_POOL_BUDGET_USD = 0;
  const fetch = vi.fn(() => Promise.reject(new Error("Provider access forbidden"))); vi.stubGlobal("fetch", fetch);
  for (const mode of ["rewrite", "inspire"] as const) await expect(assistMusicalPrompt(ownerId, project.id, randomUUID(), { mode, direction: mode === "rewrite" ? "Warm and sparse" : "", expectedHeadId: null, sectionId: null, partId: null, protectedPartIds: [], sourceIds: [], recent: [] })).rejects.toThrow(/MODEL:gpt-6-luna/);
  expect(fetch).not.toHaveBeenCalled();
  expect((await getPool().query("SELECT id FROM prompt_assistance WHERE owner_id=$1", [ownerId])).rowCount).toBe(0);
});

it("routes stale Sol submissions to Luna, keeps receipts stable, and rejects exhausted pools without a new job", async () => {
  config.SOL_POOL_BUDGET_USD = 0; config.LUNA_POOL_BUDGET_USD = 50;
  const { job, input } = await create();
  expect(job.request.model).toBe("gpt-6-sol");
  expect(job.request._nativeRun).toMatchObject({ model: "gpt-6-luna", reasoningEffort: "xhigh" });
  expect(await createNativeJob(input)).toEqual({ id: job.id, duplicate: true });
  const options = await fundedProducerModels(job.ownerId);
  expect(options.fallbackModel).toBeNull();
  expect(options.models).toHaveLength(1);
  expect(options.models[0]).toMatchObject({ id: "gpt-6-luna", available: true });
  expect(JSON.stringify(options)).not.toMatch(/remaining|50|budgetUsd/i);
  config.LUNA_POOL_BUDGET_USD = 0;
  await expect(create()).rejects.toThrow(/shared demo allowance/);
  const exhausted = await fundedProducerModels(job.ownerId);
  expect(exhausted.fallbackModel).toBeNull();
  expect(exhausted.models.filter((m) => m.provider === "openai").every((m) => !m.available)).toBe(true);
});

it("never bypasses user or provider limits to fall back and meters critic calls against their actual model", async () => {
  const { job } = await create();
  config.SOL_POOL_BUDGET_USD = 0; config.LUNA_POOL_BUDGET_USD = 50;
  await getPool().query("INSERT INTO owner_usage_limit(owner_id,limit_microusd) VALUES($1,0)", [job.ownerId]);
  expect((await fundedProducerModels(job.ownerId)).fallbackModel).toBeNull();
  expect(await handoffNativeToLuna(job, 10_000)).toBe(false);
  await expect(reserve(job, 1000, "gpt-6-luna", "native-symbolic-review")).rejects.toThrow(/USER/);
  await getPool().query("DELETE FROM owner_usage_limit WHERE owner_id=$1", [job.ownerId]);
  // Sol's response reservation would exceed this user's remaining amount;
  // Luna can fit it. The model-pool decision must be made before the expensive
  // route's quota estimate, and the cheaper route must still check that cap.
  await getPool().query("INSERT INTO owner_usage_limit(owner_id,limit_microusd) VALUES($1,50000)", [job.ownerId]);
  const available = await fundedProducerModels(job.ownerId);
  expect(available.fallbackModel).toBeNull();
  expect(available.models).toMatchObject([{ id: "gpt-6-luna", available: true }]);
  await getPool().query("DELETE FROM owner_usage_limit WHERE owner_id=$1", [job.ownerId]);
  config.OPENAI_POOL_BUDGET_USD = 0;
  expect(await handoffNativeToLuna(job, 10_000)).toBe(false);
  config.OPENAI_POOL_BUDGET_USD = 100; config.LUNA_POOL_BUDGET_USD = 0;
  await expect(reserve(job, 1000, "gpt-6-luna", "native-symbolic-review")).rejects.toThrow(/MODEL:gpt-6-luna/);
});

it("hands off within the real worker, preserves music and costs, and sends Luna no Sol reasoning", async () => {
  config.OPENAI_API_KEY = "offline-test";
  const { job } = await create();
  config.SOL_POOL_BUDGET_USD = 50; config.LUNA_POOL_BUDGET_USD = 50;
  const deadline = job.deadlineAt;
  const requests: { model: string; input: unknown }[] = [];
  const form = { title: "Handoff phrase", tempoBpm: 92, meter: { numerator: 4, denominator: 4 }, sections: [{ id: "whole", name: "Whole", bars: 4 }], parts: [{ id: "lead", name: "Lead", role: "melody", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, motifs: [], placements: [], freeNotes: [{ beat: 0, durationBeats: 1, pitch: 64, velocity: 0.7 }] }] };
  vi.stubGlobal("fetch", async (url: unknown, init: RequestInit) => {
    await Promise.resolve();
    if (String(url) !== "https://api.openai.com/v1/responses" || typeof init.body !== "string") throw new Error("Unexpected live request");
    const request = JSON.parse(init.body) as { model: string; input: unknown }; requests.push(request);
    const sol = request.model === "gpt-6-sol";
    if (sol) config.SOL_POOL_BUDGET_USD = 0; // another owner's settled spend exhausts the pool before the next call
    return Response.json({ id: `resp_${requests.length}`, object: "response", created_at: 1, status: "completed", model: request.model,
      output: sol ? [{ type: "reasoning", id: "rs_sol_private", summary: [] }, { type: "function_call", id: "fc_sol", call_id: "call_sol", name: "compose_native_form", arguments: JSON.stringify(form), status: "completed" }] : [{ type: "message", id: "msg_luna", role: "assistant", status: "completed", content: [{ type: "output_text", text: "The phrase is ready.", annotations: [] }] }],
      usage: { input_tokens: 100, output_tokens: 80, total_tokens: 180, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 20 } } });
  });
  await processJob(job, { library: createNativeLibrary(null), scriptedModel: producerChatModel("gpt-6-sol", 1000, "high", 10_000), scriptedFallbackModel: producerChatModel("gpt-6-luna", 1000, "xhigh", 10_000) });
  const snapshot = await jobSnapshot(job.ownerId, job.id);
  expect(snapshot.state, JSON.stringify(snapshot)).toBe("succeeded");
  expect(requests.map((r) => r.model)).toEqual(["gpt-6-sol", "gpt-6-luna"]);
  expect(JSON.stringify(requests[1]?.input)).not.toContain("rs_sol_private");
  expect(JSON.stringify(requests[1]?.input)).toContain("Handoff phrase");
  expect((await nativeSnapshot(job.ownerId, job.projectId)).current?.document.parts[0]?.notes[0]?.pitch).toBe(64);
  expect(job.deadlineAt).toEqual(deadline);
  const costs = (await getPool().query("SELECT model,actual_cost_microusd,state FROM effect WHERE job_id=$1 AND step='producer-model-call' ORDER BY created_at", [job.id])).rows;
  expect(costs.map((r) => r.model)).toEqual(["gpt-6-sol", "gpt-6-luna"]);
  expect(costs.every((r) => Number(r.actual_cost_microusd) > 0 && r.state === "succeeded")).toBe(true);
  expect((await getPool().query("SELECT * FROM native_model_handoff WHERE job_id=$1", [job.id])).rowCount).toBe(1);
  expect((await getPool().query("SELECT payload->>'text' AS text FROM project_activity WHERE job_id=$1 AND origin=$2", [job.id, `model-handoff:${job.id}`])).rows).toEqual([{ text: "Continuing with Luna." }]);
  expect((await getPool().query("SELECT * FROM effect WHERE job_id=$1 AND step='native-producer-result'", [job.id])).rowCount).toBe(1);
}, 30_000);

it("persists a handoff before restart without resetting limits and refuses cancelled leases", async () => {
  const { job } = await create();
  const previous = structuredClone(job.request._nativeRun);
  const effect = await reserve(job, 1000);
  await markEffectDispatched(effect.id, job);
  await completeProviderEffect({ effectId: effect.id, job, output: { usage: { inputTokens: 1, outputTokens: 1 } }, actualCostMicrousd: 10 });
  config.SOL_POOL_BUDGET_USD = 0; config.LUNA_POOL_BUDGET_USD = 50;
  expect(await handoffNativeToLuna(job, 1000)).toBe(true);
  const stored = (await getPool().query("SELECT request,deadline_at FROM job WHERE id=$1", [job.id])).rows[0];
  expect(stored.request._nativeRun).toEqual(previous);
  expect(stored.request._nativeRunCurrent).toMatchObject({ ...previous as object, model: "gpt-6-luna", provider: "openai", reasoningEffort: "xhigh", pricing: expect.any(Object) });
  expect(await handoffNativeToLuna(job, 1000)).toBe(false);
  config.SOL_POOL_BUDGET_USD = undefined; config.LUNA_POOL_BUDGET_USD = undefined;
  const cancelled = (await create()).job;
  await getPool().query("UPDATE job SET cancellation_requested_at=now(),state='cancel_requested' WHERE id=$1", [cancelled.id]);
  config.SOL_POOL_BUDGET_USD = 0; config.LUNA_POOL_BUDGET_USD = 50;
  await expect(handoffNativeToLuna(cancelled, 1000)).rejects.toThrow(/lease|cancelled/i);
});

it("survives a killed handoff process and two contending replacement workers", async () => {
  const { job } = await create();
  await getPool().query("UPDATE job SET lease_until=now()-interval '1 second' WHERE id=$1", [job.id]);
  const children: ChildProcess[] = [];
  const start = (mode: string) => {
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/test-model-handoff-process.ts", job.id, mode], {
      cwd: process.cwd(), stdio: ["ignore", "ignore", "pipe", "ipc"],
      env: { ...process.env, APP_ENV: "test", FIXTURE_MODE: "true", LANGSMITH_TRACING: "false", LANGSMITH_API_KEY: "", OPENAI_API_KEY: "", GEMINI_API_KEY: "", GOOGLE_API_KEY: "", AI_GATEWAY_API_KEY: "", VERCEL_AI_GATEWAY_API_KEY: "", SOL_POOL_BUDGET_USD: "0", LUNA_POOL_BUDGET_USD: "50", OPENAI_POOL_BUDGET_USD: "100", INITIAL_BUILD_API_BUDGET_USD: "100", DEFAULT_USER_BUDGET_USD: "100", MAX_JOB_COST_USD: "100", JOB_LEASE_SECONDS: "45" },
    });
    children.push(child); return child;
  };
  const message = (child: ChildProcess) => Promise.race([once(child, "message").then(([value]) => value as string), once(child, "exit").then(([code]) => { throw new Error(`Handoff probe exited: ${String(code)}`); })]);
  try {
    const first = start("handoff"); expect(await message(first)).toBe("checkpoint");
    const steps = (await getPool().query("SELECT result_hash FROM native_job_step WHERE job_id=$1 ORDER BY ordinal", [job.id])).rows;
    const exited = once(first, "exit"); first.kill("SIGKILL"); await exited;
    await getPool().query("UPDATE job SET lease_until=now()-interval '1 second' WHERE id=$1", [job.id]);
    const a = start("finish"), b = start("finish");
    expect((await Promise.all([message(a), message(b)])).sort()).toEqual(["contended", "finished"]);
    expect((await jobSnapshot(job.ownerId, job.id)).state).toBe("succeeded");
    expect((await getPool().query("SELECT result_hash FROM native_job_step WHERE job_id=$1 ORDER BY ordinal", [job.id])).rows).toEqual(steps);
    expect((await getPool().query("SELECT model FROM effect WHERE job_id=$1 AND step='producer-model-call'", [job.id])).rows).toEqual([{ model: "gpt-6-luna" }]);
    expect((await getPool().query("SELECT * FROM native_model_handoff WHERE job_id=$1", [job.id])).rowCount).toBe(1);
  } finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) { const stopped = once(child, "exit"); child.kill("SIGKILL"); await stopped; }
  }
}, 45_000);
