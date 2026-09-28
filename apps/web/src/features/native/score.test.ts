import { describe, expect, it } from "vitest"
import type { NativeDocument, NativePart } from "../../lib/api"
import { automationAt, compareScoreSection, materializedSectionNotes, projectScoreOverview } from "./score"
import { advanceConfirmedFrame, barLabel, occupiedBars, confirmedChanges, controlPath, noteGeometry, scoreWindow } from "./score-presentation"

it("labels occupied bar spans without including an exclusive endpoint", () => {
  expect(occupiedBars(15360, 38400, 3840)).toBe("5–10")
  expect(occupiedBars(15360, 38401, 3840)).toBe("5–11")
  expect(occupiedBars(480, 960, 3840)).toBe("1–1")
  expect(occupiedBars(0, 5760, 2880)).toBe("1–2")
  expect(barLabel(38400, 3840)).toBe("11")
})

const instrument = (id: string, role = "melody"): NativePart => ({ id, name: id, role, device: { type: "heisenberg", parameters: {} }, gain: 0.7, pan: 0, notes: [], placements: [], sourceRegions: [], effects: [], automation: [] })

it("compares connected sidechain content within the selected section", () => {
  const before = fixture()
  before.parts.push({ ...instrument("bass", "bass"), groupId: "duck" })
  before.groups = [{ id: "duck", name: "Ducked bass", gain: 1, pan: 0, sidechainFromPartId: "lead", compressor: { thresholdDb: -12, ratio: 4, attackMs: 5, releaseMs: 200, makeupGainDb: 0, isActive: true } }]
  const after = structuredClone(before); after.parts[0].notes[0].startTick = 960
  expect(compareScoreSection(before, after, "opening").parts.find((part) => part.partId === "bass")).toMatchObject({ status: "changed", dependenciesChanged: true })
  expect(compareScoreSection(before, after, "return").parts.find((part) => part.partId === "bass")).toMatchObject({ status: "preserved" })
  after.parts[0].automation = [{ id: "curve", target: "unrecognized", points: [{ tick: 0, value: 0 }, { tick: 1000, value: 1 }] }]
  expect(compareScoreSection(before, after, "opening").parts.find((part) => part.partId === "bass")?.status).toBe("unverified")
  expect(compareScoreSection(before, after, "opening").verifiedUnchangedParts).not.toContain("bass")
})
const fixture = (): NativeDocument => ({ schemaVersion: 2, ppq: 960, title: "Independent score", direction: "A returning theme", currentObjective: "Inspect", assumptions: [], tempoBpm: 120, meter: { numerator: 4, denominator: 4 }, bars: 8,
  sections: [{ id: "opening", name: "Opening", startBar: 0, endBar: 4, intent: "" }, { id: "return", name: "Return", startBar: 4, endBar: 8, intent: "" }],
  parts: [{ ...instrument("lead"), notes: [{ id: "free", startTick: 0, durationTicks: 480, pitch: 72, velocity: 0.8 }], placements: [{ id: "theme-first", motifId: "theme", startTick: 3840, repeats: 2, transpose: 2 }, { id: "theme-return", motifId: "theme", startTick: 15360, repeats: 1, transpose: 0 }] },
    { ...instrument("wash", "source"), device: { type: "audio", parameters: {} }, sourceRegions: [{ id: "loop", assetId: "00000000-0000-4000-8000-000000000001", assetHash: "a".repeat(64), rights: "Owned", startTick: 11520, durationTicks: 7680, sourceStartSeconds: 0, sourceDurationSeconds: 2, playbackMode: "loop", gain: 0.6 }] }],
  motifs: [{ id: "theme", partId: "lead", name: "Theme", lengthTicks: 1920, notes: [{ id: "one", startTick: 0, durationTicks: 480, pitch: 60, velocity: 0.7 }, { id: "two", startTick: 960, durationTicks: 480, pitch: 64, velocity: 0.6 }] }], protectedPartIds: [], protectedMotifIds: [], sourceAssetIds: ["00000000-0000-4000-8000-000000000001"], audio: { state: "deferred", revisionId: null, assetHash: null } })

