import type pg from "pg";
import { getConfig } from "../config.js";
import { getPool } from "../db/pool.js";
import { minimumNextNativeReservationUsd, nativeRunLimits, type NativeRunLimits } from "../native/profile.js";
import { modelCredentials, modelProvider, producerModels } from "./models.js";
import { sharedUsageBlock, type UsageBlock } from "./limits.js";
import { pricingEvidence } from "./pricing.js";

// Only the route changes. Never reset a logical job's limits, deadline or spend.
export function lunaHandoffLimits(limits: NativeRunLimits): NativeRunLimits {
  return { ...limits, model: "gpt-6-luna", provider: "openai", reasoningEffort: "xhigh", pricing: pricingEvidence("openai", "gpt-6-luna") };
}

export async function selectFundedRoute(client: pg.PoolClient | pg.Pool, ownerId: string, limits: NativeRunLimits, hasMusic = false): Promise<{ limits: NativeRunLimits; blocked: UsageBlock | null }> {
  const blocked = await sharedUsageBlock(client, ownerId, modelProvider(limits.model), Math.ceil(minimumNextNativeReservationUsd(limits, hasMusic) * 1e6), limits.model);
  if (blocked === "MODEL" && limits.model === "gpt-6-sol" && getConfig().LUNA_POOL_BUDGET_USD !== undefined && (getConfig().FIXTURE_MODE || modelCredentials("gpt-6-luna").apiKey)) {
    const next = lunaHandoffLimits(limits);
    return { limits: next, blocked: await sharedUsageBlock(client, ownerId, "openai", Math.ceil(minimumNextNativeReservationUsd(next, hasMusic) * 1e6), next.model) };
  }
  return { limits, blocked };
}

export function allowanceMessage(block: UsageBlock): string {
  return block === "USER" ? "You've reached your demo usage limit. Your saved arrangements are still available." : "The shared demo allowance is unavailable for this request. Your saved arrangements are still available.";
}

export async function fundedProducerModels(ownerId: string) {
  const models = await Promise.all(producerModels().map(async (model) => {
    const limits = nativeRunLimits("standard", model.available ? model.id : undefined);
    const unmeteredFixture = getConfig().FIXTURE_MODE && getConfig().SOL_POOL_BUDGET_USD === undefined && getConfig().LUNA_POOL_BUDGET_USD === undefined;
    const blocked = model.available && !unmeteredFixture ? await sharedUsageBlock(getPool(), ownerId, model.provider, Math.ceil(minimumNextNativeReservationUsd(limits) * 1e6), model.id) : null;
    return { ...model, available: model.available && !blocked, reason: !model.available ? "configuration" : blocked?.toLowerCase() ?? null };
  }));
  // Historical Sol jobs can still use selectFundedRoute; new public work is Luna-only.
  return { models, fallbackModel: null,
    repository: { url: "https://github.com/theBlackfish01/PocketProducer", public: getConfig().SOURCE_REPOSITORY_PUBLIC } };
}
