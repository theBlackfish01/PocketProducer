import type { Asset, NativeSnapshot } from "../../lib/api"

export interface NativeDraft {
  headId: string | null
  direction: string
  targetPartId: string | null
  targetSectionId: string | null
  protectedPartIds: string[]
  sourceIds: string[]
  profile?: "standard" | "extended"
}

export const nativeDraftKey = (projectId: string) => `pocket-producer:native-draft:${projectId}`
export const defaultNativeDirection = () => ""

export function freshNativeDraft(snapshot: NativeSnapshot | null): NativeDraft {
  return { headId: snapshot?.currentRevisionId ?? null, direction: defaultNativeDirection(), targetPartId: null, targetSectionId: null, protectedPartIds: snapshot?.current?.document.protectedPartIds ?? [], sourceIds: [], profile: "standard" }
}

export function reconcileNativeDraft(raw: unknown, snapshot: NativeSnapshot, assets: Asset[]): { draft: NativeDraft; notices: string[] } {
  const fallback = freshNativeDraft(snapshot)
  if (!raw || typeof raw !== "object") return { draft: fallback, notices: [] }
  const saved = raw as Record<string, unknown>
  const partIds = new Set(snapshot.current?.document.parts.map((part) => part.id) ?? [])
  const sectionIds = new Set(snapshot.current?.document.sections.map((section) => section.id) ?? [])
  const assetIds = new Set(assets.map((asset) => asset.id))
  const headChanged = saved.headId !== snapshot.currentRevisionId
  const requestedPartId = typeof saved.targetPartId === "string" ? saved.targetPartId : null
  const requestedSectionId = typeof saved.targetSectionId === "string" ? saved.targetSectionId : null
  const requestedSources = Array.isArray(saved.sourceIds) ? saved.sourceIds.filter((value): value is string => typeof value === "string") : []
  const notices: string[] = []
  if (headChanged) notices.push("The selected version changed. Review this saved request before sending it; pending keep choices were reset to the current version.")
  if (requestedPartId && !partIds.has(requestedPartId)) notices.push("The part you selected is no longer in this version, so that target was cleared.")
  if (requestedSectionId && !sectionIds.has(requestedSectionId)) notices.push("The section you selected is no longer in this version, so that target was cleared.")
  if (requestedSources.some((id) => !assetIds.has(id))) notices.push("An unavailable sound was removed from this request.")
  const requestedProtections = Array.isArray(saved.protectedPartIds) ? saved.protectedPartIds.filter((value): value is string => typeof value === "string") : []
  return { draft: {
    headId: snapshot.currentRevisionId,
    direction: typeof saved.direction === "string" && saved.direction.length <= 32_768 ? saved.direction : fallback.direction,
    targetPartId: requestedPartId && partIds.has(requestedPartId) ? requestedPartId : null,
    targetSectionId: requestedSectionId && sectionIds.has(requestedSectionId) ? requestedSectionId : null,
    protectedPartIds: headChanged ? fallback.protectedPartIds : [...new Set(requestedProtections.filter((id) => partIds.has(id)))],
    sourceIds: [...new Set(requestedSources.filter((id) => assetIds.has(id)))],
    profile: saved.profile === "extended" ? "extended" : "standard"
  }, notices }
}
