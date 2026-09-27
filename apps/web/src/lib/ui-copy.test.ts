import { describe, expect, it } from "vitest"
import { arrangementSummary, friendlyIssue, jobProgress, readableDevice } from "./ui-copy"
import type { Job, NativeVersion } from "./api"

describe("Listening Room copy", () => {
  it("turns internal recovery and budget messages into useful next-step language", () => {
    expect(friendlyIssue("expected native head changed", "Fallback")).toMatch(/reopen it/i)
    expect(friendlyIssue("provider budget limit exceeded", "Fallback")).toMatch(/spending allowance.*draft is saved/i)
    expect(friendlyIssue("MODEL_CALL_LIMIT_EXCEEDED", "Fallback")).toMatch(/step limit/i)
    expect(friendlyIssue("REPEATED_NO_PROGRESS", "Fallback")).toMatch(/repeated steps/i)
    expect(friendlyIssue("uncertain remote outcome", "Fallback")).toMatch(/check what happened/i)
    expect(friendlyIssue("unknown reservation outcome", "Fallback")).toMatch(/check what happened/i)
    expect(friendlyIssue("opaque provider code 123", "Your saved work is safe.")).toBe("Your saved work is safe.")
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
