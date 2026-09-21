export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

interface ModelPrice {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  modality: "text" | "audio";
  source: string;
  verifiedOn: string;
}

const prices: Record<string, ModelPrice> = {
  "openai:gpt-6-astra": {
    inputUsdPerMillion: 10,
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
  const price = requireModelPrice(provider, model);
  return Math.ceil(usage.inputTokens * price.inputUsdPerMillion + usage.outputTokens * price.outputUsdPerMillion);
}

export function tokenCostUsd(provider: "openai" | "gemini", model: string, usage: TokenUsage): number {
  return tokenCostMicrousd(provider, model, usage) / 1_000_000;
}

export function pricingEvidence(provider: "openai" | "gemini", model: string): ModelPrice {
  return requireModelPrice(provider, model);
}
