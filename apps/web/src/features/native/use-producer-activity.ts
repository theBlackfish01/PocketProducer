import { useCallback, useEffect, useRef, useState } from "react"
import { api, type Activity, type WorkspaceActivity } from "../../lib/api"

export function mergeActivity(previous: Activity[], incoming: Activity[]): Activity[] {
  return [...new Map([...previous, ...incoming].map((event) => [event.cursor, event])).values()].sort((a, b) => a.cursor - b.cursor).slice(-80)
}

export function useProducerActivity(projectId: string) {
  const [state, setState] = useState<WorkspaceActivity | null>(null)
  const [events, setEvents] = useState<Activity[]>([])
  const [connection, setConnection] = useState<"connecting" | "live" | "polling" | "offline">("connecting")
  const [older, setOlder] = useState<Activity[] | null>(null)
  const [historyBusy, setHistoryBusy] = useState(false)
  const activeProject = useRef(projectId)
  activeProject.current = projectId
  useEffect(() => {
    let active = true
    let cursor = 0
    let source: EventSource | null = null
    let timer: number | undefined
    let failures = 0
    let signature = ""
    const controller = new AbortController()
    setState(null); setEvents([]); setOlder(null); setConnection("connecting")
    const accept = (page: WorkspaceActivity) => {
      if (!active || (!page.reset && page.nextCursor < cursor)) return
      cursor = page.nextCursor
      if (page.reset) { setEvents(page.events); setOlder(null) }
      else if (page.events.length) setEvents((prior) => mergeActivity(prior, page.events))
      const next = JSON.stringify({ ...page, events: [], hasOlder: false })
      if (next !== signature) { signature = next; setState(page) }
    }
    const poll = async () => {
      try { accept(await api.activity(projectId, `?after=${cursor}`, controller.signal)); if (!active) return; failures = 0; setConnection("polling") }
      catch { if (active) { failures++; setConnection("offline") } }
      if (active) timer = window.setTimeout(() => void poll(), Math.min(15_000, 2_000 * (failures + 1)))
    }
    const start = async () => {
      try {
        accept(await api.activity(projectId, "", controller.signal))
        if (!active) return
        source = new EventSource(`/api/v1/projects/${projectId}/activity/stream?after=${cursor}`)
        source.addEventListener("workspace", (event) => {
          try { accept(JSON.parse((event as MessageEvent<string>).data) as WorkspaceActivity); if (active) setConnection("live") }
          catch { source?.close(); if (timer === undefined && active) timer = window.setTimeout(() => void poll(), 1_000) }
        })
        source.onerror = () => { source?.close(); if (active) { setConnection("polling"); if (timer === undefined) timer = window.setTimeout(() => void poll(), 1_000) } }
      } catch { if (active) { setConnection("offline"); timer = window.setTimeout(() => void poll(), 2_000) } }
    }
    void start()
    return () => { active = false; controller.abort(); source?.close(); window.clearTimeout(timer) }
  }, [projectId])
  const loadOlder = useCallback(async () => {
    if (historyBusy) return
    setHistoryBusy(true)
    try { const page = await api.activity(projectId, `?before=${older?.[0]?.cursor ?? events.slice(-30)[0]?.cursor ?? 1}&limit=30`); if (activeProject.current === projectId) setOlder(page.events) }
    finally { if (activeProject.current === projectId) setHistoryBusy(false) }
  }, [projectId, events, older, historyBusy])
  return { state, events, connection, older, loadOlder, historyBusy, closeOlder: () => setOlder(null) }
}
