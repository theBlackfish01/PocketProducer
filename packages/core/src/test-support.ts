import { randomUUID } from "node:crypto";
import { fakeModel as langChainFakeModel } from "@langchain/core/testing";
import { AIMessage } from "@langchain/core/messages";

// The upstream tool helper echoes the entire input into assistant prose. That
// creates exponential fake history, unlike a normal tool-only provider reply.
// Keep the same queues/call inspection, without relying on production stripping
// assistant messages (which would also destroy provider replay envelopes).
export function fakeModel() {
  const model = langChainFakeModel();
  model.respondWithTools = (calls) => model.respond(new AIMessage({ content: "", tool_calls: calls.map((call) => ({ ...call, id: call.id ?? randomUUID(), type: "tool_call" as const })) }));
  return model;
}
export { AIMessage } from "@langchain/core/messages";
export { CompatibleProducerModel, producerChatModel } from "./providers/compatible-model.js";
export { AccountedOpenAICalls, boundOpenAiRequest } from "./agent/runtime.js";
export { sharedUsageBlock } from "./providers/limits.js";
export { focusedNativeReview, nativeFormatRecoveryAvailable } from "./native/review-model.js";
export { createOfflineDocument } from "@audiotool/nexus/node";
