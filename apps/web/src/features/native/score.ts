import type { NativeAutomation, NativeClip, NativeDocument, NativeNote, NativePart } from "../../lib/api"

export const ticksPerBar = (document: NativeDocument) => document.ppq * document.meter.numerator * 4 / document.meter.denominator
const overlaps = (start: number, end: number, from: number, to: number) => start < to && end > from
const stable = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)

export interface ScoreNote extends NativeNote { key: string; partId: string; origin: "free" | "motif"; motifId?: string; familyId?: string; placementId?: string; repeat?: number }
export interface ScoreBlock { key: string; partId: string; startTick: number; endTick: number; label: string; kind: "motif" | "owned-clip" | "library-clip"; familyId?: string; derivedFromMotifId?: string; sourceStartSeconds?: number; sourceDurationSeconds?: number; playbackMode?: string; playbackRate?: number; stretchMode?: string; pitchShiftSemitones?: number; gain?: number }
export interface ScoreLane { partId: string; name: string; role: string; density: number[]; blocks: ScoreBlock[]; totalNoteOnsets: number; totalClips: number }
export interface ScoreOverview { lanes: ScoreLane[]; noteOnsets: number; bars: number; truncated: boolean }

export function motifFamily(document: NativeDocument, motifId: string): string | null {
  const motif = document.motifs.find((item) => item.id === motifId)
  return motif ? motif.familyId ?? (motif.derivedFromMotifId ? null : motif.id) : null
}

export function projectScoreOverview(document: NativeDocument): ScoreOverview {
  const width = ticksPerBar(document)
  let truncated = false
  let noteOnsets = 0
  const motifs = new Map(document.motifs.map((motif) => [motif.id, motif]))
  const lanes = document.parts.map((part): ScoreLane => {
    const density = Array.from({ length: document.bars }, () => 0)
    const add = (tick: number) => { const bar = Math.floor(tick / width); if (bar >= 0 && bar < density.length) { density[bar]++; noteOnsets++ } }
    for (const note of part.notes) add(note.startTick)
    const blocks: ScoreBlock[] = []
    let visits = 0
    for (const placement of part.placements) {
      const motif = motifs.get(placement.motifId)
      if (!motif) continue
      blocks.push({ key: `${part.id}:${placement.id}`, partId: part.id, startTick: placement.startTick, endTick: placement.startTick + placement.repeats * motif.lengthTicks, label: motif.name, kind: "motif", familyId: motifFamily(document, motif.id) ?? undefined, derivedFromMotifId: motif.derivedFromMotifId })
      for (let repeat = 0; repeat < placement.repeats && visits < 100_000; repeat++) for (const note of motif.notes) {
        if (visits++ >= 100_000) { truncated = true; break }
        add(placement.startTick + repeat * motif.lengthTicks + note.startTick)
      }
      if (visits >= 100_000) truncated = true
    }
    for (const clip of part.sourceRegions) blocks.push({ key: `${part.id}:${clip.id}`, partId: part.id, startTick: clip.startTick, endTick: clip.startTick + clip.durationTicks, label: "Your sound", kind: "owned-clip", sourceStartSeconds: clip.sourceStartSeconds, sourceDurationSeconds: clip.sourceDurationSeconds, playbackMode: clip.playbackMode, playbackRate: clip.playbackRate, stretchMode: clip.stretchMode, pitchShiftSemitones: clip.pitchShiftSemitones, gain: clip.gain })
    for (const clip of part.libraryRegions ?? []) blocks.push({ key: `${part.id}:${clip.id}`, partId: part.id, startTick: clip.startTick, endTick: clip.startTick + clip.durationTicks, label: clip.displayName, kind: "library-clip", sourceStartSeconds: clip.sourceStartSeconds, sourceDurationSeconds: clip.sourceDurationSeconds, playbackMode: clip.playbackMode, playbackRate: clip.playbackRate, stretchMode: clip.stretchMode, pitchShiftSemitones: clip.pitchShiftSemitones, gain: clip.gain })
    return { partId: part.id, name: part.name, role: part.role, density, blocks, totalNoteOnsets: density.reduce((sum, count) => sum + count, 0), totalClips: part.sourceRegions.length + (part.libraryRegions?.length ?? 0) }
  })
  return { lanes, noteOnsets, bars: document.bars, truncated }
}

