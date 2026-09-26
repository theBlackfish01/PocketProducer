import type { NativeAutomation, NativeDocument } from "../../lib/api"
import { materializedSectionNotes, partGroupChain, ticksPerBar, type ScoreNote } from "./score"

export const roleNames: Record<string, string> = { percussion: "Drums", bass: "Bass", melody: "Melody", harmony: "Harmony", texture: "Atmosphere", lead: "Lead", fx: "Accents", source: "Your sounds" }
export const pitchName = (pitch: number) => `${["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][pitch % 12]}${Math.floor(pitch / 12) - 1}`
export const barLabel = (tick: number, width: number) => `${Math.floor(tick / width) + 1}${tick % width ? ` + ${Number((tick % width / 960).toFixed(2))} beats` : ""}`
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export interface ConfirmedFrame { document: NativeDocument; identity: string; scope?: string; steps: number; before?: NativeDocument }
export function advanceConfirmedFrame(prior: ConfirmedFrame, next: Omit<ConfirmedFrame, "before">): ConfirmedFrame {
  if (prior.scope === next.scope && (prior.identity === next.identity || next.steps < prior.steps)) return prior
  return { ...next, before: next.scope && prior.scope === next.scope && next.steps > prior.steps ? prior.document : undefined }
}

/** Presentation only: detects changed stored music, never certifies preservation or sound. */
export function confirmedChanges(before: NativeDocument, after: NativeDocument) {
  const oldParts = new Map(before.parts.map((part) => [part.id, part]))
  const oldMotifs = new Map(before.motifs.map((motif) => [motif.id, motif]))
  const newMotifs = new Map(after.motifs.map((motif) => [motif.id, motif]))
  const routing = (document: NativeDocument, partId: string) => {
    const part = document.parts.find((item) => item.id === partId)
    return [document.master, partGroupChain(document, partId), part?.sends?.some((send) => send.busId === document.reverbBus?.id) ? document.reverbBus : null, part?.sends?.some((send) => send.busId === document.delayBus?.id) ? document.delayBus : null]
  }
  const parts = after.parts.flatMap((part) => {
    const old = oldParts.get(part.id)
    const notes = !old || !same(old.notes, part.notes) || !same(old.placements, part.placements) || part.placements.some((placement) => !same(oldMotifs.get(placement.motifId), newMotifs.get(placement.motifId)))
    const clips = !same([old?.sourceRegions ?? [], old?.libraryRegions ?? []], [part.sourceRegions, part.libraryRegions ?? []])
    const controls = !old || !same(routing(before, part.id), routing(after, part.id)) || !same([old.device, old.gain, old.pan, old.effects, old.automation, old.sends, old.parallel, old.groupId], [part.device, part.gain, part.pan, part.effects, part.automation, part.sends, part.parallel, part.groupId])
    const kinds = [!old ? "added part" : notes ? "notes / phrases" : null, clips ? "clips" : null, controls ? "sound / controls" : null].filter((kind): kind is string => Boolean(kind))
    return kinds.length ? [{ id: part.id, name: part.name, kinds }] : []
  })
  for (const part of before.parts) if (!after.parts.some((item) => item.id === part.id)) parts.push({ id: part.id, name: part.name, kinds: ["removed part"] })
  return { parts, formChanged: !same([before.sections, before.tempoBpm, before.meter], [after.sections, after.tempoBpm, after.meter]) }
}

/** Same time and pitch coordinates in Before, After and Changes, including removed parts. */
export function scoreWindow(document: NativeDocument, reference: NativeDocument | undefined, partId: string, from: number, to: number) {
  const current = materializedSectionNotes(document, partId, from, to, 120)
  const prior = reference ? materializedSectionNotes(reference, partId, from, to, 120) : current
  const pitches = [...current.notes, ...prior.notes].map((note) => note.pitch)
  const low = pitches.length ? Math.min(...pitches) - 1 : 59
  const high = pitches.length ? Math.max(...pitches) + 1 : 73
  const old = new Map(prior.notes.map((note) => [note.key, note]))
  const now = new Map(current.notes.map((note) => [note.key, note]))
  return { current, prior, low, high, old, now }
}

export function noteGeometry(note: ScoreNote, from: number, to: number, low: number, high: number) {
  const x = Math.max(0, (note.startTick - from) / (to - from) * 1000)
  return { x, y: 38 - (note.pitch - low) / Math.max(1, high - low) * 30, width: Math.max(2, Math.min(1000, (note.startTick + note.durationTicks - from) / (to - from) * 1000) - x), height: 5 }
}
export const noteChanged = (a: ScoreNote, b: ScoreNote) => a.pitch !== b.pitch || a.startTick !== b.startTick || a.durationTicks !== b.durationTicks || a.velocity !== b.velocity
export function controlName(target: string) {
  const words = target.split(".").at(-1) ?? target
  return ({ gain: "Level", pan: "Balance", wetMix: "Wet blend", feedbackFactor: "Feedback", cutoffFrequency: "Filter cutoff" } as Record<string, string>)[words] ?? words.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase())
}

/** Only draw exact step/linear interpolation. Unsupported easing is displayed as points. */
export function controlPath(curve: NativeAutomation, endTick: number, range?: [number, number]) {
  const values = curve.points.map((point) => point.value)
  const low = range?.[0] ?? Math.min(...values), high = range?.[1] ?? Math.max(...values)
  const x = (tick: number) => tick / endTick * 100
  const y = (value: number) => 27 - (value - low) / Math.max(0.0001, high - low) * 22
  let path = ""
  curve.points.forEach((point, index) => {
    const prior = curve.points[index - 1]
    if (!prior || prior.interpolation === "sloped") path += ` M${x(point.tick)},${y(point.value)}`
    else if (!prior.interpolation || prior.interpolation === "step") path += ` H${x(point.tick)} V${y(point.value)}`
    else path += ` L${x(point.tick)},${y(point.value)}`
  })
  return { path, low, high, points: curve.points.map((point) => ({ x: x(point.tick), y: y(point.value) })) }
}
export const documentEnd = (document: NativeDocument) => document.bars * ticksPerBar(document)
