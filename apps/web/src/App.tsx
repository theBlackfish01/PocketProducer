import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowUp, AudioLines, Check, GitCompareArrows, Headphones, Library, Menu, Mic, Plus, ShieldCheck, Upload, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { AudioPlayer, usePlayback, type PlaybackItem } from "@/features/listening/audio-player"
import { NativeRoom } from "@/features/native/native-room"
import { api, type AppStatus, type Asset, type Job, type Project, type ProjectSnapshot, type Version } from "@/lib/api"
import { beginAudiotoolConnection, finishAudiotoolCallback } from "@/lib/audiotool"
import { startWavRecording, type RecordingSession } from "@/lib/record-wav"

const terminalStates = new Set(["succeeded", "failed", "cancelled", "needs_attention"])

function stageLabel(job: Job | null) {
  if (!job) return null
  if (job.state === "queued") return "Waiting for the producer…"
  if (job.state === "cancel_requested") return "Stopping safely…"
  if (job.state === "failed") return job.error_message ?? "The request failed. Your previous version is safe."
  if (job.state === "cancelled") return "Request cancelled. Your previous version is unchanged."
  if (job.state === "needs_attention") return job.error_message ?? "The outcome needs a safe reconciliation before any new paid or remote work."
  const labels: Record<string, string> = {
    analyzing: "Inspecting your source…", planning: "Shaping the arrangement…", composing: "Writing the parts…",
    rendering: "Rendering the real preview…", checking: "Checking timing and headroom…", exporting: "Preparing the Nexus handoff…"
  }
  return job.stage ? labels[job.stage] ?? "Working on your piece…" : job.state === "succeeded" ? "Version ready." : "Working on your piece…"
}

function MiniWave() {
  return <span className="mini-wave" aria-hidden="true">{[7, 14, 10, 18, 9, 15, 6].map((height, index) => <i key={index} style={{ height }} />)}</span>
}

const creationDraft = "Make a warm, restrained instrumental around this sound."
const revisionDraft = "Simplify the drums in Groove; keep the melody."

interface SubmissionReceipt {
  key: string
  projectId: string
  operation: "generation" | "revision" | "export"
  direction?: string
  baseRevisionId?: string | null
  sourceAssetId?: string
  jobId?: string
  acceptedAt?: string
}

function acceptedPlaybackItem(value: ProjectSnapshot | null): PlaybackItem | null {
  const revision = value?.currentRevision
  if (!revision) return null
  return { kind: "revision", id: revision.id, url: revision.audioUrl, label: `Version ${revision.ordinal} · current`, durationSeconds: revision.durationSeconds, peaks: revision.waveformPeaks }
}

function versionPlaybackItem(version: Version, currentId: string | null): PlaybackItem {
  return { kind: "revision", id: version.id, url: version.audioUrl, label: `Version ${version.ordinal}${version.id === currentId ? " · current" : " · audition"}`, durationSeconds: version.durationSeconds, peaks: version.waveformPeaks }
}

