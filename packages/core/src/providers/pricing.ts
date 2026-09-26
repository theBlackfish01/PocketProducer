export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

export interface ModelPrice {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cachedInputUsdPerMillion?: number | undefined;
  modality: "text" | "audio";
  source: string;
  verifiedOn: string;
}

const prices: Record<string, ModelPrice> = {
  "openai:gpt-6-astra": {
    inputUsdPerMillion: 10,
    cachedInputUsdPerMillion: 1,
    outputUsdPerMillion: 50,
    modality: "text",
    source: "https://developers.openai.com/api/docs/models/gpt-6-astra",
    verifiedOn: "2026-09-20"
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
  const cached = Math.max(0, Math.min(usage.inputTokens, usage.cachedInputTokens ?? 0));
  return Math.ceil((usage.inputTokens - cached) * price.inputUsdPerMillion + cached * (price.cachedInputUsdPerMillion ?? price.inputUsdPerMillion) + usage.outputTokens * price.outputUsdPerMillion);
}

export function tokenCostUsd(provider: "openai" | "gemini", model: string, usage: TokenUsage): number {
  return tokenCostMicrousd(provider, model, usage) / 1_000_000;
}

export function pricingEvidence(provider: "openai" | "gemini", model: string): ModelPrice {
  return requireModelPrice(provider, model);
}
