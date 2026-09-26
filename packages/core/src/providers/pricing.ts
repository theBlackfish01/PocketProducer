export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
}

export interface ModelPrice {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cachedInputUsdPerMillion?: number | undefined;
  cacheWriteUsdPerMillion?: number | undefined;
  modality: "text" | "audio";
  source: string;
  verifiedOn: string;
}

const prices: Record<string, ModelPrice> = {
  "openai:gpt-6-astra": {
    inputUsdPerMillion: 10,
    cachedInputUsdPerMillion: 1,
    cacheWriteUsdPerMillion: 12.5,
    outputUsdPerMillion: 50,
    modality: "text",
    source: "https://developers.openai.com/api/docs/models/gpt-6-astra",
    verifiedOn: "2026-09-27"
  },
  "gemini:gemini-3-flash-preview": {
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 3,
    modality: "audio",
    source: "https://ai.google.dev/gemini-api/docs/pricing",
    verifiedOn: "2026-09-20"
  }
};

export function requireModelPrice(provider: "openai" | "gemini", model: string): ModelPrice {
  const price = prices[`${provider}:${model}`];
  if (!price) throw new Error(`No verified pricing is configured for ${provider} model ${model}`);
  return price;
}

export function tokenCostMicrousd(provider: "openai" | "gemini", model: string, usage: TokenUsage): number {
  return tokenCostMicrousdAtPrice(requireModelPrice(provider, model), usage);
}

export function tokenCostMicrousdAtPrice(price: ModelPrice, usage: TokenUsage): number {
  const input = Math.max(0, usage.inputTokens);
  const writes = Math.max(0, Math.min(input, usage.cacheWriteTokens ?? 0));
  // Invalid overlapping telemetry must never grant a larger discount.
  const reads = Math.max(0, Math.min(input - writes, (usage.cachedInputTokens ?? 0) + writes <= input ? usage.cachedInputTokens ?? 0 : 0));
  return Math.ceil((input - reads - writes) * price.inputUsdPerMillion
    + reads * (price.cachedInputUsdPerMillion ?? price.inputUsdPerMillion)
    + writes * (price.cacheWriteUsdPerMillion ?? price.inputUsdPerMillion)
    + Math.max(0, usage.outputTokens) * price.outputUsdPerMillion);
}

export function tokenCostUsd(provider: "openai" | "gemini", model: string, usage: TokenUsage): number {
  return tokenCostMicrousd(provider, model, usage) / 1_000_000;
}

export function pricingEvidence(provider: "openai" | "gemini", model: string): ModelPrice {
  return requireModelPrice(provider, model);
}
