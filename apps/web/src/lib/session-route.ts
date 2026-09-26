export function sessionFromPath(path: string): { id: string; view: "start" | "arrange" | "audio" } | null {
  const match = /^\/sessions\/([a-zA-Z0-9-]+)(?:\/(start|audio))?\/?$/.exec(path)
  return match ? { id: match[1], view: match[2] === "audio" ? "audio" : match[2] === "start" ? "start" : "arrange" } : null
}
export function navigateSession(id: string, view: "start" | "arrange" | "audio" = "arrange", replace = false) {
  const path = `/sessions/${encodeURIComponent(id)}${view === "arrange" ? "" : `/${view}`}`
  if (window.location.pathname === path) return
  window.history[replace ? "replaceState" : "pushState"]({}, "", path)
}
