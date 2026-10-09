import { memo, useEffect, useId, useRef, useState, type FocusEvent, type PointerEvent } from "react"
import { ArrowDown, Check, LocateFixed, MessageCircle, Sparkles } from "lucide-react"
import type { Activity } from "../../lib/api"
import { Button } from "../../components/ui/button"
import type { ScoreTargets } from "./activity-targets"

function MessageText({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const id = useId()
  return <><p id={id} className={!expanded && text.length > 280 ? "message-preview" : undefined}>{text}</p>{text.length > 280 ? <Button type="button" size="xs" variant="link" className="message-expand" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded((value) => !value)}>{expanded ? "Show less" : "Read more"}</Button> : null}</>
}

interface Pointing { resolve?(event: Activity): ScoreTargets | null; onPreview?(targets: ScoreTargets | null): void; onReveal?(targets: ScoreTargets): void; moved?(event: PointerEvent<HTMLElement>): boolean }

function ActivityRow({ event, onCompare, pointing }: { event: Activity; onCompare(id: string): void; pointing: Pointing }) {
  const value = event.payload
  if (value.kind === "allowance") return null
  // Points at stored parts/sections only; it does not replay or certify a change.
  const targets = pointing.resolve?.(event) ?? null
  // Only a moved pointer previews; content arriving under a resting pointer does not.
  const preview = targets ? { onPointerMove: (event: PointerEvent<HTMLElement>) => { if (event.pointerType === "mouse" && pointing.moved?.(event)) pointing.onPreview?.(targets) }, onMouseLeave: () => pointing.onPreview?.(null), onFocus: () => pointing.onPreview?.(targets), onBlur: (event: FocusEvent<HTMLElement>) => { if (!event.currentTarget.contains(event.relatedTarget)) pointing.onPreview?.(null) } } : {}
  return <article className={`producer-message producer-message-${value.kind}${targets ? " has-targets" : ""}`} {...preview}>
    <div className="producer-message-label">{value.kind === "request" ? <MessageCircle size={14} /> : value.kind === "saved" ? <Check size={14} /> : <Sparkles size={14} />}<span>{value.kind === "request" ? "You" : value.kind === "approach" ? "The approach" : value.kind === "selected" ? "Version choice" : "Producer"}{value.historical ? " · earlier request" : ""}</span><time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div>
    <MessageText text={value.text} />
    {value.kind === "request" && value.scope && value.scope !== "Whole piece" ? <p className="producer-request-scope">{value.scope}</p> : null}
    {targets || (value.kind === "saved" && value.baseRevisionId && value.revisionId) ? <div className="producer-message-actions">
      {targets ? <Button size="sm" variant="ghost" className="producer-locate" onClick={() => pointing.onReveal?.(targets)}><LocateFixed size={14} aria-hidden="true" />Show in score</Button> : null}
      {value.kind === "saved" && value.baseRevisionId && value.revisionId ? <Button size="sm" variant="outline" onClick={() => onCompare(value.revisionId!)}>Review this change</Button> : null}
    </div> : null}
  </article>
}

export const ProducerFeed = memo(function ProducerFeed({ events, connection, older, onOlder, onLatest, historyBusy, onCompare, resolveTargets, onPreview, onReveal }: { events: Activity[]; connection: string; older: Activity[] | null; onOlder(): void; onLatest(): void; historyBusy: boolean; onCompare(id: string): void } & { resolveTargets?: Pointing["resolve"]; onPreview?: Pointing["onPreview"]; onReveal?: Pointing["onReveal"] }) {
  // A window listener runs after React's root handler, so rows compare with the previous position.
  const lastPointer = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const record = (event: globalThis.PointerEvent) => { lastPointer.current = { x: event.clientX, y: event.clientY } }
    window.addEventListener("pointermove", record, { passive: true })
    return () => window.removeEventListener("pointermove", record)
  }, [])
  const pointing = { resolve: resolveTargets, onPreview, onReveal, moved: (event: PointerEvent<HTMLElement>) => Boolean(lastPointer.current && (lastPointer.current.x !== event.clientX || lastPointer.current.y !== event.clientY)) }
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
      {displayed.map((event) => <ActivityRow key={event.cursor} event={event} onCompare={onCompare} pointing={pointing} />)}
      {!displayed.length ? <p className="producer-empty">Your directions and confirmed musical changes will appear here.</p> : null}
      {unseen && !older ? <div className="producer-new-updates"><Button variant="outline" size="sm" onClick={() => { follow.current = true; scroll.current?.scrollTo({ top: scroll.current.scrollHeight }); setUnseen(false) }}><ArrowDown size={14} /> New updates</Button></div> : null}
    </div>
  </div>
})
