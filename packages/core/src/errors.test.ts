import { describe, expect, it } from "vitest";
import { boundedStopCodes, callOutcomeUnknown, CodedError, coded, errorCode, findCodedError, hasErrorCode, isRateLimited, isRecoverableInterruption, isTransientNetworkError, isUnsentRequestError, providerErrorStatus, stopIssue, uncertainOutcomeCodes } from "./errors.js";

describe("typed error classification", () => {
  it("keeps the historical coded wording while exposing code, qualifier and details", () => {
    const error = coded("MODEL_BUDGET_EXCEEDED:MODEL:gpt-6-sol:reservation=420", { pool: "MODEL", model: "gpt-6-sol", reservation: 420 });
    expect(error).toBeInstanceOf(CodedError);
    expect(error.message).toBe("MODEL_BUDGET_EXCEEDED:MODEL:gpt-6-sol:reservation=420");
    expect([error.code, error.qualifier, error.details.reservation]).toEqual(["MODEL_BUDGET_EXCEEDED", "MODEL", 420]);
    expect(() => coded("Something went wrong")).toThrow(/known code/);
  });

  it("finds the original typed error through many wrapper layers, as agent middleware nests it", () => {
    const original = coded("MODEL_BUDGET_EXCEEDED:MODEL:gpt-6-sol:reservation=9", { model: "gpt-6-sol", reservation: 9 });
    let wrapped: Error = original;
    for (let layer = 0; layer < 8; layer++) wrapped = Object.assign(new Error(original.message, { cause: wrapped }), { name: "MiddlewareError" });
    expect(findCodedError(wrapped)?.details).toEqual({ model: "gpt-6-sol", reservation: 9 });
    expect(isTransientNetworkError(new Error("outer", { cause: Object.assign(new Error("x"), { cause: Object.assign(new Error("y"), { cause: Object.assign(new Error("z"), { cause: Object.assign(new Error("w"), { code: "ECONNRESET" }) }) }) }) }))).toBe(true);
    expect(isRateLimited(new Error("outer", { cause: Object.assign(new Error("slow down"), { status: 429 }) }))).toBe(true);
    const cycle = new Error("a"); (cycle as { cause?: unknown }).cause = cycle;
    expect(findCodedError(cycle)).toBeNull();
  });

  it("reads codes from persisted messages, including ones wrapped in explanatory text", () => {
    expect(errorCode("Construction stopped before completion; no new version was selected. NATIVE_INCOMPLETE:REVIEW_EXHAUSTED: three reviews")).toEqual({ code: "NATIVE_INCOMPLETE", qualifier: "REVIEW_EXHAUSTED" });
    expect(errorCode("NATIVE_INCOMPLETE: the empty starting sketch part is still present")).toEqual({ code: "NATIVE_INCOMPLETE", qualifier: null });
    expect(errorCode("A timeout while the network was busy")).toBeNull();
    expect(hasErrorCode(new Error("OPENAI_INPUT_LIMIT_EXCEEDED:9000:8000"), boundedStopCodes)).toBe(true);
    expect(hasErrorCode(new Error("NATIVE_STEP_REPLAY_CONFLICT"), uncertainOutcomeCodes)).toBe(true);
    // Free text that merely mentions a failure is not a code.
    expect(hasErrorCode(new Error("The outcome is uncertain"), uncertainOutcomeCodes)).toBe(false);
  });

  it("judges transport failures by class and system code along the cause chain, not message words", () => {
    expect(isTransientNetworkError(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }))).toBe(true);
    expect(isTransientNetworkError(new Error("wrapped", { cause: Object.assign(new Error("x"), { code: "UND_ERR_SOCKET" }) }))).toBe(true);
    expect(isTransientNetworkError(Object.assign(new Error("Request timed out."), { name: "APIConnectionTimeoutError" }))).toBe(true);
    expect(isTransientNetworkError(new Error("network timeout while reading the score"))).toBe(false);
    expect(isRateLimited(Object.assign(new Error("slow down"), { status: 429 }))).toBe(true);
    expect(isRateLimited(new Error("rate of change"))).toBe(false);
  });

  it("costs a failed call as free only when it provably never left or the provider refused it", () => {
    const failure = (code: string) => Object.assign(new Error("Connection error."), { name: "APIConnectionError", cause: Object.assign(new Error(code), { code }) });
    for (const code of ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"]) {
      expect(isUnsentRequestError(failure(code))).toBe(true);
      expect(callOutcomeUnknown(failure(code))).toBe(false);
    }
    for (const code of ["ECONNRESET", "UND_ERR_SOCKET", "ETIMEDOUT"]) expect(callOutcomeUnknown(failure(code))).toBe(true);
    // Without a cause the SDK cannot say whether the request was sent.
    expect(callOutcomeUnknown(Object.assign(new Error("Connection error."), { name: "APIConnectionError" }))).toBe(true);
    // A provider error status means no billable response; anything after a response may be billed.
    expect(providerErrorStatus(new Error("wrapped", { cause: Object.assign(new Error("Internal error"), { status: 500 }) }))).toBe(500);
    expect(callOutcomeUnknown(Object.assign(new Error("Bad request"), { status: 400 }))).toBe(false);
    expect(callOutcomeUnknown(new TypeError("Cannot read properties of undefined"))).toBe(true);
    expect(callOutcomeUnknown(coded("OPENAI_EFFECT_DISPATCHED"))).toBe(true);
  });

  it("treats interruptions and lost, held responses as recoverable, but not in-flight or history conflicts", () => {
    expect(isRecoverableInterruption(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }))).toBe(true);
    expect(isRecoverableInterruption(Object.assign(new Error("slow down"), { status: 429 }))).toBe(true);
    expect(isRecoverableInterruption(coded("PROVIDER_USAGE_UNKNOWN: unmetered response"))).toBe(true);
    expect(isRecoverableInterruption(coded("OPENAI_EFFECT_UNCERTAIN"))).toBe(true);
    expect(isRecoverableInterruption(coded("OPENAI_EFFECT_DISPATCHED"))).toBe(false);
    expect(isRecoverableInterruption(coded("NATIVE_STEP_REPLAY_CONFLICT"))).toBe(false);
    expect(hasErrorCode(coded("PROVIDER_USAGE_UNKNOWN: unmetered"), uncertainOutcomeCodes)).toBe(false);
  });

  it("maps stopped jobs to browser-facing issue codes", () => {
    expect(stopIssue("NATIVE_PARTIAL", "Construction stopped before completion. MODEL_CALL_LIMIT_EXCEEDED")).toBe("CALL_LIMIT");
    expect(stopIssue("NATIVE_PARTIAL", "NATIVE_INCOMPLETE:REPEATED_NO_PROGRESS: twelve unchanged steps")).toBe("NO_PROGRESS");
    expect(stopIssue("NATIVE_PARTIAL", "NATIVE_INCOMPLETE:REVIEW_EXHAUSTED: three reviews")).toBe("REVIEW_EXHAUSTED");
    expect(stopIssue("NATIVE_PARTIAL", "NATIVE_INCOMPLETE: the empty starting sketch part is still present")).toBeNull();
    expect(stopIssue("NATIVE_PARTIAL", "MODEL_BUDGET_EXCEEDED:USER")).toBe("ALLOWANCE_USER");
    expect(stopIssue("NATIVE_PARTIAL", "MODEL_BUDGET_EXCEEDED:SITE")).toBe("ALLOWANCE_SHARED");
    expect(stopIssue("NATIVE_PARTIAL", "MODEL_BUDGET_EXCEEDED:MODEL:gpt-6-sol:reservation=1")).toBe("ALLOWANCE_SHARED");
    expect(stopIssue("NATIVE_PARTIAL", "MODEL_BUDGET_EXCEEDED:PROVIDER:openai")).toBe("ALLOWANCE_PROVIDER");
    expect(stopIssue("NATIVE_PARTIAL", "MODEL_BUDGET_EXCEEDED:JOB")).toBe("SPEND_ALLOWANCE");
    expect(stopIssue("NATIVE_PARTIAL", "OPENAI_INPUT_LIMIT_EXCEEDED:9000:8000")).toBe("INPUT_LIMIT");
    expect(stopIssue("NATIVE_PARTIAL", "OPENAI_INCOMPLETE_RESPONSE: reason=max_output_tokens")).toBe("INCOMPLETE_RESPONSE");
    expect(stopIssue("PROVIDER_OUTCOME_UNCERTAIN", "A model call has no confirmed outcome.")).toBe("OUTCOME_UNCERTAIN");
    expect(stopIssue("JOB_FAILED", "PROVIDER_USAGE_UNKNOWN: reconcile the observed response before continuing")).toBe("USAGE_UNKNOWN");
    expect(stopIssue("PROVIDER_UNAVAILABLE", "Connection error.")).toBe("PROVIDER_UNAVAILABLE");
    expect(stopIssue("NATIVE_PARTIAL", "NATIVE_INTERRUPTED: The connection to the model was interrupted. Connection error.")).toBe("PROVIDER_UNAVAILABLE");
    expect(stopIssue("JOB_FAILED", "Connection error.")).toBeNull();
    expect(stopIssue(null, null)).toBeNull();
  });
});
