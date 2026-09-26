import { describe, expect, it } from "vitest"
import type { NativeDocument, NativePart } from "../../lib/api"
import { automationAt, compareScoreSection, materializedSectionNotes, projectScoreOverview } from "./score"

const instrument = (id: string, role = "melody"): NativePart => ({ id, name: id, role, device: { type: "heisenberg", parameters: {} }, gain: 0.7, pan: 0, notes: [], placements: [], sourceRegions: [], effects: [], automation: [] })
const fixture = (): NativeDocument => ({ schemaVersion: 2, ppq: 960, title: "Independent score", direction: "A returning theme", currentObjective: "Inspect", assumptions: [], tempoBpm: 120, meter: { numerator: 4, denominator: 4 }, bars: 8,
  sections: [{ id: "opening", name: "Opening", startBar: 0, endBar: 4, intent: "" }, { id: "return", name: "Return", startBar: 4, endBar: 8, intent: "" }],
  parts: [{ ...instrument("lead"), notes: [{ id: "free", startTick: 0, durationTicks: 480, pitch: 72, velocity: 0.8 }], placements: [{ id: "theme-first", motifId: "theme", startTick: 3840, repeats: 2, transpose: 2 }, { id: "theme-return", motifId: "theme", startTick: 15360, repeats: 1, transpose: 0 }] },
    { ...instrument("wash", "source"), device: { type: "audio", parameters: {} }, sourceRegions: [{ id: "loop", assetId: "00000000-0000-4000-8000-000000000001", assetHash: "a".repeat(64), rights: "Owned", startTick: 11520, durationTicks: 7680, sourceStartSeconds: 0, sourceDurationSeconds: 2, playbackMode: "loop", gain: 0.6 }] }],
  motifs: [{ id: "theme", partId: "lead", name: "Theme", lengthTicks: 1920, notes: [{ id: "one", startTick: 0, durationTicks: 480, pitch: 60, velocity: 0.7 }, { id: "two", startTick: 960, durationTicks: 480, pitch: 64, velocity: 0.6 }] }], protectedPartIds: [], protectedMotifIds: [], sourceAssetIds: ["00000000-0000-4000-8000-000000000001"], audio: { state: "deferred", revisionId: null, assetHash: null } })