export function materializedSectionNotes(document: NativeDocument, partId: string, fromTick: number, toTick: number, limit = 320): { notes: ScoreNote[]; total: number; truncated: boolean } {
  const part = document.parts.find((item) => item.id === partId)
  if (!part) return { notes: [], total: 0, truncated: false }
  const notes: ScoreNote[] = []
  let total = 0
  const add = (item: ScoreNote) => { if (!overlaps(item.startTick, item.startTick + item.durationTicks, fromTick, toTick)) return; total++; if (notes.length < limit) notes.push(item) }
  for (const note of part.notes) add({ ...note, key: `${part.id}:free:${note.id}`, partId, origin: "free" })
  const motifs = new Map(document.motifs.map((motif) => [motif.id, motif]))
  for (const placement of part.placements) {
    const motif = motifs.get(placement.motifId)
    if (!motif || !overlaps(placement.startTick, placement.startTick + placement.repeats * motif.lengthTicks, fromTick, toTick)) continue
    const first = Math.max(0, Math.floor((fromTick - placement.startTick - motif.lengthTicks) / motif.lengthTicks))
    const last = Math.min(placement.repeats, Math.ceil((toTick - placement.startTick) / motif.lengthTicks))
    for (let repeat = first; repeat < last; repeat++) for (const note of motif.notes) add({ ...note, key: `${part.id}:${placement.id}:${repeat}:${note.id}`, partId, origin: "motif", motifId: motif.id, familyId: motifFamily(document, motif.id) ?? undefined, placementId: placement.id, repeat, startTick: placement.startTick + repeat * motif.lengthTicks + note.startTick, pitch: note.pitch + placement.transpose })
  }
  notes.sort((a, b) => a.startTick - b.startTick || a.pitch - b.pitch || a.key.localeCompare(b.key))
  return { notes, total, truncated: total > notes.length }
}

export function automationAt(curve: NativeAutomation, tick: number): number | null {
  if (!curve.points.length || tick < curve.points[0].tick) return null
  const index = curve.points.findIndex((point) => point.tick > tick)
  if (index < 0) return curve.points.at(-1)!.value
  const left = curve.points[index - 1], right = curve.points[index]
  if ((left.interpolation ?? "step") === "step") return left.value
  if (left.interpolation === "sloped") return null
  return left.value + (right.value - left.value) * (tick - left.tick) / (right.tick - left.tick)
}

function automationBaseline(part: NativePart, target: string): number | null {
  if (target === "gain") return part.gain
  const send = /^send\.([^.]+)\.gain$/.exec(target)
  if (send) return part.sends?.find((item) => item.busId === send[1])?.gain ?? null
  const effect = /^effect\.([^.]+)\.([^.]+)$/.exec(target)
  if (effect) return part.effects.find((item) => item.id === effect[1])?.parameters[effect[2]] ?? null
  return null
}

function sectionAutomationStatus(oldAutomation: NativeAutomation[], newAutomation: NativeAutomation[], oldBaseline: (target: string) => number | null, newBaseline: (target: string) => number | null, start: number, end: number): ComparisonState {
  if (stable(oldAutomation) === stable(newAutomation)) return "preserved"
  const targets = new Set([...oldAutomation.map((curve) => curve.target), ...newAutomation.map((curve) => curve.target)])
  let changed = false
  for (const target of targets) {
    const oldCurves = oldAutomation.filter((curve) => curve.target === target)
    const newCurves = newAutomation.filter((curve) => curve.target === target)
    if (oldCurves.length > 1 || newCurves.length > 1) return "unverified"
    const oldCurve = oldCurves[0], newCurve = newCurves[0]
    if ([oldCurve, newCurve].some((curve) => curve?.points.some((point) => point.interpolation === "sloped"))) return "unverified"
    const boundaries = new Set<number>([start, end - 1])
    for (const curve of [oldCurve, newCurve]) for (const point of curve?.points ?? []) {
      for (const tick of [point.tick - 1, point.tick, point.tick + 1]) if (tick >= start && tick < end) boundaries.add(tick)
    }
    const sorted = [...boundaries].sort((a, b) => a - b)
    const probes = [...sorted, ...sorted.slice(1).map((tick, index) => Math.floor((sorted[index] + tick) / 2))]
    for (const tick of probes) {
      const previous = oldCurve ? automationAt(oldCurve, tick) : oldBaseline(target)
      const current = newCurve ? automationAt(newCurve, tick) : newBaseline(target)
      if (previous === null || current === null) return "unverified"
      if (Math.abs(previous - current) > 1e-6) changed = true
    }
  }
  return changed ? "changed" : "preserved"
}

function groupBaseline(group: NonNullable<NativeDocument["groups"]>[number], target: string): number | null {
  if (target === "gain" || target === "pan") return group[target]
  if (target === "parallel.wetMix") return group.parallel?.wetMix ?? null
  const compressor = /^compressor\.([^.]+)$/.exec(target)
  if (compressor) { const value = group.compressor?.[compressor[1] as keyof NonNullable<typeof group.compressor>]; return typeof value === "number" ? value : null }
  const effect = /^effect\.([^.]+)\.([^.]+)$/.exec(target)
  if (effect) return group.effects?.find((item) => item.id === effect[1])?.parameters?.[effect[2]] ?? null
  return null
}

