import { afterEach, describe, expect, it, vi } from "vitest"
import type { Activity, NativeDocument, NativePart, NativeVersion } from "../../lib/api"
import { activityTargets, namedParts } from "./activity-targets"
import { activeStep, ghostSections } from "./construction-progress"
import { laneContour, projectScoreOverview } from "./score"
import { composePins, pinBars, pinState, readPins, writePins, type ScorePin } from "./score-pins"

const part = (id: string, name: string, role = "melody", extra: Partial<NativePart> = {}): NativePart => ({ id, name, role, device: { type: "heisenberg", parameters: {} }, gain: .7, pan: 0, notes: [], placements: [], sourceRegions: [], effects: [], automation: [], ...extra })
const fixture = (): NativeDocument => ({ schemaVersion: 2, ppq: 960, title: "Wayfinding", direction: "x", currentObjective: "x", assumptions: [], tempoBpm: 96, meter: { numerator: 4, denominator: 4 }, bars: 16,
  sections: [{ id: "opening", name: "Opening", startBar: 0, endBar: 4, intent: "" }, { id: "bloom", name: "Bloom", startBar: 4, endBar: 8, intent: "" }, { id: "ascent", name: "Ascent", startBar: 8, endBar: 16, intent: "" }],
  parts: [part("bass", "Bass", "bass", { notes: [{ id: "b", startTick: 0, durationTicks: 3840, pitch: 36, velocity: .7 }] }), part("bass-2", "Bass II", "bass"), part("lead", "Slow lead", "melody", { notes: [{ id: "l", startTick: 3840 * 5, durationTicks: 960, pitch: 72, velocity: .7 }] })],
  motifs: [], protectedPartIds: [], protectedMotifIds: [], sourceAssetIds: [], audio: { state: "deferred", revisionId: null, assetHash: null } })
const event = (payload: Partial<Activity["payload"]>, jobId = "job"): Activity => ({ cursor: 1, jobId, createdAt: "2026-10-08T00:00:00Z", payload: { version: 1, kind: "music", text: "", ...payload } })
const pin = (id: string, partId: string, startBar: number, endBar: number, note = "too busy"): ScorePin => ({ id, partId, partName: partId, startBar, endBar, note, revisionId: "v1", ordinal: 1, createdAt: "" })

describe("feed pointers", () => {
  it("prefers stored identities and falls back to whole part names, longest first", () => {
    const document = fixture()
    expect(activityTargets(event({ text: "Updated something.", partIds: ["lead", "gone"], sectionIds: ["bloom"] }), document, [], null)).toEqual({ partIds: ["lead"], sectionIds: ["bloom"] })
    expect(namedParts("Updated Bass II and Slow lead.", document)).toEqual(["bass-2", "lead"])
    expect(namedParts("Updated Bassoon.", document)).toEqual([])
    expect(activityTargets(event({ kind: "request", text: "Calmer", sectionId: "ascent", partId: "bass" }), document, [], null)).toEqual({ partIds: ["bass"], sectionIds: ["ascent"] })
    expect(activityTargets(event({ kind: "approach", text: "Bass and Slow lead" }), document, [], null)).toBeNull()
  })

  it("points a saved message only at the current version's own changes", () => {
    const document = fixture()
    const version = { id: "v2", structuralDiff: { addedParts: ["lead"], changedParts: ["bass"], addedSections: [], changedSections: ["opening"] } } as unknown as NativeVersion
    expect(activityTargets(event({ kind: "saved", text: "Saved Version 2", revisionId: "v2" }), document, [version], "v2")).toEqual({ partIds: ["lead", "bass"], sectionIds: ["opening"] })
    expect(activityTargets(event({ kind: "saved", text: "Saved Version 2", revisionId: "v2" }), document, [version], "v3")).toBeNull()
  })
})

