import type { NativeRunLimits } from "./profile.js";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const count = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

// Only diagnostic facts, never response text, reasoning or tool arguments.
export function nativeCompletionDiagnostic(response: unknown, outputLimit?: number) {
  const value = record(response), metadata = record(value.response_metadata ?? value.responseMetadata);
  const details = record(metadata.incomplete_details ?? metadata.incompleteDetails);
  const usage = record(value.usage_metadata), tokens = record(usage.output_token_details);
  const length = metadata.finish_reason === "length" || metadata.finishReason === "length";
  const incomplete = metadata.status === "incomplete" || length || details.reason === "max_output_tokens";
  const reason = details.reason === "max_output_tokens" || length ? "max_output_tokens" : details.reason === "content_filter" ? "content_filter" : "unknown";
  return { incomplete, reason: incomplete ? reason : null, outputLimit: count(outputLimit), outputTokens: count(usage.output_tokens), reasoningTokens: count(tokens.reasoning) };
}

export function assertNativeModelCompletion(response: unknown, outputLimit?: number): void {
  const diagnostic = nativeCompletionDiagnostic(response, outputLimit);
  if (!diagnostic.incomplete) return;
  throw new Error(`OPENAI_INCOMPLETE_RESPONSE: reason=${diagnostic.reason}; output_limit=${diagnostic.outputLimit ?? "unknown"}; output_tokens=${diagnostic.outputTokens ?? "unknown"}; reasoning_tokens=${diagnostic.reasoningTokens ?? "unknown"}. The incomplete response was not applied.`);
}

export function nativeOutputRecoveryBlocked(stop: string, limits: NativeRunLimits | null, hasConfirmedMusic: boolean): boolean {
  if (!stop.includes("OPENAI_INCOMPLETE_RESPONSE")) return false;
  if (!limits) return true;
  if (stop.includes("reason=")) {
    if (!/reason=max_output_tokens;/.test(stop)) return true;
    const bound = /output_limit=(\d+);/.exec(stop);
    return !bound || limits.maxOutputTokens <= Number(bound[1]);
  }
  // Only the exact old diagnostic qualifies for the phase-cap repair. The old
  // reason is unknown; continuation is explicit and still effect/budget fenced.
  if (!stop.includes("increase the captured output allowance before continuing this confirmed draft")) return true;
  const legacyCeiling = hasConfirmedMusic ? (limits.profile === "extended" ? 12_288 : 8_192) : (limits.profile === "extended" ? 20_480 : 12_288);
  return limits.maxOutputTokens <= legacyCeiling;
}
