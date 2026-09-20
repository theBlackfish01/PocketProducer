import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowUp, AudioLines, Check, GitCompareArrows, Headphones, Library, Menu, Mic, Plus, ShieldCheck, Upload, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { AudioPlayer, usePlayback } from "@/features/listening/audio-player"
import { api, type Job, type Project, type ProjectSnapshot } from "@/lib/api"
import { startWavRecording, type RecordingSession } from "@/lib/record-wav"

const terminalStates = new Set(["succeeded", "failed", "cancelled", "needs_attention"])

function stageLabel(job: Job | null) {
  if (!job) return null
  if (job.state === "queued") return "Waiting for the producer…"
  if (job.state === "cancel_requested") return "Stopping safely…"
  if (job.state === "failed") return job.error_message ?? "The request failed. Your previous version is safe."
  if (job.state === "cancelled") return "Request cancelled. Your previous version is unchanged."
  const labels: Record<string, string> = {
    analyzing: "Inspecting your source…", planning: "Shaping the arrangement…", composing: "Writing the parts…",
    rendering: "Rendering the real preview…", checking: "Checking timing and headroom…", exporting: "Preparing the Nexus handoff…"
  }
  return job.stage ? labels[job.stage] ?? "Working on your piece…" : job.state === "succeeded" ? "Version ready." : "Working on your piece…"
}

