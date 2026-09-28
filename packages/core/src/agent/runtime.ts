import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { LLMResult } from "@langchain/core/outputs";
import type { Serialized } from "@langchain/core/load/serializable";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { getConfig } from "../config.js";
import { canonicalHash } from "../domain/hash.js";
import { getPool } from "../db/pool.js";
import type { JobRecord } from "../db/repository.js";
import { completeProviderEffect, failProviderEffect, markEffectDispatched, reserveProviderEffect } from "../providers/effects.js";
import { tokenCostMicrousd, tokenCostMicrousdAtPrice, tokenCostUsd } from "../providers/pricing.js";
import { jobNativeRunLimits } from "../native/profile.js";
import { modelProvider } from "../providers/models.js";
import { reportedGatewayCost } from "../providers/compatible-model.js";

let checkpointReady: Promise<PostgresSaver> | undefined;

export function checkpoint(): Promise<PostgresSaver> {
  checkpointReady ??= (async () => {
    const saver = new PostgresSaver(getPool(), undefined, { schema: "public" });
    await saver.setup();
    return saver;
  })();
  return checkpointReady;
}

export async function estimateCheckpointUsage(threadId: string): Promise<{ inputTokens: number; outputTokens: number }> {
  const rows = await getPool().query<{ blob: Buffer }>("SELECT blob FROM checkpoint_writes WHERE thread_id=$1 AND channel='messages' AND type='json'", [threadId]);
  const totals = { inputTokens: 0, outputTokens: 0 };
  const seen = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const usage = record.usage_metadata;
    const id = typeof record.id === "string" ? record.id : undefined;
    if (usage && typeof usage === "object" && (!id || !seen.has(id))) {
      const tokens = usage as Record<string, unknown>;
      totals.inputTokens += typeof tokens.input_tokens === "number" ? tokens.input_tokens : 0;
      totals.outputTokens += typeof tokens.output_tokens === "number" ? tokens.output_tokens : 0;
      if (id) seen.add(id);
    }
    for (const child of Object.values(record)) visit(child);
  };
  for (const row of rows.rows) {
    try { visit(JSON.parse(row.blob.toString("utf8")) as unknown); } catch { /* A future serializer can omit usage rather than fail the job. */ }
  }
  return totals;
}

export function openAiCost(usage: { inputTokens: number; outputTokens: number }, model: string): number {
  return tokenCostUsd("openai", model, usage);
}

export function usageFromLlmResult(result: LLMResult): { inputTokens: number; outputTokens: number; cachedInputTokens: number; cacheWriteTokens: number } {
  const totals = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0 };
  for (const generations of result.generations) {
    for (const generation of generations) {
      const message = "message" in generation ? generation.message as BaseMessage & { usage_metadata?: { input_tokens?: number; output_tokens?: number; input_token_details?: { cache_read?: number; cache_creation?: number; cache_write?: number } }; response_metadata?: { tokenUsage?: { promptTokensDetails?: { cachedTokens?: number; cacheWriteTokens?: number } }; token_usage?: { prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number } } } } : undefined;
      totals.inputTokens += message?.usage_metadata?.input_tokens ?? 0;
      totals.outputTokens += message?.usage_metadata?.output_tokens ?? 0;
      totals.cachedInputTokens += message?.usage_metadata?.input_token_details?.cache_read ?? message?.response_metadata?.token_usage?.prompt_tokens_details?.cached_tokens ?? message?.response_metadata?.tokenUsage?.promptTokensDetails?.cachedTokens ?? 0;
      totals.cacheWriteTokens += message?.usage_metadata?.input_token_details?.cache_creation ?? message?.usage_metadata?.input_token_details?.cache_write ?? message?.response_metadata?.token_usage?.prompt_tokens_details?.cache_write_tokens ?? message?.response_metadata?.tokenUsage?.promptTokensDetails?.cacheWriteTokens ?? 0;
    }
  }
  const tokenUsage = result.llmOutput?.tokenUsage as { promptTokens?: number; completionTokens?: number; promptTokensDetails?: { cachedTokens?: number; cacheWriteTokens?: number } } | undefined;
  if (totals.inputTokens === 0) totals.inputTokens = tokenUsage?.promptTokens ?? 0;
  if (totals.outputTokens === 0) totals.outputTokens = tokenUsage?.completionTokens ?? 0;
  if (totals.cachedInputTokens === 0) totals.cachedInputTokens = tokenUsage?.promptTokensDetails?.cachedTokens ?? 0;
  if (totals.cacheWriteTokens === 0) totals.cacheWriteTokens = tokenUsage?.promptTokensDetails?.cacheWriteTokens ?? 0;
  totals.cachedInputTokens = Math.max(0, Math.min(totals.inputTokens, totals.cachedInputTokens));
  totals.cacheWriteTokens = Math.max(0, Math.min(totals.inputTokens, totals.cacheWriteTokens));
  return totals;
}

