import { useMemo } from "react"
import { motion } from "motion/react"
import type { NativeDocument, NativePart } from "../../lib/api"
import { materializedSectionNotes, sectionClips } from "./score"
import { barLabel, controlName, controlPath, documentEnd, noteChanged, noteGeometry, pitchName, roleNames, scoreWindow } from "./score-presentation"
import { pinBars, type ScorePin } from "./score-pins"

export function ScoreDetailLane({ document, reference, before, part, from, to, width, family, inspect, animate, changeKey, pins = [], highlighted = false, flash = null }: { document: NativeDocument; reference?: NativeDocument; before?: NativeDocument; part: NativePart; from: number; to: number; width: number; family: string | null; inspect(): void; animate: boolean; changeKey: string; pins?: ScorePin[]; highlighted?: boolean; flash?: number | null }) {
  const view = useMemo(() => scoreWindow(document, reference, part.id, from, to), [document, reference, part.id, from, to])
  const prior = useMemo(() => before ? materializedSectionNotes(before, part.id, from, to, 120).notes : [], [before, part.id, from, to])
  const old = new Map(prior.map((note) => [note.key, note]))
  const clips = sectionClips(document, part.id, from, to)
  const oldClips = before ? sectionClips(before, part.id, from, to) : []
  const oldClipMap = new Map(oldClips.map((clip) => [clip.key, clip]))
  const clipShape = (clip: typeof clips[number]) => ({ x: Math.max(0, (clip.startTick - from) / (to - from) * 1000), y: 48, width: Math.max(2, Math.min(1000, (clip.startTick + clip.durationTicks - from) / (to - from) * 1000) - Math.max(0, (clip.startTick - from) / (to - from) * 1000)), height: 14 })
  const ghosts = prior.filter((note) => !view.now.has(note.key) || noteChanged(note, view.now.get(note.key)!))
  const currentPart = document.parts.find((item) => item.id === part.id)
  const oldPart = before?.parts.find((item) => item.id === part.id)
  const changedCurves = before ? [...new Set([...(oldPart?.automation ?? []).map((curve) => curve.target), ...(currentPart?.automation ?? []).map((curve) => curve.target)])].filter((target) => JSON.stringify(oldPart?.automation.filter((curve) => curve.target === target)) !== JSON.stringify(currentPart?.automation.filter((curve) => curve.target === target))) : []
  const windowPins = pins.filter((pin) => pin.startBar * width < to && pin.endBar * width > from)
  const span = (start: number, end: number) => { const x = Math.max(0, (start - from) / (to - from) * 1000); return { x, width: Math.max(4, Math.min(1000, (end - from) / (to - from) * 1000) - x) } }
  return <><div className="score-detail-lane" data-part-id={part.id} data-pitch-range={`${view.low}:${view.high}`} data-highlighted={highlighted || undefined}>
    <button type="button" onClick={inspect}><small>{roleNames[part.role] ?? part.role}</small><strong>{part.name}</strong><span className="score-pitch-range">{view.current.pitchRange ? `${pitchName(view.current.pitchRange[0])}–${pitchName(view.current.pitchRange[1])}` : "No notes"}</span></button>
    <svg key={changeKey} viewBox="0 0 1000 68" preserveAspectRatio="none" role="img" aria-label={`${part.name}: ${view.current.total} notes, ${clips.length} clips; bars ${barLabel(from, width)}–${to / width}`}>
      {Array.from({ length: Math.round((to - from) / 960) + 1 }, (_, index) => <line key={index} x1={index * 960 / (to - from) * 1000} x2={index * 960 / (to - from) * 1000} y1="0" y2="68" className={index * 960 % width === 0 ? "score-bar-line" : "score-beat-line"} />)}
      {oldClips.filter((clip) => !clips.some((item) => item.key === clip.key)).slice(0, 80).map((clip) => <rect key={`old:${clip.key}`} {...clipShape(clip)} className="score-note-removed"><title>Previous clip: {clip.label}</title></rect>)}
      {clips.slice(0, 120).map((clip, index) => { const priorClip = oldClipMap.get(clip.key); const changed = Boolean(before && JSON.stringify(priorClip) !== JSON.stringify(clip)); const title = `${clip.label} · ${clip.playbackMode ?? "once"} · source ${clip.sourceStartSeconds}–${clip.sourceStartSeconds + clip.sourceDurationSeconds} seconds`; return animate && changed && index < 40 ? <motion.rect key={clip.key} data-motion-clip="changed" initial={priorClip ? clipShape(priorClip) : { ...clipShape(clip), opacity: 0.2 }} animate={{ ...clipShape(clip), opacity: 1 }} transition={{ duration: 0.32 }} rx="2" className="score-detail-clip score-note-modified"><title>{title}</title></motion.rect> : <rect key={clip.key} {...clipShape(clip)} rx="2" className={`score-detail-clip ${changed ? "score-note-modified" : ""}`}><title>{title}</title></rect> })}
      {ghosts.map((note, index) => animate && index < 40 ? <motion.rect key={`ghost:${note.key}`} {...noteGeometry(note, from, to, view.low, view.high)} rx="2" className="score-note-removed" initial={{ opacity: 0.8 }} animate={{ opacity: 0.2 }} transition={{ duration: 0.26 }} /> : <rect key={`ghost:${note.key}`} {...noteGeometry(note, from, to, view.low, view.high)} rx="2" className="score-note-removed" opacity="0.7" />)}
      {view.current.notes.map((note, index) => {
        const previous = old.get(note.key), modified = previous && noteChanged(previous, note), added = Boolean(before && !previous)
        const geometry = noteGeometry(note, from, to, view.low, view.high)
        const className = `score-detail-note role-${part.role} ${added ? "score-note-added" : modified ? "score-note-modified" : ""} ${family && note.familyId !== family ? "is-muted" : ""}`
        const title = `${pitchName(note.pitch)} · bar ${barLabel(note.startTick, width)} · ${note.durationTicks / 960} beats · velocity ${Math.round(note.velocity * 100)}%`
        return animate && index < 80 && (modified || added) ? <motion.rect key={note.key} data-motion-note={modified ? "modified" : "added"} initial={modified ? noteGeometry(previous, from, to, view.low, view.high) : { ...geometry, opacity: 0.2 }} animate={{ ...geometry, opacity: 1 }} transition={{ duration: 0.36, ease: "easeOut" }} rx="2" className={className}><title>{title}</title></motion.rect> : <rect key={note.key} {...geometry} rx="2" className={className}><title>{title}</title></rect>
      })}
      {!view.current.total && !clips.length ? <text x="12" y="31" className="score-rest">{currentPart ? "Rest" : "Part absent in this version"}</text> : null}
      {windowPins.map((pin) => <rect key={pin.id} className="score-pin" {...span(pin.startBar * width, pin.endBar * width)} y="1" height="66" rx="3"><title>Pinned note, {pinBars(pin)}: {pin.note}</title></rect>)}
    </svg>{flash !== null ? <span key={flash} className="score-lane-flash" aria-hidden="true" /> : null}<span className="score-detail-count">{view.current.total}{view.current.truncated ? "+" : ""} notes{clips.length ? ` · ${clips.length} clips` : ""}</span>
  </div>{changedCurves.slice(0, 3).map((target) => {
    const previous = oldPart?.automation.find((curve) => curve.target === target), next = currentPart?.automation.find((curve) => curve.target === target)
    const values = [...(previous?.points ?? []), ...(next?.points ?? [])].map((point) => point.value)
    const range: [number, number] = [Math.min(...values), Math.max(...values)]
    return <div className="score-control-update" key={`${target}:${changeKey}`}><span>{part.name} · {controlName(target)}<small>Whole piece · {range[0]}–{range[1]} stored units</small></span><svg viewBox="0 0 100 32" preserveAspectRatio="none" role="img" aria-label={`${controlName(target)} changed; previous curve dashed, new curve solid; ${!previous ? "added" : !next ? "removed" : "modified"}`}>
      {previous ? <path d={controlPath(previous, documentEnd(document), range).path} className="previous-control" /> : null}
      {next ? <motion.path d={controlPath(next, documentEnd(document), range).path} initial={animate ? { opacity: 0.2 } : false} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} /> : null}
    </svg><button type="button" onClick={inspect}>Exact values</button></div>
  })}</>
}
