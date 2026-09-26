import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ArrowRight, Check, GitCompareArrows, Headphones, LockKeyhole, Music2, Play, Plus, RotateCcw, Search, ShieldCheck, Sparkles } from "lucide-react"
import { api, type Asset, type Job, type NativeDraftView, type NativeSnapshot } from "../../lib/api"
import { arrangementSummary, friendlyIssue, jobProgress, readableDevice, readableEffect } from "../../lib/ui-copy"
import { Button } from "../../components/ui/button"
import { RoomHero } from "../../components/room-hero"
import { Textarea } from "../../components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog"
import { RadioGroup, RadioGroupItem } from "../../components/ui/radio-group"
import { defaultNativeDirection, freshNativeDraft, nativeDraftKey, reconcileNativeDraft } from "./native-draft"
import { NativeScore } from "./native-score"
import { compareScoreSection } from "./score"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../components/ui/sheet"
import { ProducerFeed } from "./producer-feed"
import { useProducerActivity } from "./use-producer-activity"
import { navigateSession } from "../../lib/session-route"

const terminal = new Set(["succeeded", "failed", "cancelled", "needs_attention"])
const clipTransform = (region: { playbackRate?: number; stretchMode?: string; pitchShiftSemitones?: number }) =>
  (region.playbackRate ? " · " + String(region.playbackRate) + "× speed" : "") + (region.stretchMode === "preservePitch" ? " · pitch preserved" : "") + (region.pitchShiftSemitones ? " · " + String(region.pitchShiftSemitones) + " semitone shift" : "")
type Receipt = { operation: "native-generation" | "native-revision" | "native-sync"; key: string; jobId: string | null; signature: string }

interface NativeRoomProps {
  projectId: string
  assets: Asset[]
  legacyVersionCount: number
  audiotoolConnected: boolean
  audiotoolAvailable: boolean
  sourcePreview: ReactNode
  onAddSource(): void
  onAuditionSource(assetId: string): void
  onConnectAudiotool(): void
  onLegacy(): void
  onProjectUpdated(): void
}