type ClipSegment = { resource: string; startTick: number; endTick: number; sourceStartSeconds: number; gain: number; playbackRate: number; stretchMode: string | null; pitchShiftSemitones: number; secondsPerTick: number }
function clipSegments(document: NativeDocument, part: NativePart, start: number, end: number): ClipSegment[] | null {
  const segments: ClipSegment[] = []
  for (const clip of [...part.sourceRegions, ...(part.libraryRegions ?? [])]) {
    const from = Math.max(start, clip.startTick), to = Math.min(end, clip.startTick + clip.durationTicks)
    if (from >= to) continue
    const secondsPerTick = 60 / document.tempoBpm / document.ppq * (clip.playbackRate ?? 1)
    const loopTicks = clip.playbackMode === "loop" ? clip.sourceDurationSeconds / secondsPerTick : null
    if (loopTicks !== null && Math.abs(loopTicks - Math.round(loopTicks)) > 1e-6) return null
    for (let cursor = from; cursor < to;) {
      if (segments.length > 8192) return null
      const phase = loopTicks === null ? cursor - clip.startTick : (cursor - clip.startTick) % Math.round(loopTicks)
      const length = loopTicks === null ? to - cursor : Math.min(to - cursor, Math.round(loopTicks) - phase)
      segments.push({ resource: "assetId" in clip ? `owned:${clip.assetId}:${clip.assetHash}` : `library:${clip.sampleName}`, startTick: cursor, endTick: cursor + length, sourceStartSeconds: Number((clip.sourceStartSeconds + phase * secondsPerTick).toFixed(6)), gain: clip.gain, playbackRate: clip.playbackRate ?? 1, stretchMode: clip.stretchMode ?? null, pitchShiftSemitones: clip.pitchShiftSemitones ?? 0, secondsPerTick })
      cursor += length
    }
  }
  segments.sort((a, b) => a.startTick - b.startTick || a.resource.localeCompare(b.resource) || a.sourceStartSeconds - b.sourceStartSeconds)
  const merged: ClipSegment[] = []
  for (const segment of segments) {
    const previous = merged.at(-1)
    if (previous && previous.endTick === segment.startTick && previous.resource === segment.resource && previous.gain === segment.gain && previous.playbackRate === segment.playbackRate && previous.stretchMode === segment.stretchMode && previous.pitchShiftSemitones === segment.pitchShiftSemitones && Math.abs(previous.sourceStartSeconds + (previous.endTick - previous.startTick) * previous.secondsPerTick - segment.sourceStartSeconds) < 1e-5) previous.endTick = segment.endTick
    else merged.push({ ...segment })
  }
  return merged
}

export type ComparisonState = "preserved" | "changed" | "added" | "removed" | "unverified"
export interface PartComparison { partId: string; name: string; status: ComparisonState; addedNotes: ScoreNote[]; removedNotes: ScoreNote[]; modifiedNotes: Array<{ before: ScoreNote; after: ScoreNote }>; preservedNotes: number; clipStatus: ComparisonState; controlsChanged: boolean; dependenciesChanged: boolean; metadataChanged: boolean }
export interface SectionComparison { sectionId: string; status: ComparisonState; parts: PartComparison[]; addedNotes: number; removedNotes: number; modifiedNotes: number; verifiedUnchangedParts: string[]; caveats: string[] }

