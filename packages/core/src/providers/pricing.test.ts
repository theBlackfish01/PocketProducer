import { AIMessage } from "@langchain/core/messages";
import type { LLMResult } from "@langchain/core/outputs";
import { describe, expect, it } from "vitest";
import { openAiCost, usageFromLlmResult } from "../agent/producer.js";
import { pricingEvidence, tokenCostMicrousdAtPrice } from "./pricing.js";

describe("captured provider accounting", () => {
  it("discounts only provider-reported cached input tokens", () => {
    const price = pricingEvidence("openai", "gpt-6-astra");
    expect(tokenCostMicrousdAtPrice(price, { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 400 })).toBe(6000 + 400 + 5000);
    expect(tokenCostMicrousdAtPrice(price, { inputTokens: 1000, outputTokens: 100 })).toBe(10000 + 5000);
    expect(tokenCostMicrousdAtPrice(price, { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 400, cacheWriteTokens: 300 })).toBe(3000 + 400 + 3750 + 5000);
    expect(tokenCostMicrousdAtPrice(price, { inputTokens: 1000, outputTokens: 0, cachedInputTokens: 1000, cacheWriteTokens: 1000 })).toBe(12500);
  });
  it("captures verified GPT-6 Sol pricing for new jobs without repricing Astra history", () => {
    const sol = pricingEvidence("openai", "gpt-6-sol");
    const astra = pricingEvidence("openai", "gpt-6-astra");
    expect(tokenCostMicrousdAtPrice(sol, { inputTokens: 1000, cachedInputTokens: 400, cacheWriteTokens: 300, outputTokens: 100 }))
      .toBe(600 + 80 + 750 + 1000);
    expect(astra.inputUsdPerMillion).toBe(10);
    expect(astra.outputUsdPerMillion).toBe(50);
    expect(openAiCost({ inputTokens: 1000, outputTokens: 100 }, "gpt-6-sol")).toBe(0.003);
    expect(openAiCost({ inputTokens: 1000, outputTokens: 100 }, "gpt-6-astra")).toBe(0.015);
  });
  it("reads cached usage from the reported model message without estimating a cache hit", () => {
    const cached = new AIMessage("done");
    Object.assign(cached, { usage_metadata: { input_tokens: 1000, output_tokens: 100, total_tokens: 1100, input_token_details: { cache_read: 400, cache_creation: 300 } } });
    const result = { generations: [[{ message: cached, text: "done" }]] } as unknown as LLMResult;
    expect(usageFromLlmResult(result)).toEqual({ inputTokens: 1000, outputTokens: 100, cachedInputTokens: 400, cacheWriteTokens: 300 });
  });
});
