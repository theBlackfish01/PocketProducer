import type { Activity, NativeDocument, NativeVersion } from "../../lib/api"
import { words } from "../../lib/words"

/** Where a public message points in the displayed score. Presentation only. */
export interface ScoreTargets { partIds: string[]; sectionIds: string[] }

/** Older "music" rows predate stored identities; match whole part names as word
 * sequences in the public text, longest first so "Bass II" does not also light "Bass". */
export function namedParts(text: string, document: NativeDocument): string[] {
  const remaining: Array<string | null> = words(text)
  const found = new Set<string>()
  for (const part of [...document.parts].sort((a, b) => b.name.length - a.name.length)) {
    const name = words(part.name)
    const at = name.length ? remaining.findIndex((_, index) => name.every((word, offset) => remaining[index + offset] === word)) : -1
    if (at < 0) continue
    found.add(part.id)
    remaining.fill(null, at, at + name.length)
  }
  return document.parts.filter((part) => found.has(part.id)).map((part) => part.id)
}

export function activityTargets(event: Activity, document: NativeDocument | null | undefined, versions: NativeVersion[], currentRevisionId: string | null): ScoreTargets | null {
  if (!document) return null
  const value = event.payload
  const parts = new Set(document.parts.map((part) => part.id)), sections = new Set(document.sections.map((section) => section.id))
  let partIds: string[] = [], sectionIds: string[] = []
  if (value.kind === "music") {
    partIds = value.partIds ?? namedParts(value.text, document)
    sectionIds = value.sectionIds ?? []
  } else if (value.kind === "request") {
    partIds = value.partId ? [value.partId] : []
    sectionIds = value.sectionId ? [value.sectionId] : []
  } else if (value.kind === "saved" && value.revisionId && value.revisionId === currentRevisionId) {
    const diff = versions.find((version) => version.id === value.revisionId)?.structuralDiff
    partIds = [...(diff?.addedParts ?? []), ...(diff?.changedParts ?? [])]
    sectionIds = [...(diff?.addedSections ?? []), ...(diff?.changedSections ?? [])]
  }
  const result = { partIds: [...new Set(partIds)].filter((id) => parts.has(id)), sectionIds: [...new Set(sectionIds)].filter((id) => sections.has(id)) }
  return result.partIds.length || result.sectionIds.length ? result : null
}
