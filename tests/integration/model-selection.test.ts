import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { claimJobById, createNativeJob, createProject, dispatchOutbox, failProviderEffect, getConfig, getPool, markEffectDispatched, reserveProviderEffect, type JobRecord } from "@pocket/core";
import { createNativeLibrary, jobSnapshot, nativeSnapshot } from "@pocket/core";
import { processJob } from "@pocket/worker";
import { AIMessage, fakeModel, CompatibleProducerModel, producerChatModel, AccountedOpenAICalls } from "@pocket/core/test-support";
const config = getConfig(), original = { ...config };
const owners: string[] = [], jobs: JobRecord[] = [];
beforeAll(async () => {
  for (let i = 0; i < 2; i++) owners.push((await getPool().query<{ id: string }>("INSERT INTO app_user(provider_subject,display_name) VALUES($1,'Model quota test') RETURNING id", [`models-${randomUUID()}`])).rows[0]!.id);
});
afterEach(() => { Object.assign(config, original); vi.unstubAllGlobals(); });
afterAll(async () => {
  await getPool().query("DELETE FROM native_sync WHERE project_id IN (SELECT id FROM project WHERE owner_id=ANY($1::uuid[]))", [owners]);
  await getPool().query("DELETE FROM native_project_head WHERE project_id IN (SELECT id FROM project WHERE owner_id=ANY($1::uuid[]))", [owners]);
  await getPool().query("UPDATE job SET result_native_revision_id=NULL WHERE owner_id=ANY($1::uuid[])", [owners]);
  await getPool().query("DELETE FROM native_revision WHERE project_id IN (SELECT id FROM project WHERE owner_id=ANY($1::uuid[]))", [owners]);
  await getPool().query("DELETE FROM job WHERE owner_id=ANY($1::uuid[])", [owners]);
  await getPool().query("DELETE FROM project WHERE owner_id=ANY($1::uuid[])", [owners]);
  await getPool().query("DELETE FROM owner_usage_limit WHERE owner_id=ANY($1::uuid[])", [owners]);
  await getPool().query("DELETE FROM app_user WHERE id=ANY($1::uuid[])", [owners]);
});
async function job(owner: string, model: string) {
  const project = await createProject(owner, "Model selection test");
  const result = await createNativeJob({ ownerId: owner, projectId: project.id, kind: "native-generation", idempotencyKey: randomUUID(), request: { direction: "A small melodic sketch", model }, expectedHeadId: null });
  await dispatchOutbox();
  const claimed = (await claimJobById(result.id, "model-test"))!;
  jobs.push(claimed); return claimed;
}
function reserve(job: JobRecord, key: string, provider: "gateway" | "gemini", amount: number) {
  return reserveProviderEffect({ job, provider, step: "producer-model-call", model: String((job.request._nativeRun as { model: string }).model), idempotencyKey: key, inputHash: key, promptVersion: "test", reservationMicrousd: amount });
}
it("captures model choice, rejects changed-model replays, and ignores subsequent default-model changes", async () => {
  const selected = await job(owners[0]!, "gemini-3.7-flash");
  expect(selected.request._nativeRun).toMatchObject({ model: "gemini-3.7-flash", provider: "gemini" });
  const row = (await getPool().query("SELECT idempotency_key FROM job WHERE id=$1", [selected.id])).rows[0];
  await expect(createNativeJob({ ownerId: selected.ownerId, projectId: selected.projectId, kind: "native-generation", idempotencyKey: row.idempotency_key, request: { direction: "A small melodic sketch", model: "gpt-6-sol" }, expectedHeadId: null })).rejects.toThrow(/different request/);
  config.OPENAI_MODEL = "gpt-6-astra";
  expect((await getPool().query("SELECT request FROM job WHERE id=$1", [selected.id])).rows[0].request._nativeRun.model).toBe("gemini-3.7-flash");
});
it.each(["gemini-3.7-flash", "deepseek/deepseek-v4-pro-0813"])("constructs through the real worker with the %s wire adapter (scripted transport)", async (model) => {
  Object.assign(config, { GEMINI_API_KEY: "test-only", AI_GATEWAY_API_KEY: "test-only", INITIAL_BUILD_API_BUDGET_USD: 100, MAX_JOB_COST_USD: 100, DEFAULT_USER_BUDGET_USD: 100, GEMINI_POOL_BUDGET_USD: 100, GATEWAY_POOL_BUDGET_USD: 100 });
  const selected = await job(owners[1]!, model);
  const form = { stepKey: "wire-scene", replaceSeed: true, title: "Wire-built phrase", parts: [{ id: "lead", name: "Lead", role: "melody", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, notes: [{ id: "n", startTick: 0, durationTicks: 960, pitch: 64, velocity: 0.7 }] }] };
  let turns = 0;
  const requests: { tools: { function: { name: string } }[]; messages: { role: string; tool_call_id?: string }[] }[] = [];
  const adapter = new CompatibleProducerModel(model, 1000, "low", 10000, async (url, init) => {
    await Promise.resolve();
    if (typeof url === "string" && url.includes("/generation")) return Response.json({ data: { total_cost: 0.0001 } });
    if (typeof init?.body !== "string") throw new Error("Expected JSON body");
    const body = JSON.parse(init.body) as { tools: { function: { name: string } }[]; messages: { role: string; tool_call_id?: string }[] };
    requests.push(body);
    const message = turns++ === 0 ? { role: "assistant", content: null, tool_calls: [{ id: "form-call", type: "function", function: { name: "compose_native_scene", arguments: JSON.stringify(form) } }] } : { role: "assistant", content: "The phrase is ready." };
    return Response.json({ id: `test-${turns}`, choices: [{ message, finish_reason: turns === 1 ? "tool_calls" : "stop" }], usage: { prompt_tokens: 100, completion_tokens: 80 } });
  });
  await processJob(selected, { scriptedModel: adapter, library: createNativeLibrary(null) });
  const snapshot = await jobSnapshot(selected.ownerId, selected.id);
  expect(snapshot.state, JSON.stringify(snapshot)).toBe("succeeded");
  const score = (await nativeSnapshot(selected.ownerId, selected.projectId)).current?.document;
  expect(score?.parts[0]?.notes[0]?.pitch).toBe(64);
  expect(turns).toBe(2);
  expect(requests[0]?.tools.some((t) => t.function.name === "compose_native_scene")).toBe(true);
  expect(JSON.stringify(requests[1]?.messages)).toContain("Wire-built phrase");
}, 30_000);

