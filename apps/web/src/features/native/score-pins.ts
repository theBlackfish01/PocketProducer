import type { NativeDocument } from "../../lib/api"

/** A local, unsent listening note anchored to bars of one part. Pins never
 * authorize a change: they only become editable direction text on request. */
export interface ScorePin { id: string; partId: string; partName: string; startBar: number; endBar: number; note: string; revisionId: string | null; ordinal: number | null; createdAt: string }

export const pinKey = (projectId: string) => `pocket-producer:score-pins:${projectId}`
export const maxPins = 24
export const maxPinNote = 240

export function readPins(projectId: string): ScorePin[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(pinKey(projectId)) ?? "[]")
    return Array.isArray(value) ? value.filter(isPin).slice(0, maxPins) : []
  } catch { return [] }
}

export function writePins(projectId: string, pins: ScorePin[]) {
  try {
    if (pins.length) localStorage.setItem(pinKey(projectId), JSON.stringify(pins.slice(0, maxPins)))
    else localStorage.removeItem(pinKey(projectId))
  } catch { /* Pins are a local convenience; the score is unaffected. */ }
}

function isPin(value: unknown): value is ScorePin {
  if (!value || typeof value !== "object") return false
  const pin = value as Record<string, unknown>
  return typeof pin.id === "string" && typeof pin.partId === "string" && typeof pin.partName === "string" && typeof pin.note === "string" && pin.note.length <= maxPinNote
    && Number.isInteger(pin.startBar) && Number.isInteger(pin.endBar) && (pin.startBar as number) >= 0 && (pin.endBar as number) > (pin.startBar as number)
}

export const pinBars = (pin: Pick<ScorePin, "startBar" | "endBar">) => pin.endBar - pin.startBar === 1 ? `bar ${pin.startBar + 1}` : `bars ${pin.startBar + 1}–${pin.endBar}`

export type PinState = "ready" | "kept" | "missing"
export function pinState(pin: ScorePin, document: NativeDocument, protectedPartIds: string[]): PinState {
  if (!document.parts.some((part) => part.id === pin.partId) || pin.endBar > document.bars) return "missing"
  return protectedPartIds.includes(pin.partId) ? "kept" : "ready"
}

/** The one section containing every pin, if any. */
export function pinsSection(pins: ScorePin[], document: NativeDocument) {
  const sections = new Set(pins.map((pin) => document.sections.find((section) => pin.startBar >= section.startBar && pin.endBar <= section.endBar)?.id ?? null))
  const [only] = sections
  return sections.size === 1 && only ? document.sections.find((section) => section.id === only)! : null
}

/** Editable direction text plus a suggested scope. A single section prefix keeps
 * an exclusion such as "remove" local instead of reading as a whole-piece rule. */
export function composePins(pins: ScorePin[], document: NativeDocument, protectedPartIds: string[]) {
  const usable = pins.filter((pin) => pinState(pin, document, protectedPartIds) === "ready")
  const section = usable.length ? pinsSection(usable, document) : null
  const parts = new Set(usable.map((pin) => pin.partId))
  const lines = usable.map((pin) => {
    const name = document.parts.find((part) => part.id === pin.partId)!.name
    const note = pin.note.trim().replace(/\s+/g, " ")
    const ending = [".", "!", "?"].includes(note.at(-1) ?? "") ? "" : "."
    return section ? `In ${section.name}, ${name} (${pinBars(pin)}): ${note}${ending}` : `In ${pinBars(pin)}, ${name}: ${note}${ending}`
  })
  return { text: lines.join("\n"), used: usable.map((pin) => pin.id), sectionId: section?.id ?? null, partId: parts.size === 1 ? [...parts][0] : null }
}
