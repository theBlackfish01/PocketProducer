import { afterEach, expect, it, vi } from "vitest";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { getConfig } from "../config.js";
import { nativeRunLimits, jobNativeRunLimits } from "../native/profile.js";
import { CompatibleProducerModel, compatibleMessages, producerChatModel, reportedGatewayCost } from "./compatible-model.js";
import { modelCredentials, producerModels, selectableProducerModelSchema } from "./models.js";
import { boundOpenAiRequest } from "../agent/runtime.js";
const config = getConfig(), original = { ...config };
afterEach(() => { Object.assign(config, original); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("bounds replayed Responses output and tool arguments even without assistant prose", () => {
  const opaque = new AIMessage({ content: "", response_metadata: { output: [{ type: "reasoning", id: "rs_offline", encrypted_content: "x".repeat(4000) }] } });
  const call = new AIMessage({ content: "", tool_calls: [{ id: "call_offline", name: "inspect", args: { description: "x".repeat(4000) } }] });
  for (const message of [opaque, call]) expect(() => boundOpenAiRequest([[message]], 100, 3000)).toThrow(/OPENAI_INPUT_LIMIT_EXCEEDED/);
});

it("offers Luna xhigh instead of DeepSeek while retaining captured historical jobs", () => {
  expect(producerModels().map((model) => model.id)).toEqual(["gpt-6-sol", "gpt-6-luna", "gemini-3.7-flash"]);
  expect(selectableProducerModelSchema.safeParse("deepseek/deepseek-v4-pro-0813").success).toBe(false);
  const luna = nativeRunLimits("standard", "gpt-6-luna");
  expect(luna).toMatchObject({ provider: "openai", model: "gpt-6-luna", reasoningEffort: "xhigh", pricing: { inputUsdPerMillion: 0.1, outputUsdPerMillion: 0.5 } });
  config.NATIVE_REASONING_EFFORT = "low";
  expect(jobNativeRunLimits({ _nativeRun: luna })).toEqual(luna);
  const historical = nativeRunLimits("extended", "deepseek/deepseek-v4-pro-0813");
  expect(jobNativeRunLimits({ _nativeRun: historical })).toEqual(historical);
});

it("sends Luna tools through OpenAI Responses with xhigh and the existing OpenAI key", async () => {
  config.OPENAI_API_KEY = "offline-openai-test";
  const transport = vi.fn(() => Promise.resolve(Response.json({ id: "resp_offline", object: "response", created_at: 1, status: "completed", model: "gpt-6-luna", output: [{ type: "function_call", id: "fc_offline", call_id: "call_offline", name: "inspect", arguments: "{}", status: "completed" }], usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 5 } } })));
  vi.stubGlobal("fetch", transport);
  const run = nativeRunLimits("standard", "gpt-6-luna");
  const model = producerChatModel(run.model, 1000, run.reasoningEffort, 1000);
  if (!model.bindTools) throw new Error("Producer must support tools");
  const response = await model.bindTools([{ type: "function", function: { name: "inspect", parameters: { type: "object", properties: {} } } }]).invoke("Inspect the arrangement");
  expect(response.tool_calls?.[0]?.name).toBe("inspect");
  expect(transport).toHaveBeenCalledTimes(1);
  const [url, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
  expect(String(url)).toBe("https://api.openai.com/v1/responses");
  expect(new Headers(init.headers).get("authorization")).toBe("Bearer offline-openai-test");
  if (typeof init.body !== "string") throw new Error("Expected a JSON request body");
  expect(JSON.parse(init.body)).toMatchObject({ model: "gpt-6-luna", reasoning: { effort: "xhigh" }, tools: [{ type: "function", name: "inspect" }] });
});

it("captures the selected provider and price without changing old jobs", () => {
  for (const item of producerModels()) {
    const run = nativeRunLimits("standard", item.id);
    expect(run.model).toBe(item.id); expect(run.provider).toBe(item.provider);
    expect(jobNativeRunLimits({ _nativeRun: run })).toEqual(run);
  }
  expect(() => nativeRunLimits("standard", "arbitrary/model")).toThrow();
  Object.assign(config, { APP_ENV: "development", FIXTURE_MODE: false });
  expect(() => nativeRunLimits("standard", "gemini-3.7-flash")).toThrow(/not configured/);
});

it("uses the Gateway key alias, never the OpenAI key for DeepSeek", () => {
  Object.assign(getConfig(), { VERCEL_AI_GATEWAY_API_KEY: "gateway-test", OPENAI_API_KEY: "openai-test" });
  expect(modelCredentials("deepseek/deepseek-v4-pro-0813").apiKey).toBe("gateway-test");
});

it.each(["gemini-3.7-flash", "deepseek/deepseek-v4-pro-0813"])("preserves %s opaque tool context and real usage across a round trip", async (model) => {
  Object.assign(getConfig(), { GEMINI_API_KEY: "test-only", AI_GATEWAY_API_KEY: "test-only" });
  const wire = { role: "assistant", content: null, reasoning_content: "private protocol data", tool_calls: [{ id: "call-1", type: "function", function: { name: "inspect", arguments: '{"section":"intro"}' }, extra_content: { google: { thought_signature: "opaque-signature" } } }] };
  const requests: Array<Record<string, unknown>> = [];
  const transport: typeof fetch = async (url, init) => {
    await Promise.resolve();
    if (typeof url === "string" && url.includes("/generation")) return new Response(JSON.stringify({ data: { total_cost: 0.00123 } }));
    if (typeof init?.body !== "string") throw new Error("Expected JSON body");
    requests.push(JSON.parse(init.body) as Record<string, unknown>);
    return new Response(JSON.stringify({ id: "gen_test", choices: [{ message: wire, finish_reason: "tool_calls" }], usage: { prompt_tokens: 50, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 20 } } }));
  };
  const adapter = new CompatibleProducerModel(model, 100, "medium", 1000, transport);
  const bound = adapter.bindTools([{ type: "function", function: { name: "inspect", parameters: { type: "object", properties: { section: { type: "string" } }, required: ["section"] } } }]);
  const first = await bound.invoke([new HumanMessage("inspect")]);
  expect(first.tool_calls?.[0]?.args).toEqual({ section: "intro" });
  expect(compatibleMessages([first])[0]).toEqual(wire);
  await bound.invoke([new HumanMessage("inspect"), first, new ToolMessage({ content: "found", tool_call_id: "call-1" })]);
  expect(requests[1]?.messages).toEqual([{ role: "user", content: "inspect" }, wire, { role: "tool", tool_call_id: "call-1", content: "found" }]);
  expect(requests[0]?.tools).toBeTruthy();
  if (model.startsWith("deepseek")) expect(reportedGatewayCost({ generations: [[{ message: first }]] })).toBe(1230);
});

it("does not repeat generation when Gateway billing lookup fails", async () => {
  getConfig().AI_GATEWAY_API_KEY = "test-only";
  let calls = 0;
  const model = new CompatibleProducerModel("deepseek/deepseek-v4-pro-0813", 100, "low", 1000, async (url) => {
    await Promise.resolve();
    if (typeof url === "string" && url.includes("/generation")) return new Response("unavailable", { status: 503 });
    calls++;
    return new Response(JSON.stringify({ id: "gen_test", choices: [{ message: { role: "assistant", content: "done" }, finish_reason: "stop" }], usage: { prompt_tokens: 30, completion_tokens: 3 } }));
  });
  const result = await model.invoke("hello");
  expect(calls).toBe(1); expect(reportedGatewayCost({ generations: [[{ message: result }]] })).toBeUndefined();
});
