import { afterEach, expect, it, vi } from "vitest";
import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import { getConfig } from "../config.js";
import { nativeRunLimits, jobNativeRunLimits } from "../native/profile.js";
import { CompatibleProducerModel, compatibleMessages, reportedGatewayCost } from "./compatible-model.js";
import { modelCredentials, producerModels } from "./models.js";
const config = getConfig(), original = { ...config };
afterEach(() => { Object.assign(config, original); vi.restoreAllMocks(); });

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
