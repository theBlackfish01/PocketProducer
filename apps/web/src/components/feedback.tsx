import { useId, useRef, useState } from "react"
import { MessageSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/api"

export function Feedback({ compact = false }: { compact?: boolean }) {
  const fieldId = useId()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submission = useRef<{ id: string; message: string } | null>(null)
  const pending = useRef(false)
  async function send() {
    const text = message.trim()
    if (pending.current || !text) return
    pending.current = true; setBusy(true); setError(null)
    if (submission.current?.message !== text) submission.current = { id: crypto.randomUUID(), message: text }
    try {
      await api.submitFeedback(submission.current)
      setSaved(true); setMessage(""); submission.current = null
    } catch { setError("Feedback could not be saved. Your message is still here—please try again.") }
    finally { pending.current = false; setBusy(false) }
  }
  return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) setSaved(false) }}>
    <DialogTrigger render={<Button variant="ghost" size={compact ? "icon" : "sm"} className="feedback-trigger" aria-label="Send feedback" />}><MessageSquare size={16} aria-hidden="true" />{!compact && <span>Feedback</span>}</DialogTrigger>
    <DialogContent className="feedback-dialog">
      <DialogTitle>Share your feedback</DialogTitle>
      <DialogDescription>What worked well, or could feel better? Saved with your username when available.</DialogDescription>
      {saved ? <p role="status">Thanks—your feedback was saved.</p> : <form onSubmit={(event) => { event.preventDefault(); void send() }} className="feedback-form">
        <label htmlFor={fieldId}>Your feedback</label>
        <Textarea id={fieldId} value={message} onChange={(event) => setMessage(event.target.value)} maxLength={4000} rows={5} required disabled={busy} />
        {error && <p role="alert">{error}</p>}
        <Button type="submit" disabled={busy || !message.trim()}>{busy ? "Sending…" : "Send feedback"}</Button>
      </form>}
    </DialogContent>
  </Dialog>
}