export class AccountedOpenAICalls extends BaseCallbackHandler {
  name = "pocket-producer-accounting";
  private readonly effects = new Map<string, string>();
  private currentOutputTokenBound: number;
  private requestEnvelope: unknown;
  private readonly inputBounds = new Map<string, ReturnType<typeof boundOpenAiRequest>["inputComponents"]>();
  readonly usage = { inputTokens: 0, outputTokens: 0 };
  costMicrousd = 0;

  constructor(private readonly job: JobRecord, private readonly model: string, private readonly operationHash: string, private readonly outputTokenBound = 900) {
    super({ raiseError: true, _awaitHandler: true });
    this.currentOutputTokenBound = outputTokenBound;
  }

  setOutputTokenBound(bound: number): void { this.currentOutputTokenBound = Math.min(this.outputTokenBound, bound); }
  setRequestEnvelope(envelope: unknown): void { this.requestEnvelope = envelope; }

  private cost(usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number; cacheWriteTokens?: number }): number {
    const capturedPrice = jobNativeRunLimits(this.job.request)?.pricing;
    // Older captured Astra profiles predate the cache-write field. Preserve
    // their captured input rate and apply the documented 1.25x write factor.
    return capturedPrice ? tokenCostMicrousdAtPrice({ ...capturedPrice, cacheWriteUsdPerMillion: capturedPrice.cacheWriteUsdPerMillion ?? (this.model === "gpt-6-astra" ? capturedPrice.inputUsdPerMillion * 1.25 : capturedPrice.inputUsdPerMillion) }, usage) : tokenCostMicrousd("openai", this.model, usage);
  }

  override async handleChatModelStart(_llm: Serialized, messages: BaseMessage[][], runId: string): Promise<void> {
    const request = boundOpenAiRequest(messages, this.currentOutputTokenBound, jobNativeRunLimits(this.job.request)?.maxInputTokens, this.requestEnvelope);
    // A handoff can reconstruct identical musical context for a different model.
    // Keep prior Sol identities stable, but never collide with them for Luna.
    const originalModel = jobNativeRunLimits({ _nativeRun: this.job.request._nativeRun })?.model;
    const messageHash = canonicalHash(originalModel && originalModel !== this.model ? { model: this.model, messages: request.normalizedMessages } : request.normalizedMessages);
    const reservation = await reserveProviderEffect({
      job: this.job,
      provider: modelProvider(this.model),
      step: "producer-model-call",
      idempotencyKey: `producer:${this.operationHash}:call:${messageHash}`,
      inputHash: canonicalHash({ operationHash: this.operationHash, messageHash, inputTokenBound: request.inputTokenBound, outputTokenBound: request.outputTokenBound }),
      model: this.model,
      promptVersion: "deep-producer-v2",
      // No cache hit is assumed. For a write-priced model, all input may be a
      // cache creation on this dispatch, so reserve at that upper rate.
      reservationMicrousd: this.cost({ inputTokens: request.inputTokenBound, cacheWriteTokens: request.inputTokenBound, outputTokens: request.outputTokenBound })
    });
    if (!reservation.created) throw new Error(`OPENAI_EFFECT_${reservation.state.toUpperCase()}`);
    await markEffectDispatched(reservation.id, this.job);
    this.effects.set(runId, reservation.id);
    this.inputBounds.set(runId, request.inputComponents);
  }

  override async handleLLMEnd(output: LLMResult, runId: string): Promise<void> {
    const effectId = this.effects.get(runId);
    if (!effectId) return;
    const usage = usageFromLlmResult(output);
    const gatewayCost = reportedGatewayCost(output);
    const returned = output.generations[0]?.[0] as { message?: BaseMessage } | undefined;
    const requestId = returned?.message?.response_metadata.providerRequestId;
    const providerRequestId = typeof requestId === "string" ? requestId : "";
    if (!getConfig().FIXTURE_MODE && (usage.inputTokens <= 0 || usage.outputTokens <= 0 || (modelProvider(this.model) === "gateway" && gatewayCost === undefined))) {
      await failProviderEffect({ effectId, job: this.job, errorClass: "ProviderUsageUnknown", uncertain: true, safeDetails: { providerRequestId } });
      throw new Error("PROVIDER_USAGE_UNKNOWN: reconcile the observed response before continuing");
    }
    const actualCostMicrousd = gatewayCost ?? this.cost(usage);
    const state = await completeProviderEffect({ effectId, job: this.job, output: { usage, inputReservationBytes: this.inputBounds.get(runId) }, actualCostMicrousd, ...(providerRequestId ? { providerRequestId } : {}) });
    if (state !== "succeeded") throw new Error("OPENAI_EFFECT_OUTCOME_UNCERTAIN");
    this.usage.inputTokens += usage.inputTokens;
    this.usage.outputTokens += usage.outputTokens;
    this.costMicrousd += actualCostMicrousd;
  }

  override async handleLLMError(error: Error, runId: string): Promise<void> {
    const effectId = this.effects.get(runId);
    if (!effectId) return;
    await failProviderEffect({
      effectId,
      job: this.job,
      errorClass: error.name,
      uncertain: /timeout|abort|network|uncertain|ECONN|socket/i.test(`${error.name} ${error.message}`)
    });
  }
}

