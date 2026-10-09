import { randomUUID } from "node:crypto";
import { fakeModel as langChainFakeModel } from "@langchain/core/testing";
import { AIMessage } from "@langchain/core/messages";
import type { z } from "zod";
import { captureNativeBrief, type NativeBrief, type nativeBriefProposalSchema } from "./native/brief.js";
import type { NativeDocument } from "./native/model.js";

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
export { focusedNativeReview, nativeFormatRecoveryAvailable, nativeReviewResponseFormat } from "./native/review-model.js";
export { createOfflineDocument } from "@audiotool/nexus/node";

type BriefProposal = z.input<typeof nativeBriefProposalSchema>;
/** A section reference by written name (new piece) or name in the selected version. */
export const briefSection = (name: string) => ({ sectionId: null, name, position: null });
export const briefRole = (kind: BriefProposal["roles"][number]["kind"], role: BriefProposal["roles"][number]["role"], quote: string, section: string | null = null, reduceDensity = false) => ({ kind, role, quote, section: section ? briefSection(section) : null, reduceDensity });
export const briefKeep = (quote: string, target: { partId?: string; motifId?: string; theme?: boolean }, section: string | null = null) => ({ partId: target.partId ?? null, motifId: target.motifId ?? null, theme: target.theme ?? false, section: section ? briefSection(section) : null, quote });
/** A brief captured from an explicit interpretation, through the real validation. */
export function capturedBrief(direction: string, proposal: Partial<BriefProposal> = {}, document: NativeDocument | null = null, targetSectionId: string | null = null): NativeBrief {
  return captureNativeBrief({ totalBars: null, tempoBpm: null, meter: null, sections: [], chordProgressions: [], roles: [], keep: [], construction: [], guidance: [], ...proposal }, { direction, document, baseRevisionId: null, targetSectionId, provenance: "scripted" });
}
/** A scripted interpreter reply, validated by the real capture like a live one. */
export const scriptedBrief = (proposal: Partial<BriefProposal> = {}, usage = { inputTokens: 40, outputTokens: 20 }) => () => Promise.resolve({ value: { totalBars: null, tempoBpm: null, meter: null, sections: [], chordProgressions: [], roles: [], keep: [], construction: [], guidance: [], ...proposal }, usage });
