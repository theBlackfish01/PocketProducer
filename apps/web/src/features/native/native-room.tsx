import { useEffect, useMemo, useState, type ReactNode } from "react"
import { ArrowRight, Check, GitCompareArrows, Headphones, LockKeyhole, Music2, Play, Plus, RotateCcw, Search, ShieldCheck, Sparkles } from "lucide-react"
import { api, type Asset, type Job, type NativeSnapshot } from "../../lib/api"
import { arrangementSummary, friendlyIssue, jobProgress, readableDevice, readableEffect } from "../../lib/ui-copy"
import { Button } from "../../components/ui/button"
import { RoomHero } from "../../components/room-hero"
import { Textarea } from "../../components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog"
import { RadioGroup, RadioGroupItem } from "../../components/ui/radio-group"

const terminal = new Set(["succeeded", "failed", "cancelled", "needs_attention"])
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
  const [direction, setDirection] = useState("Build an evolving instrumental with a clear motif and contrasting sections.")
  const [targetPartId, setTargetPartId] = useState<string | null>(null)
  const [targetSectionId, setTargetSectionId] = useState<string | null>(null)
  const [protectedPartIds, setProtectedPartIds] = useState<string[]>([])
  const [sourceIds, setSourceIds] = useState<string[]>([])
  const [job, setJob] = useState<Job | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)
  const [compareId, setCompareId] = useState<string | null>(null)
  const [detailsPartId, setDetailsPartId] = useState<string | null>(null)
  const [capabilityQuery, setCapabilityQuery] = useState("")
  const [capabilities, setCapabilities] = useState<Array<{ type: string; family: string; purpose: string; writableInPocketProducer: boolean }>>([])
  const current = snapshot?.current ?? null
  const currentRemoteVerification = snapshot?.synchronization.state === "verified" && snapshot.synchronization.revisionId === current?.id && snapshot.synchronization.mappingVersion === "nexus-native-v2"
  const receiptKey = `pocket-producer:native-receipt:${projectId}`

  useEffect(() => {
    let active = true
    setLoading(true); setSnapshot(null); setJob(null); setError(null); setTargetPartId(null); setTargetSectionId(null); setProtectedPartIds([]); setSourceIds([])
    void api.nativeSnapshot(projectId).then((value) => {
      if (!active) return
      setSnapshot(value); setProtectedPartIds(value.current?.document.protectedPartIds ?? [])
      setTargetPartId(null)
      setTargetSectionId(null)
      setDirection(value.current ? "Develop the later section with a variation while keeping the selected parts unchanged." : "Build an evolving instrumental with a clear motif and contrasting sections.")
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
          if (active) { setSnapshot(fresh); setProtectedPartIds(fresh.current?.document.protectedPartIds ?? []); setJob(value); if (value.state === "succeeded") { localStorage.removeItem(receiptKey); onProjectUpdated() } }
        } else if (active) setJob(value)
      }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Unable to check construction progress") })
    }, 900)
    return () => { active = false; window.clearInterval(timer) }
  }, [job, projectId, receiptKey, onProjectUpdated])

  const selectedVersion = useMemo(() => snapshot?.versions.find((value) => value.id === compareId) ?? null, [snapshot, compareId])
  const activeJob = job && !terminal.has(job.state) ? job : null
  const selectedSection = current?.document.sections.find((section) => section.id === targetSectionId)
  const selectedPart = current?.document.parts.find((part) => part.id === targetPartId)
  const detailsPart = current?.document.parts.find((part) => part.id === detailsPartId)
  const comparison = selectedVersion ? snapshot?.comparisons[selectedVersion.id] : null
  const partName = (id: string) => current?.document.parts.find((part) => part.id === id)?.name ?? selectedVersion?.document.parts.find((part) => part.id === id)?.name ?? id
  const focusDirection = () => document.getElementById("native-direction")?.focus()
  const suggest = (value: string) => { setDirection(value); window.requestAnimationFrame(focusDirection) }
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
    const signature = JSON.stringify({ operation, head, direction: direction.trim(), targetPartId, targetSectionId, protectedPartIds: [...protectedPartIds].sort(), sourceIds: [...sourceIds].sort() })
    const storageKey = `pocket-producer:native-command:${projectId}:${signature}`
    const key = freshAttempt ? crypto.randomUUID() : localStorage.getItem(storageKey) ?? crypto.randomUUID()
    localStorage.setItem(storageKey, key)
    const receipt: Receipt = { operation, key, jobId: null, signature }
    localStorage.setItem(receiptKey, JSON.stringify(receipt))
    setBusy(true); setError(null)
    try {
      const savedProtections = current?.document.protectedPartIds ?? []
      const protectionChanged = JSON.stringify([...savedProtections].sort()) !== JSON.stringify([...protectedPartIds].sort())
      const result = head ? await api.reviseNative(projectId, { direction: direction.trim(), baseNativeRevisionId: head, expectedNativeHeadId: head, ...(targetPartId ? { targetPartId } : {}), ...(targetSectionId ? { targetSectionId } : {}), ...(protectionChanged ? { protectionChange: { expectedPartIds: savedProtections, desiredPartIds: protectedPartIds } } : {}), sourceAssetIds: sourceIds }, key) : await api.constructNative(projectId, direction.trim(), sourceIds, key)
      localStorage.setItem(receiptKey, JSON.stringify({ ...receipt, jobId: result.jobId }))
      const accepted = await api.job(result.jobId)
      setJob(accepted)
      if (terminal.has(accepted.state)) { const fresh = await api.nativeSnapshot(projectId); setSnapshot(fresh); setProtectedPartIds(fresh.current?.document.protectedPartIds ?? []); if (accepted.state === "succeeded") localStorage.removeItem(receiptKey) }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Construction request failed. Its receipt remains available for reconciliation.") }
    finally { setBusy(false) }
  }

  const restore = async () => {
    if (!snapshot?.currentRevisionId || !selectedVersion || busy) return
    setBusy(true); setError(null)
    try {
      await api.selectNativeVersion(projectId, selectedVersion.id, snapshot.currentRevisionId)
      const fresh = await api.nativeSnapshot(projectId)
      setSnapshot(fresh); setProtectedPartIds(fresh.current?.document.protectedPartIds ?? []); setCompareOpen(false)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to restore native version") }
    finally { setBusy(false) }
  }

  const synchronize = async () => {
    if (!current || busy || activeJob) return
    const key = crypto.randomUUID()
    localStorage.setItem(receiptKey, JSON.stringify({ operation: "native-sync", key, jobId: null, signature: current.id } satisfies Receipt))
    setBusy(true); setError(null)
    try {
      const accepted = await api.syncNative(projectId, current.id, key)
      localStorage.setItem(receiptKey, JSON.stringify({ operation: "native-sync", key, jobId: accepted.jobId, signature: current.id } satisfies Receipt))
      const state = await api.job(accepted.jobId)
      setJob(state)
      if (terminal.has(state.state)) { setSnapshot(await api.nativeSnapshot(projectId)); if (state.state === "succeeded") localStorage.removeItem(receiptKey) }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to start native synchronization") }
    finally { setBusy(false) }
  }

  if (loading) return <div className="empty-surface" role="status">Opening your arrangement…</div>
  return <div className="native-room">
    <RoomHero status={activeJob ? "Taking shape" : current ? "Ready to shape" : "A fresh start"} title={current?.document.title ?? "Make something yours"} description={current ? "Explore the sections and parts below, then tell us what you want to change." : "Describe the music you have in mind. We’ll make an editable arrangement you can keep shaping."} meta={current ? `${current.document.bars} bars · ${current.document.sections.length} sections · ${current.document.parts.length} editable parts` : "Start with an idea · Add your own sounds if you like"} actions={<Button onClick={focusDirection}><Sparkles className="size-4" /> {current ? "Shape this arrangement" : "Describe your idea"}</Button>} />

    <div className="native-audio-boundary" role="note"><Headphones className="size-5" /><div><strong>This arrangement isn't playable yet.</strong><p>You can shape its notes, sounds and sections now. {legacyVersionCount ? <button className="text-link" onClick={onLegacy}>Listen to your separate playable audio</button> : "Sounds you add can still be auditioned below."}</p></div></div>
    {activeJob ? <div className="job-status" role="status" aria-live="polite"><strong>{jobProgress(activeJob)}</strong><span>Your request continues if you leave this room. Accepted versions stay safe.</span><Button size="sm" variant="ghost" onClick={() => void api.cancel(activeJob.id).then(() => api.job(activeJob.id)).then(setJob)}>Stop this request</Button></div> : null}
    {job && terminal.has(job.state) && job.state !== "succeeded" ? <div className="job-status" role="alert"><strong>{job.state === "needs_attention" ? "We need to check what happened" : job.state === "cancelled" ? "Request stopped" : "We couldn't finish that change"}</strong><span>{friendlyIssue(job.error_message, "Your earlier version is safe.")}</span>{["failed", "cancelled"].includes(job.state) ? <Button className="mt-3" variant="outline" size="sm" onClick={() => void submit(true)} disabled={busy}>Try again as a new request</Button> : <p className="provider-note">A new request is paused until the earlier outcome is known.</p>}{job.error_message ? <details className="room-technical"><summary>Technical details</summary><p>{job.error_message}</p></details> : null}</div> : null}
    {error ? <div className="job-status" role="alert"><strong>Something needs attention</strong><span>{friendlyIssue(error, "We couldn't complete that action. Your saved versions are unchanged.")}</span><details className="room-technical"><summary>Technical details</summary><p>{error}</p></details></div> : null}

    <div className="workspace-panel">
      <div className="workspace-main">
        {current ? <>
          <section className="native-section arrangement-section" aria-labelledby="arrangement-heading"><div className="section-heading"><div><h2 id="arrangement-heading">Arrangement</h2><p>Choose a section to focus your next change.</p></div><Button variant="outline" size="sm" aria-pressed={targetSectionId === null} onClick={() => setTargetSectionId(null)}>Whole piece</Button></div><div className="native-section-grid">{current.document.sections.map((section, index) => <button key={section.id} type="button" className="native-section-card" aria-pressed={targetSectionId === section.id} onClick={() => setTargetSectionId((prior) => prior === section.id ? null : section.id)}><span className="section-card-copy"><small>{String(index + 1).padStart(2, "0")}</small><strong>{section.name}</strong><span>Bars {section.startBar + 1}–{section.endBar}</span><em>{section.intent}</em></span><span className={`section-card-art art-variant-${index % 5}`} aria-hidden="true" /></button>)}</div></section>
          <section className="native-section parts-section" aria-labelledby="parts-heading"><div className="section-heading"><div><h2 id="parts-heading">Parts & instruments</h2><p>Choose one part to change, or let the producer decide.</p></div><Button variant="outline" size="sm" aria-pressed={targetPartId === null} onClick={() => setTargetPartId(null)}>Any part</Button></div><div className="native-part-grid">{current.document.parts.map((part) => { const kept = protectedPartIds.includes(part.id); return <article key={part.id} className={`native-part-card ${targetPartId === part.id ? "is-target" : ""} ${kept ? "is-kept" : ""}`}><span className="native-part-role">{part.role}</span><h3>{part.name}</h3><p>{readableDevice(part.device.type)} · {part.placements.length} {part.placements.length === 1 ? "phrase" : "phrases"}{part.sourceRegions.length ? ` · ${part.sourceRegions.length} sound ${part.sourceRegions.length === 1 ? "clip" : "clips"}` : ""}</p><div className="part-card-actions"><Button size="sm" variant={targetPartId === part.id ? "default" : "outline"} aria-label={`Change ${part.name}`} aria-pressed={targetPartId === part.id} disabled={kept} onClick={() => { setTargetPartId((prior) => prior === part.id ? null : part.id); focusDirection() }}>{targetPartId === part.id ? "Selected" : "Change"}</Button><Button size="sm" variant="ghost" onClick={() => setDetailsPartId(part.id)}>Details</Button><Button size="sm" variant="ghost" aria-label={`${kept ? "Allow changes to" : "Keep unchanged"} ${part.name} for the next change`} aria-pressed={kept} onClick={() => { if (!kept && targetPartId === part.id) setTargetPartId(null); setProtectedPartIds((prior) => kept ? prior.filter((value) => value !== part.id) : [...prior, part.id]) }}><LockKeyhole className="size-3" /> {kept ? "Kept" : "Keep"}</Button></div></article> })}</div><p className="section-footnote">“Keep” protects a part when you submit your next change. You can allow changes again before submitting.</p></section>
        </> : <section className="native-start"><Music2 className="size-8 text-primary" /><h2>Start with your idea</h2><p>A few words are enough. Adding a sound is optional, and your first arrangement can be changed later.</p></section>}

        <section className="direction-section" aria-labelledby="direction-heading"><div className="section-heading"><div><h2 id="direction-heading">{current ? "What would you like to change?" : "What are you making?"}</h2><p>{current ? `${selectedSection ? `In ${selectedSection.name}` : "Across the whole piece"} · ${selectedPart ? `change ${selectedPart.name}` : "choose any part"}${protectedPartIds.length ? ` · keep ${protectedPartIds.map(partName).join(", ")} unchanged` : ""}` : "Describe a mood, rhythm, instrument or moment."}</p></div></div><form className="composer native-composer" onSubmit={(event) => { event.preventDefault(); void submit() }}><label htmlFor="native-direction" className="sr-only">Describe your arrangement</label><Textarea id="native-direction" value={direction} onChange={(event) => setDirection(event.target.value)} placeholder={current ? "For example: Make the later section feel bigger with a brighter pad." : "For example: A slow, spacious instrumental with a clear melody."} disabled={Boolean(activeJob)} /><div className="composer-actions"><div className="chips"><span className="chip"><Sparkles className="mr-1 size-3" /> {current ? selectedSection?.name ?? "Whole piece" : "New arrangement"}</span>{selectedPart ? <span className="chip">{selectedPart.name}</span> : null}{protectedPartIds.length ? <span className="chip"><ShieldCheck className="mr-1 size-3" /> Keep {protectedPartIds.length} {protectedPartIds.length === 1 ? "part" : "parts"}</span> : null}{sourceIds.length ? <span className="chip">{sourceIds.length} {sourceIds.length === 1 ? "sound" : "sounds"} selected</span> : null}</div><Button type="submit" disabled={busy || Boolean(activeJob) || direction.trim().length < 3}><Sparkles className="size-4" /> {current ? "Shape the arrangement" : "Create arrangement"} <ArrowRight className="size-4" /></Button></div></form><p className="section-footnote">{current ? "Your current version stays available. You'll review the changes before deciding what to keep." : "This creates an editable arrangement, not a playable recording."}</p></section>

        <section className="native-section versions-section"><div className="section-heading"><div><h2>Versions</h2><p>{snapshot?.versions.length ? `${snapshot.versions.length} saved ${snapshot.versions.length === 1 ? "version" : "versions"}. Compare changes or return to an earlier one.` : "Your first saved arrangement will appear here."}</p></div><Button variant="outline" size="sm" onClick={() => { setCompareId(snapshot?.currentRevisionId ?? null); setCompareOpen(true) }} disabled={!snapshot?.versions.length}><GitCompareArrows className="size-4" /> Compare</Button></div>{current ? <p className="version-current"><Check className="size-4" /> Version {current.ordinal} is current · {arrangementSummary(current)}</p> : null}</section>
      </div>

      <aside className="workspace-side" aria-label="Arrangement tools">
        <section className="side-section"><div className="section-heading"><h2>Your sounds</h2><Button size="sm" variant="outline" onClick={onAddSource}><Plus className="size-4" /> Add</Button></div>{assets.length ? <div className="source-card-list">{assets.map((asset) => <div className="source-card" key={asset.id}><button type="button" className="source-play" aria-label={`Play sound ${asset.name}`} onClick={() => onAuditionSource(asset.id)}><Play className="size-4" /></button><div className="source-card-name"><strong>{asset.name}</strong><small>{Math.round(asset.durationSeconds)} seconds · your sound</small></div><label className="source-select"><input type="checkbox" aria-label={`Use ${asset.name} in the next arrangement change`} checked={sourceIds.includes(asset.id)} onChange={(event) => setSourceIds((prior) => event.target.checked ? [...prior, asset.id] : prior.filter((value) => value !== asset.id))} /><span className="sr-only">Use in the next change</span></label></div>)}</div> : <p className="side-empty">Add or record a WAV if you want the producer to work with your own sound.</p>}{sourcePreview}<p className="side-note">Selected sounds may be placed in the arrangement. Placement alone does not confirm how they will sound.</p></section>
        <section className="side-section"><div className="section-heading"><h2>Sounds & instruments</h2></div><p className="side-note">Explore the kinds of parts we can shape. These aren't playable presets.</p><div className="sound-family-list"><div><span className="family-icon rhythm">▥</span><span><strong>Drums</strong><small>Patterns and pulse</small></span></div><div><span className="family-icon bass">〰</span><span><strong>Bass</strong><small>Low-end movement</small></span></div><div><span className="family-icon keys">▦</span><span><strong>Keys & pads</strong><small>Harmony and atmosphere</small></span></div><div><span className="family-icon lead">⌁</span><span><strong>Leads</strong><small>Melodies and responses</small></span></div><div><span className="family-icon effects">✳</span><span><strong>Effects</strong><small>Space, motion and dynamics</small></span></div></div><details className="native-palette"><summary>Explore detailed capabilities</summary><p className="side-note">This reference includes capabilities that may not yet be available for construction.</p><label className="native-search"><Search className="size-4" /><span className="sr-only">Search detailed capabilities</span><input value={capabilityQuery} onChange={(event) => setCapabilityQuery(event.target.value)} placeholder="Find instruments or effects" /></label><div className="native-capability-grid">{capabilities.slice(0, 12).map((item) => <div key={item.type} className="native-capability"><strong>{item.type}</strong><span>{item.family}</span><small>{item.purpose}</small><small>{item.writableInPocketProducer ? "Available for construction" : "Reference only"}</small></div>)}</div></details></section>
        <section className="side-section inspiration-section"><h2>Need inspiration?</h2><p className="side-note">Choose a starting point, then make it your own.</p><div className="suggestion-list">{(current ? [`Build more energy in ${current.document.sections[Math.min(1, current.document.sections.length - 1)]?.name ?? "the middle"}`, `Make ${current.document.sections[0]?.name ?? "the opening"} more minimal`, `Give ${current.document.parts.find((part) => part.role === "melody")?.name ?? "the melody"} a new response`] : ["A calm opening that grows into a pulse", "A sparse rhythm with a memorable melody", "An atmospheric piece with contrasting sections"]).map((prompt) => <button key={prompt} type="button" onClick={() => suggest(prompt)}>{prompt}<ArrowRight className="size-4" /></button>)}</div></section>
        {current ? <section className="side-section audiotool-section"><h2>Editable in Audiotool</h2><p>{syncMessage}</p><div className="side-actions">{currentRemoteVerification && snapshot?.synchronization.url ? <Button variant="outline" size="sm" onClick={() => window.open(snapshot.synchronization.url ?? "", "_blank", "noopener,noreferrer")}>Open in Audiotool</Button> : null}{audiotoolConnected && !["uncertain", "conflict", "applying", "needs_attention"].includes(syncState) ? <Button variant="outline" size="sm" disabled={busy || Boolean(activeJob)} onClick={() => void synchronize()}>{currentRemoteVerification ? "Recheck copy" : "Make editable copy"}</Button> : !audiotoolConnected && audiotoolAvailable ? <Button variant="outline" size="sm" onClick={onConnectAudiotool}>Connect Audiotool</Button> : null}</div>{snapshot?.synchronization.error ? <details className="room-technical"><summary>Technical details</summary><p>{snapshot.synchronization.error}</p></details> : null}</section> : null}
      </aside>
    </div>

    <Dialog open={Boolean(detailsPart)} onOpenChange={(open) => { if (!open) setDetailsPartId(null) }}><DialogContent className="max-w-xl bg-popover p-6"><DialogHeader><DialogTitle className="font-heading text-2xl">{detailsPart?.name ?? "Part details"}</DialogTitle><DialogDescription>What this part contains in the editable arrangement. This is not an audio preview.</DialogDescription></DialogHeader>{detailsPart ? <div className="part-detail"><p><strong>Instrument:</strong> {readableDevice(detailsPart.device.type)}</p><p><strong>Placed phrases:</strong> {detailsPart.placements.length} · <strong>Sound clips:</strong> {detailsPart.sourceRegions.length}</p><p><strong>Processing:</strong> {detailsPart.effects.length ? detailsPart.effects.map((effect) => readableEffect(effect.type)).join(", ") : "None"}</p><p><strong>Motion:</strong> {detailsPart.automation.length ? `${detailsPart.automation.length} changing controls` : "No changing controls"}</p><details className="room-technical"><summary>Technical details</summary><p>Device: {detailsPart.device.type}. {Object.keys(detailsPart.device.parameters).length} mapped parameters. {detailsPart.notes.length} direct notes.</p></details></div> : null}<DialogFooter className="-mx-6 -mb-6"><Button variant="outline" onClick={() => setDetailsPartId(null)}>Close</Button><Button disabled={!detailsPart || protectedPartIds.includes(detailsPart.id)} onClick={() => { if (detailsPart) setTargetPartId(detailsPart.id); setDetailsPartId(null); window.setTimeout(focusDirection, 0) }}>Change this part</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto bg-popover p-6">
        <DialogHeader><DialogTitle className="font-heading text-2xl">Compare arrangements</DialogTitle><DialogDescription>See what changed from the current version. Restoring one changes only this room's selected version; it does not rewrite Audiotool.</DialogDescription></DialogHeader>
        <RadioGroup value={compareId ?? undefined} onValueChange={setCompareId} aria-label="Version to compare" className="version-list">
          {snapshot?.versions.map((version) => <label key={version.id} className="version-option"><RadioGroupItem value={version.id} aria-label={`Version ${version.ordinal}`} /><span><span className="version-title">Version {version.ordinal} {version.id === snapshot.currentRevisionId ? <span className="chip"><Check className="mr-1 size-3" /> Current</span> : null}</span><p>{arrangementSummary(version)}</p><small>{version.document.bars} bars · {version.document.parts.length} parts</small></span></label>)}
        </RadioGroup>
        {selectedVersion && comparison ? <div className="native-diff"><strong>Version {selectedVersion.ordinal} compared with current version {snapshot?.current?.ordinal}</strong><p><b>Parts added:</b> {comparison.addedParts.map(partName).join(", ") || "None"} · <b>Changed:</b> {comparison.changedParts.map(partName).join(", ") || "None"} · <b>Removed:</b> {comparison.removedParts.map(partName).join(", ") || "None"}</p><p><b>Sections changed:</b> {comparison.changedSections.join(", ") || "None"} · <b>Tempo:</b> {comparison.tempoChange ? `${comparison.tempoChange.from} → ${comparison.tempoChange.to} BPM` : "Unchanged"}</p><p><b>Parts kept unchanged:</b> {comparison.protectionChange.added.map(partName).join(", ") || "None"} · <b>Allowed to change:</b> {comparison.protectionChange.removed.map(partName).join(", ") || "None"}</p></div> : null}
        <DialogFooter className="-mx-6 -mb-6"><Button variant="outline" onClick={() => setCompareOpen(false)}>Keep current</Button><Button onClick={() => void restore()} disabled={!selectedVersion || selectedVersion.id === snapshot?.currentRevisionId || busy}><RotateCcw className="size-4" /> Restore this version</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
}
