import { useEffect, useId, useState } from "react"
import { MapPin, X } from "lucide-react"
import type { NativeDocument } from "../../lib/api"
import { Button } from "../../components/ui/button"
import { Textarea } from "../../components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog"
import { maxPinNote, pinBars, pinState, type ScorePin } from "./score-pins"

export interface PinDraft { partId: string; partName: string; startBar: number; endBar: number; bars: number }

/** Captures one local note. Saving it changes nothing on the server. */
export function PinDialog({ draft, onSave, onClose, returnFocus }: { draft: PinDraft | null; onSave(value: { startBar: number; endBar: number; note: string }): void; onClose(): void; returnFocus(): HTMLElement | null }) {
  const [from, setFrom] = useState(1), [to, setTo] = useState(1), [note, setNote] = useState("")
  const id = useId()
  useEffect(() => { if (draft) { setFrom(draft.startBar + 1); setTo(draft.endBar); setNote("") } }, [draft])
  const valid = Boolean(draft && note.trim() && from >= 1 && to >= from && to <= draft.bars)
  return <Dialog open={Boolean(draft)} onOpenChange={(open) => { if (!open) onClose() }}>
    <DialogContent className="pin-dialog" finalFocus={() => returnFocus() ?? true}>
      <DialogHeader><DialogTitle className="font-heading text-2xl">Pin a note</DialogTitle><DialogDescription>{draft?.partName} · {draft ? pinBars({ startBar: from - 1, endBar: to }) : ""}. Notes stay on this device until you add them to a direction.</DialogDescription></DialogHeader>
      <form id={id} className="pin-form" onSubmit={(event) => { event.preventDefault(); if (valid) onSave({ startBar: from - 1, endBar: to, note: note.trim() }) }}>
        <div className="pin-range">
          <label>From bar<input type="number" inputMode="numeric" min={1} max={draft?.bars ?? 1} value={from} onChange={(event) => { const value = Number(event.target.value); setFrom(value); if (value > to) setTo(value) }} /></label>
          <label>To bar<input type="number" inputMode="numeric" min={from} max={draft?.bars ?? 1} value={to} onChange={(event) => setTo(Number(event.target.value))} /></label>
        </div>
        <label htmlFor={`${id}-note`}>What should change here?</label>
        <Textarea id={`${id}-note`} autoFocus required maxLength={maxPinNote} value={note} onChange={(event) => setNote(event.target.value)} placeholder="For example: too busy, leave more space" />
      </form>
      <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form={id} disabled={!valid}>Pin note</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}

export function PinTray({ pins, document, protectedPartIds, currentId, onRemove, onClear, onUse }: { pins: ScorePin[]; document: NativeDocument; protectedPartIds: string[]; currentId: string | null; onRemove(id: string): void; onClear(): void; onUse(): void }) {
  const usable = pins.filter((pin) => pinState(pin, document, protectedPartIds) === "ready").length
  return <section className="pin-tray" aria-labelledby="pin-tray-heading">
    <div className="pin-tray-heading"><h3 id="pin-tray-heading"><MapPin size={14} aria-hidden="true" /> Pinned notes · {pins.length}</h3><Button variant="ghost" size="xs" onClick={onClear}>Clear all</Button></div>
    <ul>{pins.map((pin) => {
      const state = pinState(pin, document, protectedPartIds)
      const name = document.parts.find((part) => part.id === pin.partId)?.name ?? pin.partName
      return <li key={pin.id} className={`pin-item is-${state}`}>
        <span><strong>{name} · {pinBars(pin)}</strong>{pin.revisionId && pin.revisionId !== currentId && pin.ordinal ? <small>Pinned on Version {pin.ordinal}</small> : null}{state === "kept" ? <small>Kept unchanged. Allow changes to use this note.</small> : state === "missing" ? <small>Not in this version.</small> : null}<span className="pin-note">{pin.note}</span></span>
        <Button variant="ghost" size="icon-sm" aria-label={`Remove note on ${name}, ${pinBars(pin)}`} onClick={() => onRemove(pin.id)}><X /></Button>
      </li>
    })}</ul>
    <Button variant="outline" size="sm" disabled={!usable} onClick={onUse}>Add {usable === pins.length ? "" : `${usable} `}{usable === 1 ? "note" : "notes"} to direction</Button>
    <p className="section-footnote">Added notes become editable text and set the change scope when they share a section or part. Nothing is sent until you make the change.</p>
  </section>
}
