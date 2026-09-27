import { memo, useEffect, useId, useRef, useState } from "react"
import { ArrowDown, Check, MessageCircle, Sparkles } from "lucide-react"
import type { Activity } from "../../lib/api"
import { Button } from "../../components/ui/button"

function MessageText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const id = useId()
  return <><p id={id} className={!expanded && text.length > 280 ? "message-preview" : undefined}>{text}</p>{text.length > 280 ? <Button type="button" size="sm" variant="ghost" className="message-expand" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded((value) => !value)}>{expanded ? "Show less" : "Read more"}</Button> : null}</>
}

function ActivityRow({ event, onCompare }: { event: Activity; onCompare(id: string): void }) {
  const value = event.payload
  if (value.kind === "allowance") return null
  return <article className={`producer-message producer-message-${value.kind}`}>
    <div className="producer-message-label">{value.kind === "request" ? <MessageCircle size={14} /> : value.kind === "saved" ? <Check size={14} /> : <Sparkles size={14} />}<span>{value.kind === "request" ? "You" : value.kind === "approach" ? "The approach" : value.kind === "selected" ? "Version choice" : "Producer"}{value.historical ? " · earlier request" : ""}</span><time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div>
    <MessageText text={value.text} />
    {value.kind === "request" && value.scope && value.scope !== "Whole piece" ? <p className="producer-request-scope">{value.scope}</p> : null}
    {value.kind === "saved" && value.baseRevisionId && value.revisionId ? <Button size="sm" variant="outline" onClick={() => onCompare(value.revisionId!)}>Review this change</Button> : null}
  </article>
}

export const ProducerFeed = memo(function ProducerFeed({ events, connection, older, onOlder, onLatest, historyBusy, onCompare }: { events: Activity[]; connection: string; older: Activity[] | null; onOlder(): void; onLatest(): void; historyBusy: boolean; onCompare(id: string): void }) {
  const scroll = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const [unseen, setUnseen] = useState(false)
  const latest = events.at(-1)?.cursor
  useEffect(() => {
    if (follow.current && !older) { scroll.current?.scrollTo({ top: scroll.current.scrollHeight }); setUnseen(false) }
    else setUnseen(true)
  }, [latest, older])
  const displayed = older ?? events.slice(-30)
  return <div className="producer-feed-wrap">
    {["offline", "connecting", "polling"].includes(connection) ? <div className="producer-connection" role="status">{connection === "offline" ? "Reconnecting · showing your last saved updates" : connection === "connecting" ? "Opening saved conversation…" : "Reconnecting to live updates…"}</div> : null}
    <div className="producer-feed" ref={scroll} onScroll={() => { const el = scroll.current; if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64 }} aria-label="Producer conversation" tabIndex={0}>
      {(displayed[0]?.cursor ?? 1) > 1 ? <Button size="sm" variant="ghost" disabled={historyBusy} onClick={onOlder}>Earlier activity</Button> : null}
      {older ? <Button size="sm" variant="outline" onClick={onLatest}>Return to latest</Button> : null}
      {displayed.map((event) => <ActivityRow key={event.cursor} event={event} onCompare={onCompare} />)}
      {!displayed.length ? <p className="producer-empty">Your directions and confirmed musical changes will appear here.</p> : null}
    </div>
    {unseen && !older ? <Button variant="outline" size="sm" className="producer-new-updates" onClick={() => { follow.current = true; scroll.current?.scrollTo({ top: scroll.current.scrollHeight }); setUnseen(false) }}><ArrowDown size={14} /> New updates</Button> : null}
  </div>
})