it("captures Luna xhigh and completes a scripted construction through the real worker", async () => {
  const selected = await job(owners[1]!, "gpt-6-luna");
  expect(selected.request._nativeRun).toMatchObject({ model: "gpt-6-luna", provider: "openai", reasoningEffort: "xhigh" });
  const form = { title: "Luna phrase", tempoBpm: 92, meter: { numerator: 4, denominator: 4 }, sections: [{ id: "whole", name: "Whole", bars: 4 }], parts: [{ id: "lead", name: "Lead", role: "melody", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, motifs: [], placements: [], freeNotes: [{ beat: 0, durationBeats: 1, pitch: 64, velocity: 0.7 }] }] };
  await processJob(selected, { scriptedModel: fakeModel().respondWithTools([{ name: "compose_native_form", args: form }]).respond(new AIMessage("Finished")), library: createNativeLibrary(null) });
  expect((await jobSnapshot(selected.ownerId, selected.id)).state).toBe("succeeded");
  expect((await nativeSnapshot(selected.ownerId, selected.projectId)).current?.document.parts[0]?.notes[0]?.pitch).toBe(64);
  expect((await getPool().query("SELECT request FROM job WHERE id=$1", [selected.id])).rows[0].request._nativeRun).toEqual(selected.request._nativeRun);
});

