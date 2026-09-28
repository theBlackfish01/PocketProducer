import type { NativeDocument, NativePart } from "../../lib/api"
import { readableDevice, readableEffect } from "../../lib/ui-copy"
import { materializedSectionNotes, partGroupChain, sectionClips, ticksPerBar } from "./score"
import { barLabel, controlName, controlPath, documentEnd, pitchName } from "./score-presentation"

export function ScoreInspector({ document, part, from, to }: { document: NativeDocument; part: NativePart; from: number; to: number }) {
  const width = ticksPerBar(document), notes = materializedSectionNotes(document, part.id, from, to, 24), clips = sectionClips(document, part.id, from, to)
  const groups = partGroupChain(document, part.id)
  const curves = [...part.automation.map((curve) => ({ ...curve, owner: part.name })), ...groups.flatMap((item) => (item.automation ?? []).map((curve) => ({ ...curve, owner: item.name })))]
  return <div className="score-inspector" aria-label={`${part.name} musical facts`}>
    <p>{readableDevice(part.device.type)} · level {Math.round(part.gain * 100)}% · balance {part.pan}</p>
    <p>Output: {[...groups.map((item) => item.name), "Main mix"].join(" → ")}{part.sends?.length ? ` · ${part.sends.length} shared sends` : ""}. {part.effects.map((effect) => readableEffect(effect.type)).join(" → ")}</p>
    <h3>Notes & phrases</h3><p>{notes.total} notes in bars {barLabel(from, width)}–{to / width}.{notes.truncated ? " First 24 shown." : ""}</p>
    {notes.notes.length ? <ol className="score-note-facts">{notes.notes.map((note) => <li key={note.key}><b>{pitchName(note.pitch)}</b><span>Bar {barLabel(note.startTick, width)} · {Number((note.durationTicks / 960).toFixed(2))} beats · {Math.round(note.velocity * 100)}%{note.motifId ? ` · ${document.motifs.find((motif) => motif.id === note.motifId)?.name ?? "phrase"}` : ""}</span></li>)}</ol> : <p>No notes in this window.</p>}
    <h3>Sound clips</h3>{clips.length ? <ul>{clips.slice(0, 24).map((clip) => <li key={clip.key}>{clip.label} · from bar {barLabel(clip.startTick, width)} until bar {barLabel(clip.startTick + clip.durationTicks, width)} · {clip.playbackMode ?? "once"} · source {clip.sourceStartSeconds.toFixed(2)}–{(clip.sourceStartSeconds + clip.sourceDurationSeconds).toFixed(2)} seconds{clip.playbackRate ? ` · ${clip.playbackRate}×` : ""}</li>)}</ul> : <p>No sound clips in this window.</p>}
    <h3>Changing controls</h3>{curves.length ? curves.map((curve) => { const drawing = controlPath(curve, documentEnd(document)); return <div className="score-control" key={`${curve.owner}:${curve.id}`}><strong>{controlName(curve.target)} <small>· {curve.owner}</small></strong><svg viewBox="0 0 100 32" preserveAspectRatio="none" role="img" aria-label={`${controlName(curve.target)} across the whole piece; stored range ${drawing.low} to ${drawing.high}`}><path d={drawing.path} />{drawing.points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="0.7" />)}</svg><span>Whole piece · {drawing.low}–{drawing.high} stored units</span><details><summary>Exact control points</summary><p>{curve.target}</p><ul>{curve.points.map((point, index) => <li key={index}>Bar {barLabel(point.tick, width)}: {point.value} ({point.interpolation ?? "step"})</li>)}</ul></details></div> }) : <p>No changing controls.</p>}
    <details><summary>Exact sound settings</summary><pre>{JSON.stringify({ instrument: part.device, effects: part.effects, parallel: part.parallel, sends: part.sends, sharedProcessing: groups }, null, 2)}</pre></details>
    <p className="score-inspector-note">Stored musical instructions, not measured sound. Curved easing is shown as points only.</p>
  </div>
}
