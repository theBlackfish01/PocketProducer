import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowRight, Check, GitCompareArrows, LockKeyhole, Music2, MoreHorizontal, ExternalLink, RotateCcw, Search } from "lucide-react"
import { api, type Asset, type Job, type NativeDraftView, type NativeSnapshot, type SoundRecipe, type SoundFeedback } from "../../lib/api"
import { arrangementSummary, friendlyIssue, jobProgress, readableDevice, readableEffect } from "../../lib/ui-copy"
import { Button } from "../../components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../components/ui/dropdown-menu"
import { SourcesPanel } from "../sources/sources-panel"
import { RoomHero } from "../../components/room-hero"
import { DirectionComposer } from "./direction-composer"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog"
import { RadioGroup, RadioGroupItem } from "../../components/ui/radio-group"
import { defaultNativeDirection, freshNativeDraft, nativeDraftKey, reconcileNativeDraft } from "./native-draft"
import { NativeScore } from "./native-score"
import { compareScoreSection } from "./score"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../components/ui/sheet"
import { ProducerFeed } from "./producer-feed"
import { useProducerActivity } from "./use-producer-activity"
import { navigateSession } from "../../lib/session-route"
import { assertFreshSnapshot, reconcileRead } from "./reconcile-read"
import { claimAudioPlayback, releaseAudioPlayback } from "../../lib/audio-coordinator"

const terminal = new Set(["succeeded", "failed", "cancelled", "needs_attention"])
const clipTransform = (region: { playbackRate?: number; stretchMode?: string; pitchShiftSemitones?: number }) =>
  (region.playbackRate ? " · " + String(region.playbackRate) + "× speed" : "") + (region.stretchMode === "preservePitch" ? " · pitch preserved" : "") + (region.pitchShiftSemitones ? " · " + String(region.pitchShiftSemitones) + " semitone shift" : "")
type Receipt = { operation: "native-generation" | "native-revision" | "native-sync"; key: string; jobId: string | null; signature: string }

interface NativeRoomProps {
  projectId: string
  assets: Asset[]
  audiotoolConnected: boolean
  audiotoolAvailable: boolean
  onSourcesChanged(): Promise<void>
  onConnectAudiotool(): void
  onProjectUpdated(): void
}