describe("score presentation never substitutes counts for musical changes", () => {
  it("detects same-density pitch, timing, duration, phrase, clip and control edits", () => {
    const before = fixture()
    for (const field of ["pitch", "startTick", "durationTicks"] as const) {
      const after = structuredClone(before); after.parts[0].notes[0][field] += 1
      expect(projectScoreOverview(before).lanes[0].density).toEqual(projectScoreOverview(after).lanes[0].density)
      expect(confirmedChanges(before, after).parts[0]).toMatchObject({ id: "lead", kinds: ["notes / phrases"] })
    }
    const after = structuredClone(before)
    after.motifs[0].notes[0].pitch += 12
    after.parts[1].sourceRegions[0].sourceStartSeconds += 0.5
    after.parts[1].automation.push({ id: "fade", target: "gain", points: [{ tick: 0, value: 0.2 }, { tick: 7680, value: 0.8 }] })
    expect(confirmedChanges(before, after).parts).toEqual([{ id: "lead", name: "lead", kinds: ["notes / phrases"] }, { id: "wash", name: "wash", kinds: ["clips", "sound / controls"] }])
  })
  it("keeps coordinates identical across before/after and shows real pitch and duration movement", () => {
    const before = fixture(), after = structuredClone(before)
    after.parts[0].notes[0].pitch = 84; after.parts[0].notes[0].startTick = 960; after.parts[0].notes[0].durationTicks = 1920
    const a = scoreWindow(before, after, "lead", 0, 15360), b = scoreWindow(after, before, "lead", 0, 15360)
    expect([a.low, a.high]).toEqual([b.low, b.high])
    const old = noteGeometry(a.current.notes[0], 0, 15360, a.low, a.high), next = noteGeometry(b.current.notes[0], 0, 15360, b.low, b.high)
    expect(next.x).toBeGreaterThan(old.x); expect(next.y).toBeLessThan(old.y); expect(next.width).toBe(old.width * 4)
  })
  it("retains confirmed snapshots for duplicate/late receipts but resets on job changes and reload", () => {
    const document = fixture(), nextDocument = structuredClone(document); nextDocument.parts[0].notes[0].pitch++
    const first = { identity: "one", scope: "job-a", steps: 2, document }
    const next = advanceConfirmedFrame(first, { ...first, identity: "two", steps: 5, document: nextDocument })
    expect(next.before).toBe(document)
    expect(advanceConfirmedFrame(next, { ...next })).toBe(next)
    expect(advanceConfirmedFrame(next, first)).toBe(next)
    expect(advanceConfirmedFrame(next, { ...first, scope: "job-b" }).before).toBeUndefined()
    expect(advanceConfirmedFrame(first, first).before).toBeUndefined()
  })
  it("does not draw invented linear ramps for stepped or unsupported curves", () => {
    const points = [{ tick: 0, value: 0.2, interpolation: "step" as const }, { tick: 3840, value: 0.8 }]
    expect(controlPath({ id: "level", target: "gain", points }, 7680).path).toContain("H50 V5")
    expect(controlPath({ id: "level", target: "gain", points: [{ ...points[0], interpolation: "sloped" }, points[1]] }, 7680).path).not.toContain("L")
  })
  it("reports removed parts and form changes without fabricating a sequence", () => {
    const before = fixture(), after = structuredClone(before); after.parts.pop(); after.tempoBpm++
    expect(confirmedChanges(before, after)).toMatchObject({ formChanged: true, parts: [{ id: "wash", kinds: ["removed part"] }] })
  })
  it("highlights shared controls only for connected parts, including parent groups", () => {
    const before = fixture()
    before.groups = [{ id: "bus", name: "Shared space", gain: 0.7, pan: 0 }, { id: "child", name: "Lead bus", gain: 1, pan: 0, parentId: "bus" }]
    before.parts[0].groupId = "child"
    const after = structuredClone(before); after.groups![0].gain = 0.4
    expect(confirmedChanges(before, after).parts.map((part) => part.id)).toEqual(["lead"])
    expect(compareScoreSection(before, after, "opening").parts[0]).toMatchObject({ status: "changed", dependenciesChanged: true })
    expect(compareScoreSection(before, after, "opening").parts[1]?.status).toBe("preserved")
    after.groups![0].gain = 0.7
    after.groups![0].automation = [{ id: "parent-fade", target: "gain", points: [{ tick: 0, value: .2, interpolation: "step" }, { tick: 15360, value: .7 }] }]
    expect(compareScoreSection(before, after, "opening").parts[0]).toMatchObject({ status: "changed", controlsChanged: true })
    expect(compareScoreSection(before, after, "return").parts[0]?.status).toBe("preserved")
  })
})

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
    document.parts[0].notes[511].pitch = 95
    expect(materializedSectionNotes(document, "part-0", 0, 128 * 3840, 120).pitchRange).toEqual([36, 95])
  })
})
