import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { assistMusicalPrompt, createProject, getConfig, getPool, type PromptAssistanceInput, type PromptGenerator } from "@pocket/core";

const responseMock = vi.hoisted(() => vi.fn());
vi.mock("../../packages/core/node_modules/openai/index.mjs", () => ({ default: class { responses = { create: responseMock }; } }));

let ownerId: string, projectId: string;
const direction: PromptAssistanceInput = { mode: "rewrite", direction: "Warm and sparse. Do not add drums.", expectedHeadId: null, sectionId: null, partId: null, protectedPartIds: [], sourceIds: [], recent: [] };
beforeAll(async () => {
  const owner = await getPool().query<{ id: string }>("INSERT INTO app_user(provider_subject,display_name) VALUES($1,'Prompt tests') RETURNING id", [`prompt-test-${randomUUID()}`]);
  ownerId = owner.rows[0]!.id; projectId = (await createProject(ownerId, "Prompt helper tests")).id;
});
afterAll(async () => {
  await getPool().query("DELETE FROM effect WHERE prompt_assistance_id IN (SELECT id FROM prompt_assistance WHERE owner_id=$1)", [ownerId]);
  await getPool().query("DELETE FROM prompt_assistance WHERE owner_id=$1", [ownerId]);
  await getPool().query("DELETE FROM project WHERE id=$1", [projectId]);
  await getPool().query("DELETE FROM app_user WHERE id=$1", [ownerId]);
});
const generated = { value: { prompt: "Warm and sparse. Do not add drums. Let a rounded bass answer the keys." }, usage: { inputTokens: 12, outputTokens: 20 } };

it("uses the real service, inspects model context, deduplicates a replay, and creates no job or version", async () => {
  let calls = 0;
  const key = randomUUID();
  const generator: PromptGenerator = (context) => { calls++; expect(JSON.parse(context)).toMatchObject({ direction: direction.direction, requiredPassages: ["Do not add drums."], keep: [], selectedSounds: [] }); return Promise.resolve(generated); };
  const result = await assistMusicalPrompt(ownerId, projectId, key, direction, generator);
  expect(result.prompt).toContain("Do not add drums.");
  expect(await assistMusicalPrompt(ownerId, projectId, key, direction, generator)).toEqual(result);
  expect(calls).toBe(1);
  await expect(assistMusicalPrompt(ownerId, projectId, key, { ...direction, direction: "Something else" }, generator)).rejects.toThrow(/different direction/);
  expect((await getPool().query("SELECT id FROM job WHERE project_id=$1", [projectId])).rowCount).toBe(0);
  expect((await getPool().query("SELECT id FROM native_revision WHERE project_id=$1", [projectId])).rowCount).toBe(0);
});

it("rejects unowned projects, missing sources and stale heads before dispatch", async () => {
  const generator: PromptGenerator = () => Promise.reject(new Error("must not dispatch"));
  await expect(assistMusicalPrompt(randomUUID(), projectId, randomUUID(), direction, generator)).rejects.toThrow(/Project not found/);
  await expect(assistMusicalPrompt(ownerId, projectId, randomUUID(), { ...direction, expectedHeadId: randomUUID() }, generator)).rejects.toThrow(/version changed/);
  await expect(assistMusicalPrompt(ownerId, projectId, randomUUID(), { ...direction, sourceIds: [randomUUID()] }, generator)).rejects.toThrow(/sound/);
});

it("does not dispatch contending requests with different keys for the same pending input", async () => {
  let release!: () => void, entered!: () => void;
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const first = assistMusicalPrompt(ownerId, projectId, randomUUID(), direction, async () => { entered(); await wait; return generated; });
  await ready;
  try { await expect(assistMusicalPrompt(ownerId, projectId, randomUUID(), direction, () => Promise.resolve(generated))).rejects.toThrow(/still being checked/); }
  finally { release(); }
  await first;
});

it("records invalid model output as a completed paid attempt, never a free retry", async () => {
  const key = randomUUID();
  await expect(assistMusicalPrompt(ownerId, projectId, key, direction, () => Promise.resolve({ value: { prompt: "Add drums" }, usage: { inputTokens: 100, outputTokens: 20 } }))).rejects.toThrow(/couldn't finish/);
  const effect = await getPool().query("SELECT state,cost_status FROM effect WHERE idempotency_key=$1", [key]);
  expect(effect.rows[0]).toMatchObject({ state: "failed", cost_status: "observed" });
  await expect(assistMusicalPrompt(ownerId, projectId, key, direction, () => Promise.resolve(generated))).rejects.toThrow(/earlier prompt request/);
});

it("enforces the live cap before dispatch and accounts invalid JSON using actual usage", async () => {
  const config = getConfig();
  const original = { ...config };
  const network = vi.fn(() => Promise.reject(new Error("Provider network forbidden in tests")));
  vi.stubGlobal("fetch", network);
  try {
    // OpenAI is module-mocked above; the pool remains the guarded *_test DB.
    // Simulate runtime billing configuration without disabling test isolation.
    Object.assign(config, { APP_ENV: "development", FIXTURE_MODE: false, OPENAI_API_KEY: "offline-mock-only", INITIAL_BUILD_API_BUDGET_USD: 0 });
    await expect(assistMusicalPrompt(ownerId, projectId, randomUUID(), direction)).rejects.toThrow(/current setup/);
    expect(responseMock).not.toHaveBeenCalled();
    config.INITIAL_BUILD_API_BUDGET_USD = 100;
    const key = randomUUID();
    responseMock.mockResolvedValueOnce({ id: "offline-response", output_text: "invalid JSON", usage: { input_tokens: 1000, output_tokens: 200, input_tokens_details: { cached_tokens: 500 } } });
    await expect(assistMusicalPrompt(ownerId, projectId, key, direction)).rejects.toThrow(/couldn't finish/);
    expect(responseMock).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-6-luna", store: false, text: expect.objectContaining({ format: expect.objectContaining({ type: "json_schema" }) }) }));
    const effect = await getPool().query("SELECT state,cost_status,actual_cost_microusd FROM effect WHERE idempotency_key=$1", [key]);
    expect(effect.rows[0]).toMatchObject({ state: "failed", cost_status: "observed", actual_cost_microusd: "155" });
    expect(network).not.toHaveBeenCalled();
  } finally { Object.assign(config, original); responseMock.mockReset(); vi.unstubAllGlobals(); }
});

it("retains unknown effects and prevents uncertain replay after a fresh service call", async () => {
  const key = randomUUID();
  await expect(assistMusicalPrompt(ownerId, projectId, key, direction, () => Promise.reject(new Error("connection lost after dispatch")))).rejects.toThrow(/couldn't finish/);
  const effect = await getPool().query("SELECT state,cost_status FROM effect WHERE idempotency_key=$1", [key]);
  expect(effect.rows[0]).toMatchObject({ state: "uncertain", cost_status: "unknown" });
  await expect(assistMusicalPrompt(ownerId, projectId, randomUUID(), direction, () => Promise.resolve(generated))).rejects.toThrow(/still being checked/);
});