it.each([ ["gpt-6-sol", "multiple"], ["gpt-6-luna", "multiple"], ["gpt-6-luna", "shared"] ] as const)("preserves every reasoning/tool item through %s construction (%s reasoning), mixed errors and history compaction", async (model, reasoningMode) => {
  config.OPENAI_API_KEY = "offline-openai-test";
  config.JOB_LEASE_SECONDS = 45;
  const selected = await job(owners[1]!, model);
  const form = { title: "Reasoning replay phrase", tempoBpm: 92, meter: { numerator: 4, denominator: 4 }, sections: [{ id: "whole", name: "Whole", bars: 4 }], parts: [{ id: "lead", name: "Lead", role: "melody", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, motifs: [], placements: [], freeNotes: [{ beat: 0, durationBeats: 1, pitch: 64, velocity: 0.7 }] }] };
  type Item = { type: string; id?: string; call_id?: string; name?: string; output?: unknown };
  const requests: Item[][] = [];
  const expectedReasoning = new Map<string, string>();
  const violations: string[] = [];
  let turn = 0;
  vi.stubGlobal("fetch", async (url: unknown, init: RequestInit) => {
    await Promise.resolve();
    if (String(url) !== "https://api.openai.com/v1/responses" || typeof init.body !== "string") throw new Error("Unexpected provider transport");
    const body = JSON.parse(init.body) as { input: Item[]; stream?: boolean };
    if (body.stream) throw new Error("Expected non-streaming production invocation");
    requests.push(body.input);
    for (const [index, item] of body.input.entries()) {
      if (item.type !== "function_call") continue;
      const required = expectedReasoning.get(item.call_id!);
      if (required && !body.input.slice(0, index).some((previous) => previous.type === "reasoning" && previous.id === required)) violations.push(`${item.id} missing ${required}`);
      if (!body.input.some((reply) => reply.type === "function_call_output" && reply.call_id === item.call_id)) violations.push(`${item.id} missing result`);
    }
    if (violations.length) return Response.json({ error: { message: `function_call provided without its required reasoning item: ${violations.join(", ")}`, type: "invalid_request_error" } }, { status: 400 });
    const calls = turn === 0 ? [{ name: "compose_native_form", args: form }]
      : turn === 1 ? [{ name: "read_native_brief", args: { offset: 0, length: 100 } }, { name: "inspect_native_part", args: { partId: "missing-part" } }]
      : turn < 8 ? [{ name: "read_native_brief", args: { offset: 0, length: 100 } }] : [];
    const output = calls.flatMap((call, index) => {
      const id = `${turn}_${index}`;
      expectedReasoning.set(`call_${id}`, `rs_${reasoningMode === "shared" ? `${turn}_0` : id}`);
      return [...(reasoningMode === "shared" && index > 0 ? [] : [{ type: "reasoning", id: `rs_${id}`, summary: [] }]), { type: "function_call", id: `fc_${id}`, call_id: `call_${id}`, name: call.name, arguments: JSON.stringify(call.args), status: "completed" }];
    });
    const finalOutput = output.length ? output : [{ type: "message", id: `msg_${turn}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: "The phrase is ready.", annotations: [] }] }];
    return Response.json({ id: `resp_${turn++}`, object: "response", created_at: 1, status: "completed", model, output: finalOutput, usage: { input_tokens: 100, output_tokens: 80, total_tokens: 180, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 20 } } });
  });
  const adapter = producerChatModel(model, 1000, model === "gpt-6-luna" ? "xhigh" : "high", 10_000);
  await processJob(selected, { scriptedModel: adapter, library: createNativeLibrary(null) });
  expect(violations).toEqual([]);
  expect((await jobSnapshot(selected.ownerId, selected.id)).state).toBe("succeeded");
  expect((await nativeSnapshot(selected.ownerId, selected.projectId)).current?.document.parts[0]?.notes[0]?.pitch).toBe(64);
  expect(turn).toBe(9);
  const final = requests.at(-1)!;
  expect(final.some((item) => item.id === "fc_0_0")).toBe(false); // Confirmed mutation is compacted as a whole.
  expect(final.some((item) => item.id === "fc_2_0")).toBe(false); // Older successful reads are also bounded.
  expect(final.filter((item) => item.type === "reasoning").map((item) => item.id)).toEqual(["rs_1_0", ...(reasoningMode === "shared" ? [] : ["rs_1_1"]), "rs_4_0", "rs_5_0", "rs_6_0", "rs_7_0"]);
  expect(final.some((item) => item.type === "function_call_output" && item.call_id === "call_1_1" && /error/i.test(JSON.stringify(item.output)))).toBe(true);
  const effects = (await getPool().query("SELECT state,cost_status FROM effect WHERE job_id=$1 AND step='producer-model-call'", [selected.id])).rows;
  expect(effects).toHaveLength(9);
  expect(effects.every((effect) => effect.state === "succeeded" && effect.cost_status === "observed")).toBe(true);
}, 30_000);

it("holds a missing Gateway cost as unknown through the actual accounting callback", async () => {
  Object.assign(config, { INITIAL_BUILD_API_BUDGET_USD: 100, MAX_JOB_COST_USD: 100, DEFAULT_USER_BUDGET_USD: 100, GATEWAY_POOL_BUDGET_USD: 100 });
  const selected = await job(owners[1]!, "deepseek/deepseek-v4-pro-0813");
  const accounting = new AccountedOpenAICalls(selected, "deepseek/deepseek-v4-pro-0813", randomUUID(), 100);
  await accounting.handleChatModelStart({ lc: 1, type: "not_implemented", id: [] }, [[new AIMessage("A phrase")]], "accounted-call");
  Object.assign(config, { APP_ENV: "development", FIXTURE_MODE: false }); // No transport is invoked.
  const message = new AIMessage("Done");
  Object.assign(message, { usage_metadata: { input_tokens: 10, output_tokens: 5 }, response_metadata: { providerRequestId: "test-generation" } });
  const generation = { text: message.text, message };
  await expect(accounting.handleLLMEnd({ generations: [[generation]] }, "accounted-call")).rejects.toThrow(/PROVIDER_USAGE_UNKNOWN/);
  const row = (await getPool().query("SELECT state,cost_status,output,reservation_microusd FROM effect WHERE job_id=$1", [selected.id])).rows[0];
  expect(row).toMatchObject({ state: "uncertain", cost_status: "unknown", output: { providerRequestId: "test-generation" } });
  expect(Number(row.reservation_microusd)).toBeGreaterThan(0);
});
it("serializes contending users against one provider pool and keeps unknown charges held", async () => {
  Object.assign(config, { INITIAL_BUILD_API_BUDGET_USD: 100, MAX_JOB_COST_USD: 100, DEFAULT_USER_BUDGET_USD: 100, GATEWAY_POOL_BUDGET_USD: 1 });
  const existing = (await getPool().query("SELECT COALESCE(sum(CASE WHEN state IN ('reserved','dispatched','uncertain') THEN GREATEST(reservation_microusd,actual_cost_microusd) ELSE actual_cost_microusd END),0)::text AS used FROM effect WHERE provider='gateway'")).rows[0];
  config.GATEWAY_POOL_BUDGET_USD = Number(existing.used) / 1e6 + 1;
  const a = await job(owners[0]!, "deepseek/deepseek-v4-pro-0813"), b = await job(owners[1]!, "deepseek/deepseek-v4-pro-0813");
  const outcomes = await Promise.allSettled([reserve(a, "pool-a", "gateway", 700_000), reserve(b, "pool-b", "gateway", 700_000)]);
  expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
  const success = outcomes.findIndex((o) => o.status === "fulfilled"), winner = [a, b][success]!;
  const value = outcomes[success]; if (value?.status !== "fulfilled") throw new Error("Missing reservation");
  await markEffectDispatched(value.value.id, winner);
  await failProviderEffect({ effectId: value.value.id, job: winner, errorClass: "Transport", uncertain: true });
  await expect(reserve([a, b][1 - success]!, "another-key", "gateway", 400_000)).rejects.toThrow(/PROVIDER:gateway/);
  const repeat = await reserve(winner, success === 0 ? "pool-a" : "pool-b", "gateway", 700_000);
  expect(repeat).toMatchObject({ created: false, state: "uncertain" });
});
it("enforces one user's lifetime quota across models without blocking a different user", async () => {
  Object.assign(config, { INITIAL_BUILD_API_BUDGET_USD: 100, MAX_JOB_COST_USD: 100, DEFAULT_USER_BUDGET_USD: 100, GEMINI_POOL_BUDGET_USD: 100 });
  await getPool().query("INSERT INTO owner_usage_limit(owner_id,limit_microusd) VALUES($1,0)", [owners[0]]);
  const a = await job(owners[0]!, "gemini-3.7-flash"), b = await job(owners[1]!, "gemini-3.7-flash");
  await expect(reserve(a, "user-denied", "gemini", 100)).rejects.toThrow(/USER/);
  await expect(reserve(b, "user-allowed", "gemini", 100)).resolves.toMatchObject({ created: true });
  expect((await getPool().query("SELECT 1 FROM effect WHERE job_id=$1", [a.id])).rowCount).toBe(0);
});