export function NativeRoom({ projectId, assets, audiotoolConnected, audiotoolAvailable, onSourcesChanged, onConnectAudiotool, onProjectUpdated }: NativeRoomProps) {
  const menuRef = useRef<HTMLButtonElement>(null)
  const menuPanelRef = useRef(false)
  const lastDisplayTitle = useRef<string | null>(null)
  const [snapshot, setSnapshotState] = useState<NativeSnapshot | null>(null)
  const snapshotRef = useRef(snapshot)
  const setSnapshot = useCallback((value: NativeSnapshot | null) => {
    if (value && snapshotRef.current && value.headVersion < snapshotRef.current.headVersion) return
    snapshotRef.current = value
    setSnapshotState(value)
  }, [])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [direction, setDirection] = useState(defaultNativeDirection())
  const [profile, setProfile] = useState<"standard" | "extended">("standard")
  const [producerModel, setProducerModel] = useState("gpt-6-sol")
  const [targetPartId, setTargetPartId] = useState<string | null>(null)
  const [targetSectionId, setTargetSectionId] = useState<string | null>(null)
  const [protectedPartIds, setProtectedPartIds] = useState<string[]>([])
  const [sourceIds, setSourceIds] = useState<string[]>([])
  const [draftProjectId, setDraftProjectId] = useState<string | null>(null)
  const [draftNotices, setDraftNotices] = useState<string[]>([])
  const [job, setJob] = useState<Job | null>(null)
  const [tentative, setTentative] = useState<NativeDraftView | null>(null)
  const [tentativeError, setTentativeError] = useState<string | null>(null)
  const [snapshotError, setSnapshotError] = useState<string | null>(null)
  const [refreshReads, setRefreshReads] = useState(0)
  const [extendOpen, setExtendOpen] = useState(false)
  const [abandonOpen, setAbandonOpen] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const [compareId, setCompareId] = useState<string | null>(null)
  const [detailsPartId, setDetailsPartId] = useState<string | null>(null)
  const [viewSectionId, setViewSectionId] = useState<string | null>(null)
  const [soundsOpen, setSoundsOpen] = useState(false)
  const [panel, setPanel] = useState<"history" | "audiotool" | null>(null)
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
  const [sampleKind, setSampleKind] = useState<"any" | "one-shot" | "loop">("any")
  const [sampleTempo, setSampleTempo] = useState("")
  const [sampleAnalysis, setSampleAnalysis] = useState<Awaited<ReturnType<typeof api.inspectLibrarySample>> | null>(null)
  const [sampleAuditioned, setSampleAuditioned] = useState(false)
  const libraryAudioRef = useRef<HTMLAudioElement>(null)
  const [sampleFeedback, setSampleFeedback] = useState<SoundFeedback | null>(null)
  const [feedbackRating, setFeedbackRating] = useState<"fits" | "not-for-this">("fits")
  const [feedbackNote, setFeedbackNote] = useState("")
  const [feedbackBusy, setFeedbackBusy] = useState(false)
  const [localRecipes, setLocalRecipes] = useState<SoundRecipe[]>([])
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
  // Existing v7 copies remain verified for their immutable score. A new copy
  // uses v8, but changing the local mapper does not revoke a prior readback.
  const currentRemoteVerification = snapshot?.synchronization.state === "verified" && snapshot.synchronization.revisionId === current?.id && ["nexus-native-v7", "nexus-native-v8", "nexus-native-v9"].includes(snapshot.synchronization.mappingVersion ?? "")
  const receiptKey = `pocket-producer:native-receipt:${projectId}`

  useEffect(() => {
    if (!soundsOpen) libraryAudioRef.current?.pause()
  }, [soundsOpen])

  useEffect(() => {
    let active = true
    roomActiveRef.current = true
    setPanel(null); setExtendOpen(false); setAbandonOpen(false)
    libraryAudioRef.current?.pause(); pendingCompare.current = null; setDraftProjectId(null); setLoading(true); setBusy(false); setSnapshot(null); setJob(null); setTentative(null); setTentativeError(null); setError(null); setTargetPartId(null); setTargetSectionId(null); setProtectedPartIds([]); setSourceIds([]); setRoleFilter("all"); setPartLimit(8); setCompareOpen(false); setComparePair(null); setInspectedPartId(null); setViewSectionId(null); setSoundsOpen(false); setPartsOpen(false); setComparePartId(null); setReplay(0); setShowUnchanged(false); setSampleAnalysis(null); setSampleAuditioned(false); setSampleFeedback(null); setLibraryResults([]); setLibraryError(null)
    void api.nativeSnapshot(projectId).then((value) => {
      if (!active) return
      let stored: unknown = null
      try { stored = JSON.parse(localStorage.getItem(nativeDraftKey(projectId)) ?? "null") } catch { /* A malformed browser draft has no authority. */ }
      const restored = reconcileNativeDraft(stored, value, assetsRef.current)
      setWorkspaceView(value.current ? "arrangement" : "producer"); setSnapshot(value); setDirection(restored.draft.direction); setProfile(restored.draft.profile ?? "standard"); setProducerModel(restored.draft.model ?? "gpt-6-sol"); setTargetPartId(restored.draft.targetPartId); setTargetSectionId(restored.draft.targetSectionId); setProtectedPartIds(restored.draft.protectedPartIds); setSourceIds(restored.draft.sourceIds); setDraftNotices(restored.notices); setDraftProjectId(projectId)
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
    return () => { active = false; roomActiveRef.current = false; libraryAudioRef.current?.pause() }
  }, [projectId, receiptKey])

  useEffect(() => {
    if (draftProjectId !== projectId) return
    localStorage.setItem(nativeDraftKey(projectId), JSON.stringify({ headId: snapshot?.currentRevisionId ?? null, direction, profile, model: producerModel, targetPartId, targetSectionId, protectedPartIds, sourceIds }))
  }, [draftProjectId, projectId, snapshot?.currentRevisionId, direction, profile, producerModel, targetPartId, targetSectionId, protectedPartIds, sourceIds])

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
    const controller = new AbortController()
    if (page.headId !== snapshot?.currentRevisionId) void reconcileRead(async () => {
      const fresh = await api.nativeSnapshot(projectId, controller.signal)
      assertFreshSnapshot(fresh, page.headId, snapshotRef.current)
      return fresh
    }, controller.signal).then((fresh) => {
      if (!active) return
      setSnapshotError(null)
      const prior = pendingCompare.current
      setSnapshot(fresh)
      if (prior && prior.jobId === page.job?.id && page.job.state === "succeeded" && fresh.currentRevisionId && fresh.currentRevisionId !== prior.baseId) {
        setComparePair({ beforeId: prior.baseId, afterId: fresh.currentRevisionId }); setCompareSectionId(prior.sectionId); setCompareMode("changes"); setReplay(0); setComparePartId(null); setShowUnchanged(false); setCompareOpen(true)
      }
      pendingCompare.current = null
      const reconciled = reconcileNativeDraft({ headId: snapshot?.currentRevisionId ?? null, direction: directionRef.current, targetPartId, targetSectionId, protectedPartIds, sourceIds, profile }, fresh, assetsRef.current)
      setDirection(reconciled.draft.direction); setTargetPartId(reconciled.draft.targetPartId); setTargetSectionId(reconciled.draft.targetSectionId); setProtectedPartIds(reconciled.draft.protectedPartIds); setSourceIds(reconciled.draft.sourceIds); setDraftNotices(directionRef.current.trim() ? reconciled.notices : [])
      setShowDraft(false); localStorage.removeItem(receiptKey); onProjectUpdated()
    }).catch(() => { if (active) setSnapshotError("The latest saved arrangement could not be loaded. Your direction is still here.") })
    return () => { active = false; controller.abort() }
  }, [projectId, activity.state?.headId, activity.state?.job?.id, activity.state?.job?.state, activity.state?.job?.stage, loading, draftProjectId, refreshReads])

  useEffect(() => {
    const page = activity.state
    const request = page?.job
    if (!request || request.state === "succeeded" || (request.state === "cancelled" && request.error_code !== "NATIVE_ABANDONED")) { setTentative(null); setTentativeError(null); return }
    let active = true
    const controller = new AbortController()
    void reconcileRead(async () => {
      const view = await api.nativeDraft(projectId, request.id, controller.signal)
      if (view.jobId !== request.id || view.stepCount < (page?.draft?.step ?? 0)) throw new Error("Work in progress is still catching up")
      return view
    }, controller.signal).then((view) => { if (active) { setTentative((prior) => prior?.jobId === view.jobId && prior.stepCount > view.stepCount ? prior : view); setTentativeError(null) } }).catch(() => { if (active) setTentativeError("Work in progress is temporarily unavailable. Your saved arrangement is unchanged.") })
    return () => { active = false; controller.abort() }
  }, [projectId, activity.state?.job?.id, activity.state?.job?.state, activity.state?.draft?.hash, refreshReads])

  // Refresh the existing sidebar projection only when confirmed music gets a title.
  const displayTitle = snapshot?.current?.document.title ?? tentative?.document?.title ?? null
  useEffect(() => {
    if (!displayTitle || displayTitle === lastDisplayTitle.current) return
    lastDisplayTitle.current = displayTitle
    onProjectUpdated()
  }, [displayTitle, onProjectUpdated])

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
    setLibraryBusy(true); setLibrarySearched(false); setLibraryError(null); setLibraryResults([]); setSampleAnalysis(null)
    try {
      if (libraryKind === "samples") {
        const bpm = sampleTempo.trim() ? Number(sampleTempo) : null
        if (bpm !== null && (!Number.isFinite(bpm) || bpm < 20 || bpm > 300)) throw new Error("Choose a tempo between 20 and 300 BPM")
        const result = await api.searchLibrarySamples(libraryQuery.trim(), { ...(sampleKind !== "any" ? { kind: sampleKind } : {}), ...(bpm !== null ? { minBpm: Math.max(0, bpm - 12), maxBpm: Math.min(400, bpm + 12) } : {}) })
        setLibraryResults(result.samples.map((sample) => ({ name: sample.name, displayName: sample.displayName, ownerName: sample.ownerName, detail: `${sample.durationSeconds.toFixed(1)} seconds · ${sample.sampleKind}` })))
      } else {
        const result = await api.searchLibraryPresets(libraryKind, libraryQuery.trim())
        setLibraryResults(result.presets.map((preset) => ({ name: preset.name, displayName: preset.displayName, ownerName: preset.ownerName, detail: `${preset.deviceType} preset` })))
      }
    } catch (cause) { setLibraryError(cause instanceof Error ? cause.message : "Unable to search Audiotool's library") }
    finally { setLibraryBusy(false); setLibrarySearched(true) }
  }
  const chooseLibrary = (item: { name: string; displayName: string }) => {
    const slice = sampleAnalysis?.sample.name === item.name ? sampleAnalysis.measured.suggestedSlices[0] : null
    setDirection((prior) => `${prior.trim()}\nConsider the Audiotool ${libraryKind === "samples" ? "sample" : "preset"} “${item.displayName}” (${item.name}); inspect it before use.${slice ? ` Its measured activity suggests inspecting ${slice.startSeconds}–${slice.endSeconds} seconds as one possible slice, not a semantic or licensing judgment.` : ""}`)
    window.requestAnimationFrame(focusDirection)
  }
  const chooseRecipe = (recipe: SoundRecipe) => {
    setDirection((prior) => `${prior.trim()}\nExplore the ${recipe.name} sound (${recipe.id}) for the ${recipe.role}, and adapt its character to this piece.`)
    window.requestAnimationFrame(focusDirection)
  }
  const inspectSample = async (name: string) => {
    if (libraryBusy) return
    libraryAudioRef.current?.pause()
    setLibraryBusy(true); setLibraryError(null); setSampleAnalysis(null); setSampleAuditioned(false); setSampleFeedback(null); setFeedbackNote("")
    try {
      const [analysis, saved] = await Promise.all([api.inspectLibrarySample(name), api.soundFeedback(projectId)])
      if (!stillInProject()) return
      setSampleAnalysis(analysis)
      const previous = saved.feedback.find((item) => item.sampleName === analysis.sample.name && item.contentHash === analysis.contentHash) ?? null
      setSampleFeedback(previous); setFeedbackRating(previous?.rating ?? "fits"); setFeedbackNote(previous?.note ?? "")
    }
    catch (cause) { setLibraryError(cause instanceof Error ? cause.message : "This sample could not be inspected") }
    finally { setLibraryBusy(false) }
  }
  const saveSampleFeedback = async () => {
    if (!sampleAnalysis || !sampleAuditioned || feedbackBusy) return
    setFeedbackBusy(true); setLibraryError(null)
    try {
      const saved = await api.saveSoundFeedback(projectId, { sampleName: sampleAnalysis.sample.name, contentHash: sampleAnalysis.contentHash, rating: feedbackRating, note: feedbackNote.trim() })
      if (stillInProject()) setSampleFeedback(saved.feedback)
    } catch (cause) { if (stillInProject()) setLibraryError(cause instanceof Error ? cause.message : "Your listening note could not be saved") }
    finally { setFeedbackBusy(false) }
  }
  useEffect(() => {
    if (!soundsOpen || localRecipes.length) return
    let active = true
    void api.soundRecipes().then((result) => { if (active) setLocalRecipes(result.recipes) }).catch(() => undefined)
    return () => { active = false }
  }, [soundsOpen, localRecipes.length])
  const syncState = snapshot?.synchronization.state ?? "local"
  const syncMessage = currentRemoteVerification ? `Editable copy confirmed in Audiotool ${snapshot?.synchronization.verifiedAt ? `on ${new Date(snapshot.synchronization.verifiedAt).toLocaleDateString()}` : ""}. Recheck before relying on later Studio changes.`
    : syncState === "conflict" ? "The Audiotool copy changed. This room will not overwrite it automatically."
      : syncState === "uncertain" || syncState === "needs_attention" ? "We need to check the earlier Audiotool action before trying again."
        : syncState === "applying" ? "Preparing the editable Audiotool copy…"
          : audiotoolAvailable ? `Version ${current?.ordinal ?? ""} is ready to copy.` : "Audiotool connection is not set up."

  const submit = async (freshAttempt = false, submittedModel = producerModel) => {
    if (!direction.trim() || busy || activeJob || activity.state?.actions.canSubmit === false || activity.state?.headId !== snapshot?.currentRevisionId || draftNotices.length) return
    const head = snapshot?.currentRevisionId ?? null
    const operation: Receipt["operation"] = head ? "native-revision" : "native-generation"
    const signature = JSON.stringify({ operation, head, direction: direction.trim(), profile, model: submittedModel, targetPartId, targetSectionId, protectedPartIds: [...protectedPartIds].sort(), sourceIds: [...sourceIds].sort() })
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
      const result = head ? await api.reviseNative(projectId, { direction: direction.trim(), profile, model: submittedModel, baseNativeRevisionId: head, expectedNativeHeadId: head, ...(targetPartId ? { targetPartId } : {}), ...(targetSectionId ? { targetSectionId } : {}), ...(protectionChanged ? { protectionChange: { expectedPartIds: savedProtections, desiredPartIds: protectedPartIds } } : {}), sourceAssetIds: sourceIds }, key) : await api.constructNative(projectId, direction.trim(), sourceIds, key, profile, submittedModel)
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

  const abandonPartial = async () => {
    if (!job || busy) return
    setBusy(true)
    try {
      await api.abandonNative(projectId, job.id)
      if (!stillInProject()) return
      const stopped = await api.job(job.id)
      if (!stillInProject()) return
      setJob(stopped); setAbandonOpen(false); setError(null)
    } catch (cause) { if (stillInProject()) setError(cause instanceof Error ? cause.message : "Unable to leave this draft") }
    finally { if (stillInProject()) setBusy(false) }
  }

  const continuePartial = async () => {
    if (!job || job.error_code !== "NATIVE_PARTIAL" || busy) return
    setBusy(true); setError(null)
    try { await api.continueNative(projectId, job.id); const next = await api.job(job.id); if (stillInProject()) setJob(next) }
    catch (cause) { if (stillInProject()) setError(cause instanceof Error ? cause.message : "Unable to continue this saved draft") }
    finally { if (stillInProject()) setBusy(false) }
  }

  const extendAndContinue = async () => {
    if (!job || busy || !callExtension || !canExtendCalls) return
    setBusy(true); setError(null)
    try {
      await api.extendNative(projectId, job.id, { maxCalls: callExtension })
      if (!stillInProject()) return
      await api.continueNative(projectId, job.id)
      const next = await api.job(job.id)
      if (stillInProject()) { setJob(next); setExtendOpen(false) }
    } catch (cause) {
      if (stillInProject()) { setError(cause instanceof Error ? cause.message : "Unable to continue"); setRefreshReads((value) => value + 1) }
    } finally { if (stillInProject()) setBusy(false) }
  }


  const inWorkspace = Boolean(current || job || activity.state?.job)
  const draftVisible = Boolean(tentative?.document && (!current || showDraft))
  const earlyCreation = inWorkspace && !current && !tentative?.document;
  const displayedDocument = draftVisible ? tentative?.document : current?.document;
  const statusText = activeJob && activeJob.kind !== "native-sync" ? "Working" : job?.state === "needs_attention" ? "Paused" : job?.state === "cancelled" && !current ? "Stopped" : current ? `Version ${current.ordinal} · Current` : "Draft";
  const callExtension = tentative?.canExtend && !tentative.canContinue && /MODEL_CALL_LIMIT_EXCEEDED/.test(tentative.stopReason ?? "") && tentative.runLimits && tentative.extensionCeiling ? Math.min(80, tentative.extensionCeiling.maxCalls) : null;
  const canExtendCalls = Boolean(callExtension && tentative?.runLimits && callExtension > tentative.runLimits.maxCalls);
  const ToolOverlay = panel ? Dialog : Sheet;
  const ToolContent = panel ? DialogContent : SheetContent;
  const ToolHeader = panel ? DialogHeader : SheetHeader;
  const ToolTitle = panel ? DialogTitle : SheetTitle;
  const ToolDescription = panel ? DialogDescription : SheetDescription;
  const composer = <><DirectionComposer projectId={projectId} headId={current?.id ?? null} direction={direction} onDirection={setDirection} revision={Boolean(current)} active={Boolean(activeJob) || job?.state === "needs_attention"} busy={busy}
    canSubmit={!busy && !activeJob && activity.state?.headId === snapshot?.currentRevisionId && Boolean(activity.state?.actions.canSubmit) && draftNotices.length === 0 && direction.trim().length >= 3}
    onSubmit={(model) => { setProducerModel(model); void submit(false, model) }} onAddSound={() => setSoundsOpen(true)} sectionId={targetSectionId} partId={targetPartId} protectedPartIds={protectedPartIds} sourceIds={sourceIds}
    sections={current?.document.sections ?? []} onSection={setTargetSectionId} partName={selectedPart?.name} clearPart={() => setTargetPartId(null)}
    protectedNames={[...new Set([...protectedPartIds.map(partName), ...(preservationPreview?.revisionId === current?.id ? preservationPreview?.namedParts.map((item) => item.name) ?? [] : []), ...(preservationPreview?.revisionId === current?.id && preservationPreview?.theme ? [`${preservationPreview.theme.label} theme phrase`] : [])])]} profile={profile} onProfile={setProfile} model={producerModel} onModel={setProducerModel}>
    {draftNotices.length ? <div className="job-status" role="status">{draftNotices.map((notice) => <p key={notice}>{notice}</p>)}<Button size="sm" variant="outline" onClick={() => setDraftNotices([])}>I reviewed the updated scope</Button></div> : null}
  </DirectionComposer>{current && preservationPreview?.revisionId === current.id && preservationPreview.unresolved.length ? <div className="preservation-preview" role="alert">{preservationPreview.unresolved.join(". ")}. Name the part or phrase before sending.</div> : null}</>

  const producer = <section className="producer-panel" aria-label="Producer"><div className="producer-heading"><h2>Producer</h2></div>{current || tentative?.document ? <Button className="producer-view-arrangement" variant="ghost" onClick={() => setWorkspaceView("arrangement")}>View arrangement <ArrowRight size={14} /></Button> : null}<ProducerFeed events={activity.events} connection={activity.connection} older={activity.older} onOlder={() => void activity.loadOlder().catch(() => setError("Earlier activity could not be loaded."))} onLatest={activity.closeOlder} historyBusy={activity.historyBusy} onCompare={reviewActivityVersion} />{activeJob && activeJob.kind !== "native-sync" ? <div className="producer-current" role="status"><strong>{jobProgress(activeJob)}</strong><Button size="sm" variant="outline" disabled={!activity.state?.actions.canStop} onClick={() => void api.cancel(activeJob.id).then(() => api.job(activeJob.id)).then(setJob).catch(() => setError("Unable to stop the request. Check your connection and try again."))}>Stop</Button></div> : null}{job && job.kind !== "native-sync" && terminal.has(job.state) && job.state !== "succeeded" ? <div className="job-status" role="status">
      <strong>{job.state === "cancelled" ? "Stopped" : "Paused"}</strong>
      <span>{friendlyIssue(tentative?.continuationReason ?? tentative?.stopReason ?? job.error_message, "The producer could not finish this request. Your draft is saved.", tentative?.stepCount !== 0)}</span>
      <details><summary>Details</summary><p>{tentative?.stopReason ?? job.error_message}</p></details>
      {job.error_code === "NATIVE_PARTIAL" ? <>
{tentative?.canContinue ? <Button size="sm" disabled={busy} onClick={() => void continuePartial()}>Continue arrangement</Button> : canExtendCalls ? <Button size="sm" disabled={busy} onClick={() => setExtendOpen(true)}>Continue arrangement</Button> : null}{activity.state?.actions.canAbandon ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAbandonOpen(true)}>End this attempt…</Button> : null}
      </> : ["failed", "cancelled"].includes(job.state) && activity.state?.actions.canSubmit ? <Button className="mt-3" variant="outline" size="sm" onClick={() => void submit(true)} disabled={busy || !direction.trim()}>Send as a new request</Button> : <p className="provider-note">A new request is paused until the earlier outcome is known.</p>}
    </div> : null}{job && tentative?.plan && tentative.jobId === job.id && job.state !== "succeeded" ? <details className="producer-approach"><summary>Musical approach</summary><div className="section-heading"><div><h3>The approach</h3><p>{tentative.plan.stage === "planned" ? "Planning the piece" : tentative.plan.stage === "building" ? "Building the arrangement" : tentative.plan.stage === "refining" ? "Adding detail" : "Reviewing the structure"}</p></div></div><p>{tentative.plan.plan.intent}</p><ol>{tentative.plan.plan.sections.map((section, index) => <li key={`${section.name}-${index}`}><strong>{section.name}</strong> — {section.purpose}</li>)}</ol>{tentative.plan.plan.creativeState?.identity ? <p><strong>Musical identity:</strong> {tentative.plan.plan.creativeState.identity}</p> : null}{tentative.plan.plan.creativeState?.palette.length ? <p><strong>Chosen sounds:</strong> {tentative.plan.plan.creativeState.palette.map((item) => `${item.role}: ${item.resourceId}`).join(" · ")}</p> : null}{tentative.plan.plan.creativeState?.unfinishedTasks.length ? <p><strong>Still to shape:</strong> {tentative.plan.plan.creativeState.unfinishedTasks.join(" · ")}</p> : tentative.plan.plan.developmentTasks.length ? <p><strong>Still to develop:</strong> {tentative.plan.plan.developmentTasks.join(" · ")}</p> : null}{tentative.plan.review?.documentHash === tentative.documentHash ? <p><strong>Score check:</strong> {tentative.plan.review.verdict} {tentative.plan.review.modelUsed ? "A symbolic editor reviewed this structure; no audio was heard." : "Checked from note and section data only."}</p> : null}</details> : null}{composer}</section>
  if (loading) return <div className="empty-surface" role="status">Opening your arrangement…</div>
  return <div className={`native-room producer-room ${inWorkspace ? "is-workspace" : "is-start"} ${earlyCreation ? "is-early" : ""} view-${workspaceView}`}>
    <Dialog open={extendOpen} onOpenChange={setExtendOpen}><DialogContent><DialogHeader><DialogTitle>Continue this arrangement?</DialogTitle><DialogDescription>Allow up to {callExtension} total model steps for this request, keeping its existing spending limit. Completed work will not be started over.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={busy} onClick={() => setExtendOpen(false)}>Not now</Button><Button disabled={busy || !canExtendCalls} onClick={() => void extendAndContinue()}>{busy ? "Continuing…" : "Extend and continue"}</Button></DialogFooter></DialogContent></Dialog>
    {snapshotError || tentativeError ? <div className="job-status" role="status"><p>{snapshotError ?? tentativeError}</p><Button variant="outline" size="sm" onClick={() => { setSnapshotError(null); setTentativeError(null); setRefreshReads((value) => value + 1) }}>Refresh arrangement</Button></div> : null}
    <Dialog open={abandonOpen} onOpenChange={setAbandonOpen}><DialogContent><DialogHeader><DialogTitle>End this attempt?</DialogTitle><DialogDescription>Your saved versions and confirmed work stay safe. This request will stop and cannot be continued. You can send a fresh direction afterward.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={busy} onClick={() => setAbandonOpen(false)}>Keep working on it</Button><Button disabled={busy} onClick={() => void abandonPartial()}>End attempt</Button></DialogFooter></DialogContent></Dialog>
    {inWorkspace ? <header className="producer-workspace-header"><div><p className="workspace-state" role="status">{statusText}</p><h1 id="workspace-title" tabIndex={-1}>{displayedDocument?.title ?? "Your new arrangement"}</h1><p>{displayedDocument ? `${displayedDocument.bars} bars · ${displayedDocument.sections.length} sections · ${displayedDocument.parts.length} parts${draftVisible ? " · Draft" : ""}` : "A new piece, taking shape."}</p></div><div className="workspace-handoff">{current ? <><Button variant="outline" disabled={!currentRemoteVerification && (busy || Boolean(activeJob))} onClick={() => currentRemoteVerification && snapshot?.synchronization.url ? window.open(snapshot.synchronization.url, "_blank", "noopener,noreferrer") : ["conflict", "uncertain", "needs_attention", "applying"].includes(syncState) || !audiotoolAvailable ? setPanel("audiotool") : audiotoolConnected ? void synchronize() : onConnectAudiotool()}><ExternalLink size={16} /> {!audiotoolAvailable ? "Audiotool setup" : currentRemoteVerification ? "Open in Audiotool" : ["conflict", "uncertain", "needs_attention"].includes(syncState) ? "Review Audiotool copy" : syncState === "applying" ? "Copying…" : audiotoolConnected ? draftVisible ? `Copy Version ${current.ordinal} to Audiotool` : "Copy to Audiotool" : "Connect Audiotool"}</Button>{currentRemoteVerification ? <small>Version {current.ordinal} copied</small> : null}</> : null}</div></header> : <RoomHero status="A fresh start" title="What would you like to make?" description="A mood, a moment, or a detailed vision. Start with what you imagine." meta="" />}
    {error ? <div className="job-status" role="alert"><strong>That action couldn't finish</strong><span>{friendlyIssue(error, "Your saved work is unchanged. Check the action and try again.")}</span></div> : null}
    {inWorkspace ? <>
      <nav className="workspace-toolbar" aria-label="Session tools"><Button variant="outline" onClick={() => setSoundsOpen(true)}>Sounds</Button><Button variant="outline" onClick={() => setPanel("history")}>Versions</Button><DropdownMenu><DropdownMenuTrigger ref={menuRef} render={<Button variant="ghost" size="icon" aria-label="Session options" />}><MoreHorizontal /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => { menuPanelRef.current = true; setPanel("audiotool") }}>Audiotool connection</DropdownMenuItem></DropdownMenuContent></DropdownMenu></nav>
      <div className="workspace-view-switch" role="group" aria-label="Workspace view"><Button variant={workspaceView === "arrangement" ? "default" : "outline"} aria-pressed={workspaceView === "arrangement"} onClick={() => setWorkspaceView("arrangement")}>Arrangement</Button><Button variant={workspaceView === "producer" ? "default" : "outline"} aria-pressed={workspaceView === "producer"} onClick={() => setWorkspaceView("producer")}>Producer</Button></div>
      <div className="producer-workspace-grid"><section className="producer-canvas" aria-label="Arrangement workspace">{tentative?.document && current ? <div className="draft-choice" role="group" aria-label="Arrangement to inspect"><Button size="sm" variant={!showDraft ? "default" : "outline"} aria-pressed={!showDraft} onClick={() => setShowDraft(false)}>Saved arrangement</Button><Button size="sm" variant={showDraft ? "default" : "outline"} aria-pressed={showDraft} onClick={() => setShowDraft(true)}>View work in progress</Button></div> : null}{draftVisible ? <>{job && tentative?.document && tentative.jobId === job.id && job.state !== "succeeded" ? <section className="native-section native-draft-preview" aria-label="Unfinished arrangement preview">
      <div className="section-heading"><h2>Your arrangement</h2></div>

      <NativeScore document={tentative.document} identity={`${projectId}:${tentative.jobId}:${tentative.documentHash}:${tentative.stepCount}`} selectedSectionId={draftSectionId} onSelectSection={setDraftSectionId} selectedPartId={draftPartId} onInspectPart={setDraftPartId} animateConfirmed motionScope={`${projectId}:${tentative.jobId}`} confirmedStepCount={tentative.stepCount} draft />

</section> : null}</> : current ? <section className="native-section arrangement-section" aria-labelledby="arrangement-heading"><div className="section-heading"><div><h2 id="arrangement-heading">Your arrangement</h2><p>Explore a section or part. Choose “Change” when you're ready to shape it.</p></div><div className="arrangement-actions"><Button variant="ghost" size="sm" onClick={() => setPartsOpen(true)}>Manage parts</Button><Button variant="outline" size="sm" onClick={() => { setTargetSectionId(null); setTargetPartId(null); focusDirection() }}>Change whole piece</Button></div></div><NativeScore key={projectId} document={current.document} identity={`${projectId}:${current.id}:${current.documentHash}`} selectedSectionId={viewSectionId} onSelectSection={setViewSectionId} selectedPartId={inspectedPartId} onInspectPart={setInspectedPartId} onChangeSection={changeSection} onChangePart={changePart} onKeepPart={keepPart} protectedPartIds={protectedPartIds} /></section> : <section className="producer-empty-score"><Music2 size={32} /><h2>Finding the first musical shape</h2></section>}{tentativeError ? <p role="status">{tentativeError}</p> : null}</section>{producer}</div>
    </> : <section className="session-start-form">{composer}</section>}
    <ToolOverlay open={soundsOpen || partsOpen || panel !== null} onOpenChange={(open) => { if (!open) { setSoundsOpen(false); setPartsOpen(false); setPanel(null) } }}>
      <ToolContent className={panel ? "workspace-tool-dialog" : "workspace-tool-sheet"} finalFocus={() => { const fromMenu = menuPanelRef.current; menuPanelRef.current = false; return fromMenu ? menuRef.current : true }}><ToolHeader><ToolTitle>{soundsOpen ? "Sounds" : partsOpen ? "Parts & instruments" : panel === "history" ? "Version history" : "Your Audiotool copy"}</ToolTitle><ToolDescription>{soundsOpen ? "Record, upload or explore sounds." : panel === "history" ? "Choose a version to inspect." : panel === "audiotool" ? "Continue working on your editable music in Audiotool." : "Your saved versions stay safe."}</ToolDescription></ToolHeader><div className="workspace-tool-body">
      {soundsOpen ? <div className="workspace-side">
        <SourcesPanel projectId={projectId} assets={assets} selectedIds={sourceIds} onSelection={setSourceIds} onChanged={onSourcesChanged} />
        <section className="side-section"><div className="section-heading"><h2>Sounds & instruments</h2></div><p className="side-note">Explore the kinds of parts we can shape. These aren't playback of your arrangement.</p><div className="sound-family-list"><div><span className="family-icon rhythm">▥</span><span><strong>Drums</strong><small>Patterns and pulse</small></span></div><div><span className="family-icon bass">〰</span><span><strong>Bass</strong><small>Low-end movement</small></span></div><div><span className="family-icon keys">▦</span><span><strong>Keys & pads</strong><small>Harmony and atmosphere</small></span></div><div><span className="family-icon lead">⌁</span><span><strong>Leads</strong><small>Melodies and responses</small></span></div><div><span className="family-icon effects">✳</span><span><strong>Effects</strong><small>Space, motion and dynamics</small></span></div></div>
          <details className="native-palette"><summary>Explore our sound ideas</summary><p className="side-note">These are editable starting settings, not recordings. Ask the producer to adapt one; listen after copying your finished arrangement to Audiotool.</p><ul className="native-library-results">{localRecipes.map((recipe) => <li key={recipe.id}><div><strong>{recipe.name}</strong><small>{recipe.character} · {recipe.role}</small><details><summary>How it might work</summary><p>{recipe.guidance.register}. {recipe.guidance.articulation}. {recipe.guidance.usefulMotion}.</p><p className="side-note">Watch for: {recipe.guidance.failureMode}. This idea has not been auditioned.</p></details></div><Button type="button" size="sm" variant="outline" onClick={() => chooseRecipe(recipe)}>Ask for this</Button></li>)}</ul></details>
          <details className="native-palette"><summary>Explore detailed capabilities</summary><p className="side-note">This reference includes capabilities that may not yet be available for construction.</p><label className="native-search"><Search className="size-4" /><span className="sr-only">Search detailed capabilities</span><input value={capabilityQuery} onChange={(event) => setCapabilityQuery(event.target.value)} placeholder="Find instruments or effects" /></label><div className="native-capability-grid">{capabilities.slice(0, 12).map((item) => <div key={item.type} className="native-capability"><strong>{item.type}</strong><span>{item.family}</span><small>{item.purpose}</small><small>{item.writableInPocketProducer ? "Available for construction" : "Reference only"}</small></div>)}</div></details></section>
        <section className="side-section inspiration-section"><h2>Need inspiration?</h2><p className="side-note">Choose a starting point, then make it your own.</p><div className="suggestion-list">{(current ? [`Build more energy in ${current.document.sections[Math.min(1, current.document.sections.length - 1)]?.name ?? "the middle"}`, `Make ${current.document.sections[0]?.name ?? "the opening"} more minimal`, `Give ${current.document.parts.find((part) => part.role === "melody")?.name ?? "the melody"} a new response`] : ["A calm opening that grows into a pulse", "A sparse rhythm with a memorable melody", "An atmospheric piece with contrasting sections"]).map((prompt) => <button key={prompt} type="button" onClick={() => suggest(prompt)}>{prompt}<ArrowRight className="size-4" /></button>)}</div></section>
        <section className="side-section native-library-section"><h2>Audiotool sound library</h2><p className="side-note">Find a sample or instrument sound. Sample audition plays that sound alone, not your arrangement.</p>{audiotoolConnected ? <>
          <form onSubmit={(event) => { event.preventDefault(); void searchLibrary() }}>
            <label htmlFor="native-library-kind">Find</label><select id="native-library-kind" value={libraryKind} onChange={(event) => { setLibraryKind(event.target.value as typeof libraryKind); setLibraryResults([]); setLibrarySearched(false) }}><option value="samples">Samples</option><option value="heisenberg">Synth presets</option><option value="pulverisateur">Analog synth presets</option><option value="gakki">Sampler presets</option><option value="beatbox8">Drum machine presets</option></select>
            <label htmlFor="native-library-query">Sound or mood</label><input id="native-library-query" value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} maxLength={80} placeholder="Try glass, soft drums, texture…" />
            {libraryKind === "samples" ? <><label htmlFor="native-sample-kind">Sample type</label><select id="native-sample-kind" value={sampleKind} onChange={(event) => setSampleKind(event.target.value as typeof sampleKind)}><option value="any">Any type</option><option value="one-shot">One-shot</option><option value="loop">Loop</option></select><label htmlFor="native-sample-tempo">Near this tempo (optional)</label><input id="native-sample-tempo" type="number" inputMode="numeric" min="20" max="300" value={sampleTempo} onChange={(event) => setSampleTempo(event.target.value)} placeholder="BPM ±12" /></> : null}
            <Button type="submit" size="sm" variant="outline" disabled={libraryBusy || !libraryQuery.trim()}>{libraryBusy ? "Searching…" : "Search library"}</Button>
          </form>
          {libraryError ? <p role="alert" className="side-note">{libraryError}</p> : null}
          {librarySearched && !libraryError && !libraryResults.length ? <p role="status" className="side-note">No matching sounds found. Try another description.</p> : null}
          {libraryResults.length ? <ul className="native-library-results">{libraryResults.map((item) => <li key={item.name}><div><strong>{item.displayName}</strong><small>{item.detail} · {item.ownerName}</small></div>{libraryKind === "samples" ? <Button size="sm" variant="ghost" disabled={libraryBusy} onClick={() => void inspectSample(item.name)}>Inspect slices</Button> : null}<Button size="sm" variant="outline" onClick={() => chooseLibrary(item)}>Ask to use</Button></li>)}</ul> : null}
          {sampleAnalysis ? <section className="side-section" aria-label="Original sample audition"><h3>{sampleAnalysis.sample.displayName}</h3><p className="side-note">Original sample only · {sampleAnalysis.measured.durationSeconds.toFixed(2)} seconds. The suggested active slices are {sampleAnalysis.measured.suggestedSlices.slice(0, 4).map((slice) => `${slice.startSeconds}–${slice.endSeconds}s`).join(", ") || "unavailable"}.</p><audio ref={libraryAudioRef} key={`${sampleAnalysis.sample.name}:${sampleAnalysis.contentHash}`} controls preload="none" aria-label={`Listen to original sample ${sampleAnalysis.sample.displayName}`} src={api.sampleAudioUrl(sampleAnalysis.sample.name, sampleAnalysis.contentHash)} onPlay={(event) => claimAudioPlayback(event.currentTarget)} onPlaying={() => setSampleAuditioned(true)} onPause={(event) => releaseAudioPlayback(event.currentTarget)} onEnded={(event) => releaseAudioPlayback(event.currentTarget)} onError={() => { setSampleAuditioned(false); setLibraryError("The sample could not be played. Reinspect it or try another sound.") }} /><details className="side-note"><summary>Sample details & usage</summary><p>{sampleAnalysis.measured.limitations} Listening here does not grant usage rights. Check the source licence before using it.</p></details>{sampleFeedback ? <p role="status" className="side-note">Your listening note is saved for this sample: {sampleFeedback.rating === "fits" ? "Fits this piece" : "Not for this piece"}.</p> : null}<fieldset disabled={!sampleAuditioned || feedbackBusy}><legend>After listening, does it fit this piece?</legend><label><input type="radio" name="sample-fit" checked={feedbackRating === "fits"} onChange={() => setFeedbackRating("fits")} /> Fits</label><label><input type="radio" name="sample-fit" checked={feedbackRating === "not-for-this"} onChange={() => setFeedbackRating("not-for-this")} /> Not for this piece</label><label htmlFor="sample-feedback-note">What did you notice? (optional)</label><textarea id="sample-feedback-note" maxLength={240} value={feedbackNote} onChange={(event) => setFeedbackNote(event.target.value)} placeholder="For example: the attack is too sharp for the opening" /><Button type="button" size="sm" variant="outline" onClick={() => void saveSampleFeedback()} disabled={!sampleAuditioned || feedbackBusy}>{feedbackBusy ? "Saving…" : "Save listening note"}</Button></fieldset></section> : null}
        </> : <p className="side-note">Connect Audiotool to browse its sound library. Your own uploaded sounds remain available separately.</p>}</section>
</div> : null}
      {partsOpen && current ? <>          <section className="native-section parts-section" aria-labelledby="parts-heading">
            <div className="section-heading"><div><h2 id="parts-heading">Parts & instruments</h2><p>Choose one part to change, or let the producer decide.</p></div><Button variant="outline" size="sm" aria-pressed={targetPartId === null} onClick={() => setTargetPartId(null)}>Any part</Button></div>
            {current.document.parts.length > 8 ? <div className="native-role-filters" role="group" aria-label="Filter parts by role">{["all", ...partRoles].map((role) => <Button key={role} size="sm" variant={roleFilter === role ? "default" : "outline"} aria-pressed={roleFilter === role} onClick={() => { setRoleFilter(role); setPartLimit(8) }}>{role === "all" ? `All (${current.document.parts.length})` : `${role} (${current.document.parts.filter((part) => part.role === role).length})`}</Button>)}</div> : null}
            <div className="native-part-grid">{visibleParts.map((part) => { const kept = protectedPartIds.includes(part.id); return <article key={part.id} className={`native-part-card ${targetPartId === part.id ? "is-target" : ""} ${kept ? "is-kept" : ""}`}><span className="native-part-role">{part.role}</span><h3>{part.name}</h3><p>{readableDevice(part.device.type)} · {part.placements.length} {part.placements.length === 1 ? "phrase" : "phrases"}{part.sourceRegions.length ? ` · ${part.sourceRegions.length} owned ${part.sourceRegions.length === 1 ? "clip" : "clips"}` : ""}{part.libraryRegions?.length ? ` · ${part.libraryRegions.length} library ${part.libraryRegions.length === 1 ? "clip" : "clips"}` : ""}</p><div className="part-card-actions"><Button size="sm" variant={targetPartId === part.id ? "default" : "outline"} aria-label={`Change ${part.name}`} aria-pressed={targetPartId === part.id} disabled={kept} onClick={() => { setTargetPartId((prior) => prior === part.id ? null : part.id); focusDirection() }}>{targetPartId === part.id ? "Selected" : "Change"}</Button><Button size="sm" variant="ghost" onClick={() => setDetailsPartId(part.id)}>Details</Button><Button size="sm" variant="ghost" aria-label={`${kept ? "Allow changes to" : "Keep unchanged"} ${part.name} for the next change`} aria-pressed={kept} onClick={() => { if (!kept && targetPartId === part.id) setTargetPartId(null); setProtectedPartIds((prior) => kept ? prior.filter((value) => value !== part.id) : [...prior, part.id]) }}><LockKeyhole className="size-3" /> {kept ? "Kept" : "Keep"}</Button></div></article> })}</div>
            {filteredParts.length > visibleParts.length ? <Button className="mt-3" variant="outline" size="sm" onClick={() => setPartLimit((count) => count + 8)}>Show more parts ({filteredParts.length - visibleParts.length} remaining)</Button> : null}
            <p className="section-footnote">“Keep” protects a part when you submit your next change. You can allow changes again before submitting.</p>
          </section></> : null}
      {panel === "history" ? <section className="native-section versions-section">{snapshot && snapshot.versions.length > 1 ? <Button variant="outline" size="sm" onClick={() => openComparison()}><GitCompareArrows className="size-4" /> Compare</Button> : null}{snapshot?.versions.length ? <div className="version-quick-list">{snapshot.versions.map((version) => <Button variant="ghost" key={version.id} disabled={snapshot.versions.length < 2} onClick={() => openComparison(version.id)}><span>Version {version.ordinal}{version.id === snapshot.currentRevisionId ? <small className="version-badge">Current</small> : null}<span>{arrangementSummary(version)}</span></span></Button>)}</div> : <p>Your first version will appear when the arrangement is complete.</p>}</section> : null}
      {panel === "audiotool" ? <><p>{current ? syncMessage : "Finish the arrangement to copy it to Audiotool."}</p>{snapshot?.synchronization.error ? <details><summary>Connection details</summary><p>{snapshot.synchronization.error}</p></details> : null}{currentRemoteVerification && snapshot?.synchronization.url ? <Button variant="outline" onClick={() => window.open(snapshot.synchronization.url!, "_blank", "noopener,noreferrer")}>Open in Audiotool</Button> : null}<Button disabled={busy || (audiotoolConnected && (!current || Boolean(activeJob))) || !audiotoolAvailable || ["conflict", "uncertain", "needs_attention", "applying"].includes(syncState)} onClick={() => audiotoolConnected ? void synchronize() : onConnectAudiotool()}>{audiotoolConnected ? currentRemoteVerification ? "Recheck Audiotool copy" : "Copy to Audiotool" : "Connect Audiotool"}</Button></> : null}
      </div></ToolContent>
    </ToolOverlay>

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
