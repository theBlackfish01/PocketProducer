// Typed native errors. Control flow classifies these by class and code, never by
// matching message text.
import { CodedError } from "../errors.js";
import type { NativeReview } from "./critique.js";

/** A focused review whose response was lost or refused. Its cost is settled or
 * held and the request is never re-sent; `attempt` records it as one review
 * attempt so a later review uses a fresh request within the review allowance. */
export class NativeReviewLostError extends CodedError {
  constructor(message: string, readonly attempt: NativeReview, cause?: unknown) {
    super("REVIEW_RESPONSE_LOST", `REVIEW_RESPONSE_LOST: ${message}`, null, {}, { cause });
    this.name = "NativeReviewLostError";
  }
}

/** A rejected proposal the producer can fix in a later turn. Never fatal and
 * never an external effect: nothing was written or charged. */
export class NativeCorrectableError extends Error {
  constructor(readonly code: NativeCorrectableCode, message: string, readonly next: string) { super(message); this.name = "NativeCorrectableError"; }
  toolText() { return `Error [${this.code}]: ${this.message} Next: ${this.next}`; }
}
export type NativeCorrectableCode = "SEED_PART_RESERVED" | "REMOTE_PRESET_NOT_INSPECTED" | "REMOTE_SAMPLE_NOT_INSPECTED" | "REMOTE_LIBRARY_UNAVAILABLE";

/** The empty starting sketch every new construction begins from. */
export const SEED_PART_ID = "starting-voice";

/** A document identifier that does not exist. The message keeps its historical wording. */
export class NativeUnknownIdError extends Error {
  constructor(readonly kind: "part" | "motif" | "section" | "group" | "target section", readonly id: string) { super(`Unknown ${kind} ${id}`); this.name = "NativeUnknownIdError"; }
}
