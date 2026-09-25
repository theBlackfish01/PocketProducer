import { z } from "zod";
import { getConfig } from "../config.js";
import { pricingEvidence } from "../providers/pricing.js";

export const nativeProfileSchema = z.enum(["standard", "extended"]);
export type NativeProfile = z.infer<typeof nativeProfileSchema>;

export const nativeRunLimitsSchema = z.object({
  profile: nativeProfileSchema,
  model: z.string().min(1),
  pricing: z.object({ inputUsdPerMillion: z.number().min(0), outputUsdPerMillion: z.number().min(0), modality: z.enum(["text", "audio"]), source: z.string(), verifiedOn: z.string() }).optional(),
  reasoningEffort: z.enum(["low", "medium", "high"]),
  maxCalls: z.number().int().min(0).max(100),
  maxInputTokens: z.number().int().min(1_000).max(128_000),
  maxOutputTokens: z.number().int().min(400).max(32_768),
  deadlineSeconds: z.number().int().min(10).max(3_600),
  maxJobCostUsd: z.number().min(0).max(15)
});
export type NativeRunLimits = z.infer<typeof nativeRunLimitsSchema>;

// Captured when the job is accepted, not re-created from mutable configuration
// on worker restart. The site-wide remaining allowance is checked separately.
export function nativeRunLimits(profile: NativeProfile): NativeRunLimits {
  const config = getConfig();
  const target = profile === "extended"
    ? { calls: 80, input: 96_000, output: 32_768, seconds: 3_600, cost: 15 }
    : { calls: 40, input: 64_000, output: 16_384, seconds: 1_800, cost: 5 };
  return nativeRunLimitsSchema.parse({
    profile, model: config.OPENAI_MODEL, pricing: pricingEvidence("openai", config.OPENAI_MODEL), reasoningEffort: config.NATIVE_REASONING_EFFORT,
    maxCalls: Math.min(target.calls, config.MAX_MODEL_CALLS_PER_JOB),
    maxInputTokens: Math.min(target.input, config.MAX_OPENAI_INPUT_TOKENS),
    maxOutputTokens: Math.min(target.output, config.NATIVE_MODEL_OUTPUT_TOKENS),
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
