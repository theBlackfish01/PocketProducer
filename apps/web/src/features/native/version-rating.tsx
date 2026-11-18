import { useEffect, useState } from "react"
import { ThumbsDown, ThumbsUp } from "lucide-react"
import { Button } from "../../components/ui/button"
import { request } from "../../lib/api"

type Vote = "up" | "down"
interface Rating { vote: Vote; reason: string | null; comment: string }
interface Answer { rating: Rating | null }
export function VersionRating({ projectId, revisionId, ordinal }: { projectId: string; revisionId: string; ordinal: number }) {
  const path = `/projects/${projectId}/native/versions/${revisionId}/rating`
  const [saved,setSaved] = useState<Rating | null>(null)
  const [reason,setReason] = useState("")
  const [comment,setComment] = useState("")
  const [editing,setEditing] = useState(false)
  const [state,setState] = useState<"loading"|"ready"|"saving"|"unavailable">("loading")
  const [message,setMessage] = useState("")
  const [retry,setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setState("loading")
    void request<Answer>(path,{signal:controller.signal}).then(({rating}) => {
      if (controller.signal.aborted) return
      setSaved(rating); setReason(rating?.reason ?? ""); setComment(rating?.comment ?? ""); setState("ready")
    }).catch(() => { if (!controller.signal.aborted) setState("unavailable") })
    return () => controller.abort()
  }, [path,retry])
  async function save(vote: Vote | null) {
    if (state !== "ready") return
    setState("saving"); setMessage("")
    try {
      const { rating } = await request<Answer>(path,{method:"PUT",body:JSON.stringify({vote,reason:vote && reason ? reason : null,comment:vote ? comment : ""})})
      setSaved(rating); setReason(rating?.reason ?? ""); setComment(rating?.comment ?? ""); setEditing(false)
      setMessage(rating ? "Rating saved." : "Rating removed.")
    } catch { setMessage("Couldn’t save your rating. Try again.") }
    finally { setState("ready") }
  }
  return <section className="version-rating" aria-label={`Rate version ${ordinal}`}>
    <div className="rating-line"><span>Rate version {ordinal}</span>
      {(["up","down"] as const).map(vote => {
        const Icon = vote === "up" ? ThumbsUp : ThumbsDown
        return <Button key={vote} variant="ghost" size="icon-sm" aria-label={vote === "up" ? "Thumbs up" : "Thumbs down"} aria-pressed={saved?.vote === vote} disabled={state !== "ready"} onClick={() => void save(saved?.vote === vote ? null : vote)}><Icon /></Button>
      })}
      {saved ? <Button variant="link" size="sm" disabled={state !== "ready"} aria-expanded={editing} onClick={() => setEditing(!editing)}>{saved.comment || saved.reason ? "Edit details" : "Add details"}</Button> : null}
      {state === "unavailable" ? <Button variant="link" size="sm" onClick={() => setRetry(n => n+1)}>Retry rating</Button> : null}
    </div>
    {editing && saved ? <form onSubmit={event => {event.preventDefault();void save(saved.vote)}}>
      <label>What stood out?<select value={reason} onChange={event => setReason(event.target.value)}><option value="">Choose a reason (optional)</option>{["Direction","Arrangement","Sound choices","Other"].map(item => <option key={item}>{item}</option>)}</select></label>
      <label>Comment (optional)<textarea rows={2} maxLength={600} value={comment} onChange={event => setComment(event.target.value)} /></label>
      <Button variant="outline" size="sm" disabled={state !== "ready"} type="submit">Save details</Button>
    </form> : null}
    <span role="status" className={message.includes("Couldn’t") ? "" : "sr-only"}>{message}</span>
  </section>
}
