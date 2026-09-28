import { useEffect, useState, type SyntheticEvent } from "react"
import App from "../App"
import { Brand } from "./brand"
import { Button } from "./ui/button"

interface Session { mode: "development" | "invite" | "audiotool"; user: { ownerId: string; displayName: string } | null }
async function readSession(signal?: AbortSignal): Promise<Session> {
  const response = await fetch("/api/v1/auth/session", { cache: "no-store", ...(signal ? { signal } : {}) })
  if (!response.ok) throw new Error("Unable to connect. Please try again.")
  const session = await response.json() as Session
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError")
  if (session.mode !== "development" && session.user) {
    // Browser caches, including SDK OAuth tokens, cannot cross account changes.
    if (localStorage.getItem("pocket-hosted-owner") !== session.user.ownerId) { localStorage.clear(); sessionStorage.clear() }
    localStorage.setItem("pocket-hosted-owner", session.user.ownerId)
  }
  return session
}
export function AuthBoundary() {
  const [session, setSession] = useState<Session | null>(null)
  const [code, setCode] = useState("")
  const [error, setError] = useState<string | null>(() => new URLSearchParams(window.location.search).get("signin") === "failed" ? "We couldn’t sign you in with Audiotool. Please try again." : null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void readSession(controller.signal).then(setSession).catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to connect") })
    const expired = () => { void readSession().then(setSession).catch(() => setSession(null)); setError("Sign in again to continue.") }
    window.addEventListener("pocket:auth-expired", expired)
    const switched = (event: StorageEvent) => { if (event.key === "pocket-hosted-owner" || event.key === null) window.location.assign("/") }
    window.addEventListener("storage", switched)
    return () => { controller.abort(); window.removeEventListener("pocket:auth-expired", expired); window.removeEventListener("storage", switched) }
  }, [])
  async function signIn(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null)
    try {
      const response = await fetch("/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) })
      if (!response.ok) { const body = await response.json() as { message?: string }; throw new Error(body.message ?? "Unable to sign in") }
      setCode(""); setSession(await readSession())
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to sign in") }
    finally { setBusy(false) }
  }
  async function signOut() {
    try {
      const response = await fetch("/api/v1/auth/logout", { method: "POST" })
      if (!response.ok) throw new Error("Unable to sign out. Please try again.")
      localStorage.clear(); sessionStorage.clear(); window.location.assign("/")
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to sign out") }
  }
  async function audiotoolSignIn() {
    setBusy(true); setError(null)
    try {
      const response = await fetch("/api/v1/auth/audiotool/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ returnPath: window.location.pathname }) })
      const body = await response.json() as { url?: string; message?: string }
      if (!response.ok || !body.url) throw new Error(body.message ?? "Unable to sign in. Please try again.")
      window.location.assign(body.url)
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to sign in"); setBusy(false) }
  }
  if (session?.user) return <>{error ? <div role="alert" className="auth-notice">{error}</div> : null}<App key={session.user.ownerId} {...(session.mode !== "development" ? { onSignOut: () => void signOut(), listenerName: session.user.displayName, hostedAudiotool: session.mode === "audiotool" } : {})} /></>
  const publicEntry = session?.mode === "audiotool"
  return <main className="auth-page"><Brand /><section className="auth-card" aria-labelledby="sign-in-title"><p className="eyebrow">Your listening room</p><h1 id="sign-in-title">Make something yours.</h1><p>{publicEntry ? "Turn an idea into music you can keep shaping in Audiotool." : "Enter your personal access code to start creating."}</p>{error ? <p role="alert">{error}</p> : null}{publicEntry ? <Button disabled={busy} onClick={() => void audiotoolSignIn()}>{busy ? "Opening Audiotool…" : "Sign in with Audiotool"}</Button> : session ? <form onSubmit={(event) => void signIn(event)}><label htmlFor="access-code">Access code</label><input id="access-code" type="password" autoComplete="current-password" autoCapitalize="none" spellCheck={false} value={code} onChange={(event) => setCode(event.target.value)} required maxLength={128} /><Button type="submit" disabled={busy || !code.trim()}>{busy ? "Signing in…" : "Enter listening room"}</Button></form> : error ? <Button onClick={() => window.location.reload()}>Try again</Button> : <p role="status">Connecting…</p>}<p className="auth-hint">{publicEntry ? "Your sessions stay private. Copy to Audiotool when you’re ready." : session ? "Access is by invitation for this preview." : ""}</p></section></main>
}
