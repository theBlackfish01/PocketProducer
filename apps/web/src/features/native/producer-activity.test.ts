import { describe, expect, it } from "vitest"
import { mergeActivity } from "./use-producer-activity"
import { sessionFromPath } from "../../lib/session-route"

describe("workspace presentation boundaries", () => {
  it("deduplicates replay and bounds mounted history without rearranging late events", () => {
    const event = (cursor: number) => ({ cursor, jobId: null, createdAt: "2026-09-26", payload: { version: 1 as const, kind: "working", text: String(cursor) } })
    const merged = mergeActivity(Array.from({ length: 100 }, (_, i) => event(i + 1)), [event(100), event(99), event(101)])
    expect(merged).toHaveLength(80); expect(merged.at(-1)?.cursor).toBe(101)
    expect(new Set(merged.map((item) => item.cursor)).size).toBe(80)
  })
  it("supports direct routes without treating the OAuth callback as a session", () => {
    expect(sessionFromPath("/sessions/abc/start")).toEqual({ id: "abc", view: "start" })
    expect(sessionFromPath("/sessions/abc")).toEqual({ id: "abc", view: "arrange" })
    expect(sessionFromPath("/sessions/abc/audio")).toEqual({ id: "abc", view: "audio" })
    expect(sessionFromPath("/auth/audiotool/callback")).toBeNull()
  })
})
