import { BaseChatModel, type BaseChatModelCallOptions, type BindToolsInput } from "@langchain/core/language_models/chat_models";
import { AIMessage, type ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import { getConfig } from "../config.js";
import { modelCredentials, modelProvider } from "./models.js";

interface Options extends BaseChatModelCallOptions { tools?: ReturnType<typeof convertToOpenAITool>[] }
const wireMessage = z.object({ role: z.literal("assistant"), content: z.string().nullable().optional(), reasoning_content: z.string().optional(),
  tool_calls: z.array(z.object({ id: z.string(), type: z.literal("function"), function: z.object({ name: z.string(), arguments: z.string() }), extra_content: z.unknown().optional() }).loose()).optional(),
  extra_content: z.unknown().optional(),
});
const responseSchema = z.object({ id: z.string(), choices: z.array(z.object({ message: wireMessage, finish_reason: z.string().nullable() })).min(1),
  usage: z.object({ prompt_tokens: z.number().nonnegative(), completion_tokens: z.number().nonnegative(), prompt_tokens_details: z.object({ cached_tokens: z.number().nonnegative().optional() }).optional() }).optional(),
});

export function compatibleMessages(messages: BaseMessage[]) {
  return messages.map((m) => {
    if (m.type === "ai") {
      // Preserve opaque Gemini signatures and DeepSeek reasoning across tool turns/checkpoints.
      const saved = m.additional_kwargs.producerWire;
      if (saved) return wireMessage.parse(saved);
      const ai = m as AIMessage;
      return { role: "assistant", content: m.text || null, ...(ai.tool_calls?.length ? { tool_calls: ai.tool_calls.map((t) => ({ id: t.id, type: "function", function: { name: t.name, arguments: JSON.stringify(t.args) } })) } : {}) };
    }
    if (m.type === "tool") return { role: "tool", tool_call_id: (m as ToolMessage).tool_call_id, content: m.text };
    return { role: m.type === "human" ? "user" : "system", content: m.text };
  });
}

/** Narrow text/tool adapter; existing LangGraph orchestration and accounting stay authoritative. */
export class CompatibleProducerModel extends BaseChatModel<Options> {
  constructor(readonly modelName: string, readonly outputTokens: number, readonly effort: "low" | "medium" | "high", readonly timeoutMs: number, readonly transport: typeof fetch = fetch) { super({ maxRetries: 0 }); }
  _llmType() { return "pocket-compatible-producer"; }
  override bindTools(tools: BindToolsInput[], options?: Partial<Options>) { return this.withConfig({ ...options, tools: tools.map((t) => convertToOpenAITool(t)) }); }
  async _generate(messages: BaseMessage[], options: Options): Promise<ChatResult> {
    if (getConfig().FIXTURE_MODE && this.transport === fetch) throw new Error("Provider network disabled in fixture mode");
    const route = modelCredentials(this.modelName);
    if (!route.apiKey) throw new Error("Selected producer is not configured");
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(this.timeoutMs)]) : AbortSignal.timeout(this.timeoutMs);
    const headers = { Authorization: `Bearer ${route.apiKey}`, "Content-Type": "application/json" };
    const response = await this.transport(`${route.baseURL.replace(/\/$/, "")}/chat/completions`, { method: "POST", headers, signal, redirect: "error", body: JSON.stringify({
      model: this.modelName, messages: compatibleMessages(messages), max_tokens: this.outputTokens, stream: false,
      ...(options.tools?.length ? { tools: options.tools, tool_choice: "auto" } : {}),
      reasoning_effort: route.provider === "gateway" ? "high" : this.effort,
    }) }).catch(() => { throw new Error("Provider network outcome uncertain"); });
    // Never log provider bodies or headers. Ambiguous transport/server failures retain their reservation.
    if (!response.ok) throw new Error(`Provider ${response.status >= 500 ? "network outcome uncertain" : "request rejected"}: HTTP ${response.status}`);
    let raw: z.infer<typeof responseSchema>;
    try { raw = responseSchema.parse(await response.json()); } catch { throw new Error("Provider response outcome uncertain: invalid envelope"); }
    const choice = raw.choices[0]!;
    const calls: NonNullable<AIMessage["tool_calls"]> = [], invalid: NonNullable<AIMessage["invalid_tool_calls"]> = [];
    for (const t of choice.message.tool_calls ?? []) {
      try { calls.push({ id: t.id, name: t.function.name, args: z.record(z.string(), z.unknown()).parse(JSON.parse(t.function.arguments)), type: "tool_call" }); }
      catch { invalid.push({ id: t.id, name: t.function.name, args: t.function.arguments, error: "Invalid tool arguments", type: "invalid_tool_call" }); }
    }
    let gatewayCostMicrousd: number | undefined;
    if (route.provider === "gateway") {
      // Lookup may lag ingestion; retry only the read, NEVER the generation.
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const bill = await this.transport(`${route.baseURL}/generation?id=${encodeURIComponent(raw.id)}`, { headers, signal, redirect: "error" });
          if (bill.ok) {
            const value = z.object({ data: z.object({ total_cost: z.number().nonnegative(), is_byok: z.boolean().optional() }) }).parse(await bill.json());
            if (value.data.is_byok) break; // Separate upstream wallet is not silently charged as Gateway credit.
            gatewayCostMicrousd = Math.ceil(value.data.total_cost * 1e6); break;
          }
          if (bill.status !== 404) break;
          if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 2000));
        } catch { break; }
      }
    }
    const usage = raw.usage;
    const message = new AIMessage(choice.message.content ?? "");
    message.response_metadata = { ...(choice.finish_reason ? { finish_reason: choice.finish_reason } : {}), providerRequestId: raw.id, ...(gatewayCostMicrousd !== undefined ? { gatewayCostMicrousd } : {}) };
    if (usage) Object.assign(message, { usage_metadata: { input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens, total_tokens: usage.prompt_tokens + usage.completion_tokens, input_token_details: { cache_read: usage.prompt_tokens_details?.cached_tokens ?? 0 } } });
    message.tool_calls = calls;
    message.invalid_tool_calls = invalid;
    message.additional_kwargs.producerWire = choice.message;
    return { generations: [{ message, text: message.text }] };
  }
}

/** cacheKey groups requests that share a prompt prefix (one job, or one reviewer
 * prompt) so the provider can reuse cached input. It carries no user content. */
export function producerChatModel(model: string, output: number, effort: "low" | "medium" | "high" | "xhigh", timeout: number, cacheKey?: string): BaseChatModel {
  // The pinned LangChain version only recognizes o*/gpt-5 as reasoning models.
  // Forward Luna's effort explicitly rather than silently dropping xhigh on the wire.
  if (modelProvider(model) === "openai") return new ChatOpenAI({ model, apiKey: getConfig().OPENAI_API_KEY, useResponsesApi: true, reasoning: { effort }, ...(model === "gpt-6-luna" ? { modelKwargs: { reasoning: { effort } } } : {}), maxTokens: output, maxRetries: 0, timeout, ...(cacheKey ? { promptCacheKey: cacheKey } : {}) });
  if (effort === "xhigh") throw new Error("xhigh reasoning requires an OpenAI producer");
  return new CompatibleProducerModel(model, output, effort, timeout);
}

export function reportedGatewayCost(result: { generations: unknown[][] }): number | undefined {
  const generation = result.generations[0]?.[0] as { message?: BaseMessage } | undefined;
  const value = generation?.message?.response_metadata.gatewayCostMicrousd;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
