import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { ArrowRight, Check, GitCompareArrows, Headphones, LockKeyhole, Music2, Play, Plus, RotateCcw, Search, ShieldCheck, Sparkles } from "lucide-react"
import { api, type Asset, type Job, type NativeDraftView, type NativeSnapshot } from "../../lib/api"
import { arrangementSummary, friendlyIssue, jobProgress, readableDevice, readableEffect } from "../../lib/ui-copy"
import { Button } from "../../components/ui/button"
import { RoomHero } from "../../components/room-hero"
import { Textarea } from "../../components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog"
import { RadioGroup, RadioGroupItem } from "../../components/ui/radio-group"
import { defaultNativeDirection, freshNativeDraft, nativeDraftKey, reconcileNativeDraft } from "./native-draft"

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
  const [direction, setDirection] = useState(defaultNativeDirection(false))
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
  const [compareOpen, setCompareOpen] = useState(false)
  const [compareId, setCompareId] = useState<string | null>(null)
  const [detailsPartId, setDetailsPartId] = useState<string | null>(null)
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
  const currentRemoteVerification = snapshot?.synchronization.state === "verified" && snapshot.synchronization.revisionId === current?.id && snapshot.synchronization.mappingVersion === "nexus-native-v5"
  const receiptKey = `pocket-producer:native-receipt:${projectId}`

  useEffect(() => {
    let active = true
    setDraftProjectId(null); setLoading(true); setSnapshot(null); setJob(null); setTentative(null); setTentativeError(null); setError(null); setTargetPartId(null); setTargetSectionId(null); setProtectedPartIds([]); setSourceIds([]); setRoleFilter("all"); setPartLimit(8)
    void api.nativeSnapshot(projectId).then((value) => {
      if (!active) return
      let stored: unknown = null
      try { stored = JSON.parse(localStorage.getItem(nativeDraftKey(projectId)) ?? "null") } catch { /* A malformed browser draft has no authority. */ }
      const restored = reconcileNativeDraft(stored, value, assetsRef.current)
      setSnapshot(value); setDirection(restored.draft.direction); setProfile(restored.draft.profile ?? "standard"); setTargetPartId(restored.draft.targetPartId); setTargetSectionId(restored.draft.targetSectionId); setProtectedPartIds(restored.draft.protectedPartIds); setSourceIds(restored.draft.sourceIds); setDraftNotices(restored.notices); setDraftProjectId(projectId)
      setLoading(false)
      try {
        const raw = localStorage.getItem(receiptKey)
        if (raw) {
          const receipt = JSON.parse(raw) as Receipt
          if (receipt.jobId) void api.job(receipt.jobId).then(async (value) => { if (active) { setJob(value); if (terminal.has(value.state)) setSnapshot(await api.nativeSnapshot(projectId)) } })
          else void api.commandReceipt(projectId, receipt.operation, receipt.key).then(async ({ job: found }) => { if (active && found) { setJob(found); localStorage.setItem(receiptKey, JSON.stringify({ ...receipt, jobId: found.id })); if (terminal.has(found.state)) setSnapshot(await api.nativeSnapshot(projectId)) } })
        }
      } catch { /* A malformed local receipt cannot change server state. */ }
    }).catch((cause: unknown) => { if (active) { setLoading(false); setError(cause instanceof Error ? cause.message : "Unable to load native construction") } })
    return () => { active = false }
  }, [projectId, receiptKey])

  useEffect(() => {
    if (draftProjectId !== projectId) return
    localStorage.setItem(nativeDraftKey(projectId), JSON.stringify({ headId: snapshot?.currentRevisionId ?? null, direction, profile, targetPartId, targetSectionId, protectedPartIds, sourceIds }))
  }, [draftProjectId, projectId, snapshot?.currentRevisionId, direction, profile, targetPartId, targetSectionId, protectedPartIds, sourceIds])

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(() => { void api.nativeCapabilities(capabilityQuery).then((value) => { if (active) setCapabilities(value.matches) }).catch(() => undefined) }, 180)
    return () => { active = false; window.clearTimeout(timer) }
  }, [capabilityQuery])

  useEffect(() => {
    if (!job || terminal.has(job.state)) return
    let active = true
    const timer = window.setInterval(() => {
      void api.job(job.id).then(async (value) => {
        if (!active) return
        if (terminal.has(value.state)) {
          const fresh = await api.nativeSnapshot(projectId)
          if (active) { setSnapshot(fresh); setJob(value); if (value.state === "succeeded") { if (value.kind !== "native-sync") { const reset = freshNativeDraft(fresh); setDirection(reset.direction); setTargetPartId(null); setTargetSectionId(null); setProtectedPartIds(reset.protectedPartIds); setSourceIds([]); setDraftNotices([]) } setTentative(null); setTentativeError(null); localStorage.removeItem(receiptKey); onProjectUpdated() } }
        } else if (active) setJob(value)
      }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Unable to check construction progress") })
    }, 900)
    return () => { active = false; window.clearInterval(timer) }
  }, [job, projectId, receiptKey, onProjectUpdated])

  useEffect(() => {
    if (!job || !["native-generation", "native-revision"].includes(job.kind) || job.state === "succeeded" || job.state === "cancelled") { setTentative(null); setTentativeError(null); return }
    let active = true
    const inspect = () => { void api.nativeDraft(projectId, job.id).then((view) => { if (active) { setTentative(view); setTentativeError(null) } }).catch((cause: unknown) => { if (active) setTentativeError(cause instanceof Error ? cause.message : "The saved draft could not be checked") }) }
    inspect()
    const timer = !terminal.has(job.state) ? window.setInterval(inspect, 1800) : null
    return () => { active = false; if (timer !== null) window.clearInterval(timer) }
  }, [job?.id, job?.state, projectId])

  const selectedVersion = useMemo(() => snapshot?.versions.find((value) => value.id === compareId) ?? null, [snapshot, compareId])
  const activeJob = job && !terminal.has(job.state) ? job : null
  const selectedSection = current?.document.sections.find((section) => section.id === targetSectionId)
  const selectedPart = current?.document.parts.find((part) => part.id === targetPartId)
  const detailsPart = current?.document.parts.find((part) => part.id === detailsPartId)
  const comparison = selectedVersion ? snapshot?.comparisons[selectedVersion.id] : null
  const partName = (id: string) => current?.document.parts.find((part) => part.id === id)?.name ?? selectedVersion?.document.parts.find((part) => part.id === id)?.name ?? id
  const focusDirection = () => document.getElementById("native-direction")?.focus()
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
    if (!direction.trim() || busy || activeJob) return
    const head = snapshot?.currentRevisionId ?? null
    const operation: Receipt["operation"] = head ? "native-revision" : "native-generation"
    const signature = JSON.stringify({ operation, head, direction: direction.trim(), profile, targetPartId, targetSectionId, protectedPartIds: [...protectedPartIds].sort(), sourceIds: [...sourceIds].sort() })
    const storageKey = `pocket-producer:native-command:${projectId}:${signature}`
    const key = freshAttempt ? crypto.randomUUID() : localStorage.getItem(storageKey) ?? crypto.randomUUID()
    localStorage.setItem(storageKey, key)
    const receipt: Receipt = { operation, key, jobId: null, signature }
    localStorage.setItem(receiptKey, JSON.stringify(receipt))
    setBusy(true); setError(null)
    try {
      const savedProtections = current?.document.protectedPartIds ?? []
      const protectionChanged = JSON.stringify([...savedProtections].sort()) !== JSON.stringify([...protectedPartIds].sort())
      const result = head ? await api.reviseNative(projectId, { direction: direction.trim(), profile, baseNativeRevisionId: head, expectedNativeHeadId: head, ...(targetPartId ? { targetPartId } : {}), ...(targetSectionId ? { targetSectionId } : {}), ...(protectionChanged ? { protectionChange: { expectedPartIds: savedProtections, desiredPartIds: protectedPartIds } } : {}), sourceAssetIds: sourceIds }, key) : await api.constructNative(projectId, direction.trim(), sourceIds, key, profile)
      localStorage.setItem(receiptKey, JSON.stringify({ ...receipt, jobId: result.jobId }))
      const accepted = await api.job(result.jobId)
      setJob(accepted)
      if (terminal.has(accepted.state)) { const fresh = await api.nativeSnapshot(projectId); setSnapshot(fresh); if (accepted.state === "succeeded") { const reset = freshNativeDraft(fresh); setDirection(reset.direction); setTargetPartId(null); setTargetSectionId(null); setProtectedPartIds(reset.protectedPartIds); setSourceIds([]); setDraftNotices([]); localStorage.removeItem(receiptKey) } }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Construction request failed. Its receipt remains available for reconciliation.") }
    finally { setBusy(false) }
  }

  const restore = async () => {
    if (!snapshot?.currentRevisionId || !selectedVersion || busy) return
    setBusy(true); setError(null)
    try {
      await api.selectNativeVersion(projectId, selectedVersion.id, snapshot.currentRevisionId)
      const fresh = await api.nativeSnapshot(projectId)
      const restored = reconcileNativeDraft({ headId: snapshot.currentRevisionId, direction, targetPartId, targetSectionId, protectedPartIds, sourceIds }, fresh, assets)
      setSnapshot(fresh); setDirection(restored.draft.direction); setTargetPartId(restored.draft.targetPartId); setTargetSectionId(restored.draft.targetSectionId); setProtectedPartIds(restored.draft.protectedPartIds); setSourceIds(restored.draft.sourceIds); setDraftNotices(restored.notices); setCompareOpen(false)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to restore native version") }
    finally { setBusy(false) }
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
    setBusy(true); setError(null)
    try {
      await api.extendNative(projectId, job.id)
      setTentative(await api.nativeDraft(projectId, job.id))
      await api.continueNative(projectId, job.id)
      setJob(await api.job(job.id))
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to extend this saved draft") }
    finally { setBusy(false) }
  }

  if (loading) return <div className="empty-surface" role="status">Opening your arrangement…</div>
  return <div className="native-room">
    <RoomHero status={activeJob ? "Taking shape" : current ? "Ready to shape" : "A fresh start"} title={current?.document.title ?? "Make something yours"} description={current ? "Explore the sections and parts below, then tell us what you want to change." : "Describe the music you have in mind. We’ll make an editable arrangement you can keep shaping."} meta={current ? `${current.document.bars} bars · ${current.document.sections.length} sections · ${current.document.parts.length} editable parts` : "Start with an idea · Add your own sounds if you like"} actions={<Button onClick={focusDirection}><Sparkles className="size-4" /> {current ? "Shape this arrangement" : "Describe your idea"}</Button>} />

    <div className="native-audio-boundary" role="note"><Headphones className="size-5" /><div><strong>This arrangement isn't playable yet.</strong><p>You can shape its notes, sounds and sections now. {legacyVersionCount ? <button className="text-link" onClick={onLegacy}>Listen to your separate playable audio</button> : "Sounds you add can still be auditioned below."}</p></div></div>
    {activeJob ? <div className="job-status" role="status" aria-live="polite"><strong>{jobProgress(activeJob)}</strong><span>Your request continues if you leave this room. Accepted versions stay safe.{tentative?.runLimits ? ` ${tentative.runLimits.profile === "extended" ? "Extended" : "Standard"} depth: up to ${tentative.runLimits.maxCalls} producer steps, ${Math.round(tentative.runLimits.deadlineSeconds / 60)} minutes, and $${tentative.runLimits.maxJobCostUsd.toFixed(2)} for this request, subject to the installation's remaining allowance.` : ""}</span><Button size="sm" variant="ghost" onClick={() => void api.cancel(activeJob.id).then(() => api.job(activeJob.id)).then(setJob)}>Stop this request</Button></div> : null}
    {job && terminal.has(job.state) && job.state !== "succeeded" ? <div className="job-status" role="alert">
      <strong>{job.error_code === "NATIVE_PARTIAL" ? "This arrangement is still in progress" : job.state === "needs_attention" ? "We need to check what happened" : job.state === "cancelled" ? "Request stopped" : "We couldn't finish that change"}</strong>
      <span>{job.error_code === "NATIVE_PARTIAL" ? "Confirmed steps are saved with this request, but this unfinished draft has not replaced your current version." : friendlyIssue(job.error_message, "Your earlier version is safe.")}</span>
      {job.error_code === "NATIVE_PARTIAL" ? <>{tentative?.canContinue ? <Button className="mt-3" variant="outline" size="sm" onClick={() => void continuePartial()} disabled={busy}>Continue saved draft</Button> : <p className="provider-note">{tentative?.continuationReason ?? "Checking whether this draft can continue…"}</p>}{tentative?.canExtend ? <div><Button className="mt-3" variant="outline" size="sm" onClick={() => void extendPartial()} disabled={busy}>Extend this request and continue</Button><p className="provider-note">Moves this saved request to Extended depth without resetting past work or spending. Any later model calls remain subject to your installation’s overall allowance.</p></div> : null}</> : ["failed", "cancelled"].includes(job.state) ? <Button className="mt-3" variant="outline" size="sm" onClick={() => void submit(true)} disabled={busy}>Try again as a new request</Button> : <p className="provider-note">A new request is paused until the earlier outcome is known.</p>}
      {job.error_message ? <details className="room-technical"><summary>Technical details</summary><p>{job.error_message}</p></details> : null}
    </div> : null}
    {job && tentative?.plan && tentative.jobId === job.id && job.state !== "succeeded" ? <section className="native-section native-draft-preview" aria-label="Production plan"><div className="section-heading"><div><h2>Where your music is heading</h2><p>{tentative.plan.stage === "planned" ? "Planning the piece" : tentative.plan.stage === "building" ? "Building the arrangement" : tentative.plan.stage === "refining" ? "Adding detail" : "Reviewing the structure"} · saved with this request</p></div></div><p>{tentative.plan.plan.intent}</p><ol>{tentative.plan.plan.sections.map((section, index) => <li key={`${section.name}-${index}`}><strong>{section.name}</strong> — {section.purpose}</li>)}</ol><p className="section-footnote">This is a construction plan, not accepted music or a playable preview.</p></section> : null}
    {job && tentative?.document && tentative.jobId === job.id && job.state !== "succeeded" ? <section className="native-section native-draft-preview" aria-label="Unfinished arrangement preview">
      <div className="section-heading"><div><h2>Work in progress</h2><p>Not your current version · {tentative.stepCount} confirmed {tentative.stepCount === 1 ? "change" : "changes"}</p></div></div>
      <p>{tentative.document.bars} bars across {tentative.document.sections.length} sections. {tentative.document.parts.length} editable {tentative.document.parts.length === 1 ? "part" : "parts"} currently in the draft.</p>
      <p><strong>Sections:</strong> {tentative.document.sections.map((section) => `${section.name} (${section.endBar - section.startBar} bars)`).join(" · ")}</p>
      <p><strong>Parts so far:</strong> {tentative.document.parts.slice(0, 8).map((part) => part.name).join(", ")}{tentative.document.parts.length > 8 ? ` and ${tentative.document.parts.length - 8} more` : ""}</p>
      <p className="section-footnote">This is a saved structural draft. It is not selected, synchronized or playable.</p>
    </section> : null}
    {tentativeError ? <p className="provider-note" role="alert">The saved draft could not be inspected: {tentativeError}</p> : null}
    {error ? <div className="job-status" role="alert"><strong>Something needs attention</strong><span>{friendlyIssue(error, "We couldn't complete that action. Your saved versions are unchanged.")}</span><details className="room-technical"><summary>Technical details</summary><p>{error}</p></details></div> : null}

    <div className="workspace-panel">
      <div className="workspace-main">
        {current ? <>
          <section className="native-section arrangement-section" aria-labelledby="arrangement-heading"><div className="section-heading"><div><h2 id="arrangement-heading">Arrangement</h2><p>Choose a section to focus your next change.</p></div><Button variant="outline" size="sm" aria-pressed={targetSectionId === null} onClick={() => setTargetSectionId(null)}>Whole piece</Button></div><div className="native-section-grid">{current.document.sections.map((section, index) => <button key={section.id} type="button" className="native-section-card" aria-pressed={targetSectionId === section.id} onClick={() => setTargetSectionId((prior) => prior === section.id ? null : section.id)}><span className="section-card-copy"><small>{String(index + 1).padStart(2, "0")}</small><strong>{section.name}</strong><span>Bars {section.startBar + 1}–{section.endBar}</span><em>{section.intent}</em></span><span className={`section-card-art art-variant-${index % 5}`} aria-hidden="true" /></button>)}</div></section>
          <section className="native-section parts-section" aria-labelledby="parts-heading">
            <div className="section-heading"><div><h2 id="parts-heading">Parts & instruments</h2><p>Choose one part to change, or let the producer decide.</p></div><Button variant="outline" size="sm" aria-pressed={targetPartId === null} onClick={() => setTargetPartId(null)}>Any part</Button></div>
            {current.document.parts.length > 8 ? <div className="native-role-filters" role="group" aria-label="Filter parts by role">{["all", ...partRoles].map((role) => <Button key={role} size="sm" variant={roleFilter === role ? "default" : "outline"} aria-pressed={roleFilter === role} onClick={() => { setRoleFilter(role); setPartLimit(8) }}>{role === "all" ? `All (${current.document.parts.length})` : `${role} (${current.document.parts.filter((part) => part.role === role).length})`}</Button>)}</div> : null}
            <div className="native-part-grid">{visibleParts.map((part) => { const kept = protectedPartIds.includes(part.id); return <article key={part.id} className={`native-part-card ${targetPartId === part.id ? "is-target" : ""} ${kept ? "is-kept" : ""}`}><span className="native-part-role">{part.role}</span><h3>{part.name}</h3><p>{readableDevice(part.device.type)} · {part.placements.length} {part.placements.length === 1 ? "phrase" : "phrases"}{part.sourceRegions.length ? ` · ${part.sourceRegions.length} owned ${part.sourceRegions.length === 1 ? "clip" : "clips"}` : ""}{part.libraryRegions?.length ? ` · ${part.libraryRegions.length} library ${part.libraryRegions.length === 1 ? "clip" : "clips"}` : ""}</p><div className="part-card-actions"><Button size="sm" variant={targetPartId === part.id ? "default" : "outline"} aria-label={`Change ${part.name}`} aria-pressed={targetPartId === part.id} disabled={kept} onClick={() => { setTargetPartId((prior) => prior === part.id ? null : part.id); focusDirection() }}>{targetPartId === part.id ? "Selected" : "Change"}</Button><Button size="sm" variant="ghost" onClick={() => setDetailsPartId(part.id)}>Details</Button><Button size="sm" variant="ghost" aria-label={`${kept ? "Allow changes to" : "Keep unchanged"} ${part.name} for the next change`} aria-pressed={kept} onClick={() => { if (!kept && targetPartId === part.id) setTargetPartId(null); setProtectedPartIds((prior) => kept ? prior.filter((value) => value !== part.id) : [...prior, part.id]) }}><LockKeyhole className="size-3" /> {kept ? "Kept" : "Keep"}</Button></div></article> })}</div>
            {filteredParts.length > visibleParts.length ? <Button className="mt-3" variant="outline" size="sm" onClick={() => setPartLimit((count) => count + 8)}>Show more parts ({filteredParts.length - visibleParts.length} remaining)</Button> : null}
            <p className="section-footnote">“Keep” protects a part when you submit your next change. You can allow changes again before submitting.</p>
          </section>
        </> : <section className="native-start"><Music2 className="size-8 text-primary" /><h2>Start with your idea</h2><p>A few words are enough. Adding a sound is optional, and your first arrangement can be changed later.</p></section>}

        <section className="direction-section" aria-labelledby="direction-heading"><div className="section-heading"><div><h2 id="direction-heading">{current ? "What would you like to change?" : "What are you making?"}</h2><p>{current ? `${selectedSection ? `In ${selectedSection.name}` : "Across the whole piece"} · ${selectedPart ? `change ${selectedPart.name}` : "choose any part"}${protectedPartIds.length ? ` · keep ${protectedPartIds.map(partName).join(", ")} unchanged` : ""}` : "Describe a mood, rhythm, instrument or moment. A detailed brief is welcome; recordings are optional."}</p></div></div>{draftNotices.length ? <div className="job-status" role="status">{draftNotices.map((notice) => <p key={notice}>{notice}</p>)}</div> : null}<form className="composer native-composer" onSubmit={(event) => { event.preventDefault(); void submit() }}><label htmlFor="native-direction" className="sr-only">Describe your arrangement</label><Textarea id="native-direction" value={direction} maxLength={32_768} onChange={(event) => setDirection(event.target.value)} placeholder={current ? "For example: Make the later section feel bigger with a brighter pad." : "For example: A slow, spacious instrumental with a clear melody."} disabled={Boolean(activeJob)} /><div className="native-brief-options"><span>{direction.length.toLocaleString()} / 32,768 characters</span><label htmlFor="native-profile">Depth <select id="native-profile" value={profile} onChange={(event) => setProfile(event.target.value as "standard" | "extended")} disabled={Boolean(activeJob)}><option value="standard">Standard — focused arrangement</option><option value="extended">Extended — detailed composition</option></select></label></div><div className="composer-actions"><div className="chips"><span className="chip"><Sparkles className="mr-1 size-3" /> {current ? selectedSection?.name ?? "Whole piece" : "New arrangement"}</span>{selectedPart ? <span className="chip">{selectedPart.name}</span> : null}{protectedPartIds.length ? <span className="chip"><ShieldCheck className="mr-1 size-3" /> Keep {protectedPartIds.length} {protectedPartIds.length === 1 ? "part" : "parts"}</span> : null}{sourceIds.length ? <span className="chip">{sourceIds.length} {sourceIds.length === 1 ? "sound" : "sounds"} selected</span> : null}</div><Button type="submit" disabled={busy || Boolean(activeJob) || direction.trim().length < 3}><Sparkles className="size-4" /> {current ? "Shape the arrangement" : "Create arrangement"} <ArrowRight className="size-4" /></Button></div></form><p className="section-footnote">{current ? "A successful change becomes the current version automatically. You can compare or restore any earlier version." : "This creates an editable arrangement, not a playable recording."} Extended requests may take longer and use more of the installation's remaining provider allowance.</p></section>

        <section className="native-section versions-section"><div className="section-heading"><div><h2>Versions</h2><p>{snapshot?.versions.length ? `${snapshot.versions.length} saved ${snapshot.versions.length === 1 ? "version" : "versions"}. Compare changes or return to an earlier one.` : "Your first saved arrangement will appear here."}</p></div><Button variant="outline" size="sm" onClick={() => { setCompareId(snapshot?.currentRevisionId ?? null); setCompareOpen(true) }} disabled={!snapshot?.versions.length}><GitCompareArrows className="size-4" /> Compare</Button></div>{current ? <p className="version-current"><Check className="size-4" /> Version {current.ordinal} is current · {arrangementSummary(current)}</p> : null}</section>
      </div>

      <aside className="workspace-side" aria-label="Arrangement tools">
        <section className="side-section"><div className="section-heading"><h2>Your sounds</h2><Button size="sm" variant="outline" onClick={onAddSource}><Plus className="size-4" /> Add</Button></div>{assets.length ? <div className="source-card-list">{assets.map((asset) => <div className="source-card" key={asset.id}><button type="button" className="source-play" aria-label={`Play sound ${asset.name}`} onClick={() => onAuditionSource(asset.id)}><Play className="size-4" /></button><div className="source-card-name"><strong>{asset.name}</strong><small>{Math.round(asset.durationSeconds)} seconds · your sound</small></div><label className="source-select"><input type="checkbox" aria-label={`Use ${asset.name} in the next arrangement change`} checked={sourceIds.includes(asset.id)} onChange={(event) => setSourceIds((prior) => event.target.checked ? [...prior, asset.id] : prior.filter((value) => value !== asset.id))} /><span className="sr-only">Use in the next change</span></label></div>)}</div> : <p className="side-empty">Add or record a WAV if you want the producer to work with your own sound.</p>}{sourcePreview}<p className="side-note">Selected sounds may be placed in the arrangement. Placement alone does not confirm how they will sound.</p></section>
        <section className="side-section"><div className="section-heading"><h2>Sounds & instruments</h2></div><p className="side-note">Explore the kinds of parts we can shape. These aren't playable presets.</p><div className="sound-family-list"><div><span className="family-icon rhythm">▥</span><span><strong>Drums</strong><small>Patterns and pulse</small></span></div><div><span className="family-icon bass">〰</span><span><strong>Bass</strong><small>Low-end movement</small></span></div><div><span className="family-icon keys">▦</span><span><strong>Keys & pads</strong><small>Harmony and atmosphere</small></span></div><div><span className="family-icon lead">⌁</span><span><strong>Leads</strong><small>Melodies and responses</small></span></div><div><span className="family-icon effects">✳</span><span><strong>Effects</strong><small>Space, motion and dynamics</small></span></div></div><details className="native-palette"><summary>Explore detailed capabilities</summary><p className="side-note">This reference includes capabilities that may not yet be available for construction.</p><label className="native-search"><Search className="size-4" /><span className="sr-only">Search detailed capabilities</span><input value={capabilityQuery} onChange={(event) => setCapabilityQuery(event.target.value)} placeholder="Find instruments or effects" /></label><div className="native-capability-grid">{capabilities.slice(0, 12).map((item) => <div key={item.type} className="native-capability"><strong>{item.type}</strong><span>{item.family}</span><small>{item.purpose}</small><small>{item.writableInPocketProducer ? "Available for construction" : "Reference only"}</small></div>)}</div></details></section>
        <section className="side-section inspiration-section"><h2>Need inspiration?</h2><p className="side-note">Choose a starting point, then make it your own.</p><div className="suggestion-list">{(current ? [`Build more energy in ${current.document.sections[Math.min(1, current.document.sections.length - 1)]?.name ?? "the middle"}`, `Make ${current.document.sections[0]?.name ?? "the opening"} more minimal`, `Give ${current.document.parts.find((part) => part.role === "melody")?.name ?? "the melody"} a new response`] : ["A calm opening that grows into a pulse", "A sparse rhythm with a memorable melody", "An atmospheric piece with contrasting sections"]).map((prompt) => <button key={prompt} type="button" onClick={() => suggest(prompt)}>{prompt}<ArrowRight className="size-4" /></button>)}</div></section>
        {current ? <section className="side-section audiotool-section"><h2>Editable in Audiotool</h2><p>{syncMessage}</p><div className="side-actions">{currentRemoteVerification && snapshot?.synchronization.url ? <Button variant="outline" size="sm" onClick={() => window.open(snapshot.synchronization.url ?? "", "_blank", "noopener,noreferrer")}>Open in Audiotool</Button> : null}{audiotoolConnected && !["uncertain", "conflict", "applying", "needs_attention"].includes(syncState) ? <Button variant="outline" size="sm" disabled={busy || Boolean(activeJob)} onClick={() => void synchronize()}>{currentRemoteVerification ? "Recheck copy" : "Make editable copy"}</Button> : !audiotoolConnected && audiotoolAvailable ? <Button variant="outline" size="sm" onClick={onConnectAudiotool}>Connect Audiotool</Button> : null}</div>{snapshot?.synchronization.error ? <details className="room-technical"><summary>Technical details</summary><p>{snapshot.synchronization.error}</p></details> : null}</section> : null}
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
      </aside>
    </div>

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
          {detailsPart.groupId && current?.document.groups?.find((group) => group.id === detailsPart.groupId)?.compressor?.isActive ? <p><strong>Shared processing:</strong> Group compression{current.document.groups.find((group) => group.id === detailsPart.groupId)?.sidechainFromPartId ? ` guided by ${partName(current.document.groups.find((group) => group.id === detailsPart.groupId)!.sidechainFromPartId!)}` : ""}</p> : null}
          {current?.document.master ? <p><strong>Final mix:</strong> {Math.round(current.document.master.gain * 100)}% level · {current.document.master.limiterEnabled ? "limiter on" : "limiter off"}</p> : null}
          <p><strong>Processing:</strong> {detailsPart.effects.length ? detailsPart.effects.map((effect) => readableEffect(effect.type)).join(", ") : "None"}{detailsPart.parallel ? ` · Parallel blend ${Math.round(detailsPart.parallel.wetMix * 100)}%: ${detailsPart.parallel.effects.map((effect) => readableEffect(effect.type)).join(", ")}` : ""}</p>
          <p><strong>Motion:</strong> {detailsPart.automation.length ? detailsPart.automation.map((curve) => curve.target).join(", ") : "No changing controls"}</p>
          {Object.keys(detailsPart.device.parameters).length ? <details className="room-technical"><summary>Sound settings</summary><dl>{Object.entries(detailsPart.device.parameters).map(([name, value]) => <div key={name}><dt>{name.replaceAll(".", " · ")}</dt><dd>{value}</dd></div>)}</dl></details> : null}
        </div> : null}
        <DialogFooter className="-mx-6 -mb-6"><Button variant="outline" onClick={() => setDetailsPartId(null)}>Close</Button><Button disabled={!detailsPart || protectedPartIds.includes(detailsPart.id)} onClick={() => { if (detailsPart) setTargetPartId(detailsPart.id); setDetailsPartId(null); window.setTimeout(focusDirection, 0) }}>Change this part</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto bg-popover p-6">
        <DialogHeader><DialogTitle className="font-heading text-2xl">Compare arrangements</DialogTitle><DialogDescription>See what changed from the current version. Restoring one changes only this room's selected version; it does not rewrite Audiotool.</DialogDescription></DialogHeader>
        <RadioGroup value={compareId ?? undefined} onValueChange={setCompareId} aria-label="Version to compare" className="version-list">
          {snapshot?.versions.map((version) => <label key={version.id} className="version-option"><RadioGroupItem value={version.id} aria-label={`Version ${version.ordinal}`} /><span><span className="version-title">Version {version.ordinal} {version.id === snapshot.currentRevisionId ? <span className="chip"><Check className="mr-1 size-3" /> Current</span> : null}</span><p>{arrangementSummary(version)}</p><small>{version.document.bars} bars · {version.document.parts.length} parts</small></span></label>)}
        </RadioGroup>
        {selectedVersion && comparison ? <div className="native-diff"><strong>Version {selectedVersion.ordinal} compared with current version {snapshot?.current?.ordinal}</strong><p><b>Parts added:</b> {comparison.addedParts.map(partName).join(", ") || "None"} · <b>Changed:</b> {comparison.changedParts.map(partName).join(", ") || "None"} · <b>Removed:</b> {comparison.removedParts.map(partName).join(", ") || "None"}</p>{comparison.partChanges.length ? <ul>{comparison.partChanges.map((change) => <li key={change.partId}><b>{partName(change.partId)}:</b> {change.fields.map((field) => ({ device: "instrument or preset", sourceRegions: "owned clips", libraryRegions: "library clips", groupId: "group routing", sends: "shared sends", automation: "changing controls", placements: "phrases" } as Record<string, string>)[field] ?? field).join(", ")}</li>)}</ul> : null}<p><b>Sections changed:</b> {comparison.changedSections.join(", ") || "None"} · <b>Tempo:</b> {comparison.tempoChange ? `${comparison.tempoChange.from} → ${comparison.tempoChange.to} BPM` : "Unchanged"} · <b>Shared routing:</b> {comparison.routingChange ? "Changed" : "Unchanged"}</p><p><b>Parts kept unchanged:</b> {comparison.protectionChange.added.map(partName).join(", ") || "None"} · <b>Allowed to change:</b> {comparison.protectionChange.removed.map(partName).join(", ") || "None"}</p></div> : null}
        <DialogFooter className="-mx-6 -mb-6"><Button variant="outline" onClick={() => setCompareOpen(false)}>Keep current</Button><Button onClick={() => void restore()} disabled={!selectedVersion || selectedVersion.id === snapshot?.currentRevisionId || busy}><RotateCcw className="size-4" /> Restore this version</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
}