export function boundOpenAiRequest(messages: BaseMessage[][], outputTokenBound = 900, inputLimit = getConfig().MAX_OPENAI_INPUT_TOKENS, envelope?: unknown): {
  normalizedMessages: unknown;
  inputTokenBound: number;
  outputTokenBound: number;
  inputComponents: { messages: number; envelope: number; framing: number };
} {
  const normalizedMessages = messages.map((batch) => batch.map((message) => ({
    type: message.type,
    content: message.content,
    name: message.name,
    additionalKwargs: message.additional_kwargs,
    // These are replayed on the wire even when assistant prose is empty.
    // Preserve the conservative input/reservation bound for opaque context too.
    providerOutput: message.response_metadata?.output,
    toolCalls: message instanceof AIMessage ? message.tool_calls : undefined
  })));
  const serialized = JSON.stringify(normalizedMessages);
  // Shared by preflight and accounting: actual bound tool schemas are additional
  // input, not part of the fixed framing allowance. This is a byte reservation
  // guard, NOT a measurement of provider tokens (settlement uses reported usage).
  // UTF-8 bytes are a conservative tokenizer-independent upper bound for the
  // selected text-only request. This intentionally admits less than an
  // approximate chars/4 estimate rather than risking an under-reservation.
  const inputComponents = { messages: Buffer.byteLength(serialized, "utf8"), envelope: envelope === undefined ? 0 : Buffer.byteLength(JSON.stringify(envelope), "utf8"), framing: 768 };
  const inputTokenBound = inputComponents.messages + inputComponents.envelope + inputComponents.framing;
  const configuredLimit = Math.min(inputLimit, getConfig().MAX_OPENAI_INPUT_TOKENS);
  if (inputTokenBound > configuredLimit) {
    throw new Error(`OPENAI_INPUT_LIMIT_EXCEEDED:${inputTokenBound}:${configuredLimit}`);
  }
  return { normalizedMessages, inputTokenBound, outputTokenBound, inputComponents };
}
