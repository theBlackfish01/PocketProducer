import { useEffect, useMemo, useState } from "react"
import { ArrowUp, Check, GitCompareArrows, Headphones, Layers3, LockKeyhole, RotateCcw, Search, ShieldCheck, Sparkles } from "lucide-react"
import { api, type Asset, type Job, type NativeSnapshot } from "../../lib/api"
import { Button } from "../../components/ui/button"
import { Textarea } from "../../components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog"
import { RadioGroup, RadioGroupItem } from "../../components/ui/radio-group"

const terminal = new Set(["succeeded", "failed", "cancelled", "needs_attention"])
type Receipt = { operation: "native-generation" | "native-revision" | "native-sync"; key: string; jobId: string | null; signature: string }

export function NativeRoom({ projectId, assets, legacyVersionCount, onAddSource, onLegacy, onProjectUpdated }: { projectId: string; assets: Asset[]; legacyVersionCount: number; onAddSource(): void; onLegacy(): void; onProjectUpdated(): void }) {
  const [snapshot, setSnapshot] = useState<NativeSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [direction, setDirection] = useState("Build an evolving instrumental with a clear motif, contrasting sections and editable native parts.")
  const [targetPartId, setTargetPartId] = useState<string | null>(null)
  const [targetSectionId, setTargetSectionId] = useState<string | null>(null)
  const [protectedPartIds, setProtectedPartIds] = useState<string[]>([])
  const [sourceIds, setSourceIds] = useState<string[]>([])
  const [job, setJob] = useState<Job | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)
  const [compareId, setCompareId] = useState<string | null>(null)
  const [capabilityQuery, setCapabilityQuery] = useState("")
  const [capabilities, setCapabilities] = useState<Array<{ type: string; family: string; purpose: string; writableInPocketProducer: boolean }>>([])
  const [audiotoolConnected, setAudiotoolConnected] = useState(false)
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
      setDirection(value.current ? "Develop the later section with a variation while preserving the selected parts." : "Build an evolving instrumental with a clear motif, contrasting sections and editable native parts.")
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
    void api.status().then((value) => { if (active) setAudiotoolConnected(value.nexus.session.connected) }).catch(() => undefined)
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

  if (loading) return <div className="empty-surface" role="status">Opening native construction…</div>
  return <div className="native-room">
    <header className="session-header"><div className="eyebrow"><span className="status-dot" /> {activeJob ? "Construction in progress" : current ? "Editable structure ready" : "New native construction"}</div><h1 className="session-title">{current?.document.title ?? "Make a piece, not just a preview"}</h1><p className="session-deck">{current?.changeSummary ?? "Describe the music you want. Pocket Producer will build sections, motifs and native instrument parts you can revise."}</p><p className="provider-status">{current ? `${current.document.bars} bars · ${current.document.parts.length} parts · ${current.document.tempoBpm} BPM` : "Native construction · audio-independent"} · {currentRemoteVerification ? "Studio readback verified at " + new Date(snapshot.synchronization.verifiedAt!).toLocaleString() : "Local validated draft"}</p></header>

    <form className="composer native-composer" onSubmit={(event) => { event.preventDefault(); void submit() }}><label htmlFor="native-direction" className="sr-only">Musical direction for native construction</label><Textarea id="native-direction" value={direction} onChange={(event) => setDirection(event.target.value)} placeholder={current ? "What should change in the selected section or part?" : "Describe the music you want to construct"} disabled={Boolean(activeJob)} /><div className="composer-actions"><div className="chips"><span className="chip"><Sparkles className="mr-1 size-3" /> {current ? "Structural revision" : "Native construction"}</span>{protectedPartIds.length ? <span className="chip"><ShieldCheck className="mr-1 size-3" /> {protectedPartIds.length} protected</span> : null}</div><Button className="round-play" size="icon" type="submit" aria-label={current ? "Request native revision" : "Construct native project"} disabled={busy || Boolean(activeJob) || direction.trim().length < 3}><ArrowUp /></Button></div></form>

    <div className="native-audio-boundary" role="status"><Headphones className="size-5" /><div><strong>Audio preview coming later</strong><p>This native version has not been rendered or listened to. {legacyVersionCount ? <button className="text-link" onClick={onLegacy}>Open the separate legacy audio version</button> : "Existing source audio remains available separately."}</p></div></div>
    <div className="native-sync-control"><p className="provider-note">Audiotool synchronization: {snapshot?.synchronization.state ?? "local"}. {currentRemoteVerification ? "This is a past structural readback; recheck to detect later Studio edits." : "No current remote editability is claimed until the v2 structural readback succeeds."}{snapshot?.synchronization.error ? ` ${snapshot.synchronization.error}` : ""}</p><div className="native-sync-actions">{currentRemoteVerification && snapshot?.synchronization.url ? <Button variant="outline" onClick={() => window.open(snapshot.synchronization.url ?? "", "_blank", "noopener,noreferrer")}>Open in Audiotool</Button> : null}{current && audiotoolConnected && !["uncertain", "conflict", "applying"].includes(snapshot?.synchronization.state ?? "") ? <Button variant="outline" disabled={busy || Boolean(activeJob)} onClick={() => void synchronize()}>{currentRemoteVerification ? "Recheck Studio structure" : "Sync editable native project"}</Button> : null}</div></div>

    {current ? <>
      <section className="native-section"><div className="section-heading"><h2>Arrangement</h2><span className="provider-note">Select a section only when the change must stay within its bars</span></div><div className="native-section-grid"><button type="button" className="native-section-card" aria-pressed={targetSectionId === null} onClick={() => setTargetSectionId(null)}><strong>Whole piece</strong><span>Bars 1–{current.document.bars}</span><small>Allow global timing and sound changes</small></button>{current.document.sections.map((section) => <button key={section.id} type="button" className="native-section-card" aria-pressed={targetSectionId === section.id} onClick={() => setTargetSectionId(section.id)}><strong>{section.name}</strong><span>Bars {section.startBar + 1}–{section.endBar}</span><small>{section.intent}</small></button>)}</div></section>
      <section className="native-section"><div className="section-heading"><h2>Parts & instruments</h2><span className="provider-note">Select a part for a hard edit scope; lock anything to preserve structurally</span></div><div className="native-part-grid"><button type="button" className="native-section-card native-any-part" aria-pressed={targetPartId === null} onClick={() => setTargetPartId(null)}><strong>Any unprotected part</strong><span>Producer may choose the relevant role</span></button>{current.document.parts.map((part) => <div key={part.id} className={`native-part-card ${targetPartId === part.id ? "is-target" : ""}`}><button type="button" className="native-part-select" aria-pressed={targetPartId === part.id} onClick={() => setTargetPartId(part.id)}><span className="native-part-role">{part.role}</span><strong>{part.name}</strong><span>{part.device.type} · {part.placements.length} phrase placements</span><small>{part.effects.length ? `${part.effects.map((effect) => effect.type.replace("stompbox", "")).join(", ")} · ` : ""}{part.automation.length} automation lanes</small></button><Button variant="ghost" size="sm" aria-label={`${protectedPartIds.includes(part.id) ? "Unlock" : "Protect"} ${part.name} for the next revision`} aria-pressed={protectedPartIds.includes(part.id)} onClick={() => setProtectedPartIds((prior) => prior.includes(part.id) ? prior.filter((value) => value !== part.id) : [...prior, part.id])}><LockKeyhole className="size-4" /> {protectedPartIds.includes(part.id) ? "Protected" : "Protect"}</Button></div>)}</div><p className="provider-note">A protection becomes part of accepted structural history when you submit a revision. It covers notes, device, processing, automation and motif dependencies—not an unverified audible match.</p></section>
      <section className="native-section"><div className="section-heading"><h2>Motifs & sources</h2></div><p className="provider-note">{current.document.motifs.length} reusable motifs · {current.document.parts.reduce((sum, part) => sum + part.sourceRegions.length, 0)} source intervals placed/referenced. Placement is not an audible-use claim.</p></section>
    </> : <div className="native-start"><Layers3 className="size-8 text-primary" /><h2>Construct an editable arrangement</h2><p>Start from a direction. The first version can finish without a WAV, render or Gemini critique.</p></div>}

    {assets.length ? <section className="native-section"><div className="section-heading"><h2>Owned sources</h2><Button size="sm" variant="ghost" onClick={onAddSource}>Add WAV</Button></div><div className="native-source-list">{assets.map((asset) => <label key={asset.id}><input type="checkbox" checked={sourceIds.includes(asset.id)} onChange={(event) => setSourceIds((prior) => event.target.checked ? [...prior, asset.id] : prior.filter((value) => value !== asset.id))} /><span>{asset.name}</span></label>)}</div><p className="provider-note">Select sources for the next construction. The producer can place specific intervals; remote sync uploads each owned WAV with a durable sample identity, then maps offset and loop/clip structure. No native audio has been heard here.</p></section> : <Button variant="outline" onClick={onAddSource}>Add an owned WAV (optional)</Button>}

    <details className="native-section native-palette"><summary>Explore the native palette</summary><p className="provider-note">Pinned Nexus 0.0.17 · discovery does not imply write support</p><label className="native-search"><Search className="size-4" /><span className="sr-only">Search native capabilities</span><input value={capabilityQuery} onChange={(event) => setCapabilityQuery(event.target.value)} placeholder="Find instruments, effects, tracks or automation" /></label><div className="native-capability-grid">{capabilities.slice(0, 12).map((item) => <div key={item.type} className="native-capability"><strong>{item.type}</strong><span>{item.family}</span><small>{item.purpose}</small><small>{item.writableInPocketProducer ? "Validated native mapping" : "Discoverable SDK capability"}</small></div>)}</div></details>

    {activeJob ? <div className="job-status" role="status" aria-live="polite"><strong>{activeJob.stage ? `${activeJob.stage[0]?.toUpperCase()}${activeJob.stage.slice(1)} native structure…` : "Queued for the durable worker…"}</strong><span>You can navigate away; the accepted command and completed steps are retained.</span><Button size="sm" variant="ghost" onClick={() => void api.cancel(activeJob.id).then(() => api.job(activeJob.id)).then(setJob)}>Cancel request</Button></div> : null}
    {job && terminal.has(job.state) && job.state !== "succeeded" ? <div className="job-status" role="alert"><strong>Construction needs attention: {job.state.replaceAll("_", " ")}</strong><span>{job.error_message ?? "The earlier accepted version remains intact."}</span>{["failed", "cancelled"].includes(job.state) ? <Button className="mt-3" variant="outline" size="sm" onClick={() => void submit(true)} disabled={busy}>Retry as a new attempt</Button> : <p className="provider-note">Reconcile the uncertain outcome before any new paid or remote attempt.</p>}</div> : null}
    {error ? <div className="job-status" role="alert"><strong>Something needs attention</strong><span>{error}</span></div> : null}
    <section className="native-section"><div className="section-heading"><h2>Structural versions</h2><Button variant="outline" size="sm" onClick={() => { setCompareId(snapshot?.currentRevisionId ?? null); setCompareOpen(true) }} disabled={!snapshot?.versions.length}><GitCompareArrows className="size-4" /> Compare</Button></div><p className="provider-note">{snapshot?.versions.length ?? 0} immutable native versions. Restore changes the selected local head; it does not silently rewrite Audiotool.</p></section>

    <Dialog open={compareOpen} onOpenChange={setCompareOpen}><DialogContent className="max-w-2xl bg-popover p-6"><DialogHeader><DialogTitle className="font-heading text-2xl">Compare native structure</DialogTitle><DialogDescription>Compare the selected version against the current local version. Restore is explicit and does not rewrite Audiotool.</DialogDescription></DialogHeader><RadioGroup value={compareId ?? undefined} onValueChange={setCompareId} aria-label="Native version to inspect" className="version-list">{snapshot?.versions.map((version) => <label key={version.id} className="version-option"><RadioGroupItem value={version.id} aria-label={`Native version ${version.ordinal}`} /><span><span className="version-title">Version {version.ordinal} {version.id === snapshot.currentRevisionId ? <span className="chip"><Check className="mr-1 size-3" /> Current</span> : null}</span><p>{version.changeSummary}</p><small>{version.document.bars} bars · {version.document.parts.length} parts · {version.structuralDiff.noteCount} materialized notes</small></span></label>)}</RadioGroup>{selectedVersion ? <div className="native-diff"><strong>Selected v{selectedVersion.ordinal} versus current v{snapshot?.current?.ordinal}</strong><p>Added: {snapshot?.comparisons[selectedVersion.id]?.addedParts.join(", ") || "none"} · Changed: {snapshot?.comparisons[selectedVersion.id]?.changedParts.join(", ") || "none"} · Removed: {snapshot?.comparisons[selectedVersion.id]?.removedParts.join(", ") || "none"}</p><p>Tempo: {snapshot?.comparisons[selectedVersion.id]?.tempoChange ? `${snapshot.comparisons[selectedVersion.id].tempoChange!.from} → ${snapshot.comparisons[selectedVersion.id].tempoChange!.to} BPM` : "unchanged"} · Sections changed: {snapshot?.comparisons[selectedVersion.id]?.changedSections.join(", ") || "none"}</p><p>Protection added: {snapshot?.comparisons[selectedVersion.id]?.protectionChange.added.join(", ") || "none"} · removed: {snapshot?.comparisons[selectedVersion.id]?.protectionChange.removed.join(", ") || "none"}</p></div> : null}<DialogFooter className="-mx-6 -mb-6"><Button variant="outline" onClick={() => setCompareOpen(false)}>Keep current</Button><Button onClick={() => void restore()} disabled={!selectedVersion || selectedVersion.id === snapshot?.currentRevisionId || busy}><RotateCcw className="size-4" /> Restore selected</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
