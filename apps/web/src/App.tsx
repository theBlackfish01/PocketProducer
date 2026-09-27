import { useCallback, useEffect, useRef, useState } from "react"
import { AudioLines, FolderOpen, Menu, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Brand } from "@/components/brand"
import { ConnectedAccount } from "@/components/connected-account"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { NativeRoom } from "@/features/native/native-room"
import { api, type AppStatus, type Project, type SessionSnapshot } from "@/lib/api"
import { beginAudiotoolConnection, finishAudiotoolCallback } from "@/lib/audiotool"
import { navigateSession, sessionFromPath } from "@/lib/session-route"

const returnSessionKey = "pocket-producer:audiotool-return"

export default function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null)
  const [nexus, setNexus] = useState<AppStatus["nexus"] | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [navOpen, setNavOpen] = useState(false)
  const activeProjectRef = useRef<string | null>(null)
  const requestRef = useRef(0)
  const mountedRef = useRef(false)

  const chooseProject = useCallback(async (id: string, fromHistory = false) => {
    const requestId = ++requestRef.current
    activeProjectRef.current = id
    if (!fromHistory) navigateSession(id)
    setSnapshot(null); setLoading(true); setError(null); setNavOpen(false)
    try {
      const value = await api.snapshot(id)
      if (mountedRef.current && requestId === requestRef.current) setSnapshot(value)
    } catch (cause) {
      if (mountedRef.current && requestId === requestRef.current) setError(cause instanceof Error ? cause.message : "Unable to open session")
    } finally {
      if (mountedRef.current && requestId === requestRef.current) setLoading(false)
    }
  }, [])

  const refreshLabels = useCallback(async () => {
    const result = await api.listProjects()
    if (!mountedRef.current) return
    setProjects(result.projects)
    const updated = result.projects.find((project) => project.id === activeProjectRef.current)
    if (updated) setSnapshot((prior) => prior?.project.id === updated.id ? { ...prior, project: updated } : prior)
  }, [])

  const refreshSources = useCallback(async (id: string) => {
    const requestId = requestRef.current
    const value = await api.snapshot(id)
    if (mountedRef.current && activeProjectRef.current === id && requestId === requestRef.current) {
      setSnapshot((prior) => prior?.project.id === id ? { ...prior, assets: value.assets } : prior)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    let disposed = false
    void Promise.all([api.status(), api.listProjects()]).then(async ([status, list]) => {
      if (disposed) return
      setNexus(status.nexus); setProjects(list.projects)
      let path = window.location.pathname
      if (status.nexus.oauth && path === new URL(status.nexus.oauth.redirectUrl).pathname) {
        const saved = sessionStorage.getItem(returnSessionKey)
        const returnPath = saved && sessionFromPath(saved) ? saved : "/"
        try {
          await finishAudiotoolCallback(status.nexus.oauth)
          const refreshed = await api.status()
          if (!disposed) setNexus(refreshed.nexus)
        } catch (cause) {
          if (!disposed) setError(cause instanceof Error ? cause.message : "Audiotool connection failed")
        } finally {
          sessionStorage.removeItem(returnSessionKey)
          window.history.replaceState({}, "", returnPath)
          path = returnPath
        }
      }
      if (disposed) return
      const route = sessionFromPath(path)
      if (path !== "/" && !route) { setLoading(false); setError("This page is no longer available. Choose a session or start a new one."); return }
      const id = route?.id
      if (id) {
        activeProjectRef.current = id
        const requestId = ++requestRef.current
        const value = await api.snapshot(id)
        if (!disposed && requestId === requestRef.current) setSnapshot(value)
      }
      if (!disposed) setLoading(false)
    }).catch((cause: unknown) => {
      if (!disposed) { setError(cause instanceof Error ? cause.message : "Unable to connect to Pocket Producer"); setLoading(false) }
    })
    const timer = window.setInterval(() => { void refreshLabels().catch(() => undefined) }, 8_000)
    return () => { disposed = true; mountedRef.current = false; ++requestRef.current; window.clearInterval(timer) }
  }, [refreshLabels])

  useEffect(() => {
    const change = () => {
      const route = sessionFromPath(window.location.pathname)
      if (route) void chooseProject(route.id, true)
      else {
        ++requestRef.current; activeProjectRef.current = null; setSnapshot(null); setLoading(false); setNavOpen(false)
        setError(window.location.pathname === "/" ? null : "This page is no longer available. Choose a session or start a new one.")
      }
    }
    window.addEventListener("popstate", change)
    return () => window.removeEventListener("popstate", change)
  }, [chooseProject])

  const createSession = async () => {
    setBusy(true); setError(null)
    try {
      const { project } = await api.createProject("Untitled listening room")
      if (!mountedRef.current) return
      await refreshLabels()
      navigateSession(project.id, "start")
      await chooseProject(project.id, true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to create session") }
    finally { if (mountedRef.current) setBusy(false) }
  }

  const connectAudiotool = async () => {
    if (!nexus?.oauth) return
    const id = activeProjectRef.current
    sessionStorage.setItem(returnSessionKey, id ? `/sessions/${id}` : "/")
    setError(null)
    try {
      const result = await beginAudiotoolConnection(nexus.oauth)
      if (result === "connected") {
        sessionStorage.removeItem(returnSessionKey)
        const status = await api.status()
        if (mountedRef.current) setNexus(status.nexus)
      }
    } catch (cause) {
      if (mountedRef.current && activeProjectRef.current === id) setError(cause instanceof Error ? cause.message : "Audiotool connection failed")
    }
  }

  const account = <ConnectedAccount connected={Boolean(nexus?.session.connected)} userName={nexus?.session.userName ?? null} onConnect={() => void connectAudiotool()} onDisconnect={() => { void api.disconnectAudiotool().then(() => api.status()).then((status) => setNexus(status.nexus)).catch(() => setError("Unable to disconnect Audiotool.")) }} />

  const navigation = <>
    <Button className="w-full justify-start rail-new" onClick={() => void createSession()} disabled={busy}><Plus /> New session</Button>
    <div className="rail-heading"><FolderOpen className="size-4" /> Sessions</div>
    <p className="rail-caption">Recent</p>
    <div className="rail-list" aria-label="Recent sessions">{projects.map((project) => <button key={project.id} className="rail-session" data-project-id={project.id} aria-current={project.id === snapshot?.project.id ? "page" : undefined} title={project.title} onClick={() => void chooseProject(project.id)}><span>{project.title}</span>{project.workspaceStatus && project.workspaceStatus !== "new" ? <small>{project.workspaceStatus === "working" ? "Working" : project.workspaceStatus === "attention" ? "Paused" : "Ready"}</small> : null}</button>)}</div>
  </>

  return <div className="app-shell">
    <aside className="session-rail" aria-label="Session navigation"><Brand />{navigation}{account}</aside>
    <main className="main-area"><div className="main-inner">
      <div className="mobile-topbar"><Brand /><Button variant="ghost" size="icon" aria-label="Open sessions" onClick={() => setNavOpen(true)}><Menu /></Button></div>
      <div className="topline"><span>Listening Room <span aria-hidden="true">/</span> <strong>{snapshot?.project.title ?? "Welcome"}</strong></span></div>
      {error ? <div className="job-status" role="alert"><strong>Something needs attention</strong><p>{error}</p><Button variant="ghost" onClick={() => setError(null)}>Dismiss</Button></div> : null}
      {loading ? <div className="empty-surface" aria-live="polite"><AudioLines className="mx-auto mb-4 size-8" /><p>Opening your listening room…</p></div> : snapshot && nexus ? <NativeRoom key={snapshot.project.id} projectId={snapshot.project.id} assets={snapshot.assets} audiotoolConnected={nexus.session.connected} audiotoolAvailable={Boolean(nexus.oauth)} onConnectAudiotool={() => void connectAudiotool()} onSourcesChanged={() => refreshSources(snapshot.project.id)} onProjectUpdated={() => { void refreshLabels().catch(() => undefined) }} /> : !error ? <div className="empty-surface"><h1>Your next piece starts here</h1><p>A mood, a moment or a detailed vision. What would you like to make?</p><Button onClick={() => void createSession()} disabled={busy}><Plus /> New session</Button></div> : null}
    </div></main>
    <Sheet open={navOpen} onOpenChange={setNavOpen}><SheetContent side="left" className="w-[88vw] bg-background"><SheetHeader><SheetTitle><Brand /></SheetTitle><SheetDescription>Your sessions</SheetDescription></SheetHeader><div className="mobile-session-list p-4">{navigation}{account}</div></SheetContent></Sheet>
  </div>
}
