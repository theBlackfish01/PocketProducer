import { z } from "zod";
import { getConfig } from "../config.js";
import { pricingEvidence } from "../providers/pricing.js";
import { modelCredentials, modelProvider, producerModelSchema } from "../providers/models.js";

export const nativeProfileSchema = z.enum(["standard", "extended"]);
export type NativeProfile = z.infer<typeof nativeProfileSchema>;

export const nativeRunLimitsSchema = z.object({
  profile: nativeProfileSchema,
  model: z.string().min(1),
  provider: z.enum(["openai", "gemini", "gateway"]).optional(),
  pricing: z.object({ inputUsdPerMillion: z.number().min(0), cachedInputUsdPerMillion: z.number().min(0).optional(), cacheWriteUsdPerMillion: z.number().min(0).optional(), outputUsdPerMillion: z.number().min(0), modality: z.enum(["text", "audio"]), source: z.string(), verifiedOn: z.string() }).optional(),
  reasoningEffort: z.enum(["low", "medium", "high", "xhigh"]),
  maxCalls: z.number().int().min(0).max(300),
  maxInputTokens: z.number().int().min(1_000).max(256_000),
  maxOutputTokens: z.number().int().min(400).max(65_536),
  maxSampleAnalyses: z.number().int().min(0).max(6).optional(),
  deadlineSeconds: z.number().int().min(10).max(21_600),
  maxJobCostUsd: z.number().min(0).max(100)
});
export type NativeRunLimits = z.infer<typeof nativeRunLimitsSchema>;
export function minimumNextNativeReservationUsd(limits: NativeRunLimits, hasConfirmedMusic = false): number {
  // The callback reserves the configured response ceiling before dispatch.
  // A small input floor is only a UI/recovery lower bound, not a quote.
  const responseCeiling = nativePhaseOutputTokens(limits, hasConfirmedMusic);
  return Math.ceil(responseCeiling * (limits.pricing?.outputUsdPerMillion ?? 50) + 1_000 * (limits.pricing?.cacheWriteUsdPerMillion ?? (limits.pricing?.inputUsdPerMillion ?? 10) * 1.25)) / 1_000_000;
}

// Keep the existing phase-aware callers explicit; both phases now share one allowance.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function nativePhaseOutputTokens(limits: NativeRunLimits, _hasConfirmedMusic: boolean): number {
  // Reasoning and tool arguments share this envelope. Shrinking it after the
  // first edit truncated xhigh responses and defeated explicit extensions.
  return limits.maxOutputTokens;
}

export function nativeReviewLimit(limits: NativeRunLimits | null): number {
  return limits?.profile === "extended" ? 6 : 4;
}

export function nativeSampleAnalysisLimit(limits: NativeRunLimits | null): number {
  return limits?.maxSampleAnalyses ?? 2;
}

// Captured when the job is accepted, not re-created from mutable configuration
// on worker restart. The site-wide remaining allowance is checked separately.
export function nativeRunLimits(profile: NativeProfile, selectedModel?: string): NativeRunLimits {
  const config = getConfig();
  const model = selectedModel === undefined ? config.OPENAI_MODEL : producerModelSchema.parse(selectedModel);
  if (selectedModel !== undefined && !config.FIXTURE_MODE && !modelCredentials(model).apiKey) throw Object.assign(new Error("This producer is not configured. Choose another model."), { statusCode: 409 });
  const target = profile === "extended"
    ? { calls: 80, input: 160_000, output: 32_768, seconds: 3_600, cost: 15 }
    : { calls: 80, input: 128_000, output: model === "gpt-6-luna" ? 32_768 : 16_384, seconds: 1_800, cost: 5 };
  return nativeRunLimitsSchema.parse({
    profile, model, provider: modelProvider(model), pricing: pricingEvidence(modelProvider(model), model), reasoningEffort: model === "gpt-6-luna" ? "xhigh" : config.NATIVE_REASONING_EFFORT,
    maxCalls: Math.min(target.calls, config.MAX_MODEL_CALLS_PER_JOB),
    maxInputTokens: Math.min(target.input, config.MAX_OPENAI_INPUT_TOKENS),
    maxOutputTokens: Math.min(target.output, config.NATIVE_MODEL_OUTPUT_TOKENS),
    maxSampleAnalyses: profile === "extended" ? 3 : 2,
    deadlineSeconds: Math.min(target.seconds, config.MAX_JOB_SECONDS),
    maxJobCostUsd: Math.min(target.cost, config.MAX_JOB_COST_USD)
  });
}

export function jobNativeRunLimits(request: Record<string, unknown>): NativeRunLimits | null {
  const current = request._nativeRunCurrent ?? request._nativeRun;
  return current === undefined ? null : nativeRunLimitsSchema.parse(current);
}

// An explicit extension is allowance metadata, not a new creative command or
// provider-effect identity. Existing step/effect hashes use the original request.
export function originalNativeRequest(request: Record<string, unknown>): Record<string, unknown> {
  const original = { ...request };
  delete original._nativeRunCurrent;
  return original;
}
