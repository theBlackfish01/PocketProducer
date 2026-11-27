import { useEffect, useRef, useState } from "react"
import { ArrowUpRight, Check, ChevronDown, Disc3, Pause, Play, X } from "lucide-react"
import { arrangementTemplates, type ArrangementTemplate, type ArrangementTemplateId } from "@pocket/core/templates"
import { Button } from "../../components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "../../components/ui/dialog"
import "./template-picker.css"

const clock = (seconds: number) => String(Math.floor(seconds / 60)) + ":" + String(Math.floor(seconds % 60)).padStart(2, "0")

function TemplateList({ selected, choose }: { selected?: ArrangementTemplateId | undefined; choose(id: ArrangementTemplateId): void }) {
  const audio = useRef<HTMLAudioElement>(null)
  const request = useRef(0)
  const [active, setActive] = useState<ArrangementTemplateId | null>(null)
  const [playing, setPlaying] = useState(false)
  const [failed, setFailed] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    const player = audio.current
    return () => {
      request.current++
      if (player?.hasAttribute("src")) { player.pause(); player.removeAttribute("src"); player.load() }
    }
  }, [])

  function toggle(id: ArrangementTemplateId) {
    const player = audio.current
    if (!player) return
    const attempt = ++request.current
    if (active === id && !player.paused) { player.pause(); return }
    if (active !== id || player.error) {
      player.pause()
      setElapsed(0); setDuration(0); setPlaying(false)
      player.src = "/templates/" + id + ".mp3"
      setActive(id)
    }
    if (player.ended) player.currentTime = 0
    setFailed(false)
    void player.play().catch(() => { if (request.current === attempt) { setFailed(true); setPlaying(false) } })
  }

  return <>
    <audio ref={audio} preload="none" onPlaying={() => setPlaying(true)} onPause={() => setPlaying(false)}
      onTimeUpdate={event => setElapsed(event.currentTarget.currentTime)}
      onDurationChange={event => { const value = event.currentTarget.duration; setDuration(Number.isFinite(value) ? value : 0) }}
      onEnded={() => setPlaying(false)} onError={event => { if (event.currentTarget.error) { setFailed(true); setPlaying(false) } }} />
    <ul className="template-list" aria-label="Available templates">
      {arrangementTemplates.map(template => {
        const previewing = active === template.id
        const isPlaying = previewing && playing
        const chosen = selected === template.id
        return <li key={template.id} className="template-track" aria-current={chosen ? "true" : undefined} data-previewing={previewing} data-chosen={chosen}>
          <button type="button" className="template-sleeve" data-cover={template.id}
            aria-label={(isPlaying ? "Pause " : "Play ") + template.title} onClick={() => toggle(template.id)}>
            <span className="template-play-symbol">{isPlaying ? <Pause /> : <Play />}</span>
          </button>
          <div className="template-track-copy">
            <p className="template-style">{template.style} <span>· {template.bpm} BPM · {template.beats}/4</span></p>
            <h3>{template.title}</h3>
            <p className="template-description">{template.description}</p>
          </div>
          <Button type="button" variant="outline" size="sm" className="template-use" aria-label={"Use " + template.title} onClick={() => choose(template.id)}>
            {chosen ? <><Check />Selected</> : <>Use <ArrowUpRight /></>}
          </Button>
          {previewing ? <div className="template-transport">
            {failed ? <p role="status">Preview unavailable. Press play to retry.</p> : <>
              <span>{clock(elapsed)}</span>
              <input type="range" aria-label={"Seek in " + template.title} min="0" max={duration || 1} step=".1"
                value={Math.min(elapsed, duration || 1)} disabled={!duration}
                aria-valuetext={clock(elapsed)} onChange={event => { if (audio.current && duration) { const value = Number(event.target.value); audio.current.currentTime = value; setElapsed(value) } }} />
              <span>{duration ? clock(duration) : "–:––"}</span>
            </>}
          </div> : null}
        </li>
      })}
    </ul>
  </>
}

export function TemplatePicker({ selected, onChange, disabled }: {
  selected: ArrangementTemplate | undefined; onChange(id: ArrangementTemplateId | null): void; disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  return <div className="template-choice">
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger ref={trigger} render={<Button type="button" variant="outline" size="sm" className="template-trigger" disabled={disabled} />}>
        <Disc3 aria-hidden="true" />{selected ? selected.title : "Choose a template"}<ChevronDown aria-hidden="true" />
      </DialogTrigger>
      <DialogContent className="template-library">
        <DialogHeader className="template-header">
          <DialogTitle>Arrangement templates</DialogTitle>
          <DialogDescription>Preview each arrangement with reference instruments.</DialogDescription>
        </DialogHeader>
        {open ? <TemplateList selected={selected?.id} choose={id => { onChange(id); setOpen(false) }} /> : null}
      </DialogContent>
    </Dialog>
    {selected ? <Button type="button" size="icon-sm" variant="ghost" className="template-clear" aria-label="Remove template" disabled={disabled} onClick={() => { onChange(null); trigger.current?.focus() }}><X /></Button> : null}
  </div>
}
