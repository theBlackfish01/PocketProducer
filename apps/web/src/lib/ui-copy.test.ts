import { describe, expect, it } from "vitest"
import { arrangementSummary, friendlyIssue, jobProgress, readableDevice } from "./ui-copy"
import type { Job, NativeVersion } from "./api"

describe("Listening Room copy", () => {
  it("chooses next-step language from stable issue codes, never from message text", () => {
    expect(friendlyIssue("HEAD_CHANGED", "Fallback")).toMatch(/reopen it/i)
    expect(friendlyIssue("SPEND_ALLOWANCE", "Fallback")).toMatch(/spending allowance.*draft is saved/i)
    expect(friendlyIssue("CALL_LIMIT", "Fallback")).toMatch(/step limit/i)
    expect(friendlyIssue("INCOMPLETE_RESPONSE", "Fallback", false)).toBe("The producer could not finish its response. Your approach is saved; no music has been created yet.")
    expect(friendlyIssue("NO_PROGRESS", "Fallback")).toMatch(/repeated steps/i)
    expect(friendlyIssue("REVIEW_EXHAUSTED", "Fallback")).toBe("The final musical review could not be completed. Your draft is saved.")
    expect(friendlyIssue("REVIEW_EXHAUSTED", "Fallback")).not.toMatch(/spend|budget/i)
    expect(friendlyIssue("OUTCOME_UNCERTAIN", "Fallback")).toMatch(/check what happened/i)
    expect(friendlyIssue("ALLOWANCE_USER", "Fallback")).toMatch(/your usage limit/i)
    expect(friendlyIssue("ALLOWANCE_SHARED", "Fallback")).toMatch(/shared demo allowance/i)
    expect(friendlyIssue("ACTIVE_REQUEST_LIMIT", "Fallback")).toMatch(/already running in one of your sessions/)
    expect(friendlyIssue("STUDIO_BUSY", "Fallback")).toMatch(/shared studio is busy/)
    expect(friendlyIssue("NETWORK", "Fallback")).toMatch(/connection was interrupted/i)
    // Message text, unknown codes and missing codes all use the caller's fallback.
    expect(friendlyIssue("MODEL_CALL_LIMIT_EXCEEDED: the producer hit its step limit", "Your saved work is safe.")).toBe("Your saved work is safe.")
    expect(friendlyIssue("INVALID_REQUEST", "Your saved work is safe.")).toBe("Your saved work is safe.")
    expect(friendlyIssue(null, "Your saved work is safe.")).toBe("Your saved work is safe.")
  })

  it("uses human progress and instrument labels", () => {
    expect(jobProgress({ state: "running", stage: "composing" } as Job)).toBe("Building the parts…")
    expect(readableDevice("beatbox8")).toBe("Drum machine")
  })

  it("describes a saved arrangement from confirmed facts rather than provider prose", () => {
    const version = {
      ordinal: 2,
      changeSummary: "Native SDK structure was applied",
      document: { bars: 48, sections: [{ id: "bloom" }], parts: [{ id: "lead", name: "Slow lead" }] },
      structuralDiff: { changedParts: ["lead"], addedParts: [], changedSections: ["bloom"], tempoChange: null, protectionChange: { added: [], removed: [] } }
    } as unknown as NativeVersion
    expect(arrangementSummary(version)).toBe("Changed Slow lead; reshaped 1 section.")
    expect(arrangementSummary(version)).not.toMatch(/native|SDK/i)
  })
})
