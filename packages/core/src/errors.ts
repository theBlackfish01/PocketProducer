// Error classification by type, code and structured fields — never by matching
// free text. Coded messages keep their historical "CODE[:QUALIFIER]: detail"
// wording because jobs persist them and operators read them.

export const errorCodes = [
  "NATIVE_INCOMPLETE", "NATIVE_HISTORY_INCONSISTENT", "NATIVE_STEP_REPLAY_CONFLICT", "NATIVE_STEP_PREDECESSOR_CONFLICT",
  "NATIVE_COMPLETION_CONFLICT", "NATIVE_SYNC_CHECKPOINT_CONFLICT", "NATIVE_REMOTE_CONFLICT",
  "MODEL_BUDGET_EXCEEDED", "MODEL_CALL_LIMIT_EXCEEDED", "MODEL_STEP_EFFECT_LIMIT_EXCEEDED", "MODEL_FORMAT_RECOVERY_EXHAUSTED",
  "OPENAI_INPUT_LIMIT_EXCEEDED", "OPENAI_INCOMPLETE_RESPONSE", "OPENAI_EFFECT_OUTCOME_UNCERTAIN",
  "OPENAI_EFFECT_DISPATCHED", "OPENAI_EFFECT_UNCERTAIN", "OPENAI_EFFECT_FAILED", "OPENAI_EFFECT_SUCCEEDED", "OPENAI_EFFECT_RESERVED",
  "PROVIDER_USAGE_UNKNOWN", "PROVIDER_USAGE_CONFLICT", "PROVIDER_REQUEST_ID_CONFLICT", "PROVIDER_EFFECT_INPUT_MISMATCH",
  "EFFECT_OUTCOME_UNCERTAIN", "NATIVE_INTERRUPTED", "REVIEW_RESPONSE_LOST"
] as const;
export type ErrorCode = typeof errorCodes[number];

/** Model/financial stops that leave a safely continuable draft. */
export const boundedStopCodes: readonly ErrorCode[] = ["NATIVE_INCOMPLETE", "MODEL_CALL_LIMIT_EXCEEDED", "MODEL_BUDGET_EXCEEDED", "OPENAI_INPUT_LIMIT_EXCEEDED", "OPENAI_INCOMPLETE_RESPONSE"];
/** Outcomes that must be reconciled before anything continues: a call that may
 * still be in flight, or durable history that no longer replays. */
export const uncertainOutcomeCodes: readonly ErrorCode[] = ["EFFECT_OUTCOME_UNCERTAIN", "OPENAI_EFFECT_OUTCOME_UNCERTAIN", "OPENAI_EFFECT_DISPATCHED", "NATIVE_STEP_REPLAY_CONFLICT", "NATIVE_STEP_PREDECESSOR_CONFLICT", "NATIVE_HISTORY_INCONSISTENT"];
/** A model response lost or left unmetered. Its worst-case reservation stays
 * held, so work can resume from confirmed state with a fresh request; the lost
 * request itself is never sent again. */
export const heldOutcomeCodes: readonly ErrorCode[] = ["PROVIDER_USAGE_UNKNOWN", "OPENAI_EFFECT_UNCERTAIN", "NATIVE_INTERRUPTED"];

export class CodedError extends Error {
  constructor(readonly code: ErrorCode, message: string, readonly qualifier: string | null = null, readonly details: Record<string, string | number> = {}, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CodedError";
  }
}

/** Build a coded error from its canonical "CODE[:QUALIFIER]..." message. */
export function coded(message: string, details: Record<string, string | number> = {}): CodedError {
  const parsed = parseCode(message);
  if (!parsed || parsed.at !== 0) throw new Error(`Coded errors must start with a known code: ${message.slice(0, 60)}`);
  return new CodedError(parsed.code, message, parsed.qualifier, details);
}

function parseCode(text: string): { code: ErrorCode; qualifier: string | null; at: number } | null {
  let best: { code: ErrorCode; at: number } | null = null;
  for (const code of errorCodes) {
    const at = text.indexOf(code);
    if (at >= 0 && (!best || at < best.at || (at === best.at && code.length > best.code.length))) best = { code, at };
  }
  if (!best) return null;
  const rest = text.slice(best.at + best.code.length);
  if (!rest.startsWith(":")) return { ...best, qualifier: null };
  let end = 1;
  while (end < rest.length && rest[end] !== ":" && rest[end] !== " ") end++;
  return { ...best, qualifier: rest.slice(1, end) || null };
}

/** An error and the errors it wraps. Agent middleware wraps a thrown error once
 * per layer, so the original can sit many causes deep. */
function* causeChain(input: unknown): Generator<Error> {
  const seen = new Set<unknown>();
  for (let current = input; current instanceof Error && !seen.has(current) && seen.size < 16; current = current.cause) {
    seen.add(current);
    yield current;
  }
}

/** The CodedError itself, or the one a wrapper carries along its cause chain. */
export function findCodedError(input: unknown): CodedError | null {
  for (const error of causeChain(input)) if (error instanceof CodedError) return error;
  return null;
}

/** The code of a typed error, or of a persisted/legacy coded message. */
export function errorCode(input: unknown): { code: ErrorCode; qualifier: string | null } | null {
  const typed = findCodedError(input);
  if (typed) return { code: typed.code, qualifier: typed.qualifier };
  const text = typeof input === "string" ? input : input instanceof Error ? input.message : null;
  const parsed = text ? parseCode(text) : null;
  return parsed ? { code: parsed.code, qualifier: parsed.qualifier } : null;
}

export function hasErrorCode(input: unknown, codes: readonly ErrorCode[]): boolean {
  const found = errorCode(input);
  return Boolean(found && codes.includes(found.code));
}