describe("canonical score projection", () => {
  it("places free and repeated transposed motif notes at actual ticks and pitches", () => {
    const document = fixture()
    const notes = materializedSectionNotes(document, "lead", 0, 15360).notes
    expect(notes.map((note) => [note.startTick, note.pitch, note.origin])).toEqual([[0, 72, "free"], [3840, 62, "motif"], [4800, 66, "motif"], [5760, 62, "motif"], [6720, 66, "motif"]])
    const overview = projectScoreOverview(document)
    expect(overview.lanes[0]?.density).toEqual([1, 4, 0, 0, 2, 0, 0, 0])
    expect(overview.lanes[0]?.blocks.map((block) => [block.startTick, block.endTick, block.familyId])).toEqual([[3840, 7680, "theme"], [15360, 17280, "theme"]])
  })
  it("keeps an old unlinked phrase readable and records a known variation as related", () => {
    const document = fixture()
    document.motifs.push({ id: "variation", partId: "lead", name: "Changed ending", lengthTicks: 1920, familyId: "theme", derivedFromMotifId: "theme", notes: [{ id: "one", startTick: 0, durationTicks: 480, pitch: 60, velocity: 0.7 }, { id: "two", startTick: 960, durationTicks: 480, pitch: 67, velocity: 0.6 }] })
    document.parts[0].placements[1].motifId = "variation"
    const overview = projectScoreOverview(document)
    expect(overview.lanes[0]?.blocks[0]?.derivedFromMotifId).toBeUndefined()
    expect(overview.lanes[0]?.blocks[1]).toMatchObject({ familyId: "theme", derivedFromMotifId: "theme" })
    expect(materializedSectionNotes(document, "lead", 15360, 19200).notes.map((note) => note.pitch)).toEqual([60, 67])
  })
  it("compares a same-ID pitch edit and a split/reidentified loop without claiming a clip change", () => {
    const before = fixture(), after = structuredClone(before)
    after.parts[0].notes[0].pitch = 73
    const loop = after.parts[1].sourceRegions[0]
    after.parts[1].sourceRegions = [{ ...loop, id: "left", durationTicks: 3840 }, { ...loop, id: "right", startTick: 15360, durationTicks: 3840, sourceStartSeconds: 0, sourceDurationSeconds: 2, playbackMode: "once" }]
    const opening = compareScoreSection(before, after, "opening")
    expect(opening.parts.find((part) => part.partId === "lead")?.modifiedNotes).toHaveLength(1)
    const later = compareScoreSection(before, after, "return")
    expect(later.parts.find((part) => part.partId === "wash")?.clipStatus).toBe("preserved")
  })
  it("does not confuse metadata with music, but discloses changing controls and shared processing", () => {
    const before = fixture(), after = structuredClone(before)
    after.parts[0].name = "New name"
    expect(compareScoreSection(before, after, "opening").parts[0]).toMatchObject({ status: "preserved", metadataChanged: true })
    after.parts[0].automation.push({ id: "level", target: "gain", points: [{ tick: 0, value: 0.6, interpolation: "step" }, { tick: 15360, value: 0.7 }] })
    expect(compareScoreSection(before, after, "opening").parts[0]).toMatchObject({ status: "changed", controlsChanged: true })
    after.parts[0].automation = []
    after.master = { gain: 0.9, pan: 0, limiterEnabled: true }
    expect(compareScoreSection(before, after, "opening").parts[0]).toMatchObject({ status: "changed", dependenciesChanged: true })
  })
  it("checks automation within the selected section rather than calling an earlier section changed", () => {
    const before = fixture(), after = structuredClone(before)
    after.parts[0].effects.push({ id: "echo", type: "stompboxDelay", parameters: { feedbackFactor: 0.2 } })
    before.parts[0].effects.push({ id: "echo", type: "stompboxDelay", parameters: { feedbackFactor: 0.2 } })
    after.parts[0].automation.push({ id: "return-echo", target: "effect.echo.feedbackFactor", points: [
      { tick: 0, value: 0.2, interpolation: "step" }, { tick: 15360, value: 0.6, interpolation: "step" }, { tick: 30720, value: 0.2, interpolation: "step" },
    ] })
    expect(compareScoreSection(before, after, "opening").parts[0]).toMatchObject({ status: "preserved", controlsChanged: false })
    expect(compareScoreSection(before, after, "return").parts[0]).toMatchObject({ status: "changed", controlsChanged: true })
    after.parts[0].automation[0].points[1].interpolation = "sloped"
    expect(compareScoreSection(before, after, "return").parts[0]).toMatchObject({ status: "unverified" })
  })
  it("keeps an earlier section unchanged when shared-group automation changes later", () => {
    const before = fixture(), after = structuredClone(before)
    before.parts[0].groupId = "music-bus"
    after.parts[0].groupId = "music-bus"
    before.groups = [{ id: "music-bus", name: "Music", gain: 0.8, pan: 0 }]
    after.groups = [{ ...before.groups[0], automation: [{ id: "return-level", target: "gain", points: [{ tick: 0, value: 0.8 }, { tick: 15360, value: 0.5 }, { tick: 30720, value: 0.8 }] }] }]
    expect(compareScoreSection(before, after, "opening").parts[0]).toMatchObject({ status: "preserved", controlsChanged: false, dependenciesChanged: false })
    expect(compareScoreSection(before, after, "return").parts[0]).toMatchObject({ status: "changed", controlsChanged: true })
  })
  it("marks changed timing and unsupported loop phase unverified", () => {
    const before = fixture(), after = structuredClone(before)
    after.tempoBpm = 121
    expect(compareScoreSection(before, after, "return").status).toBe("unverified")
    after.tempoBpm = 120
    after.parts[1].sourceRegions[0].sourceDurationSeconds = 1.234
    expect(compareScoreSection(after, before, "return").parts.find((part) => part.partId === "wash")?.clipStatus).toBe("unverified")
  })
  it("describes interpolation without inventing a physical unit", () => {
    expect(automationAt({ id: "one", target: "feedbackFactor", points: [{ tick: 0, value: 0.8, interpolation: "linear" }, { tick: 100, value: 0.4 }] }, 50)).toBeCloseTo(0.6)
    expect(automationAt({ id: "one", target: "feedbackFactor", points: [{ tick: 0, value: 0.8, interpolation: "step" }, { tick: 100, value: 0.4 }] }, 50)).toBe(0.8)
    expect(automationAt({ id: "one", target: "feedbackFactor", points: [{ tick: 0, value: 0.8, interpolation: "sloped", slope: 0.2 }, { tick: 100, value: 0.4 }] }, 50)).toBeNull()
  })
  it("projects a representative 128-bar, 24-part score without expanding SVG note nodes", () => {
    const document = fixture(); document.bars = 128; document.sections = [{ id: "whole", name: "Whole", startBar: 0, endBar: 128, intent: "" }]
    document.parts = Array.from({ length: 24 }, (_, index) => ({ ...instrument(`part-${index}`, index % 2 ? "harmony" : "percussion"), notes: Array.from({ length: 512 }, (_, note) => ({ id: `note-${note}`, startTick: note * 960, durationTicks: 480, pitch: 36 + index, velocity: 0.6 })) }))
    document.motifs = []
    const overview = projectScoreOverview(document)
    expect(overview.lanes).toHaveLength(24)
    expect(overview.noteOnsets).toBe(24 * 512)
    expect(overview.lanes[0]?.density).toHaveLength(128)
    expect(materializedSectionNotes(document, "part-0", 0, 128 * 3840, 120)).toMatchObject({ total: 512, truncated: true })
  })
})