export function compareScoreSection(before: NativeDocument, after: NativeDocument, sectionId: string): SectionComparison {
  const section = before.sections.find((value) => value.id === sectionId)
  const paired = after.sections.find((value) => value.id === sectionId)
  if (!section || !paired || section.startBar !== paired.startBar || section.endBar !== paired.endBar || before.tempoBpm !== after.tempoBpm || stable(before.meter) !== stable(after.meter)) return { sectionId, status: "unverified", parts: [], addedNotes: 0, removedNotes: 0, modifiedNotes: 0, verifiedUnchangedParts: [], caveats: ["Section identity or musical timing changed; local event alignment is not verified."] }
  const start = section.startBar * ticksPerBar(before), end = section.endBar * ticksPerBar(before)
  const ids = new Set([...before.parts.map((part) => part.id), ...after.parts.map((part) => part.id)])
  const parts: PartComparison[] = []
  const caveats: string[] = []
  for (const id of ids) {
    const old = before.parts.find((part) => part.id === id), next = after.parts.find((part) => part.id === id)
    if (!old || !next) { parts.push({ partId: id, name: next?.name ?? old!.name, status: next ? "added" : "removed", addedNotes: next ? materializedSectionNotes(after, id, start, end).notes : [], removedNotes: old ? materializedSectionNotes(before, id, start, end).notes : [], modifiedNotes: [], preservedNotes: 0, clipStatus: next ? "added" : "removed", controlsChanged: true, dependenciesChanged: true, metadataChanged: false }); continue }
    const previous = materializedSectionNotes(before, id, start, end, 100_000), current = materializedSectionNotes(after, id, start, end, 100_000)
    if (previous.truncated || current.truncated) caveats.push(`${old.name}: too many notes for a complete event comparison.`)
    const oldMap = new Map(previous.notes.map((note) => [note.key, note])), nextMap = new Map(current.notes.map((note) => [note.key, note]))
    const addedNotes: ScoreNote[] = [], removedNotes: ScoreNote[] = [], modifiedNotes: Array<{ before: ScoreNote; after: ScoreNote }> = []
    let preservedNotes = 0
    for (const note of previous.notes) { const newer = nextMap.get(note.key); if (!newer) removedNotes.push(note); else if (stable([note.startTick, note.durationTicks, note.pitch, note.velocity]) !== stable([newer.startTick, newer.durationTicks, newer.pitch, newer.velocity])) modifiedNotes.push({ before: note, after: newer }); else preservedNotes++ }
    for (const note of current.notes) if (!oldMap.has(note.key)) addedNotes.push(note)
    const oldClips = clipSegments(before, old, start, end), newClips = clipSegments(after, next, start, end)
    const clipStatus = oldClips === null || newClips === null ? "unverified" : stable(oldClips) === stable(newClips) ? "preserved" : !oldClips.length ? "added" : !newClips.length ? "removed" : "changed"
    const oldGroup = before.groups?.find((group) => group.id === old.groupId)
    const newGroup = after.groups?.find((group) => group.id === next.groupId)
    const partControls = sectionAutomationStatus(old.automation, next.automation, (target) => automationBaseline(old, target), (target) => automationBaseline(next, target), start, end)
    const groupControls = oldGroup && newGroup ? sectionAutomationStatus(oldGroup.automation ?? [], newGroup.automation ?? [], (target) => groupBaseline(oldGroup, target), (target) => groupBaseline(newGroup, target), start, end) : "preserved"
    const controlStatus = partControls === "unverified" || groupControls === "unverified" ? "unverified" : partControls === "changed" || groupControls === "changed" ? "changed" : "preserved"
    const controlsChanged = controlStatus === "changed"
    const dependenciesChanged = stable({ device: old.device, gain: old.gain, pan: old.pan, effects: old.effects, parallel: old.parallel, sends: old.sends, group: oldGroup && { ...oldGroup, automation: undefined }, master: before.master, reverbBus: before.reverbBus, delayBus: before.delayBus }) !== stable({ device: next.device, gain: next.gain, pan: next.pan, effects: next.effects, parallel: next.parallel, sends: next.sends, group: newGroup && { ...newGroup, automation: undefined }, master: after.master, reverbBus: after.reverbBus, delayBus: after.delayBus })
    const metadataChanged = old.name !== next.name || stable(before.motifs.filter((motif) => motif.partId === id).map((motif) => ({ id: motif.id, name: motif.name, familyId: motif.familyId }))) !== stable(after.motifs.filter((motif) => motif.partId === id).map((motif) => ({ id: motif.id, name: motif.name, familyId: motif.familyId })))
    const status: ComparisonState = previous.truncated || current.truncated || clipStatus === "unverified" || controlStatus === "unverified" ? "unverified" : addedNotes.length || removedNotes.length || modifiedNotes.length || clipStatus !== "preserved" || controlsChanged || dependenciesChanged ? "changed" : "preserved"
    parts.push({ partId: id, name: next.name, status, addedNotes, removedNotes, modifiedNotes, preservedNotes, clipStatus, controlsChanged, dependenciesChanged, metadataChanged })
  }
  return { sectionId, status: parts.some((part) => part.status === "unverified") ? "unverified" : parts.some((part) => part.status !== "preserved") ? "changed" : "preserved", parts, addedNotes: parts.reduce((sum, part) => sum + part.addedNotes.length, 0), removedNotes: parts.reduce((sum, part) => sum + part.removedNotes.length, 0), modifiedNotes: parts.reduce((sum, part) => sum + part.modifiedNotes.length, 0), verifiedUnchangedParts: parts.filter((part) => part.status === "preserved").map((part) => part.name), caveats }
}

export function sectionClips(document: NativeDocument, partId: string, start: number, end: number): Array<NativeClip & { key: string; label: string; resource: string }> {
  const part = document.parts.find((item) => item.id === partId)
  if (!part) return []
  return [...part.sourceRegions.map((clip) => ({ ...clip, key: clip.id, label: "Your sound", resource: clip.assetId })), ...(part.libraryRegions ?? []).map((clip) => ({ ...clip, key: clip.id, label: clip.displayName, resource: clip.sampleName }))].filter((clip) => overlaps(clip.startTick, clip.startTick + clip.durationTicks, start, end))
}