const networkNames = new Set(["APIConnectionError", "APIConnectionTimeoutError", "APIUserAbortError", "AbortError", "TimeoutError", "FetchError", "ConnectTimeoutError", "SocketError", "HeadersTimeoutError", "BodyTimeoutError"]);
const networkCodes = new Set(["ECONNRESET", "ECONNREFUSED", "ECONNABORTED", "ETIMEDOUT", "ENOTFOUND", "EPIPE", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "ENETDOWN", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_CLOSED"]);

/** Transport failures, judged from error class names and system codes along the cause chain. */
export function isTransientNetworkError(error: unknown): boolean {
  for (const current of causeChain(error)) {
    if (networkNames.has(current.name)) return true;
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && networkCodes.has(code)) return true;
  }
  return false;
}

// Failures before a connection existed: the request cannot have reached the provider.
const unsentCodes = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "ENETDOWN", "UND_ERR_CONNECT_TIMEOUT"]);

/** A transport failure from before any connection was established, so nothing
 * was sent or billed. Every other transport failure may have been received. */
export function isUnsentRequestError(error: unknown): boolean {
  for (const current of causeChain(error)) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && unsentCodes.has(code)) return true;
  }
  return false;
}

/** The HTTP error status a provider answered with, if any. */
export function providerErrorStatus(error: unknown): number | null {
  for (const current of causeChain(error)) {
    const status = (current as { status?: unknown }).status;
    if (typeof status === "number" && status >= 400 && status < 600) return status;
  }
  return null;
}

/** Whether a dispatched provider call that then failed may have been processed
 * and billed. Only two failures prove it was not: a request that never left, and
 * one the provider answered with an error status. Anything else (a dropped
 * connection, a timeout, an error after the response arrived) holds the call's
 * worst-case reservation instead of recording it as free. */
export function callOutcomeUnknown(error: unknown): boolean {
  if (hasErrorCode(error, uncertainOutcomeCodes)) return true;
  return !isUnsentRequestError(error) && providerErrorStatus(error) === null;
}

export function isRateLimited(error: unknown): boolean {
  for (const current of causeChain(error)) if ((current as { status?: unknown }).status === 429 || current.name === "RateLimitError") return true;
  return false;
}

/** An interruption that confirmed work survives: a transport failure, a rate
 * limit, or a lost/unmetered response whose cost is held. Recovery resumes from
 * confirmed state rather than stopping the request for manual reconciliation. */
export function isRecoverableInterruption(error: unknown): boolean {
  return isTransientNetworkError(error) || isRateLimited(error) || hasErrorCode(error, heldOutcomeCodes);
}

/** Stable codes the browser maps to its own copy. Messages stay as server-side detail. */
export const issueCodes = [
  "ACTIVE_REQUEST_LIMIT", "STUDIO_BUSY", "HEAD_CHANGED", "OUTCOME_UNCERTAIN", "USAGE_UNKNOWN", "CALL_LIMIT", "NO_PROGRESS",
  "INPUT_LIMIT", "REVIEW_EXHAUSTED", "INCOMPLETE_RESPONSE", "ALLOWANCE_USER", "ALLOWANCE_SHARED", "ALLOWANCE_PROVIDER",
  "SPEND_ALLOWANCE", "PROVIDER_UNAVAILABLE", "NOT_RESUMABLE", "INTERPRETATION_UNAVAILABLE", "INTERPRETATION_STALE", "INTERPRETATION_PENDING"
] as const;
export type IssueCode = typeof issueCodes[number];

/** A request-level failure with a stable code the browser can map to its own copy. */
export function issue(code: IssueCode, message: string, statusCode: number): Error & { code: IssueCode; statusCode: number } {
  return Object.assign(new Error(message), { code, statusCode });
}

/** The issue for a usage pool that cannot reserve another call. */
export function allowanceIssue(block: "USER" | "SITE" | "PROVIDER" | "MODEL"): IssueCode {
  return block === "USER" ? "ALLOWANCE_USER" : block === "PROVIDER" ? "ALLOWANCE_PROVIDER" : "ALLOWANCE_SHARED";
}

/** The browser-facing issue for a stopped job: its stored job code first, then
 * the code its persisted message carries. */
export function stopIssue(jobCode: string | null, message: string | null): IssueCode | null {
  if (jobCode === "PROVIDER_OUTCOME_UNCERTAIN") return "OUTCOME_UNCERTAIN";
  if (jobCode === "PROVIDER_UNAVAILABLE") return "PROVIDER_UNAVAILABLE";
  const found = errorCode(message ?? "");
  if (!found) return null;
  switch (found.code) {
    case "MODEL_CALL_LIMIT_EXCEEDED": return "CALL_LIMIT";
    case "OPENAI_INPUT_LIMIT_EXCEEDED": return "INPUT_LIMIT";
    case "OPENAI_INCOMPLETE_RESPONSE": return "INCOMPLETE_RESPONSE";
    case "PROVIDER_USAGE_UNKNOWN": return "USAGE_UNKNOWN";
    case "NATIVE_INTERRUPTED": return "PROVIDER_UNAVAILABLE";
    case "NATIVE_INCOMPLETE": return found.qualifier === "REPEATED_NO_PROGRESS" ? "NO_PROGRESS" : found.qualifier === "REVIEW_EXHAUSTED" ? "REVIEW_EXHAUSTED" : null;
    case "MODEL_BUDGET_EXCEEDED": return found.qualifier === "USER" || found.qualifier === "SITE" || found.qualifier === "PROVIDER" || found.qualifier === "MODEL" ? allowanceIssue(found.qualifier) : "SPEND_ALLOWANCE";
    default: return uncertainOutcomeCodes.includes(found.code) ? "OUTCOME_UNCERTAIN" : null;
  }
}