export function NativeRoom({ projectId, assets, legacyVersionCount, audiotoolConnected, audiotoolAvailable, sourcePreview, onAddSource, onAuditionSource, onConnectAudiotool, onLegacy, onProjectUpdated }: NativeRoomProps) {
  const [snapshot, setSnapshot] = useState<NativeSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [direction, setDirection] = useState(defaultNativeDirection())
  const [profile, setProfile] = useState<"standard" | "extended">("standard")
  const [targetPartId, setTargetPartId] = useState<string | null>(null)
  const [targetSectionId, setTargetSectionId] = useState<string | null>(null)
  const [protectedPartIds, setProtectedPartIds] = useState<string[]>([])
  const [sourceIds, setSourceIds] = useState<string[]>([])
  const [draftProjectId, setDraftProjectId] = useState<string | null>(null)
  const [draftNotices, setDraftNotices] = useState<string[]>([])
  const [job, setJob] = useState<Job | null>(null)
  const [tentative, setTentative] = useState<NativeDraftView | null>(null)
  const [tentativeError, setTentativeError] = useState<string | null>(null)
  const [extension, setExtension] = useState({ maxCalls: "", maxInputTokens: "", maxOutputTokens: "", deadlineSeconds: "", maxJobCostUsd: "" })
  const [compareOpen, setCompareOpen] = useState(false)
  const [compareId, setCompareId] = useState<string | null>(null)
  const [detailsPartId, setDetailsPartId] = useState<string | null>(null)
  const [viewSectionId, setViewSectionId] = useState<string | null>(null)
  const [soundsOpen, setSoundsOpen] = useState(false)
  const [panel, setPanel] = useState<"history" | "usage" | "audiotool" | null>(null)
  const [workspaceView, setWorkspaceView] = useState<"arrangement" | "producer">("arrangement")
  const [showDraft, setShowDraft] = useState(false)
  const activity = useProducerActivity(projectId)
  const directionRef = useRef(direction)
  directionRef.current = direction
  const [partsOpen, setPartsOpen] = useState(false)
  const [showUnchanged, setShowUnchanged] = useState(false)
  const [comparePartId, setComparePartId] = useState<string | null>(null)
  const [replay, setReplay] = useState(0)
  const [inspectedPartId, setInspectedPartId] = useState<string | null>(null)
  const [draftSectionId, setDraftSectionId] = useState<string | null>(null)
  const [draftPartId, setDraftPartId] = useState<string | null>(null)
  const [compareMode, setCompareMode] = useState<"before" | "after" | "changes">("changes")
  const [compareSectionId, setCompareSectionId] = useState<string | null>(null)
  const [comparePair, setComparePair] = useState<{ beforeId: string; afterId: string } | null>(null)
  const [preservationPreview, setPreservationPreview] = useState<Awaited<ReturnType<typeof api.nativePreservationPreview>> | null>(null)
  const pendingCompare = useRef<{ projectId: string; jobId: string; baseId: string; sectionId: string | null } | null>(null)
  const activeProjectRef = useRef(projectId)
  const roomActiveRef = useRef(true)
  activeProjectRef.current = projectId
  const stillInProject = () => roomActiveRef.current && activeProjectRef.current === projectId
  const [roleFilter, setRoleFilter] = useState("all")
  const [partLimit, setPartLimit] = useState(8)
  const [capabilityQuery, setCapabilityQuery] = useState("")
  const [libraryQuery, setLibraryQuery] = useState("")
  const [libraryKind, setLibraryKind] = useState<"samples" | "heisenberg" | "pulverisateur" | "gakki" | "beatbox8">("samples")
  const [libraryResults, setLibraryResults] = useState<Array<{ name: string; displayName: string; ownerName: string; detail: string }>>([])
  const [librarySearched, setLibrarySearched] = useState(false)
  const [libraryBusy, setLibraryBusy] = useState(false)
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const [capabilities, setCapabilities] = useState<Array<{ type: string; family: string; purpose: string; writableInPocketProducer: boolean }>>([])
  const assetsRef = useRef(assets)
  assetsRef.current = assets
  const current = snapshot?.current ?? null
  const partRoles = [...new Set(current?.document.parts.map((part) => part.role) ?? [])]
  const filteredParts = current?.document.parts.filter((part) => roleFilter === "all" || part.role === roleFilter) ?? []
  const visibleParts = filteredParts.slice(0, partLimit)
  const currentRemoteVerification = snapshot?.synchronization.state === "verified" && snapshot.synchronization.revisionId === current?.id && snapshot.synchronization.mappingVersion === "nexus-native-v6"
  const receiptKey = `pocket-producer:native-receipt:${projectId}`

  useEffect(() => {
    let active = true
    roomActiveRef.current = true
    pendingCompare.current = null; setDraftProjectId(null); setLoading(true); setBusy(false); setSnapshot(null); setJob(null); setTentative(null); setTentativeError(null); setError(null); setTargetPartId(null); setTargetSectionId(null); setProtectedPartIds([]); setSourceIds([]); setRoleFilter("all"); setPartLimit(8); setCompareOpen(false); setComparePair(null); setInspectedPartId(null); setViewSectionId(null); setSoundsOpen(false); setPartsOpen(false); setComparePartId(null); setReplay(0); setShowUnchanged(false)
    void api.nativeSnapshot(projectId).then((value) => {
      if (!active) return
      let stored: unknown = null
      try { stored = JSON.parse(localStorage.getItem(nativeDraftKey(projectId)) ?? "null") } catch { /* A malformed browser draft has no authority. */ }
      const restored = reconcileNativeDraft(stored, value, assetsRef.current)
      setWorkspaceView(value.current ? "arrangement" : "producer"); setSnapshot(value); setDirection(restored.draft.direction); setProfile(restored.draft.profile ?? "standard"); setTargetPartId(restored.draft.targetPartId); setTargetSectionId(restored.draft.targetSectionId); setProtectedPartIds(restored.draft.protectedPartIds); setSourceIds(restored.draft.sourceIds); setDraftNotices(restored.notices); setDraftProjectId(projectId)
      setLoading(false)
      try {
        const raw = localStorage.getItem(receiptKey)
        if (raw) {
          const receipt = JSON.parse(raw) as Receipt
          // Construction recovery uses room activity; an old browser receipt must
          // not replace a newer request accepted in another tab.
          if (receipt.operation === "native-sync" && receipt.jobId) void api.job(receipt.jobId).then(async (value) => { if (active) { setJob(value); if (terminal.has(value.state)) { const fresh = await api.nativeSnapshot(projectId); if (active) setSnapshot(fresh) } } }).catch(() => undefined)
          else if (receipt.operation === "native-sync") void api.commandReceipt(projectId, receipt.operation, receipt.key).then(async ({ job: found }) => { if (active && found) { setJob(found); localStorage.setItem(receiptKey, JSON.stringify({ ...receipt, jobId: found.id })); if (terminal.has(found.state)) { const fresh = await api.nativeSnapshot(projectId); if (active) setSnapshot(fresh) } } }).catch(() => undefined)
        }
      } catch { /* A malformed local receipt cannot change server state. */ }
    }).catch((cause: unknown) => { if (active) { setLoading(false); setError(cause instanceof Error ? cause.message : "Unable to load native construction") } })
    return () => { active = false; roomActiveRef.current = false }
  }, [projectId, receiptKey])

  useEffect(() => {
    if (draftProjectId !== projectId) return
    localStorage.setItem(nativeDraftKey(projectId), JSON.stringify({ headId: snapshot?.currentRevisionId ?? null, direction, profile, targetPartId, targetSectionId, protectedPartIds, sourceIds }))
  }, [draftProjectId, projectId, snapshot?.currentRevisionId, direction, profile, targetPartId, targetSectionId, protectedPartIds, sourceIds])

  useEffect(() => {
    if (!current?.id || !direction.trim()) { setPreservationPreview(null); return }
    const controller = new AbortController()
    const timer = window.setTimeout(() => { void api.nativePreservationPreview(projectId, direction, current.id, targetSectionId, controller.signal).then((value) => { if (!controller.signal.aborted) setPreservationPreview(value) }).catch(() => { if (!controller.signal.aborted) setPreservationPreview(null) }) }, 380)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [projectId, current?.id, direction, targetSectionId])

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => { void api.nativeCapabilities(capabilityQuery).then((value) => { if (active) setCapabilities(value.matches) }).catch(() => undefined) }, 180)
    return () => { active = false; window.clearTimeout(timer) }
  }, [capabilityQuery])

  // One activity subscription coordinates job, head and confirmed draft refreshes.
  useEffect(() => {
    const page = activity.state
    if (!page || loading || draftProjectId !== projectId) return
    if (page.job && window.location.pathname.endsWith("/start")) navigateSession(projectId, "arrange", true)
    if (page.job) setJob((prior) => prior?.kind === "native-sync" && !terminal.has(prior.state) ? prior : page.job)
    let active = true
    if (page.headId !== snapshot?.currentRevisionId) void api.nativeSnapshot(projectId).then((fresh) => {
      if (!active) return
      const prior = pendingCompare.current
      setSnapshot(fresh)
      if (prior && prior.jobId === page.job?.id && page.job.state === "succeeded" && fresh.currentRevisionId && fresh.currentRevisionId !== prior.baseId) {
        setComparePair({ beforeId: prior.baseId, afterId: fresh.currentRevisionId }); setCompareSectionId(prior.sectionId); setCompareMode("changes"); setReplay(0); setComparePartId(null); setShowUnchanged(false); setCompareOpen(true)
      }
      pendingCompare.current = null
      const reconciled = reconcileNativeDraft({ headId: snapshot?.currentRevisionId ?? null, direction: directionRef.current, targetPartId, targetSectionId, protectedPartIds, sourceIds, profile }, fresh, assetsRef.current)
      setDirection(reconciled.draft.direction); setTargetPartId(reconciled.draft.targetPartId); setTargetSectionId(reconciled.draft.targetSectionId); setProtectedPartIds(reconciled.draft.protectedPartIds); setSourceIds(reconciled.draft.sourceIds); setDraftNotices(directionRef.current.trim() ? reconciled.notices : [])
      setShowDraft(false); localStorage.removeItem(receiptKey); onProjectUpdated()
    }).catch(() => { if (active) setError("Unable to refresh the saved arrangement. Your work is safe; reconnect to continue.") })
    return () => { active = false }
  }, [activity.state?.headId, activity.state?.job?.id, activity.state?.job?.state, activity.state?.job?.stage, loading, draftProjectId])

  useEffect(() => {
    const page = activity.state
    const request = page?.job
    if (!request || request.state === "succeeded" || request.state === "cancelled") { setTentative(null); setTentativeError(null); return }
    let active = true
    void api.nativeDraft(projectId, request.id).then((view) => { if (active) { setTentative((prior) => prior?.jobId === view.jobId && prior.stepCount > view.stepCount ? prior : view); setTentativeError(null) } }).catch(() => { if (active) setTentativeError("Work in progress is temporarily unavailable. Your saved arrangement is unchanged.") })
    return () => { active = false }
  }, [projectId, activity.state?.job?.id, activity.state?.job?.state, activity.state?.draft?.hash])

  // Remote copying is deliberately separate from musical construction.
  useEffect(() => {
    if (!job || job.kind !== "native-sync" || terminal.has(job.state)) return
    let active = true
    const timer = window.setInterval(() => void api.job(job.id).then(async (next) => {
      if (!active) return
      setJob(next)
      if (terminal.has(next.state)) { const fresh = await api.nativeSnapshot(projectId); if (active) setSnapshot(fresh) }
    }).catch(() => undefined), 1_500)
    return () => { active = false; window.clearInterval(timer) }
  }, [job?.id, job?.state, projectId])

  const activeJob = job && !terminal.has(job.state) ? job : null
  const selectedSection = current?.document.sections.find((section) => section.id === targetSectionId)
  const selectedPart = current?.document.parts.find((part) => part.id === targetPartId)
  const detailsPart = current?.document.parts.find((part) => part.id === detailsPartId)
  const detailsGroup = detailsPart?.groupId ? current?.document.groups?.find((group) => group.id === detailsPart.groupId) : undefined
  const beforeVersion = snapshot?.versions.find((value) => value.id === comparePair?.beforeId) ?? null
  const afterVersion = snapshot?.versions.find((value) => value.id === comparePair?.afterId) ?? null
  const compareSection = beforeVersion?.document.sections.find((value) => value.id === compareSectionId) ?? beforeVersion?.document.sections[0] ?? null
  const comparison = useMemo(() => compareOpen && beforeVersion && afterVersion && compareSection ? compareScoreSection(beforeVersion.document, afterVersion.document, compareSection.id) : null, [compareOpen, beforeVersion, afterVersion, compareSection])
  const partName = (id: string) => current?.document.parts.find((part) => part.id === id)?.name ?? beforeVersion?.document.parts.find((part) => part.id === id)?.name ?? id
  const focusDirection = useCallback(() => { setWorkspaceView("producer"); setSoundsOpen(false); setPartsOpen(false); setPanel(null); window.setTimeout(() => document.getElementById("native-direction")?.focus(), 100) }, [])
  const keepPart = useCallback((id: string) => { setTargetPartId((prior) => prior === id ? null : prior); setProtectedPartIds((prior) => prior.includes(id) ? prior.filter((value) => value !== id) : [...prior, id]) }, [])
  const changeSection = useCallback((id: string | null) => { setTargetSectionId(id); focusDirection() }, [focusDirection])
  const changePart = useCallback((id: string) => { setTargetPartId(id); setTargetSectionId(viewSectionId); focusDirection() }, [viewSectionId, focusDirection])
  const suggest = (value: string) => { setDirection(value); window.requestAnimationFrame(focusDirection) }
  const searchLibrary = async () => {
    if (!libraryQuery.trim() || libraryBusy) return
    setLibraryBusy(true); setLibrarySearched(false); setLibraryError(null); setLibraryResults([])
    try {
      if (libraryKind === "samples") {
        const result = await api.searchLibrarySamples(libraryQuery.trim())
        setLibraryResults(result.samples.map((sample) => ({ name: sample.name, displayName: sample.displayName, ownerName: sample.ownerName, detail: `${sample.durationSeconds.toFixed(1)} seconds · ${sample.sampleKind}` })))
      } else {
        const result = await api.searchLibraryPresets(libraryKind, libraryQuery.trim())
        setLibraryResults(result.presets.map((preset) => ({ name: preset.name, displayName: preset.displayName, ownerName: preset.ownerName, detail: `${preset.deviceType} preset` })))
      }
    } catch (cause) { setLibraryError(cause instanceof Error ? cause.message : "Unable to search Audiotool's library") }
    finally { setLibraryBusy(false); setLibrarySearched(true) }
  }
  const chooseLibrary = (item: { name: string; displayName: string }) => {
    setDirection((prior) => `${prior.trim()}\nConsider the Audiotool ${libraryKind === "samples" ? "sample" : "preset"} “${item.displayName}” (${item.name}); inspect it before use.`)
    window.requestAnimationFrame(focusDirection)
  }
  const syncState = snapshot?.synchronization.state ?? "local"
  const syncMessage = currentRemoteVerification ? `Editable copy confirmed in Audiotool ${snapshot?.synchronization.verifiedAt ? `on ${new Date(snapshot.synchronization.verifiedAt).toLocaleDateString()}` : ""}. Recheck before relying on later Studio changes.`
    : syncState === "conflict" ? "The Audiotool copy changed. This room will not overwrite it automatically."
      : syncState === "uncertain" || syncState === "needs_attention" ? "We need to check the earlier Audiotool action before trying again."
        : syncState === "applying" ? "Preparing the editable Audiotool copy…"
          : audiotoolAvailable ? "Saved in this room. An Audiotool copy has not been verified for this version." : "Saved in this room. Audiotool connection is not set up for this installation."

  const submit = async (freshAttempt = false) => {
    if (!direction.trim() || busy || activeJob || activity.state?.actions.canSubmit === false || draftNotices.length) return
    const head = snapshot?.currentRevisionId ?? null
    const operation: Receipt["operation"] = head ? "native-revision" : "native-generation"
    const signature = JSON.stringify({ operation, head, direction: direction.trim(), profile, targetPartId, targetSectionId, protectedPartIds: [...protectedPartIds].sort(), sourceIds: [...sourceIds].sort() })
    const storageKey = `pocket-producer:native-command:${projectId}:${signature}`
    const key = freshAttempt ? crypto.randomUUID() : localStorage.getItem(storageKey) ?? crypto.randomUUID()
    localStorage.setItem(storageKey, key)
    const receipt: Receipt = { operation, key, jobId: null, signature }
    localStorage.setItem(receiptKey, JSON.stringify(receipt))
    const acceptRequest = async (accepted: Job) => {
      if (!stillInProject()) return
      if (head) pendingCompare.current = { projectId, jobId: accepted.id, baseId: head, sectionId: targetSectionId }
      localStorage.setItem(receiptKey, JSON.stringify({ ...receipt, jobId: accepted.id }))
      setJob(accepted); setDirection(""); directionRef.current = ""; setWorkspaceView("producer"); setDraftNotices([]); setError(null)
      navigateSession(projectId, "arrange", true)
      window.requestAnimationFrame(() => document.getElementById("workspace-title")?.focus())
      if (!terminal.has(accepted.state)) return
      const fresh = await api.nativeSnapshot(projectId)
      if (!stillInProject()) return
      setSnapshot(fresh)
      if (accepted.state !== "succeeded") return
      if (head && fresh.currentRevisionId && fresh.currentRevisionId !== head) {
        setComparePair({ beforeId: head, afterId: fresh.currentRevisionId }); setCompareSectionId(targetSectionId); setCompareMode("changes"); setCompareOpen(true)
      }
      pendingCompare.current = null
      const reset = freshNativeDraft(fresh)
      setTargetPartId(null); setTargetSectionId(null); setProtectedPartIds(reset.protectedPartIds); setSourceIds([]); setDraftNotices([])
      localStorage.removeItem(receiptKey)
    }
    setBusy(true); setError(null)
    try {
      if (head) { const preview = await api.nativePreservationPreview(projectId, direction.trim(), head, targetSectionId); if (!stillInProject()) return; setPreservationPreview(preview); if (preview.unresolved.length) throw new Error(preview.unresolved.join(". ")) }
      const savedProtections = current?.document.protectedPartIds ?? []
      const protectionChanged = JSON.stringify([...savedProtections].sort()) !== JSON.stringify([...protectedPartIds].sort())
      const result = head ? await api.reviseNative(projectId, { direction: direction.trim(), profile, baseNativeRevisionId: head, expectedNativeHeadId: head, ...(targetPartId ? { targetPartId } : {}), ...(targetSectionId ? { targetSectionId } : {}), ...(protectionChanged ? { protectionChange: { expectedPartIds: savedProtections, desiredPartIds: protectedPartIds } } : {}), sourceAssetIds: sourceIds }, key) : await api.constructNative(projectId, direction.trim(), sourceIds, key, profile)
      if (!stillInProject()) return
      await acceptRequest(await api.job(result.jobId))
    } catch (cause) {
      if (!stillInProject()) return
      // Resolve a lost acknowledgement, never issue a fresh paid request to recover it.
      const recovered = await api.commandReceipt(projectId, operation, key).catch(() => null)
      if (!stillInProject()) return
      if (recovered?.job) {
        await acceptRequest(recovered.job)
      } else setError(cause instanceof Error ? cause.message : "The request could not be confirmed. Your idea is still here; retrying checks the same request.")
    }
    finally { if (stillInProject()) setBusy(false) }
  }

  const openComparison = (versionId?: string) => {
    if (!snapshot?.current) return
    const selected = snapshot.versions.find((version) => version.id === versionId) ?? snapshot.current
    const other = selected.id === snapshot.current.id ? snapshot.versions.find((version) => version.id === selected.parentRevisionId) ?? snapshot.versions.find((version) => version.id !== selected.id) : snapshot.current
    if (!other) return
    const [before, after] = other.ordinal < selected.ordinal ? [other, selected] : [selected, other]
    setReplay(0); setComparePartId(null); setShowUnchanged(false)
    setCompareId(selected.id); setComparePair({ beforeId: before.id, afterId: after.id }); setCompareSectionId(targetSectionId ?? before.document.sections[0]?.id ?? null); setCompareMode("changes"); setCompareOpen(true)
  }

  const reviewActivityVersion = useCallback((id: string) => {
    const after = snapshot?.versions.find((version) => version.id === id)
    const before = snapshot?.versions.find((version) => version.id === after?.parentRevisionId)
    if (!before || !after) return
    setComparePair({ beforeId: before.id, afterId: after.id }); setCompareSectionId(before.document.sections[0]?.id ?? null); setCompareMode("changes"); setReplay(0); setComparePartId(null); setShowUnchanged(false); setCompareOpen(true)
  }, [snapshot])

  const selectComparedVersion = async (revisionId: string) => {
    if (!snapshot?.currentRevisionId || busy || !snapshot.versions.some((version) => version.id === revisionId)) return
    if (revisionId === snapshot.currentRevisionId) { setCompareOpen(false); return }
    setBusy(true); setError(null)
    try {
      await api.selectNativeVersion(projectId, revisionId, snapshot.currentRevisionId)
      const fresh = await api.nativeSnapshot(projectId)
      if (!stillInProject()) return
      const restored = reconcileNativeDraft({ headId: snapshot.currentRevisionId, direction, targetPartId, targetSectionId, protectedPartIds, sourceIds }, fresh, assets)
      setSnapshot(fresh); setDirection(restored.draft.direction); setTargetPartId(restored.draft.targetPartId); setTargetSectionId(restored.draft.targetSectionId); setProtectedPartIds(restored.draft.protectedPartIds); setSourceIds(restored.draft.sourceIds); setDraftNotices(restored.notices); setCompareOpen(false)
    } catch (cause) { if (stillInProject()) { setError(cause instanceof Error ? cause.message : "The selected version changed; refresh and compare again"); const fresh = await api.nativeSnapshot(projectId); if (stillInProject()) setSnapshot(fresh) } }
    finally { if (stillInProject()) setBusy(false) }
  }

  const synchronize = async () => {
    if (!current || busy || activeJob) return
    const key = crypto.randomUUID()
    localStorage.setItem(receiptKey, JSON.stringify({ operation: "native-sync", key, jobId: null, signature: current.id } satisfies Receipt))
    setBusy(true); setError(null); setTentative(null); setTentativeError(null)
    try {
      const accepted = await api.syncNative(projectId, current.id, key)
      localStorage.setItem(receiptKey, JSON.stringify({ operation: "native-sync", key, jobId: accepted.jobId, signature: current.id } satisfies Receipt))
      const state = await api.job(accepted.jobId)
      setJob(state)
      if (terminal.has(state.state)) { setSnapshot(await api.nativeSnapshot(projectId)); if (state.state === "succeeded") localStorage.removeItem(receiptKey) }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to start native synchronization") }
    finally { setBusy(false) }
  }

  const continuePartial = async () => {
    if (!job || job.error_code !== "NATIVE_PARTIAL" || busy) return
    setBusy(true); setError(null)
    try { await api.continueNative(projectId, job.id); setJob(await api.job(job.id)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to continue this saved draft") }
    finally { setBusy(false) }
  }

  const extendPartial = async () => {
    if (!job || job.error_code !== "NATIVE_PARTIAL" || !tentative?.canExtend || busy) return
    const requested = Object.fromEntries(Object.entries(extension).filter(([, value]) => value.trim() !== "").map(([field, value]) => [field, Number(value)])) as NonNullable<Parameters<typeof api.extendNative>[2]>
    if (!Object.keys(requested).length && tentative.runLimits?.profile === "extended") { setError("Choose at least one request limit to increase."); return }
    setBusy(true); setError(null)
    try {
      await api.extendNative(projectId, job.id, requested)
      setTentative(await api.nativeDraft(projectId, job.id))
      setExtension({ maxCalls: "", maxInputTokens: "", maxOutputTokens: "", deadlineSeconds: "", maxJobCostUsd: "" })
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to increase this request's limits") }
    finally { setBusy(false) }
  }

  const inWorkspace = Boolean(current || job || activity.state?.job)
  const draftVisible = Boolean(tentative?.document && (!current || showDraft))
  const statusText = activeJob && activeJob.kind !== "native-sync" ? jobProgress(activeJob) : activity.state?.actions.issue ? "Needs your attention" : current ? "Ready to shape" : "Your idea, taking shape"
  const composer = (<section className="direction-section" aria-labelledby="direction-heading"><div className="section-heading"><div><h2 id="direction-heading">{activeJob ? "Your next direction" : current ? "What would you like to change?" : "Your direction"}</h2><p>{current ? `${selectedSection ? `In ${selectedSection.name}` : "Across the whole piece"} · ${selectedPart ? `change ${selectedPart.name}` : "choose any part"}${protectedPartIds.length ? ` · keep ${protectedPartIds.map(partName).join(", ")} unchanged` : ""}` : "Describe a mood, rhythm, instrument or moment. A detailed brief is welcome; recordings are optional."}</p></div></div>{draftNotices.length ? <div className="job-status" role="status">{draftNotices.map((notice) => <p key={notice}>{notice}</p>)}<Button size="sm" variant="outline" onClick={() => setDraftNotices([])}>I reviewed the updated scope</Button></div> : null}<form className="composer native-composer" onSubmit={(event) => { event.preventDefault(); void submit() }}><label htmlFor="native-direction" className="sr-only">Describe your arrangement</label><Textarea id="native-direction" value={direction} maxLength={32_768} onChange={(event) => setDirection(event.target.value)} placeholder={current ? "For example: In this section, thin the drums and shorten the ambience, but keep the theme and bass." : "For example: A slow, spacious instrumental with a clear melody."} disabled={busy} /><details className="creation-options"><summary>Creation options</summary><div className="native-brief-options"><span>{direction.length.toLocaleString()} / 32,768 characters</span><label htmlFor="native-profile">Depth <select id="native-profile" value={profile} onChange={(event) => setProfile(event.target.value as "standard" | "extended")} disabled={Boolean(activeJob)}><option value="standard">Standard — focused arrangement</option><option value="extended">Extended — detailed composition</option></select></label></div></details><p className="request-cost">{activity.state ? `Up to US$${(profile === "extended" ? activity.state.allowance.extendedUsd : activity.state.allowance.standardUsd).toFixed(2)} available for this request within your overall allowance. Unconfirmed charges may reduce this.` : "Checking your available allowance…"}</p><div className="composer-actions"><div className="chips"><span className="chip"><Sparkles className="mr-1 size-3" /> {current ? selectedSection?.name ?? "Whole piece" : "New arrangement"}</span>{selectedPart ? <span className="chip">{selectedPart.name}</span> : null}{protectedPartIds.length ? <span className="chip"><ShieldCheck className="mr-1 size-3" /> Keep {protectedPartIds.length} {protectedPartIds.length === 1 ? "part" : "parts"}</span> : null}{sourceIds.length ? <span className="chip">{sourceIds.length} {sourceIds.length === 1 ? "sound" : "sounds"} selected</span> : null}</div><Button type="submit" disabled={busy || Boolean(activeJob) || !activity.state?.actions.canSubmit || draftNotices.length > 0 || direction.trim().length < 3}><Sparkles className="size-4" /> {busy ? "Starting…" : activeJob ? "Not sent yet" : current ? "Make this change" : "Create arrangement"} <ArrowRight className="size-4" /></Button></div></form>{current && preservationPreview?.revisionId === current.id && (preservationPreview.namedParts.length || preservationPreview.theme || preservationPreview.unresolved.length) ? <div className="preservation-preview" role="status"><strong>For this change, we'll keep:</strong> {preservationPreview.namedParts.map((item) => item.name).join(", ")}{preservationPreview.theme ? `${preservationPreview.namedParts.length ? " · " : ""}${preservationPreview.theme.label} theme phrase` : ""}{preservationPreview.unresolved.length ? <p role="alert">{preservationPreview.unresolved.join(". ")}. Name the part or phrase before sending.</p> : <p>These named parts and phrases are checked against the saved version before a result can be accepted.</p>}</div> : null}{current || activeJob ? <p className="section-footnote">{current ? "A successful change becomes the current version automatically. Comparing is read-only; choosing another saved version is explicit." : ""} {activeJob ? "This draft is not queued. Send it after the current request finishes." : ""}</p> : null}</section>)
  const producer = <section className="producer-panel" aria-label="Producer"><div className="producer-heading"><h2>Producer</h2><span>One direction at a time</span></div>{current || tentative?.document ? <Button className="producer-view-arrangement" variant="ghost" onClick={() => setWorkspaceView("arrangement")}>View arrangement <ArrowRight size={14} /></Button> : null}<ProducerFeed events={activity.events} connection={activity.connection} older={activity.older} onOlder={() => void activity.loadOlder().catch(() => setError("Earlier activity could not be loaded."))} onLatest={activity.closeOlder} historyBusy={activity.historyBusy} onCompare={reviewActivityVersion} />{activeJob && activeJob.kind !== "native-sync" ? <div className="producer-current" role="status"><strong>{jobProgress(activeJob)}</strong><p>Your request continues if you leave this room.</p><Button size="sm" variant="outline" disabled={!activity.state?.actions.canStop} onClick={() => void api.cancel(activeJob.id).then(() => api.job(activeJob.id)).then(setJob).catch(() => setError("Unable to stop the request. Check your connection and try again."))}>Stop this request</Button></div> : null}{job && job.kind !== "native-sync" && terminal.has(job.state) && job.state !== "succeeded" ? <div className="job-status" role="alert">
      <strong>{job.error_code === "NATIVE_PARTIAL" ? "This arrangement is still in progress" : job.state === "needs_attention" ? "This request needs your attention" : job.state === "cancelled" ? "Request stopped" : "We couldn't finish that change"}</strong>
      <span>{job.error_code === "NATIVE_PARTIAL" ? "Your work in progress is saved. Your current version has not been replaced." : friendlyIssue(job.error_message, "Your saved work is safe.")}</span>
      {job.error_code === "NATIVE_PARTIAL" ? <>
{tentative?.canContinue ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void continuePartial()}>Continue saved draft</Button> : null}<Button size="sm" variant="outline" onClick={() => setPanel("usage")}>Review usage & next steps</Button>
      </> : ["failed", "cancelled"].includes(job.state) && activity.state?.actions.canSubmit ? <Button className="mt-3" variant="outline" size="sm" onClick={() => void submit(true)} disabled={busy || !direction.trim()}>Send as a new request</Button> : <p className="provider-note">A new request is paused until the earlier outcome is known.</p>}
      {job.error_message ? <details className="room-technical"><summary>Technical details</summary><p>{job.error_message}</p></details> : null}
    </div> : null}{job && tentative?.plan && tentative.jobId === job.id && job.state !== "succeeded" ? <details className="producer-approach"><summary>Musical approach</summary><div className="section-heading"><div><h2>Where your music is heading</h2><p>{tentative.plan.stage === "planned" ? "Planning the piece" : tentative.plan.stage === "building" ? "Building the arrangement" : tentative.plan.stage === "refining" ? "Adding detail" : "Reviewing the structure"} · saved with this request</p></div></div><p>{tentative.plan.plan.intent}</p><ol>{tentative.plan.plan.sections.map((section, index) => <li key={`${section.name}-${index}`}><strong>{section.name}</strong> — {section.purpose}</li>)}</ol>{tentative.plan.plan.developmentTasks.length ? <p><strong>Still to develop:</strong> {tentative.plan.plan.developmentTasks.join(" · ")}</p> : null}<p className="section-footnote">This is a construction plan, not accepted music or a playable preview.</p></details> : null}{composer}</section>
  if (loading) return <div className="empty-surface" role="status">Opening your arrangement…</div>
  return <div className={`native-room producer-room ${inWorkspace ? "is-workspace" : "is-start"} view-${workspaceView}`}>
    {inWorkspace ? <header className="producer-workspace-header"><div><p className="workspace-state" role="status">{statusText}</p><h1 id="workspace-title" tabIndex={-1}>{current?.document.title ?? tentative?.document?.title ?? "Your new arrangement"}</h1><p>{current ? `Version ${current.ordinal} · ${current.document.bars} bars · ${current.document.parts.length} parts` : "Work in progress · saved as you go"}</p></div><span className="playback-boundary"><Headphones size={15} /> Playback not available yet{legacyVersionCount ? <button className="text-link" onClick={onLegacy}>Separate playable audio</button> : null}</span></header> : <RoomHero status="A fresh start" title="What would you like to make?" description="Start with a mood, a moment or a detailed vision. We’ll build an editable arrangement you can keep shaping." meta="Your idea first · Sounds are optional" />}
    {error ? <div className="job-status" role="alert"><strong>That action couldn't finish</strong><span>{friendlyIssue(error, "Your saved work is unchanged. Check the action and try again.")}</span><details><summary>Details</summary><p>{error}</p></details></div> : null}
    {inWorkspace ? <>
      <nav className="workspace-toolbar" aria-label="Session tools"><Button variant="outline" onClick={() => setSoundsOpen(true)}>Sounds & tools</Button>{current ? <Button variant="outline" onClick={() => setPartsOpen(true)}>Manage parts</Button> : null}<Button variant="outline" onClick={() => setPanel("history")}>Version history</Button><Button variant="ghost" onClick={() => setPanel("usage")}>Usage</Button><Button variant="ghost" onClick={() => setPanel("audiotool")}>Audiotool{["conflict", "uncertain", "needs_attention"].includes(syncState) ? " · Needs review" : ""}</Button></nav>
      <div className="workspace-view-switch" role="group" aria-label="Workspace view"><Button variant={workspaceView === "arrangement" ? "default" : "outline"} aria-pressed={workspaceView === "arrangement"} onClick={() => setWorkspaceView("arrangement")}>Arrangement</Button><Button variant={workspaceView === "producer" ? "default" : "outline"} aria-pressed={workspaceView === "producer"} onClick={() => setWorkspaceView("producer")}>Producer</Button></div>
      <div className="producer-workspace-grid"><section className="producer-canvas" aria-label="Arrangement workspace">{tentative?.document && current ? <div className="draft-choice" role="group" aria-label="Arrangement to inspect"><Button size="sm" variant={!showDraft ? "default" : "outline"} aria-pressed={!showDraft} onClick={() => setShowDraft(false)}>Saved arrangement</Button><Button size="sm" variant={showDraft ? "default" : "outline"} aria-pressed={showDraft} onClick={() => setShowDraft(true)}>View work in progress</Button></div> : null}{draftVisible ? <>{job && tentative?.document && tentative.jobId === job.id && job.state !== "succeeded" ? <section className="native-section native-draft-preview" aria-label="Unfinished arrangement preview">
      <div className="section-heading"><div><h2>Work in progress</h2><p>Not your current version · {tentative.stepCount} confirmed {tentative.stepCount === 1 ? "change" : "changes"}</p></div></div>
      <p>{tentative.document.bars} bars · {tentative.document.sections.length} sections · {tentative.document.parts.length} parts. Only saved musical changes appear below.</p>
      <NativeScore document={tentative.document} identity={`${projectId}:${tentative.jobId}:${tentative.documentHash}:${tentative.stepCount}`} selectedSectionId={draftSectionId} onSelectSection={setDraftSectionId} selectedPartId={draftPartId} onInspectPart={setDraftPartId} animateConfirmed motionScope={`${projectId}:${tentative.jobId}`} confirmedStepCount={tentative.stepCount} draft />
      <p className="section-footnote">This unfinished arrangement has not replaced your saved version.</p>
    </section> : null}</> : current ? <section className="native-section arrangement-section" aria-labelledby="arrangement-heading"><div className="section-heading"><div><h2 id="arrangement-heading">Your arrangement</h2><p>Explore a section or part. Choose “Change” when you're ready to shape it.</p></div><Button variant="outline" size="sm" onClick={() => { setTargetSectionId(null); focusDirection() }}>Change whole piece</Button></div><NativeScore key={projectId} document={current.document} identity={`${projectId}:${current.id}:${current.documentHash}`} selectedSectionId={viewSectionId} onSelectSection={setViewSectionId} selectedPartId={inspectedPartId} onInspectPart={setInspectedPartId} onChangeSection={changeSection} onChangePart={changePart} onKeepPart={keepPart} protectedPartIds={protectedPartIds} /></section> : <section className="producer-empty-score"><Music2 size={32} /><h2>The first musical shape is on its way</h2><p>The producer will save sections and parts here as they are built. Follow the conversation for confirmed progress.</p><Button variant="outline" onClick={() => setWorkspaceView("producer")}>Follow Producer</Button></section>}{tentativeError ? <p role="status">{tentativeError}</p> : null}</section>{producer}</div>
    </> : <section className="session-start-form">{composer}<div className="start-sounds"><Button variant="outline" onClick={() => setSoundsOpen(true)}><Plus size={16} /> Add a sound</Button><span>{sourceIds.length ? `${sourceIds.length} sounds selected` : "Optional · your own recordings or samples"}</span></div><p className="section-footnote"><Headphones size={14} /> Creates editable music. Playback is not available yet.</p></section>}
    <Sheet open={soundsOpen || partsOpen || panel !== null} onOpenChange={(open) => { if (!open) { setSoundsOpen(false); setPartsOpen(false); setPanel(null) } }}>
      <SheetContent className="workspace-tool-sheet"><SheetHeader><SheetTitle>{soundsOpen ? "Sounds & tools" : partsOpen ? "Parts & instruments" : panel === "history" ? "Version history" : panel === "usage" ? "Usage & next steps" : "Your Audiotool copy"}</SheetTitle><SheetDescription>{soundsOpen ? "Choose sounds for your next direction. Nothing is sent until you ask." : panel === "history" ? "Successful changes become current automatically. Comparing does not select a version." : panel === "audiotool" ? "Your local arrangement and the Audiotool copy are separate." : "Your saved versions stay safe."}</SheetDescription></SheetHeader><div className="workspace-tool-body">
      {soundsOpen ? <div className="workspace-side">
        <section className="side-section"><div className="section-heading"><h2>Your sounds</h2><Button size="sm" variant="outline" onClick={onAddSource}><Plus className="size-4" /> Add</Button></div>{assets.length ? <div className="source-card-list">{assets.map((asset) => <div className="source-card" key={asset.id}><button type="button" className="source-play" aria-label={`Play sound ${asset.name}`} onClick={() => onAuditionSource(asset.id)}><Play className="size-4" /></button><div className="source-card-name"><strong>{asset.name}</strong><small>{Math.round(asset.durationSeconds)} seconds · your sound</small></div><label className="source-select"><input type="checkbox" aria-label={`Use ${asset.name} in the next arrangement change`} checked={sourceIds.includes(asset.id)} onChange={(event) => setSourceIds((prior) => event.target.checked ? [...prior, asset.id] : prior.filter((value) => value !== asset.id))} /><span className="sr-only">Use in the next change</span></label></div>)}</div> : <p className="side-empty">Add or record a WAV if you want the producer to work with your own sound.</p>}{sourcePreview}<p className="side-note">Selected sounds may be placed in the arrangement. Placement alone does not confirm how they will sound.</p></section>
        <section className="side-section"><div className="section-heading"><h2>Sounds & instruments</h2></div><p className="side-note">Explore the kinds of parts we can shape. These aren't playable presets.</p><div className="sound-family-list"><div><span className="family-icon rhythm">▥</span><span><strong>Drums</strong><small>Patterns and pulse</small></span></div><div><span className="family-icon bass">〰</span><span><strong>Bass</strong><small>Low-end movement</small></span></div><div><span className="family-icon keys">▦</span><span><strong>Keys & pads</strong><small>Harmony and atmosphere</small></span></div><div><span className="family-icon lead">⌁</span><span><strong>Leads</strong><small>Melodies and responses</small></span></div><div><span className="family-icon effects">✳</span><span><strong>Effects</strong><small>Space, motion and dynamics</small></span></div></div><details className="native-palette"><summary>Explore detailed capabilities</summary><p className="side-note">This reference includes capabilities that may not yet be available for construction.</p><label className="native-search"><Search className="size-4" /><span className="sr-only">Search detailed capabilities</span><input value={capabilityQuery} onChange={(event) => setCapabilityQuery(event.target.value)} placeholder="Find instruments or effects" /></label><div className="native-capability-grid">{capabilities.slice(0, 12).map((item) => <div key={item.type} className="native-capability"><strong>{item.type}</strong><span>{item.family}</span><small>{item.purpose}</small><small>{item.writableInPocketProducer ? "Available for construction" : "Reference only"}</small></div>)}</div></details></section>
        <section className="side-section inspiration-section"><h2>Need inspiration?</h2><p className="side-note">Choose a starting point, then make it your own.</p><div className="suggestion-list">{(current ? [`Build more energy in ${current.document.sections[Math.min(1, current.document.sections.length - 1)]?.name ?? "the middle"}`, `Make ${current.document.sections[0]?.name ?? "the opening"} more minimal`, `Give ${current.document.parts.find((part) => part.role === "melody")?.name ?? "the melody"} a new response`] : ["A calm opening that grows into a pulse", "A sparse rhythm with a memorable melody", "An atmospheric piece with contrasting sections"]).map((prompt) => <button key={prompt} type="button" onClick={() => suggest(prompt)}>{prompt}<ArrowRight className="size-4" /></button>)}</div></section>
        <section className="side-section native-library-section"><h2>Audiotool sound library</h2><p className="side-note">Search real sample and instrument-preset metadata. A choice becomes a request to the producer; it is checked again before use and is not an audio preview or license guarantee.</p>{audiotoolConnected ? <>
          <form onSubmit={(event) => { event.preventDefault(); void searchLibrary() }}>
            <label htmlFor="native-library-kind">Find</label><select id="native-library-kind" value={libraryKind} onChange={(event) => { setLibraryKind(event.target.value as typeof libraryKind); setLibraryResults([]); setLibrarySearched(false) }}><option value="samples">Samples</option><option value="heisenberg">Synth presets</option><option value="pulverisateur">Analog synth presets</option><option value="gakki">Sampler presets</option><option value="beatbox8">Drum machine presets</option></select>
            <label htmlFor="native-library-query">Sound or mood</label><input id="native-library-query" value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} maxLength={80} placeholder="Try glass, soft drums, texture…" />
            <Button type="submit" size="sm" variant="outline" disabled={libraryBusy || !libraryQuery.trim()}>{libraryBusy ? "Searching…" : "Search library"}</Button>
          </form>
          {libraryError ? <p role="alert" className="side-note">{libraryError}</p> : null}
          {librarySearched && !libraryError && !libraryResults.length ? <p role="status" className="side-note">No matching sounds found. Try another description.</p> : null}
          {libraryResults.length ? <ul className="native-library-results">{libraryResults.map((item) => <li key={item.name}><div><strong>{item.displayName}</strong><small>{item.detail} · {item.ownerName}</small></div><Button size="sm" variant="outline" onClick={() => chooseLibrary(item)}>Ask to use</Button></li>)}</ul> : null}
        </> : <p className="side-note">Connect Audiotool to browse its sound library. Your own uploaded sounds remain available separately.</p>}</section>
</div> : null}
      {partsOpen && current ? <>          <section className="native-section parts-section" aria-labelledby="parts-heading">
            <div className="section-heading"><div><h2 id="parts-heading">Parts & instruments</h2><p>Choose one part to change, or let the producer decide.</p></div><Button variant="outline" size="sm" aria-pressed={targetPartId === null} onClick={() => setTargetPartId(null)}>Any part</Button></div>
            {current.document.parts.length > 8 ? <div className="native-role-filters" role="group" aria-label="Filter parts by role">{["all", ...partRoles].map((role) => <Button key={role} size="sm" variant={roleFilter === role ? "default" : "outline"} aria-pressed={roleFilter === role} onClick={() => { setRoleFilter(role); setPartLimit(8) }}>{role === "all" ? `All (${current.document.parts.length})` : `${role} (${current.document.parts.filter((part) => part.role === role).length})`}</Button>)}</div> : null}
            <div className="native-part-grid">{visibleParts.map((part) => { const kept = protectedPartIds.includes(part.id); return <article key={part.id} className={`native-part-card ${targetPartId === part.id ? "is-target" : ""} ${kept ? "is-kept" : ""}`}><span className="native-part-role">{part.role}</span><h3>{part.name}</h3><p>{readableDevice(part.device.type)} · {part.placements.length} {part.placements.length === 1 ? "phrase" : "phrases"}{part.sourceRegions.length ? ` · ${part.sourceRegions.length} owned ${part.sourceRegions.length === 1 ? "clip" : "clips"}` : ""}{part.libraryRegions?.length ? ` · ${part.libraryRegions.length} library ${part.libraryRegions.length === 1 ? "clip" : "clips"}` : ""}</p><div className="part-card-actions"><Button size="sm" variant={targetPartId === part.id ? "default" : "outline"} aria-label={`Change ${part.name}`} aria-pressed={targetPartId === part.id} disabled={kept} onClick={() => { setTargetPartId((prior) => prior === part.id ? null : part.id); focusDirection() }}>{targetPartId === part.id ? "Selected" : "Change"}</Button><Button size="sm" variant="ghost" onClick={() => setDetailsPartId(part.id)}>Details</Button><Button size="sm" variant="ghost" aria-label={`${kept ? "Allow changes to" : "Keep unchanged"} ${part.name} for the next change`} aria-pressed={kept} onClick={() => { if (!kept && targetPartId === part.id) setTargetPartId(null); setProtectedPartIds((prior) => kept ? prior.filter((value) => value !== part.id) : [...prior, part.id]) }}><LockKeyhole className="size-3" /> {kept ? "Kept" : "Keep"}</Button></div></article> })}</div>
            {filteredParts.length > visibleParts.length ? <Button className="mt-3" variant="outline" size="sm" onClick={() => setPartLimit((count) => count + 8)}>Show more parts ({filteredParts.length - visibleParts.length} remaining)</Button> : null}
            <p className="section-footnote">“Keep” protects a part when you submit your next change. You can allow changes again before submitting.</p>
          </section></> : null}
      {panel === "history" ? <>        <section className="native-section versions-section"><div className="section-heading"><div><h2>Saved versions</h2><p>{snapshot?.versions.length ? `${snapshot.versions.length} saved ${snapshot.versions.length === 1 ? "version" : "versions"}. Previewing a version never changes your current arrangement.` : "Your first saved arrangement will appear here."}</p></div><Button variant="outline" size="sm" onClick={() => openComparison()} disabled={!snapshot?.versions.length || snapshot.versions.length < 2}><GitCompareArrows className="size-4" /> Compare</Button></div>{current ? <p className="version-current"><Check className="size-4" /> Version {current.ordinal} is current · {arrangementSummary(current)}</p> : null}{snapshot && snapshot.versions.length > 1 ? <div className="version-quick-list">{snapshot.versions.slice(0, 6).map((version) => <button type="button" key={version.id} onClick={() => openComparison(version.id)}>Version {version.ordinal}{version.id === snapshot.currentRevisionId ? " · current" : ""}<span>{version.changeSummary}</span></button>)}</div> : null}</section></> : null}
      {panel === "usage" ? <><p>Available overall allowance: {activity.state ? `$${activity.state.allowance.remainingUsd.toFixed(2)}` : "checking…"}. Held and uncertain spending remain reserved.</p>        {tentative?.budget ? <p className="provider-note">This request: ${tentative.budget.spentUsd.toFixed(2)} used · ${tentative.budget.reservedUsd.toFixed(2)} held · ${tentative.budget.unknownUsd.toFixed(2)} awaiting provider confirmation · {tentative.budget.modelCalls} model calls. Installation allowance remaining: ${tentative.budget.siteRemainingUsd.toFixed(2)}. At least ${tentative.budget.minimumNextCallUsd.toFixed(2)} is needed to reserve another call.</p> : null}
        {tentative?.canContinue ? <Button className="mt-3" variant="outline" size="sm" onClick={() => void continuePartial()} disabled={busy}>Continue saved draft</Button> : <p className="provider-note">{tentative?.continuationReason ?? "Checking whether this draft can continue…"}</p>}
        {tentative?.canExtend && tentative.runLimits && tentative.extensionCeiling ? <div className="native-extension"><p className="provider-note">Increase this request's limits without discarding its plan, confirmed work or past spending. Leave fields empty to use Extended defaults for a Standard request. This cannot increase the installation-wide allowance.</p><div className="native-extension-fields">{([ ["maxCalls", "Model calls", 1], ["maxInputTokens", "Brief/context tokens", 1], ["maxOutputTokens", "Output tokens per call", 1], ["deadlineSeconds", "Runtime (seconds)", 1], ["maxJobCostUsd", "Request allowance (USD)", 0.01] ] as const).map(([field, label, step]) => <label key={field}>{label}<input type="number" min={tentative.runLimits![field]} max={tentative.extensionCeiling![field]} step={step} value={extension[field]} onChange={(event) => setExtension((prior) => ({ ...prior, [field]: event.target.value }))} placeholder={String(tentative.runLimits![field])} /></label>)}</div><Button className="mt-3" variant="outline" size="sm" onClick={() => void extendPartial()} disabled={busy}>Increase request limits</Button></div> : null}
{!tentative ? <p>Detailed request usage appears while work is active or paused. A new request does not reset past spending.</p> : null}</> : null}
      {panel === "audiotool" ? <><p>{syncMessage}</p>{snapshot?.synchronization.error ? <details><summary>Connection details</summary><p>{snapshot.synchronization.error}</p></details> : null}<Button disabled={!current || busy || Boolean(activeJob) || !audiotoolAvailable || ["conflict", "uncertain", "needs_attention", "applying"].includes(syncState)} onClick={() => audiotoolConnected ? void synchronize() : onConnectAudiotool()}>{audiotoolConnected ? "Copy to Audiotool" : "Connect Audiotool"}</Button></> : null}
      </div></SheetContent>
    </Sheet>

    <Dialog open={Boolean(detailsPart)} onOpenChange={(open) => { if (!open) setDetailsPartId(null) }}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto bg-popover p-6">
        <DialogHeader><DialogTitle className="font-heading text-2xl">{detailsPart?.name ?? "Part details"}</DialogTitle><DialogDescription>What this part contains in the editable arrangement. This is not an audio preview.</DialogDescription></DialogHeader>
        {detailsPart ? <div className="part-detail">
          <p><strong>Instrument:</strong> {readableDevice(detailsPart.device.type)}{detailsPart.device.preset ? ` · ${detailsPart.device.preset.displayName} preset` : ""}{detailsPart.device.preset && !detailsPart.device.preset.contentHash ? " · original sound settings unverified; reselect before copying to Audiotool" : ""}</p>
          <p><strong>Music:</strong> {detailsPart.notes.length} individual notes · {detailsPart.placements.length} phrase placements</p>
          {current?.document.motifs.filter((motif) => motif.partId === detailsPart.id).length ? <div><strong>Phrases</strong><ul>{current.document.motifs.filter((motif) => motif.partId === detailsPart.id).map((motif) => <li key={motif.id}>{motif.name} · {motif.notes.length} notes · {detailsPart.placements.filter((placement) => placement.motifId === motif.id).length} placements</li>)}</ul></div> : null}
          {detailsPart.notes.length ? <p><strong>Note range:</strong> MIDI {Math.min(...detailsPart.notes.map((note) => note.pitch))}–{Math.max(...detailsPart.notes.map((note) => note.pitch))} · <strong>Velocity:</strong> {Math.round(Math.min(...detailsPart.notes.map((note) => note.velocity)) * 100)}–{Math.round(Math.max(...detailsPart.notes.map((note) => note.velocity)) * 100)}%</p> : null}
          {detailsPart.sourceRegions.length || detailsPart.libraryRegions?.length ? <div><strong>Sound clips</strong><ul>{detailsPart.sourceRegions.map((region) => <li key={region.id}>Your sound · {region.sourceStartSeconds.toFixed(1)}–{(region.sourceStartSeconds + region.sourceDurationSeconds).toFixed(1)} seconds of source{clipTransform(region)}</li>)}{detailsPart.libraryRegions?.map((region) => <li key={region.id}>{region.displayName} · Audiotool library · {region.sourceStartSeconds.toFixed(1)}–{(region.sourceStartSeconds + region.sourceDurationSeconds).toFixed(1)} seconds of source{clipTransform(region)}</li>)}</ul></div> : null}
          <p><strong>Routing:</strong> {detailsPart.groupId ? current?.document.groups?.find((group) => group.id === detailsPart.groupId)?.name ?? "Unresolved group" : "Main output"}{detailsPart.sends?.length ? ` · ${detailsPart.sends.length} shared send${detailsPart.sends.length === 1 ? "" : "s"}` : ""}</p>
          {detailsGroup ? <p><strong>Shared processing:</strong> {[detailsGroup.effects?.map((effect) => readableEffect(effect.type)).join(" → "), detailsGroup.compressor?.isActive ? `compression${detailsGroup.sidechainFromPartId ? ` guided by ${partName(detailsGroup.sidechainFromPartId)}` : ""}` : "", detailsGroup.parallel ? `${Math.round(detailsGroup.parallel.wetMix * 100)}% parallel blend (${detailsGroup.parallel.effects.map((effect) => readableEffect(effect.type)).join(" → ")})` : "", detailsGroup.automation?.length ? `${detailsGroup.automation.length} changing controls` : ""].filter(Boolean).join(" · ") || "Level and balance only"}</p> : null}
          {current?.document.master ? <p><strong>Final mix:</strong> {Math.round(current.document.master.gain * 100)}% level · {current.document.master.limiterEnabled ? "limiter on" : "limiter off"}</p> : null}
          <p><strong>Processing:</strong> {detailsPart.effects.length ? detailsPart.effects.map((effect) => readableEffect(effect.type)).join(", ") : "None"}{detailsPart.parallel ? ` · Parallel blend ${Math.round(detailsPart.parallel.wetMix * 100)}%: ${detailsPart.parallel.effects.map((effect) => readableEffect(effect.type)).join(", ")}` : ""}</p>
          <p><strong>Motion:</strong> {detailsPart.automation.length ? detailsPart.automation.map((curve) => curve.target).join(", ") : "No changing controls"}</p>
          {Object.keys(detailsPart.device.parameters).length ? <details className="room-technical"><summary>Sound settings</summary><dl>{Object.entries(detailsPart.device.parameters).map(([name, value]) => <div key={name}><dt>{name.replaceAll(".", " · ")}</dt><dd>{value}</dd></div>)}</dl></details> : null}
        </div> : null}
        <DialogFooter className="-mx-6 -mb-6"><Button variant="outline" onClick={() => setDetailsPartId(null)}>Close</Button><Button disabled={!detailsPart || protectedPartIds.includes(detailsPart.id)} onClick={() => { if (detailsPart) setTargetPartId(detailsPart.id); setDetailsPartId(null); window.setTimeout(focusDirection, 0) }}>Change this part</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
      <DialogContent className="comparison-dialog bg-popover">
        <DialogHeader className="comparison-header"><DialogTitle className="font-heading text-2xl">Before and after</DialogTitle><DialogDescription>Version {beforeVersion?.ordinal ?? "?"} → {afterVersion?.ordinal ?? "?"} · looking does not change your current version.</DialogDescription><span className="comparison-current">Current: v{snapshot?.versions.find((version) => version.id === snapshot.currentRevisionId)?.ordinal}. Successful changes are selected automatically.</span></DialogHeader>
        <div className="comparison-body">
        {snapshot && snapshot.versions.length > 2 ? <details className="comparison-history"><summary>Compare another saved version</summary><RadioGroup value={compareId ?? undefined} onValueChange={(id) => openComparison(id)} aria-label="Version to compare" className="version-list">{snapshot.versions.map((version) => <label key={version.id} className="version-option"><RadioGroupItem value={version.id} aria-label={`Version ${version.ordinal}`} /><span><span className="version-title">Version {version.ordinal} {version.id === snapshot.currentRevisionId ? <span className="chip"><Check className="mr-1 size-3" /> Current</span> : null}</span><p>{arrangementSummary(version)}</p></span></label>)}</RadioGroup></details> : null}
        {beforeVersion && afterVersion ? <>
          <div className="comparison-tabs" role="group" aria-label="Comparison view"><Button variant={compareMode === "before" ? "default" : "outline"} aria-pressed={compareMode === "before"} onClick={() => { setReplay(0); setCompareMode("before") }}>Before · v{beforeVersion.ordinal}{snapshot?.currentRevisionId === beforeVersion.id ? " · current" : ""}</Button><Button variant={compareMode === "after" ? "default" : "outline"} aria-pressed={compareMode === "after"} onClick={() => { setReplay(0); setCompareMode("after") }}>After · v{afterVersion.ordinal}{snapshot?.currentRevisionId === afterVersion.id ? " · current" : ""}</Button><Button variant={compareMode === "changes" ? "default" : "outline"} aria-pressed={compareMode === "changes"} onClick={() => { setReplay(0); setCompareMode("changes") }}>Changes</Button></div>
          <div className="comparison-section-list" role="group" aria-label="Section to compare">{beforeVersion.document.sections.map((section) => <Button key={section.id} size="sm" variant={compareSection?.id === section.id ? "default" : "outline"} aria-pressed={compareSection?.id === section.id} onClick={() => { setReplay(0); setCompareSectionId(section.id) }}>{section.name}</Button>)}</div>
          {compareMode === "changes" && comparison ? <div className="comparison-facts" role="status"><strong>{compareSection?.name}: {comparison.status === "preserved" ? "musical structure unchanged" : comparison.status === "unverified" ? "some differences cannot be verified" : "structural changes found"}</strong><p>{comparison.addedNotes} added · {comparison.removedNotes} removed · {comparison.modifiedNotes} modified note events. {comparison.verifiedUnchangedParts.length ? `Verified unchanged here: ${comparison.verifiedUnchangedParts.length} ${comparison.verifiedUnchangedParts.length === 1 ? "part" : "parts"}.` : "No part is fully verified unchanged here."}</p>{comparison.caveats.map((caveat) => <p key={caveat}>{caveat}</p>)}<details><summary>Changed parts & verification details</summary><p><b>Kept, verified:</b> {comparison.verifiedUnchangedParts.join(", ") || "None verified here"}</p><ul>{comparison.parts.filter((part) => part.status !== "preserved" || part.metadataChanged).map((part) => <li key={part.partId}><b>{part.name}:</b> {part.status}{part.addedNotes.length || part.removedNotes.length || part.modifiedNotes.length ? ` · notes +${part.addedNotes.length} / −${part.removedNotes.length} / ~${part.modifiedNotes.length}` : ""}{part.clipStatus !== "preserved" ? ` · clips ${part.clipStatus}` : ""}{part.controlsChanged ? " · changing controls differ" : ""}{part.dependenciesChanged ? " · instrument or shared processing differs" : ""}{part.metadataChanged ? " · description changed" : ""}</li>)}</ul><p className="section-footnote">A verified unchanged structure is not proof that rendered audio sounds identical. Requested locks are separate from this comparison.</p></details></div> : null}
          <div className="comparison-display-options"><label><input type="checkbox" checked={showUnchanged} onChange={(event) => setShowUnchanged(event.target.checked)} /> Include unchanged parts</label><Button variant="outline" size="sm" disabled={compareMode !== "changes"} onClick={() => setReplay((value) => value + 1)}>Show the change</Button></div>
          <NativeScore document={compareMode === "before" ? beforeVersion.document : afterVersion.document} coordinateReference={compareMode === "before" ? afterVersion.document : beforeVersion.document} timelineReference={beforeVersion.document} comparisonBefore={compareMode === "changes" ? beforeVersion.document : undefined} identity={`${projectId}:compare:${comparePair?.beforeId}:${comparePair?.afterId}`} selectedSectionId={compareSection?.id ?? null} onSelectSection={setCompareSectionId} selectedPartId={comparePartId} onInspectPart={setComparePartId} detailOnly replay={compareMode === "changes" ? replay : 0} visiblePartIds={!showUnchanged && comparison?.parts.length ? comparison.parts.filter((part) => part.status !== "preserved" || part.metadataChanged).map((part) => part.partId) : undefined} />
        </> : <p>Both saved versions must still be available to compare.</p>}
        </div>
        <DialogFooter className="comparison-actions"><Button variant="outline" onClick={() => setCompareOpen(false)}>Keep current version</Button>{beforeVersion ? <Button variant="outline" disabled={busy || beforeVersion.id === snapshot?.currentRevisionId} onClick={() => void selectComparedVersion(beforeVersion.id)}><RotateCcw className="size-4" /> Use Before · v{beforeVersion.ordinal}</Button> : null}{afterVersion ? <Button disabled={busy || afterVersion.id === snapshot?.currentRevisionId} onClick={() => void selectComparedVersion(afterVersion.id)}>Use After · v{afterVersion.ordinal}</Button> : null}</DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
}
