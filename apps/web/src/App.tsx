import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowRight, AudioLines, Check, FolderOpen, GitCompareArrows, Headphones, Library, Menu, Mic, Plus, ShieldCheck, Sparkles, Upload, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Brand } from "@/components/brand"
import { RoomHero } from "@/components/room-hero"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { AudioPlayer, usePlayback, type PlaybackItem } from "@/features/listening/audio-player"
import { NativeRoom } from "@/features/native/native-room"
import { api, type AppStatus, type Asset, type Job, type Project, type ProjectSnapshot, type Version } from "@/lib/api"
import { beginAudiotoolConnection, finishAudiotoolCallback } from "@/lib/audiotool"
import { startWavRecording, type RecordingSession } from "@/lib/record-wav"
import { friendlyIssue, jobProgress } from "@/lib/ui-copy"
import { navigateSession, sessionFromPath } from "@/lib/session-route"

const terminalStates = new Set(["succeeded", "failed", "cancelled", "needs_attention"])

function stageLabel(job: Job | null) {
  if (!job) return null
  if (job.state === "failed") return friendlyIssue(job.error_message, "We couldn't finish that request. Your previous version is safe.")
  if (job.state === "cancelled") return "Stopped. Your previous version is unchanged."
  if (job.state === "needs_attention") return "We need to check what happened before trying again."
  return jobProgress(job)
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

  const refreshProjectLabels = async (id: string) => {
    const result = await api.listProjects()
    if (activeProjectRef.current !== id) return
    setProjects(result.projects)
    const updated = result.projects.find((project) => project.id === id)
    if (updated) setSnapshot((prior) => prior?.project.id === id ? { ...prior, project: updated } : prior)
  }

  useEffect(() => {
    const requestId = ++projectRequestRef.current
    void Promise.all([api.status(), api.listProjects()]).then(async ([status, list]) => {
      if (requestId !== projectRequestRef.current) return
      setProviders(status.providers); setNexus(status.nexus); setProjects(list.projects)
      const route = sessionFromPath(window.location.pathname)
      const first = route?.id ?? list.projects[0]?.id ?? null
      if (route && !list.projects.some((project) => project.id === route.id)) { setError("This session is no longer available. Choose a session from the sidebar."); return }
      setNativeMode(route?.view !== "audio"); activeProjectRef.current = first; setProjectId(first)
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

  useEffect(() => {
    let active = true
    const timer = window.setInterval(() => { void api.listProjects().then((value) => { if (active) setProjects(value.projects) }).catch(() => undefined) }, 8_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [])

  useEffect(() => { if (projectId && draftProjectRef.current === projectId) localStorage.setItem(`pocket-producer:draft:${projectId}`, draft) }, [draft, projectId])

  useEffect(() => () => { recordingAbortRef.current?.abort(); recording?.discard() }, [recording])

  useEffect(() => {
    if (!job || job.kind.startsWith("native-") || terminalStates.has(job.state)) return
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
  const nativeSourceItem = playback.item?.kind === "source" ? playback.item : null

  const returnToAccepted = () => {
    if (!acceptedItem) return
    setSelectedRevisionId(snapshot?.project.currentRevisionId ?? null)
    playback.load(acceptedItem)
  }

  const createSession = async () => {
    setBusy(true); setError(null)
    try { const { project } = await api.createProject("Untitled listening room"); await refreshProjects(project.id); setNativeMode(true); navigateSession(project.id, "start"); setNavOpen(false) }
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
      setError("In playable audio, this change is limited to simplifying the drums while keeping the melody. Try that direction, or switch to Arrange for broader changes.")
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

  const chooseProject = async (id: string, fromHistory = false) => {
    if (!fromHistory) navigateSession(id, nativeMode ? "arrange" : "audio")
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

  useEffect(() => {
    const change = () => {
      const route = sessionFromPath(window.location.pathname)
      if (route) { setNativeMode(route.view !== "audio"); void chooseProject(route.id, true) }
      else if (window.location.pathname === "/" && projects[0]) void chooseProject(projects[0].id, true)
    }
    window.addEventListener("popstate", change)
    return () => window.removeEventListener("popstate", change)
  }, [projects])

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
    <Button className="w-full justify-start rail-new" onClick={() => void createSession()} disabled={busy}><Plus /> New session</Button>
    <div className="rail-heading"><FolderOpen className="size-4" /> Sessions</div>
    <p className="rail-caption">Recent</p>
    <div className="rail-list" aria-label="Recent sessions">{projects.map((project) => <button key={project.id} className="rail-session" data-project-id={project.id} aria-current={project.id === projectId ? "page" : undefined} title={project.title} onClick={() => void chooseProject(project.id)}><span>{project.title}</span>{project.workspaceStatus && project.workspaceStatus !== "new" ? <small>{project.workspaceStatus === "working" ? "Working" : project.workspaceStatus === "attention" ? "Needs you" : "Ready"}</small> : null}</button>)}</div>
  </>, [projects, projectId, busy])

  return (
    <div className="app-shell">
      <aside className="session-rail" aria-label="Session navigation"><Brand />{navContent}<div className="rail-footer">Your private music workspace</div></aside>
      <main className="main-area"><div className="main-inner">
        <div className="mobile-topbar"><Brand /><Button variant="ghost" size="icon" aria-label="Open sessions" onClick={() => setNavOpen(true)}><Menu /></Button></div>
        <div className="topline"><span>Listening Room <span aria-hidden="true">/</span> <strong>{snapshot?.project.title ?? "Welcome"}</strong></span><div className="mode-switch" role="group" aria-label="Room view"><Button variant={nativeMode ? "default" : "outline"} size="sm" aria-pressed={nativeMode} disabled={busy} onClick={() => { playback.clear(); setNativeMode(true); if (projectId) navigateSession(projectId) }}>Arrange</Button><Button variant={!nativeMode ? "default" : "outline"} size="sm" aria-pressed={!nativeMode} disabled={busy} onClick={() => { setNativeMode(false); if (projectId) navigateSession(projectId, "audio"); const accepted = acceptedPlaybackItem(snapshot); if (accepted) playback.load(accepted); else playback.clear() }}>Playable audio</Button></div></div>

        {loading ? <div className="empty-surface" aria-live="polite"><AudioLines className="mx-auto mb-4 size-8" /><p>Opening your listening room…</p></div> : snapshot ? nativeMode ? <NativeRoom key={snapshot.project.id} projectId={snapshot.project.id} assets={snapshot.assets} legacyVersionCount={snapshot.revisions.length} audiotoolConnected={nexus.session.connected} audiotoolAvailable={Boolean(nexus.oauth)} onConnectAudiotool={() => { void connectAudiotool() }} onAddSource={() => setSourcesOpen(true)} onAuditionSource={auditionSource} sourcePreview={nativeSourceItem ? <div className="source-mini-player"><AudioPlayer audio={playback.audio} item={nativeSourceItem} playing={playback.playing} currentTime={playback.currentTime} duration={playback.duration || nativeSourceItem.durationSeconds} volume={playback.volume} error={playback.error} onToggle={() => void playback.toggle()} onSeek={playback.seek} onVolume={playback.setVolume} /></div> : null} onLegacy={() => { setNativeMode(false); if (projectId) navigateSession(projectId, "audio"); const accepted = acceptedPlaybackItem(snapshot); if (accepted) playback.load(accepted) }} onProjectUpdated={() => { void refreshProjectLabels(snapshot.project.id) }} /> : <>
          <RoomHero status={activeJob ? "Making your audio" : currentRevision ? "Ready to listen" : "A fresh start"} title={currentRevision?.title ?? snapshot.project.title} description={currentRevision?.changeSummary ?? "Describe a direction or add your own sound. Your playable versions will stay together here."} meta={currentRevision ? `${Math.round(currentRevision.durationSeconds)} seconds · ${currentRevision.composition.sections.length} sections · Version ${currentRevision.ordinal}` : "Playable audio is separate from your editable arrangement"} actions={currentRevision && nexus.connection !== "unconfigured" ? <Button variant="outline" onClick={() => void (nexus.connection === "awaiting-authorization" ? connectAudiotool() : exportCurrent())} disabled={busy}><Headphones /> {nexus.connection === "awaiting-authorization" ? "Connect Audiotool" : "Export audio stems"}</Button> : null} />
          {currentRevision ? <details className="room-technical"><summary>How this version was made</summary><p>Producer: {producerProvenance}. Audio analysis: {currentAnalysis ? `${currentAnalysis.status} via ${currentAnalysis.model}` : providers.gemini ? "not run for this version" : "unavailable"}. Measured checks and interpretive notes are kept separate.</p></details> : null}
          {exportResult ? <div className="job-status" role={exportResult.state === "failed" || exportResult.state === "uncertain" ? "alert" : "status"}><strong>{exportResult.remote_url ? "Your Audiotool copy is ready" : exportResult.state === "disabled" ? "Audiotool export isn't available here" : exportResult.state === "uncertain" ? "We need to check the Audiotool result" : "Preparing your Audiotool copy"}</strong><span>{exportResult.remote_url ? "The audio stems can be edited separately in Audiotool." : "Your audio and saved versions remain in this room."}</span>{exportResult.remote_url ? <Button className="mt-3" variant="outline" size="sm" onClick={() => window.open(exportResult.remote_url ?? "", "_blank", "noopener,noreferrer")}>Open in Audiotool</Button> : null}{exportResult.error_message ? <details className="room-technical"><summary>Technical details</summary><p>{exportResult.error_message}</p></details> : null}</div> : null}
          <div className="audio-room-panel">
          {audibleItem ? <>
            <div className="listening-grid"><div className="cover-art" role="img" aria-label="Abstract burnt-orange and forest-green session artwork"><span className="cover-grain" /></div><AudioPlayer audio={playback.audio} item={audibleItem} playing={playback.playing} currentTime={playback.currentTime} duration={playback.duration || audibleItem.durationSeconds} volume={playback.volume} error={playback.error} onToggle={() => void playback.toggle()} onSeek={playback.seek} onVolume={playback.setVolume} onReturnToPiece={audibleItem.kind === "source" && acceptedItem ? returnToAccepted : undefined} /></div>
            {currentRevision && audibleItem.kind === "revision" ? <div className="section-strip" aria-label="Audio sections">{currentRevision.composition.sections.map((section) => <button key={section.id} className="section-button" aria-pressed={section.id === activeSectionId} onClick={() => { if (acceptedItem && playback.item?.id !== acceptedItem.id) playback.load(acceptedItem); window.requestAnimationFrame(() => playback.seek(section.startTick / currentRevision.composition.tempoBpm / 960 * 60)) }}><strong>{section.name}</strong><br /><small>Bars {Math.floor(section.startTick / 960) + 1}–{Math.ceil(section.endTick / 960)}</small></button>)}</div> : null}
          </> : <div className="audio-empty"><AudioLines className="size-8 text-primary" /><h2>Create something you can play</h2><p>Add a sound or describe a direction below. Playable audio versions are separate from your editable arrangement.</p><div className="empty-actions"><Button variant="outline" onClick={() => fileRef.current?.click()}><Upload /> Add sound</Button><Button variant="outline" onClick={() => void toggleRecording()}>{recording ? <X /> : <Mic />}{recording ? "Stop and use" : "Record a sound"}</Button></div></div>}
           {jobMessage && job && (activeJob || job.state === "failed" || job.state === "cancelled" || job.state === "needs_attention") ? <div className="job-status" role={job.state === "failed" || job.state === "needs_attention" ? "alert" : "status"} aria-live="polite"><strong>{jobMessage}</strong><span className="provider-note">{activeJob ? "You can leave this room while the request continues." : job.state === "needs_attention" ? "We can check the earlier result without starting another request." : "Your playable audio and earlier versions remain available."}</span>{activeJob ? <Button className="mt-3" variant="ghost" size="sm" onClick={() => { const target = job.project_id; void api.cancel(job.id).then(() => api.job(job.id)).then((next) => { if (activeProjectRef.current === target) setJob(next) }).catch((cause: unknown) => { if (activeProjectRef.current === target) setError(cause instanceof Error ? cause.message : "Unable to cancel request") }) }}>Stop this request</Button> : job.state === "needs_attention" ? <Button className="mt-3" variant="outline" size="sm" onClick={() => void reconcileKnownOutcome()} disabled={busy}>Check what happened</Button> : null}{job.error_message ? <details className="room-technical"><summary>Technical details</summary><p>{job.error_message}</p></details> : null}</div> : null}
           {receipt && !receipt.jobId ? <div className="job-status" role="status"><strong>Checking your request</strong><span>The response was interrupted. Sending the same direction again will check the saved request, not create a second one.</span></div> : null}
           {recordingNotice ? <div className="job-status" role="status" aria-live="polite"><strong>Recording your sound</strong><span>{recordingNotice}</span></div> : null}
           {error ? <div className="job-status" role="alert"><strong>Something needs attention</strong><span>{friendlyIssue(error, "We couldn't complete that action. Your saved work is still here.")}</span><details className="room-technical"><summary>Technical details</summary><p>{error}</p></details></div> : null}
           <section className="audio-direction-section"><div className="section-heading"><div><h2>{currentRevision ? "Shape this audio" : "Describe your playable piece"}</h2><p>{currentRevision ? "For this audio workflow, you can simplify the drums while keeping the melody." : "Your direction will make a playable instrumental."}</p></div></div><div className="composer-shell"><form className="composer" onSubmit={(event) => { event.preventDefault(); void submitDirection() }}><label htmlFor="direction" className="sr-only">Describe your playable audio</label><Textarea id="direction" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={currentRevision ? "Simplify the drums in Groove; keep the melody." : "Describe the sound and mood you want."} disabled={Boolean(activeJob)} /><div className="composer-actions"><div className="chips">{currentRevision ? <span className="chip"><ShieldCheck className="mr-1 size-3" /> Keep the melody</span> : <span className="chip">Playable audio</span>}</div><Button type="submit" disabled={busy || Boolean(activeJob) || draft.trim().length < 3}><Sparkles className="size-4" /> {currentRevision ? "Make this change" : "Create playable audio"} <ArrowRight className="size-4" /></Button></div></form></div></section>
           <div className="detail-grid">
            <section className="quiet-section"><div className="section-heading"><h2>Your sounds</h2><Button variant="outline" size="sm" onClick={() => setSourcesOpen(true)}>{snapshot.assets.length ? "Manage" : "Add"}</Button></div><div className="source-list">{snapshot.assets.length ? snapshot.assets.map((asset) => <button className="source-pill" key={asset.id} onClick={() => auditionSource(asset.id)} aria-label={`Play sound ${asset.name}`}><MiniWave /> {asset.name}</button>) : <span className="provider-note">No sound added. You can still create from a written direction.</span>}</div>{sourceLineage?.selected ? <p className="provider-note">The selected sound {sourceLineage.audiblyUsed ? "can be heard in this playable version" : "was not heard in this playable version"}.</p> : null}{sourceAnalysis ? <details className="room-technical"><summary>Sound analysis details</summary><p>{sourceAnalysis.status} via {sourceAnalysis.model}. Interpretive notes remain separate from measured audio facts.</p></details> : null}</section>
            <section className="quiet-section"><div className="section-heading"><h2>Playable versions</h2><Button variant="outline" size="sm" onClick={() => setCompareOpen(true)} disabled={snapshot.revisions.length < 1}><GitCompareArrows /> Compare</Button></div><p className="provider-note">{snapshot.revisions.length ? `${snapshot.revisions.length} saved ${snapshot.revisions.length === 1 ? "version" : "versions"}. Listen to an earlier one or restore it without losing history.` : "Your first playable version will appear here."}</p></section>
          </div>
          </div>
        </> : <div className="empty-surface welcome-surface"><Library className="mx-auto mb-4 size-9 text-primary" /><h2>Your music starts here.</h2><p className="text-muted-foreground">Start a private session, describe an idea, and shape an editable arrangement. You can add your own sounds whenever you're ready.</p><div className="empty-actions"><Button onClick={() => void createSession()} disabled={busy}><Plus /> New session</Button></div>{error ? <p role="alert" className="mt-5 text-destructive">{friendlyIssue(error, "We couldn't open your rooms. Please try again.")}</p> : null}</div>}
      </div></main>

      <input ref={fileRef} className="sr-only" type="file" accept="audio/wav,.wav" aria-label="Upload a WAV source" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadFile(file) }} />

      <Sheet open={navOpen} onOpenChange={setNavOpen}><SheetContent side="left" className="w-[88vw] bg-background"><SheetHeader><SheetTitle><Brand /></SheetTitle><SheetDescription>Your private music workspace.</SheetDescription></SheetHeader><div className="p-4">{navContent}</div></SheetContent></Sheet>
      <Sheet open={sourcesOpen} onOpenChange={(open) => { setSourcesOpen(open); if (!open && !nativeMode) returnToAccepted() }}><SheetContent side="right" className="w-[min(92vw,430px)] bg-background"><SheetHeader><SheetTitle className="font-heading text-2xl">Your sounds</SheetTitle><SheetDescription>Add a WAV or record a short sound. Your originals stay private in this room.</SheetDescription></SheetHeader><div className="grid gap-3 p-4"><Button onClick={() => fileRef.current?.click()} disabled={busy}><Upload /> Add WAV</Button><Button variant="outline" onClick={() => void toggleRecording()}>{recording ? <X /> : <Mic />}{recording ? "Stop and use recording" : "Record a sound"}</Button>{snapshot?.assets.map((asset) => <button key={asset.id} className="source-pill justify-start" aria-label={`Play sound ${asset.name}`} onClick={() => auditionSource(asset.id)}><MiniWave /><span className="truncate">{asset.name}</span></button>)}<p className="provider-note">Recordings stop after 30 seconds or 5 MB. WAV is the supported format; your originals are preserved.</p></div></SheetContent></Sheet>
      <Dialog open={compareOpen} onOpenChange={(open) => { setCompareOpen(open); if (!open) returnToAccepted() }}><DialogContent className="max-w-xl bg-popover p-6"><DialogHeader><DialogTitle className="font-heading text-2xl">Compare playable versions</DialogTitle><DialogDescription>Choose a version to listen to. Restoring one changes what's current without deleting the others.</DialogDescription></DialogHeader><RadioGroup value={selectedRevisionId ?? undefined} onValueChange={(value) => { setSelectedRevisionId(value); const version = snapshot?.revisions.find((candidate) => candidate.id === value); if (version) playback.load(versionPlaybackItem(version, snapshot?.project.currentRevisionId ?? null)) }} className="version-list" aria-label="Version to audition">{snapshot?.revisions.map((version) => <label className="version-option" key={version.id}><RadioGroupItem value={version.id} aria-label={`Version ${version.ordinal}`} /><span><span className="version-title"><span>Version {version.ordinal}</span>{version.id === snapshot.project.currentRevisionId ? <span className="chip"><Check className="mr-1 size-3" /> Current</span> : null}</span><p>{version.changeSummary}</p>{version.protectedTrackHashes.melody ? <p><ShieldCheck className="mr-1 inline size-3" /> Melody kept unchanged</p> : null}</span></label>)}</RadioGroup><DialogFooter className="-mx-6 -mb-6"><Button variant="outline" onClick={() => { returnToAccepted(); setCompareOpen(false) }}>Keep current</Button><Button onClick={() => void useSelectedVersion()} disabled={!selectedRevisionId || selectedRevisionId === snapshot?.project.currentRevisionId || busy}>Restore this version</Button></DialogFooter></DialogContent></Dialog>
    </div>
  )
}