function MiniWave() {
  return <span className="mini-wave" aria-hidden="true">{[7, 14, 10, 18, 9, 15, 6].map((height, index) => <i key={index} style={{ height }} />)}</span>
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null)
  const [providers, setProviders] = useState({ openai: false, gemini: false, audiotool: false })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState("Make a warm, restrained instrumental around this sound.")
  const [job, setJob] = useState<Job | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [selectedRevisionId, setSelectedRevisionId] = useState<string | null>(null)
  const [recording, setRecording] = useState<RecordingSession | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const playback = usePlayback()

  const refreshProjects = async (preferred?: string) => {
    const result = await api.listProjects(); setProjects(result.projects)
    const next = preferred ?? projectId ?? result.projects[0]?.id ?? null
    setProjectId(next)
    if (next) { const value = await api.snapshot(next); setSnapshot(value); setJob(value.latestJob); setSelectedRevisionId(value.project.currentRevisionId) }
    else setSnapshot(null)
  }

  useEffect(() => {
    void Promise.all([api.status(), api.listProjects()]).then(async ([status, list]) => {
      setProviders(status.providers); setProjects(list.projects)
      const first = list.projects[0]?.id ?? null; setProjectId(first)
      if (first) { const value = await api.snapshot(first); setSnapshot(value); setJob(value.latestJob); setSelectedRevisionId(value.project.currentRevisionId) }
    }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to connect to Pocket Producer")).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!projectId) return
    const saved = localStorage.getItem(`pocket-producer:draft:${projectId}`)
    if (saved) setDraft(saved)
  }, [projectId])

  useEffect(() => { if (projectId) localStorage.setItem(`pocket-producer:draft:${projectId}`, draft) }, [draft, projectId])

  useEffect(() => {
    const revisionId = selectedRevisionId ?? snapshot?.project.currentRevisionId
    if (revisionId) playback.load(`/api/v1/revisions/${revisionId}/audio`)
  }, [playback.load, selectedRevisionId, snapshot?.project.currentRevisionId])

  useEffect(() => {
    if (!job || terminalStates.has(job.state)) return
    const timer = window.setInterval(() => {
      void api.job(job.id).then(async (next) => { setJob(next); if (terminalStates.has(next.state)) await refreshProjects(next.project_id) }).catch(() => undefined)
    }, 800)
    return () => window.clearInterval(timer)
  }, [job?.id, job?.state])

  const currentRevision = snapshot?.currentRevision ?? null
  const auditionVersion = snapshot?.revisions.find((version) => version.id === selectedRevisionId)
  const displayedDuration = auditionVersion?.durationSeconds ?? currentRevision?.duration_seconds ?? 0
  const versionLabel = auditionVersion ? `Version ${auditionVersion.ordinal}${auditionVersion.id === snapshot?.project.currentRevisionId ? " · current" : " · audition"}` : "No version"
  const activeJob = job && !terminalStates.has(job.state) ? job : null
  const jobMessage = stageLabel(job)

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
    setBusy(true); setError(null)
    try {
      const id = await ensureProject()
      const result = snapshot?.project.currentRevisionId
        ? await api.revise(id, snapshot.project.currentRevisionId, draft)
        : await api.generate(id, draft, snapshot?.assets[0]?.id)
      setJob(await api.job(result.jobId))
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to submit direction") }
    finally { setBusy(false) }
  }

  const uploadFile = async (file: File) => {
    setBusy(true); setError(null)
    try { const id = await ensureProject(); await api.upload(id, file); await refreshProjects(id); setSourcesOpen(true) }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Upload failed") }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = "" }
  }

  const toggleRecording = async () => {
    setError(null)
    if (recording) {
      try { const file = await recording.stop(); setRecording(null); await uploadFile(file) }
      catch (cause) { setRecording(null); setError(cause instanceof Error ? cause.message : "Recording failed") }
    } else {
      try { setRecording(await startWavRecording()) }
      catch { setError("Microphone access was denied or unavailable. You can still upload a WAV or type a direction.") }
    }
  }

  const auditionSource = (assetId: string) => { playback.load(`/api/v1/assets/${assetId}/audio`, false); void playback.toggle() }

  const chooseProject = async (id: string) => {
    playback.audio?.pause(); setProjectId(id); setSelectedRevisionId(null); setLoading(true); setError(null)
    try { const value = await api.snapshot(id); setSnapshot(value); setJob(value.latestJob); setSelectedRevisionId(value.project.currentRevisionId); setNavOpen(false) }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to open session") }
    finally { setLoading(false) }
  }

  const useSelectedVersion = async () => {
    if (!snapshot || !selectedRevisionId) return
    setBusy(true)
    try { await api.selectVersion(snapshot.project.id, selectedRevisionId, snapshot.project.currentRevisionId); await refreshProjects(snapshot.project.id); setCompareOpen(false) }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to restore version") }
    finally { setBusy(false) }
  }

  const exportCurrent = async () => {
    if (!snapshot?.project.currentRevisionId) return
    setBusy(true); setError(null)
    try { const result = await api.export(snapshot.project.currentRevisionId); setJob(await api.job(result.jobId)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to prepare export") }
    finally { setBusy(false) }
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
        <div className="topline"><span>Listening Room / {snapshot?.project.title ?? "Welcome"}</span><Button variant="outline" onClick={() => void exportCurrent()} disabled={!currentRevision || busy}><Headphones /> {providers.audiotool ? "Prepare in Audiotool" : "Prepare Nexus handoff"}</Button></div>

        {loading ? <div className="empty-surface" aria-live="polite"><AudioLines className="mx-auto mb-4 size-8" /><p>Opening your listening room…</p></div> : snapshot ? <>
          <header className="session-header"><div className="eyebrow"><span className="status-dot" /> {activeJob ? "Production in progress" : currentRevision ? "Ready to listen" : "New session"}</div><h1 className="session-title">{currentRevision?.title ?? snapshot.project.title}</h1><p className="session-deck">{currentRevision?.change_summary ?? "Start with a sound or an idea. The producer will shape a short instrumental and keep every accepted version safe."}</p><p className="provider-status">Producer: {providers.openai ? "OpenAI Deep Agent" : "deterministic fallback"} · Audio critique: {providers.gemini ? "Gemini available" : "Gemini unavailable; measured checks remain active"}</p></header>
          {currentRevision ? <>
            <div className="listening-grid"><div className="cover-art" role="img" aria-label="Abstract burnt-orange and forest-green session artwork"><span className="cover-grain" /><span className="cover-label">Sunroom palette</span></div><AudioPlayer audio={playback.audio} playing={playback.playing} currentTime={playback.currentTime} duration={playback.duration || displayedDuration} error={playback.error} peaks={currentRevision.waveform_peaks} versionLabel={versionLabel} onToggle={() => void playback.toggle()} onSeek={playback.seek} onVolume={playback.setVolume} /></div>
            <div className="section-strip" aria-label="Arrangement sections">{currentRevision.composition.sections.map((section, index) => <button key={section.id} className="section-button" aria-pressed={index === 1} onClick={() => playback.seek(section.startTick / currentRevision.composition.tempoBpm / 960 * 60)}><strong>{section.name}</strong><br /><small>{index === 0 ? "arrives softly" : index === 3 ? "settles" : index === 2 ? "opens up" : "main pulse"}</small></button>)}</div>
          </> : <div className="empty-surface"><AudioLines className="mx-auto mb-4 size-9 text-primary" /><h2>Start with a sound or an idea.</h2><p className="mx-auto max-w-xl text-muted-foreground">Add an owned WAV, record a small sound, or let the Sunroom palette begin from your written direction.</p><div className="empty-actions"><Button onClick={() => fileRef.current?.click()}><Upload /> Add sound</Button><Button variant="outline" onClick={() => void toggleRecording()}>{recording ? <X /> : <Mic />}{recording ? "Stop and use" : "Record a sound"}</Button><Button variant="ghost" onClick={() => void submitDirection()}><AudioLines /> Try the direction below</Button></div></div>}
           {jobMessage && job && (activeJob || job.state === "failed" || job.state === "cancelled") ? <div className="job-status" role={job.state === "failed" ? "alert" : "status"} aria-live="polite"><strong>{jobMessage}</strong><span className="provider-note">{activeJob ? "You can leave this page; the durable worker will keep going." : "Your accepted audio and earlier versions remain available."}</span>{activeJob ? <Button className="mt-3" variant="ghost" size="sm" onClick={() => void api.cancel(job.id)}>Cancel request</Button> : null}</div> : null}
           {error ? <div className="job-status" role="alert"><strong>Something needs attention</strong><span>{error}</span></div> : null}
           <div className="composer-shell"><form className="composer" onSubmit={(event) => { event.preventDefault(); void submitDirection() }}><label htmlFor="direction" className="sr-only">Direction for the producer</label><Textarea id="direction" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={currentRevision ? "What should change?" : "What should this become?"} disabled={Boolean(activeJob)} /><div className="composer-actions"><div className="chips">{currentRevision ? <><span className="chip"><ShieldCheck className="mr-1 size-3" /> Melody protected</span><span className="chip">Groove selected</span></> : <span className="chip">16 bars · Sunroom palette</span>}</div><Button className="round-play" size="icon" type="submit" aria-label={currentRevision ? "Request revision" : "Create instrumental"} disabled={busy || Boolean(activeJob) || draft.trim().length < 3}><ArrowUp /></Button></div></form></div>
           <div className="detail-grid">
            <section className="quiet-section"><div className="section-heading"><h2>Sources</h2><Button variant="ghost" size="sm" onClick={() => setSourcesOpen(true)}>{snapshot.assets.length ? "Manage" : "Add"}</Button></div><div className="source-list">{snapshot.assets.length ? snapshot.assets.map((asset) => <button className="source-pill" key={asset.id} onClick={() => auditionSource(asset.id)} aria-label={`Audition source ${asset.name}`}><MiniWave /> {asset.name}</button>) : <span className="provider-note">No source added. The owned palette can still create.</span>}</div></section>
            <section className="quiet-section"><div className="section-heading"><h2>Versions</h2><Button variant="ghost" size="sm" onClick={() => setCompareOpen(true)} disabled={snapshot.revisions.length < 1}><GitCompareArrows /> Compare</Button></div><p className="provider-note">{snapshot.revisions.length ? `${snapshot.revisions.length} immutable ${snapshot.revisions.length === 1 ? "version" : "versions"}. Melody protection is enforced by the server during revision.` : "Your first accepted version will appear here."}</p></section>
          </div>
        </> : <div className="empty-surface"><Library className="mx-auto mb-4 size-9 text-primary" /><h2>Your rooms begin here.</h2><p className="text-muted-foreground">Create a private local session, then add a sound or write the first direction.</p><div className="empty-actions"><Button onClick={() => void createSession()} disabled={busy}><Plus /> New session</Button></div>{error ? <p role="alert" className="mt-5 text-destructive">{error}</p> : null}</div>}
      </div></main>

      <input ref={fileRef} className="sr-only" type="file" accept="audio/wav,.wav" aria-label="Upload a WAV source" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadFile(file) }} />

      <Sheet open={navOpen} onOpenChange={setNavOpen}><SheetContent side="left" className="w-[88vw] bg-background"><SheetHeader><SheetTitle className="font-heading text-2xl">Pocket Producer</SheetTitle><SheetDescription>Your private listening rooms.</SheetDescription></SheetHeader><div className="p-4">{navContent}</div></SheetContent></Sheet>
      <Sheet open={sourcesOpen} onOpenChange={(open) => { setSourcesOpen(open); if (!open && selectedRevisionId) playback.load(`/api/v1/revisions/${selectedRevisionId}/audio`, false) }}><SheetContent side="right" className="w-[min(92vw,430px)] bg-background"><SheetHeader><SheetTitle className="font-heading text-2xl">Source tray</SheetTitle><SheetDescription>WAV audio stays in the project-local private store.</SheetDescription></SheetHeader><div className="grid gap-3 p-4"><Button onClick={() => fileRef.current?.click()} disabled={busy}><Upload /> Upload WAV</Button><Button variant="outline" onClick={() => void toggleRecording()}>{recording ? <X /> : <Mic />}{recording ? "Stop and use recording" : "Record a sound"}</Button>{snapshot?.assets.map((asset) => <button key={asset.id} className="source-pill justify-start" onClick={() => auditionSource(asset.id)}><MiniWave /><span className="truncate">{asset.name}</span></button>)}<p className="provider-note">Other formats are intentionally unavailable until FFmpeg is configured. Originals are preserved.</p></div></SheetContent></Sheet>
      <Dialog open={compareOpen} onOpenChange={setCompareOpen}><DialogContent className="max-w-xl bg-popover p-6"><DialogHeader><DialogTitle className="font-heading text-2xl">Compare versions</DialogTitle><DialogDescription>Choosing A or B only auditions it. “Use this version” explicitly changes the current head without deleting history.</DialogDescription></DialogHeader><RadioGroup value={selectedRevisionId ?? undefined} onValueChange={(value) => { setSelectedRevisionId(value); playback.load(`/api/v1/revisions/${value}/audio`) }} className="version-list" aria-label="Version to audition">{snapshot?.revisions.map((version) => <label className="version-option" key={version.id}><RadioGroupItem value={version.id} aria-label={`Version ${version.ordinal}`} /><span><span className="version-title"><span>Version {version.ordinal}</span>{version.id === snapshot.project.currentRevisionId ? <span className="chip"><Check className="mr-1 size-3" /> Current</span> : null}</span><p>{version.changeSummary}</p>{version.protectedTrackHashes.melody ? <p><ShieldCheck className="mr-1 inline size-3" /> Melody artifact protected</p> : null}</span></label>)}</RadioGroup><DialogFooter className="-mx-6 -mb-6"><Button variant="outline" onClick={() => setCompareOpen(false)}>Keep current</Button><Button onClick={() => void useSelectedVersion()} disabled={!selectedRevisionId || selectedRevisionId === snapshot?.project.currentRevisionId || busy}>Use this version</Button></DialogFooter></DialogContent></Dialog>
    </div>
  )
}