describe("construction progress", () => {
  it("maps recorded stages to steps", () => {
    expect([undefined, "planned", "building", "refining", "reviewed"].map((stage) => activeStep(stage as never))).toEqual([0, 1, 1, 2, 3])
  })

  it("keeps plan sections outlined until the confirmed draft stores notes there", () => {
    const sections = ghostSections([{ name: "Opening", purpose: "State it" }, { name: "bloom!", purpose: "Grow" }, { name: "Ascent", purpose: "Lift" }, { name: "Coda", purpose: "Rest" }], fixture())
    expect(sections.map((section) => [section.name, section.state, section.weight])).toEqual([["Opening", "has-music", 4], ["bloom!", "has-music", 4], ["Ascent", "shaped", 8], ["Coda", "planned", 16 / 3]])
    expect(ghostSections([{ name: "Opening", purpose: "State it" }], null)[0]).toMatchObject({ state: "planned" })
  })
})

describe("note contours", () => {
  it("merges overlapping spans per pitch row and refuses overly dense lanes", () => {
    const contour = laneContour([[0, 960, 60], [480, 1920, 60], [3840, 4800, 72]], 3840 * 4)!
    expect(contour).toMatchObject({ low: 60, high: 72, segments: 2 })
    expect(contour.path).toBe("M0 43H125M250 21H312.5")
    expect(laneContour(Array.from({ length: 4000 }, (_, index) => [index * 100, index * 100 + 10, 40 + index % 48]), 400_000)).toBeNull()
    expect(projectScoreOverview(fixture()).lanes.map((lane) => Boolean(lane.contour))).toEqual([true, false, true])
  })
})

describe("pinned notes", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("composes section-scoped, editable direction text and a suggested scope", () => {
    const document = fixture()
    expect(composePins([pin("a", "bass", 9, 11), pin("b", "bass", 12, 13, "Leave space!")], document, [])).toEqual({ text: "In Ascent, Bass (bars 10–11): too busy.\nIn Ascent, Bass (bar 13): Leave space!", used: ["a", "b"], sectionId: "ascent", partId: "bass" })
    expect(composePins([pin("a", "bass", 1, 2), pin("b", "lead", 5, 6)], document, [])).toMatchObject({ text: "In bar 2, Bass: too busy.\nIn bar 6, Slow lead: too busy.", sectionId: null, partId: null })
  })

  it("skips kept or missing parts instead of asking to change them", () => {
    const document = fixture()
    expect(pinState(pin("a", "bass", 0, 1), document, ["bass"])).toBe("kept")
    expect(pinState(pin("a", "gone", 0, 1), document, [])).toBe("missing")
    expect(pinState(pin("a", "lead", 15, 17), document, [])).toBe("missing")
    expect(composePins([pin("a", "bass", 0, 1), pin("b", "lead", 5, 6)], document, ["bass"])).toMatchObject({ used: ["b"], sectionId: "bloom", partId: "lead" })
    expect(pinBars({ startBar: 3, endBar: 4 })).toBe("bar 4")
  })

  it("stores only well-formed local pins and tolerates unavailable storage", () => {
    const store = new Map<string, string>()
    vi.stubGlobal("localStorage", { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value), removeItem: (key: string) => store.delete(key) })
    writePins("room", [pin("a", "bass", 0, 2)])
    store.set("pocket-producer:score-pins:other", JSON.stringify([pin("a", "bass", 2, 1), { id: "x" }, pin("ok", "lead", 0, 1)]))
    expect(readPins("room").map((value) => value.id)).toEqual(["a"])
    expect(readPins("other").map((value) => value.id)).toEqual(["ok"])
    writePins("room", [])
    expect(store.has("pocket-producer:score-pins:room")).toBe(false)
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked") }, setItem: () => { throw new Error("blocked") }, removeItem: () => undefined })
    expect(readPins("room")).toEqual([])
    expect(() => writePins("room", [pin("a", "bass", 0, 1)])).not.toThrow()
  })
})