function sourcePlaybackItem(asset: Asset): PlaybackItem {
  return { kind: "source", id: asset.id, url: asset.audioUrl, label: `Source · ${asset.name}`, durationSeconds: asset.durationSeconds, peaks: [] }
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null)
  const [providers, setProviders] = useState({ openai: false, gemini: false, audiotool: false })
  const [nexus, setNexus] = useState<AppStatus["nexus"]>({ sdk: "0.0.17", liveExportVerified: false, connection: "unconfigured", oauth: null, session: { connected: false, userName: null, expiresAt: null } })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState(creationDraft)
  const [job, setJob] = useState<Job | null>(null)
  const [exportResult, setExportResult] = useState<{ state: string; remote_url: string | null; error_message: string | null } | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)
  const [nativeMode, setNativeMode] = useState(true)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null)
  const [recording, setRecording] = useState<RecordingSession | null>(null)
  const [recordingNotice, setRecordingNotice] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<SubmissionReceipt | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const projectRequestRef = useRef(0)
  const activeProjectRef = useRef<string | null>(null)
  const draftProjectRef = useRef<string | null>(null)
  const recordingAbortRef = useRef<AbortController | null>(null)
  const recordingProjectRef = useRef<string | null>(null)
  const pollingFailuresRef = useRef(0)
  const oauthCallbackRef = useRef(false)
  const playback = usePlayback()

  const receiptKey = (id: string) => `pocket-producer:receipt:${id}`
  const readReceipt = (id: string): SubmissionReceipt | null => {
    try {
      const raw = localStorage.getItem(receiptKey(id))
      if (!raw) return null
      const value = JSON.parse(raw) as SubmissionReceipt
      return value.projectId === id ? value : null
    } catch { return null }
  }

  const reconcileReceipt = (id: string, storedReceipt: SubmissionReceipt | null, attempt = 0) => {
    if (!storedReceipt) return
    if (attempt >= 150) { setError("The saved command is still unresolved. Reload later to continue reconciliation without creating duplicate work."); return }
    const resolved = storedReceipt.jobId
      ? api.job(storedReceipt.jobId).then((storedJob) => ({ job: storedJob }))
      : api.commandReceipt(id, storedReceipt.operation, storedReceipt.key)
    void resolved.then(async ({ job: storedJob }) => {
      if (!storedJob || activeProjectRef.current !== id || storedJob.project_id !== id) return
      const recovered = storedReceipt.jobId ? storedReceipt : { ...storedReceipt, jobId: storedJob.id, acceptedAt: storedReceipt.acceptedAt ?? new Date().toISOString() }
      if (!storedReceipt.jobId) { localStorage.setItem(receiptKey(id), JSON.stringify(recovered)); setReceipt(recovered) }
      setJob(storedJob)
      if (terminalStates.has(storedJob.state)) {
        const value = await api.snapshot(id)
        if (activeProjectRef.current !== id) return
        setSnapshot(value); setSelectedRevisionId(value.project.currentRevisionId)
        if (storedJob.state === "succeeded" && storedJob.kind === "generation") { draftProjectRef.current = id; setDraft(revisionDraft) }
        const accepted = acceptedPlaybackItem(value)
        if (accepted) playback.load(accepted); else playback.clear()
        if (storedJob.kind === "export" && value.project.currentRevisionId) {
          const exportState = await api.exportStatus(value.project.currentRevisionId)
          if (activeProjectRef.current === id) setExportResult(exportState.export)
        }
      } else {
        window.setTimeout(() => {
          if (activeProjectRef.current !== id) return
          const current = readReceipt(id)
          if (current?.key === recovered.key) reconcileReceipt(id, current, attempt + 1)
        }, 800)
      }
    }).catch(() => {
      window.setTimeout(() => {
        if (activeProjectRef.current !== id) return
        const current = readReceipt(id)
        if (current?.key === storedReceipt.key) reconcileReceipt(id, current, attempt + 1)
      }, 1_200)
    })
  }

  const loadExportState = (project: string, revisionId: string, requestId: number) => {
    void api.exportStatus(revisionId).then((result) => {
      if (requestId === projectRequestRef.current && activeProjectRef.current === project) setExportResult(result.export)
    }).catch(() => {
      if (requestId === projectRequestRef.current && activeProjectRef.current === project) setExportResult(null)
    })
  }

  const refreshProjects = async (preferred?: string) => {
    const requestId = ++projectRequestRef.current
    const result = await api.listProjects()
    if (requestId !== projectRequestRef.current) return
    setProjects(result.projects)
    const next = preferred ?? activeProjectRef.current ?? result.projects[0]?.id ?? null
    activeProjectRef.current = next
    setProjectId(next)
    if (next) {
      const value = await api.snapshot(next)
      if (requestId !== projectRequestRef.current || activeProjectRef.current !== next) return
      setSnapshot(value); setJob(value.latestJob); setSelectedRevisionId(value.project.currentRevisionId)
      draftProjectRef.current = next
      setDraft(localStorage.getItem(`pocket-producer:draft:${next}`) ?? (value.currentRevision ? revisionDraft : creationDraft))
      const accepted = acceptedPlaybackItem(value); if (accepted) playback.load(accepted); else playback.clear()
      const storedReceipt = readReceipt(next); setReceipt(storedReceipt); reconcileReceipt(next, storedReceipt)
      if (value.currentRevision) loadExportState(next, value.currentRevision.id, requestId); else setExportResult(null)
    } else { setSnapshot(null); setReceipt(null); setExportResult(null); playback.clear() }
  }

  useEffect(() => {
    const requestId = ++projectRequestRef.current
    void Promise.all([api.status(), api.listProjects()]).then(async ([status, list]) => {
      if (requestId !== projectRequestRef.current) return
      setProviders(status.providers); setNexus(status.nexus); setProjects(list.projects)
      const first = list.projects[0]?.id ?? null; activeProjectRef.current = first; setProjectId(first)
      if (first) {
        const value = await api.snapshot(first)
        if (requestId !== projectRequestRef.current || activeProjectRef.current !== first) return
        setSnapshot(value); setJob(value.latestJob); setSelectedRevisionId(value.project.currentRevisionId)
        draftProjectRef.current = first
        setDraft(localStorage.getItem(`pocket-producer:draft:${first}`) ?? (value.currentRevision ? revisionDraft : creationDraft))
        const accepted = acceptedPlaybackItem(value); if (accepted) playback.load(accepted); else playback.clear()
        const storedReceipt = readReceipt(first); setReceipt(storedReceipt); reconcileReceipt(first, storedReceipt)
        if (value.currentRevision) loadExportState(first, value.currentRevision.id, requestId)
      }
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to connect to Pocket Producer")).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (oauthCallbackRef.current || !nexus.oauth || window.location.pathname !== new URL(nexus.oauth.redirectUrl).pathname) return
    oauthCallbackRef.current = true
    void finishAudiotoolCallback(nexus.oauth).then(async () => {
      const status = await api.status(); setProviders(status.providers); setNexus(status.nexus)
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Audiotool authorization could not be completed"))
      .finally(() => window.history.replaceState({}, "", "/"))
  }, [nexus.oauth])

  useEffect(() => { if (projectId && draftProjectRef.current === projectId) localStorage.setItem(`pocket-producer:draft:${projectId}`, draft) }, [draft, projectId])

  useEffect(() => () => { recordingAbortRef.current?.abort(); recording?.discard() }, [recording])

  useEffect(() => {
    if (!job || terminalStates.has(job.state)) return
    const polledJobId = job.id
    const polledProjectId = job.project_id
    const controller = new AbortController()
    let disposed = false
    const poll = () => {
      void Promise.all([api.job(polledJobId, controller.signal), api.snapshot(polledProjectId, controller.signal)]).then(async ([next, value]) => {
        if (disposed) return
        pollingFailuresRef.current = 0
        if (next.project_id !== polledProjectId || activeProjectRef.current !== polledProjectId) return
        setJob(next); setSnapshot(value); setSelectedRevisionId(value.project.currentRevisionId)
        if (terminalStates.has(next.state)) {
          window.clearInterval(timer)
          if (next.state === "succeeded" && next.kind === "generation") { draftProjectRef.current = polledProjectId; setDraft(revisionDraft) }
          const accepted = acceptedPlaybackItem(value)
          if (accepted && (!playback.item || playback.item.kind === "revision")) playback.load(accepted)
          if (next.kind === "export" && value.project.currentRevisionId) {
            const exportState = (await api.exportStatus(value.project.currentRevisionId, controller.signal)).export
            if (activeProjectRef.current === polledProjectId) setExportResult(exportState)
          }
        }
      }).catch(() => {
        if (disposed || controller.signal.aborted) return
        pollingFailuresRef.current += 1
        if (pollingFailuresRef.current >= 3) setError("Connection to the local worker was interrupted. The job remains durable; reload to reconcile its status.")
      })
    }
    const timer = window.setInterval(poll, 800)
    poll()
    return () => { disposed = true; controller.abort(); window.clearInterval(timer) }
  }, [job?.id])

  const currentRevision = snapshot?.currentRevision ?? null
  const acceptedItem = acceptedPlaybackItem(snapshot)
  const audibleItem = playback.item ?? acceptedItem
  const activeSectionId = playback.item?.kind === "revision" && playback.item.id === currentRevision?.id && currentRevision
    ? currentRevision.composition.sections.find((section) => {
        const tick = playback.currentTime * currentRevision.composition.tempoBpm / 60 * 960
        return tick >= section.startTick && tick < section.endTick
      })?.id ?? null
    : null
  const activeJob = job && !terminalStates.has(job.state) ? job : null
  const jobMessage = stageLabel(job)
  const currentAnalysis = snapshot?.analyses.find((analysis) => analysis.revisionId === currentRevision?.id && analysis.purpose === "preview-critique")
  const sourceAnalysis = snapshot?.analyses.find((analysis) => analysis.revisionId === currentRevision?.id && analysis.purpose === "source-analysis")
  const producerProvenance = currentRevision?.producer.provider === "openai-deep-agent" ? "OpenAI Deep Agent" : currentRevision ? "deterministic fixture" : providers.openai ? "OpenAI configured" : "fixture fallback"
  const sourceLineage = currentRevision?.producer.sourceLineage as { attached?: string[]; selected?: string | null; referenced?: string[]; audiblyUsed?: boolean } | undefined

  const returnToAccepted = () => {
    if (!acceptedItem) return
    setSelectedRevisionId(snapshot?.project.currentRevisionId ?? null)
    playback.load(acceptedItem)
  }

  const createSession = async () => {
    setBusy(true); setError(null)
    try { const { project } = await api.createProject("Untitled listening room"); await refreshProjects(project.id); setNavOpen(false) }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to create session") }
    finally { setBusy(false) }
  }

  const ensureProject = async () => {
    if (projectId) return projectId
    const { project } = await api.createProject("Untitled listening room"); await refreshProjects(project.id); return project.id
  }

  const submitDirection = async () => {
    if (draft.trim().length < 3) return
    const isRevision = Boolean(snapshot?.project.currentRevisionId)
    if (isRevision && (!/drum/i.test(draft) || !/simpl|less|space|restrain/i.test(draft))) {
      setError("This version currently supports one precise edit: simplify the drums in Groove while keeping the melody. Rephrase using that scope.")
      return
    }
    setBusy(true); setError(null)
    let targetProjectId = projectId
    try {
      const id = await ensureProject()
      targetProjectId = id
      const baseRevisionId = snapshot?.project.currentRevisionId ?? null
      const sourceAssetId = snapshot?.assets[0]?.id
      const commandIdentity = `${id}:${baseRevisionId ?? "new"}:${sourceAssetId ?? "palette"}:${draft.trim()}`
      const storageKey = `pocket-producer:submission:${commandIdentity}`
      const idempotencyKey = localStorage.getItem(storageKey) ?? crypto.randomUUID()
      localStorage.setItem(storageKey, idempotencyKey)
      const pendingReceipt: SubmissionReceipt = {
        key: idempotencyKey,
        projectId: id,
        operation: baseRevisionId ? "revision" : "generation",
        direction: draft.trim(),
        baseRevisionId,
        ...(sourceAssetId ? { sourceAssetId } : {})
      }
      localStorage.setItem(receiptKey(id), JSON.stringify(pendingReceipt))
      if (activeProjectRef.current === id) setReceipt(pendingReceipt)
      const result = baseRevisionId
        ? await api.revise(id, baseRevisionId, draft, idempotencyKey)
        : await api.generate(id, draft, idempotencyKey, sourceAssetId)
      const acceptedReceipt = { ...pendingReceipt, jobId: result.jobId, acceptedAt: new Date().toISOString() }
      localStorage.setItem(receiptKey(id), JSON.stringify(acceptedReceipt))
      if (activeProjectRef.current === id) {
        setReceipt(acceptedReceipt)
        setJob(await api.job(result.jobId))
      }
    } catch (cause) {
      if (activeProjectRef.current === targetProjectId) setError(cause instanceof Error ? cause.message : "Unable to submit direction")
    }
    finally { setBusy(false) }
  }

  const uploadFile = async (file: File) => {
    setBusy(true); setError(null)
    let targetProjectId = projectId
    try {
      const id = await ensureProject(); targetProjectId = id
      await api.upload(id, file)
      if (activeProjectRef.current !== id) return
      await refreshProjects(id)
      if (activeProjectRef.current === id) setSourcesOpen(true)
    }
    catch (cause) { if (activeProjectRef.current === targetProjectId) setError(cause instanceof Error ? cause.message : "Upload failed") }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = "" }
  }

  const toggleRecording = async () => {
    setError(null)
    if (recording) {
      const targetProjectId = recordingProjectRef.current
      try {
        const file = await recording.stop(); setRecording(null); setRecordingNotice(null)
        if (!targetProjectId || activeProjectRef.current !== targetProjectId) return
        await uploadFile(file)
      }
      catch (cause) { setRecording(null); if (activeProjectRef.current === targetProjectId) setError(cause instanceof Error ? cause.message : "Recording failed") }
    } else {
      let targetProjectId: string | null = null
      try {
        targetProjectId = await ensureProject()
        const controller = new AbortController()
        recordingAbortRef.current?.abort()
        recordingAbortRef.current = controller
        recordingProjectRef.current = targetProjectId
        setRecordingNotice("Recording… it will stop automatically at 30 seconds or 5 MB.")
        const session = await startWavRecording({
          signal: controller.signal,
          onLimitReached: () => {
            if (activeProjectRef.current === targetProjectId && recordingAbortRef.current === controller) setRecordingNotice("Recording limit reached. Choose “Stop and use” to add it.")
          }
        })
        if (controller.signal.aborted || activeProjectRef.current !== targetProjectId) { session.discard(); return }
        setRecording(session)
      }
      catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return
        setRecordingNotice(null)
        if (activeProjectRef.current === targetProjectId) setError("Microphone access was denied or unavailable. You can still upload a WAV or type a direction.")
      }
    }
  }

  const auditionSource = (assetId: string) => {
    const asset = snapshot?.assets.find((candidate) => candidate.id === assetId)
    if (asset) void playback.playItem(sourcePlaybackItem(asset))
  }

  const chooseProject = async (id: string) => {
    const requestId = ++projectRequestRef.current
    activeProjectRef.current = id
    draftProjectRef.current = id
    recordingAbortRef.current?.abort(); recording?.discard(); setRecording(null); setRecordingNotice(null)
    playback.clear(); setProjectId(id); setSnapshot(null); setJob(null); setSelectedRevisionId(null); setExportResult(null); setReceipt(readReceipt(id)); setLoading(true); setError(null)
    setDraft(localStorage.getItem(`pocket-producer:draft:${id}`) ?? creationDraft)
    try {
      const value = await api.snapshot(id)
      if (requestId !== projectRequestRef.current || activeProjectRef.current !== id) return
      setSnapshot(value); setJob(value.latestJob); setSelectedRevisionId(value.project.currentRevisionId); setNavOpen(false)
      setDraft(localStorage.getItem(`pocket-producer:draft:${id}`) ?? (value.currentRevision ? revisionDraft : creationDraft))
      const accepted = acceptedPlaybackItem(value); if (accepted) playback.load(accepted); else playback.clear()
      const storedReceipt = readReceipt(id); setReceipt(storedReceipt); reconcileReceipt(id, storedReceipt)
      if (value.currentRevision) loadExportState(id, value.currentRevision.id, requestId)
    }
    catch (cause) { if (activeProjectRef.current === id) setError(cause instanceof Error ? cause.message : "Unable to open session") }
    finally { if (requestId === projectRequestRef.current) setLoading(false) }
  }

  const useSelectedVersion = async () => {
    if (!snapshot || !selectedRevisionId) return
    const targetProjectId = snapshot.project.id
    setBusy(true)
    try {
      await api.selectVersion(targetProjectId, selectedRevisionId, snapshot.project.currentRevisionId)
      if (activeProjectRef.current !== targetProjectId) return
      await refreshProjects(targetProjectId); setCompareOpen(false)
    }
    catch (cause) { if (activeProjectRef.current === targetProjectId) setError(cause instanceof Error ? cause.message : "Unable to restore version") }
    finally { setBusy(false) }
  }

  const exportCurrent = async () => {
    if (!snapshot?.project.currentRevisionId) return
    const targetProjectId = snapshot.project.id
    const revisionId = snapshot.project.currentRevisionId
    setBusy(true); setError(null)
    try {
      const existing = readReceipt(targetProjectId)
      const exportReceipt: SubmissionReceipt = existing?.operation === "export" && existing.baseRevisionId === revisionId
        ? existing
        : { key: crypto.randomUUID(), projectId: targetProjectId, operation: "export", baseRevisionId: revisionId }
      localStorage.setItem(receiptKey(targetProjectId), JSON.stringify(exportReceipt)); setReceipt(exportReceipt)
      const result = await api.export(revisionId, exportReceipt.key)
      const acceptedReceipt = { ...exportReceipt, jobId: result.jobId, acceptedAt: new Date().toISOString() }
      localStorage.setItem(receiptKey(targetProjectId), JSON.stringify(acceptedReceipt))
      if (activeProjectRef.current !== targetProjectId) return
      setReceipt(acceptedReceipt); setExportResult({ state: "exporting", remote_url: null, error_message: null }); setJob(await api.job(result.jobId))
    }
    catch (cause) { if (activeProjectRef.current === targetProjectId) setError(cause instanceof Error ? cause.message : "Unable to prepare export") }
    finally { setBusy(false) }
  }

  const connectAudiotool = async () => {
    if (!nexus.oauth) return
    setBusy(true); setError(null)
    try {
      const result = await beginAudiotoolConnection(nexus.oauth)
      if (result === "connected") { const status = await api.status(); setProviders(status.providers); setNexus(status.nexus) }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Audiotool connection failed") }
    finally { setBusy(false) }
  }

  const reconcileKnownOutcome = async () => {
    if (!job) return
    const targetProjectId = job.project_id
    setBusy(true); setError(null)
    try {
      const result = await api.reconcile(job.id)
      if (activeProjectRef.current !== targetProjectId) return
      setJob(result.job); if (result.export) setExportResult(result.export)
      const value = await api.snapshot(targetProjectId)
      if (activeProjectRef.current === targetProjectId) setSnapshot(value)
    } catch (cause) {
      if (activeProjectRef.current === targetProjectId) setError(cause instanceof Error ? cause.message : "Unable to reconcile the known outcome")
    } finally { setBusy(false) }
  }

  const navContent = useMemo(() => <>
    <Button className="w-full justify-start" onClick={() => void createSession()} disabled={busy}><Plus /> New session</Button>
    <div className="rail-list" aria-label="Recent sessions">{projects.map((project) => <button key={project.id} className="rail-session" aria-current={project.id === projectId ? "page" : undefined} title={project.title} onClick={() => void chooseProject(project.id)}>{project.title}</button>)}</div>
  </>, [projects, projectId, busy])

  return (
    <div className="app-shell">
      <aside className="session-rail" aria-label="Session navigation"><div className="wordmark">Pocket <span>Producer</span></div>{navContent}<div className="rail-footer">Local listening room<br />Private development session</div></aside>
      <main className="main-area"><div className="main-inner">
        <div className="mobile-topbar"><div className="wordmark">Pocket <span>Producer</span></div><Button variant="ghost" size="icon" aria-label="Open sessions" onClick={() => setNavOpen(true)}><Menu /></Button></div>
        <div className="topline"><span>Listening Room / {snapshot?.project.title ?? "Welcome"}</span><div className="mode-switch" role="group" aria-label="Listening Room workflow"><Button variant={nativeMode ? "default" : "outline"} size="sm" aria-pressed={nativeMode} onClick={() => { playback.clear(); setNativeMode(true) }}>Native construction</Button><Button variant={!nativeMode ? "default" : "outline"} size="sm" aria-pressed={!nativeMode} onClick={() => { setNativeMode(false); const accepted = acceptedPlaybackItem(snapshot); if (accepted) playback.load(accepted) }}>Legacy audio</Button></div>{!nativeMode ? <Button variant="outline" onClick={() => void (nexus.connection === "awaiting-authorization" ? connectAudiotool() : exportCurrent())} disabled={!currentRevision || busy}><Headphones /> {nexus.connection === "unconfigured" ? "Prepare Nexus handoff" : nexus.connection === "awaiting-authorization" ? "Connect Audiotool" : "Export editable stems"}</Button> : null}</div>

        {loading ? <div className="empty-surface" aria-live="polite"><AudioLines className="mx-auto mb-4 size-8" /><p>Opening your listening room…</p></div> : snapshot ? nativeMode ? <NativeRoom key={snapshot.project.id} projectId={snapshot.project.id} assets={snapshot.assets} legacyVersionCount={snapshot.revisions.length} onAddSource={() => setSourcesOpen(true)} onLegacy={() => { setNativeMode(false); const accepted = acceptedPlaybackItem(snapshot); if (accepted) playback.load(accepted) }} /> : <>
          <header className="session-header"><div className="eyebrow"><span className="status-dot" /> {activeJob ? "Production in progress" : currentRevision ? "Ready to listen" : "New session"}</div><h1 className="session-title">{currentRevision?.title ?? snapshot.project.title}</h1><p className="session-deck">{currentRevision?.changeSummary ?? "Start with a sound or an idea. The producer will shape a short instrumental and keep every accepted version safe."}</p><p className="provider-status">Producer: {producerProvenance} · Audio critique: {currentAnalysis ? `${currentAnalysis.status} via ${currentAnalysis.model}` : providers.gemini ? "available when a render is made" : "unavailable; measured checks remain active"}</p></header>
          {exportResult ? <div className="job-status" role={exportResult.state === "failed" || exportResult.state === "uncertain" ? "alert" : "status"}><strong>Audiotool handoff: {exportResult.state.replaceAll("_", " ")}</strong><span>{exportResult.error_message ?? (exportResult.remote_url ? "Four editable audio stems are ready in Audiotool." : "The local four-stem mapping is preserved while this handoff progresses.")}</span>{exportResult.remote_url ? <Button className="mt-3" variant="outline" size="sm" onClick={() => window.open(exportResult.remote_url ?? "", "_blank", "noopener,noreferrer")}>Open Audiotool Studio</Button> : null}</div> : null}
          {audibleItem ? <>
            <div className="listening-grid"><div className="cover-art" role="img" aria-label="Abstract burnt-orange and forest-green session artwork"><span className="cover-grain" /><span className="cover-label">Sunroom palette</span></div><AudioPlayer audio={playback.audio} item={audibleItem} playing={playback.playing} currentTime={playback.currentTime} duration={playback.duration || audibleItem.durationSeconds} volume={playback.volume} error={playback.error} onToggle={() => void playback.toggle()} onSeek={playback.seek} onVolume={playback.setVolume} onReturnToPiece={audibleItem.kind === "source" && acceptedItem ? returnToAccepted : undefined} /></div>
            {currentRevision && audibleItem.kind === "revision" ? <div className="section-strip" aria-label="Arrangement sections">{currentRevision.composition.sections.map((section, index) => <button key={section.id} className="section-button" aria-pressed={section.id === activeSectionId} onClick={() => { if (acceptedItem && playback.item?.id !== acceptedItem.id) playback.load(acceptedItem); window.requestAnimationFrame(() => playback.seek(section.startTick / currentRevision.composition.tempoBpm / 960 * 60)) }}><strong>{section.name}</strong><br /><small>{index === 0 ? "arrives softly" : index === 3 ? "settles" : index === 2 ? "opens up" : "main pulse"}</small></button>)}</div> : null}
          </> : <div className="empty-surface"><AudioLines className="mx-auto mb-4 size-9 text-primary" /><h2>Start with a sound or an idea.</h2><p className="mx-auto max-w-xl text-muted-foreground">Add an owned WAV, record a small sound, or let the Sunroom palette begin from your written direction.</p><div className="empty-actions"><Button onClick={() => fileRef.current?.click()}><Upload /> Add sound</Button><Button variant="outline" onClick={() => void toggleRecording()}>{recording ? <X /> : <Mic />}{recording ? "Stop and use" : "Record a sound"}</Button><Button variant="ghost" onClick={() => void submitDirection()}><AudioLines /> Try the direction below</Button></div></div>}
           {jobMessage && job && (activeJob || job.state === "failed" || job.state === "cancelled" || job.state === "needs_attention") ? <div className="job-status" role={job.state === "failed" || job.state === "needs_attention" ? "alert" : "status"} aria-live="polite"><strong>{jobMessage}</strong><span className="provider-note">{activeJob ? "You can leave this page; the durable worker will keep going." : job.state === "needs_attention" ? "Checking the existing operation is safe. Starting a genuinely new paid or remote attempt is a separate action." : "Your accepted audio and earlier versions remain available."}</span>{activeJob ? <Button className="mt-3" variant="ghost" size="sm" onClick={() => { const target = job.project_id; void api.cancel(job.id).then(() => api.job(job.id)).then((next) => { if (activeProjectRef.current === target) setJob(next) }).catch((cause: unknown) => { if (activeProjectRef.current === target) setError(cause instanceof Error ? cause.message : "Unable to cancel request") }) }}>Cancel request</Button> : job.state === "needs_attention" ? <Button className="mt-3" variant="outline" size="sm" onClick={() => void reconcileKnownOutcome()} disabled={busy}>Check known outcome</Button> : null}</div> : null}
           {receipt && !receipt.jobId ? <div className="job-status" role="status"><strong>Submission receipt retained</strong><span>The acknowledgement was interrupted. Submit the unchanged direction again to reconcile the same command; Pocket Producer will reuse its key instead of starting duplicate work.</span></div> : null}
           {recordingNotice ? <div className="job-status" role="status" aria-live="polite"><strong>Microphone capture</strong><span>{recordingNotice}</span></div> : null}
           {error ? <div className="job-status" role="alert"><strong>Something needs attention</strong><span>{error}</span></div> : null}
           <div className="composer-shell"><form className="composer" onSubmit={(event) => { event.preventDefault(); void submitDirection() }}><label htmlFor="direction" className="sr-only">Direction for the producer</label><Textarea id="direction" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={currentRevision ? "What should change?" : "What should this become?"} disabled={Boolean(activeJob)} /><div className="composer-actions"><div className="chips">{currentRevision ? <><span className="chip"><ShieldCheck className="mr-1 size-3" /> Melody protected</span><span className="chip">Groove selected</span></> : <span className="chip">16 bars · Sunroom palette</span>}</div><Button className="round-play" size="icon" type="submit" aria-label={currentRevision ? "Request revision" : "Create instrumental"} disabled={busy || Boolean(activeJob) || draft.trim().length < 3}><ArrowUp /></Button></div></form></div>
           <div className="detail-grid">
            <section className="quiet-section"><div className="section-heading"><h2>Sources</h2><Button variant="ghost" size="sm" onClick={() => setSourcesOpen(true)}>{snapshot.assets.length ? "Manage" : "Add"}</Button></div><div className="source-list">{snapshot.assets.length ? snapshot.assets.map((asset) => <button className="source-pill" key={asset.id} onClick={() => auditionSource(asset.id)} aria-label={`Audition source ${asset.name}`}><MiniWave /> {asset.name}</button>) : <span className="provider-note">No source added. The owned palette can still create.</span>}</div>{sourceLineage?.selected ? <p className="provider-note">Selected source: {sourceLineage.audiblyUsed ? "used in the rendered arrangement" : "kept attached but not audibly used"}.</p> : null}{sourceAnalysis ? <p className="provider-note">Source analysis: {sourceAnalysis.status} via {sourceAnalysis.model}. Interpretive notes remain separate from measured audio facts.</p> : snapshot.assets.length ? <p className="provider-note">Source analysis has not run for the current version.</p> : null}</section>
            <section className="quiet-section"><div className="section-heading"><h2>Versions</h2><Button variant="ghost" size="sm" onClick={() => setCompareOpen(true)} disabled={snapshot.revisions.length < 1}><GitCompareArrows /> Compare</Button></div><p className="provider-note">{snapshot.revisions.length ? `${snapshot.revisions.length} immutable ${snapshot.revisions.length === 1 ? "version" : "versions"}. Melody protection is enforced by the server during revision.` : "Your first accepted version will appear here."}</p></section>
          </div>
        </> : <div className="empty-surface"><Library className="mx-auto mb-4 size-9 text-primary" /><h2>Your rooms begin here.</h2><p className="text-muted-foreground">Create a private local session, then add a sound or write the first direction.</p><div className="empty-actions"><Button onClick={() => void createSession()} disabled={busy}><Plus /> New session</Button></div>{error ? <p role="alert" className="mt-5 text-destructive">{error}</p> : null}</div>}
      </div></main>

      <input ref={fileRef} className="sr-only" type="file" accept="audio/wav,.wav" aria-label="Upload a WAV source" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadFile(file) }} />

      <Sheet open={navOpen} onOpenChange={setNavOpen}><SheetContent side="left" className="w-[88vw] bg-background"><SheetHeader><SheetTitle className="font-heading text-2xl">Pocket Producer</SheetTitle><SheetDescription>Your private listening rooms.</SheetDescription></SheetHeader><div className="p-4">{navContent}</div></SheetContent></Sheet>
      <Sheet open={sourcesOpen} onOpenChange={(open) => { setSourcesOpen(open); if (!open) returnToAccepted() }}><SheetContent side="right" className="w-[min(92vw,430px)] bg-background"><SheetHeader><SheetTitle className="font-heading text-2xl">Source tray</SheetTitle><SheetDescription>WAV audio stays in the project-local private store.</SheetDescription></SheetHeader><div className="grid gap-3 p-4"><Button onClick={() => fileRef.current?.click()} disabled={busy}><Upload /> Upload WAV</Button><Button variant="outline" onClick={() => void toggleRecording()}>{recording ? <X /> : <Mic />}{recording ? "Stop and use recording" : "Record a sound"}</Button>{snapshot?.assets.map((asset) => <button key={asset.id} className="source-pill justify-start" onClick={() => auditionSource(asset.id)}><MiniWave /><span className="truncate">{asset.name}</span></button>)}<p className="provider-note">Recordings stop at 30 seconds or 5 MB. Other formats remain unavailable until a bounded decoder is configured. Originals are preserved.</p></div></SheetContent></Sheet>
      <Dialog open={compareOpen} onOpenChange={(open) => { setCompareOpen(open); if (!open) returnToAccepted() }}><DialogContent className="max-w-xl bg-popover p-6"><DialogHeader><DialogTitle className="font-heading text-2xl">Compare versions</DialogTitle><DialogDescription>Choosing A or B only auditions it. “Use this version” explicitly changes the current head without deleting history.</DialogDescription></DialogHeader><RadioGroup value={selectedRevisionId ?? undefined} onValueChange={(value) => { setSelectedRevisionId(value); const version = snapshot?.revisions.find((candidate) => candidate.id === value); if (version) playback.load(versionPlaybackItem(version, snapshot?.project.currentRevisionId ?? null)) }} className="version-list" aria-label="Version to audition">{snapshot?.revisions.map((version) => <label className="version-option" key={version.id}><RadioGroupItem value={version.id} aria-label={`Version ${version.ordinal}`} /><span><span className="version-title"><span>Version {version.ordinal}</span>{version.id === snapshot.project.currentRevisionId ? <span className="chip"><Check className="mr-1 size-3" /> Current</span> : null}</span><p>{version.changeSummary}</p>{version.protectedTrackHashes.melody ? <p><ShieldCheck className="mr-1 inline size-3" /> Melody artifact protected</p> : null}</span></label>)}</RadioGroup><DialogFooter className="-mx-6 -mb-6"><Button variant="outline" onClick={() => { returnToAccepted(); setCompareOpen(false) }}>Keep current</Button><Button onClick={() => void useSelectedVersion()} disabled={!selectedRevisionId || selectedRevisionId === snapshot?.project.currentRevisionId || busy}>Use this version</Button></DialogFooter></DialogContent></Dialog>
    </div>
  )
}
