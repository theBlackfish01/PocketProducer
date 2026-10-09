import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react"
import { MotionConfig, motion, useReducedMotion } from "motion/react"
import { ArrowLeft, ArrowRight, LockKeyhole, MapPin } from "lucide-react"
import type { NativeDocument } from "../../lib/api"
import { Button } from "../../components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../components/ui/sheet"
import { motifFamily, projectScoreOverview, ticksPerBar } from "./score"
import { advanceConfirmedFrame, occupiedBars, confirmedChanges, documentEnd, roleNames, type ConfirmedFrame } from "./score-presentation"
import { ScoreInspector } from "./score-inspector"
import { ScoreDetailLane } from "./score-detail-lane"
import { pinBars, type ScorePin } from "./score-pins"
import { useMediaQuery } from "../../lib/use-media-query"

/** Presentation pointer from a public message; never a scope or a change. */
export interface ScoreHighlight { partIds: string[]; sectionIds: string[]; nonce: number; reveal: boolean }
const pad = (index: number) => String(index + 1).padStart(2, "0")

interface Props {
  document: NativeDocument; identity: string; selectedSectionId: string | null
  onSelectSection(id: string | null): void; selectedPartId: string | null; onInspectPart(id: string | null): void
  draft?: boolean; comparisonBefore?: NativeDocument; coordinateReference?: NativeDocument; timelineReference?: NativeDocument
  animateConfirmed?: boolean; confirmedStepCount?: number; motionScope?: string
  onChangeSection?(id: string | null): void; onChangePart?(id: string): void; onKeepPart?(id: string): void
  protectedPartIds?: string[]; visiblePartIds?: string[]; detailOnly?: boolean; replay?: number
  highlight?: ScoreHighlight | null; pins?: ScorePin[]; onPinRange?(partId: string, startBar: number, endBar: number): void
}

// Snapshot receipt is separate from playback. Same/older receipts and another job never replay.
function useConfirmedFrame(document: NativeDocument, identity: string, scope: string | undefined, steps = 0) {
  const [frame, setFrame] = useState<ConfirmedFrame>({ document, identity, scope, steps })
  useLayoutEffect(() => {
    setFrame((prior) => advanceConfirmedFrame(prior, { document, identity, scope, steps }))
  }, [document, identity, scope, steps])
  return frame
}

export const NativeScore = memo(function NativeScore(props: Props) {
  const { document: inputDocument, identity, selectedSectionId, onSelectSection, selectedPartId, onInspectPart, draft = false, comparisonBefore, coordinateReference, timelineReference, animateConfirmed = false, confirmedStepCount, motionScope, onChangeSection, onChangePart, onKeepPart, protectedPartIds = [], visiblePartIds, detailOnly, replay = 0, highlight = null, pins = [], onPinRange } = props
  const reduced = useReducedMotion()
  const frame = useConfirmedFrame(inputDocument, identity, motionScope, confirmedStepCount)
  const document = animateConfirmed && frame.scope === motionScope ? frame.document : inputDocument
  const baseline = animateConfirmed ? frame.before : comparisonBefore
  const delta = useMemo(() => baseline ? confirmedChanges(baseline, document) : null, [baseline, document])
  const changedIds = useMemo(() => new Set(delta?.parts.map((part) => part.id)), [delta])
  const overview = useMemo(() => projectScoreOverview(document), [document])
  const [detailStart, setDetailStart] = useState<{ section: string; bar: number } | null>(null)
  const [highlightFamily, setHighlightFamily] = useState<string | null>(null)
  const [collapsedRoles, setCollapsedRoles] = useState<string[]>([])
  const [showOverview, setShowOverview] = useState(false)
  const [detailLimit, setDetailLimit] = useState(8)
  useEffect(() => { setDetailLimit(8) }, [selectedSectionId])
  const section = document.sections.find((item) => item.id === selectedSectionId) ?? coordinateReference?.sections.find((item) => item.id === selectedSectionId)
  const referenceSection = timelineReference?.sections.find((item) => item.id === selectedSectionId) ?? section
  const startBar = referenceSection ? Math.min(Math.max(detailStart?.section === selectedSectionId ? detailStart.bar : referenceSection.startBar, referenceSection.startBar), referenceSection.endBar - 1) : 0
  const endBar = referenceSection ? Math.min(referenceSection.endBar, startBar + 8) : 0
  const width = ticksPerBar(timelineReference ?? document), from = startBar * width, to = endBar * width
  const selectedPart = document.parts.find((part) => part.id === selectedPartId) ?? coordinateReference?.parts.find((part) => part.id === selectedPartId)
  const families = useMemo(() => [...new Set(document.motifs.map((motif) => motifFamily(document, motif.id)).filter((value): value is string => Boolean(value)))], [document])
  const familyName = (family: string) => document.motifs.find((motif) => motif.id === family)?.name ?? document.motifs.find((motif) => motif.familyId === family)?.name ?? family
  const parts = useMemo(() => {
    const ordered = [...(timelineReference?.parts ?? document.parts)]
    for (const part of coordinateReference?.parts ?? []) if (!ordered.some((item) => item.id === part.id)) ordered.push(part)
    for (const part of document.parts) if (!ordered.some((item) => item.id === part.id)) ordered.push(part)
    return ordered.map((part) => document.parts.find((item) => item.id === part.id) ?? part).filter((part) => !visiblePartIds || visiblePartIds.includes(part.id))
  }, [document, coordinateReference, timelineReference, visiblePartIds])
  const inspectorReturn = useRef<HTMLElement | null>(null)
  const inspectorTitle = useRef<HTMLHeadingElement | null>(null)
  const inspect = (id: string) => { inspectorReturn.current = window.document.activeElement as HTMLElement; onInspectPart(id) }
  const [activeMotion, setActiveMotion] = useState(false)
  useEffect(() => {
    if (!animateConfirmed && !replay || reduced || !baseline) { setActiveMotion(false); return }
    setActiveMotion(true)
    const timer = window.setTimeout(() => setActiveMotion(false), 650)
    return () => window.clearTimeout(timer)
  }, [frame.identity, replay, animateConfirmed, reduced, baseline])
  const animate = !reduced && activeMotion
  const changeKey = `${frame.identity}:${replay}`
  const lit = (id: string, kind: "part" | "section") => (kind === "part" ? highlight?.partIds : highlight?.sectionIds)?.includes(id) || undefined
  const [pinDrag, setPinDrag] = useState<{ partId: string; anchor: number; current: number } | null>(null)
  const barAt = (event: PointerEvent<HTMLElement>) => { const box = event.currentTarget.getBoundingClientRect(); return Math.min(document.bars - 1, Math.max(0, Math.floor((event.clientX - box.left) / Math.max(1, box.width) * document.bars))) }
  const sectionLabel = (item: NativeDocument["sections"][number], index: number) => <><strong>{pad(index)} · {item.name}</strong><small>bars {item.startBar + 1}–{item.endBar}</small></>
  // On phones the ruler is too narrow to choose from: a section strip above the
  // overview does the choosing and the ruler only orients.
  const compact = useMediaQuery("(max-width: 700px)")
  const rulerChooses = !section && !compact
  // Longer pieces still scroll; fade the trailing edge while more bars remain.
  const scroller = useRef<HTMLDivElement | null>(null)
  const [overflow, setOverflow] = useState({ scrollable: false, more: false })
  const measure = useCallback(() => {
    const element = scroller.current
    if (!element) return
    const scrollable = element.scrollWidth > element.clientWidth + 4
    const more = scrollable && element.scrollLeft + element.clientWidth < element.scrollWidth - 4
    setOverflow((prior) => prior.scrollable === scrollable && prior.more === more ? prior : { scrollable, more })
  }, [])
  useLayoutEffect(() => {
    measure()
    const element = scroller.current
    if (!element || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [measure, document.bars, section, showOverview])

  return <MotionConfig reducedMotion="user"><div className={`living-score ${draft ? "is-draft" : ""}`} data-score-identity={identity}>
    {!detailOnly ? <>
      {section || compact ? <div className="score-form-strip" role="group" aria-label="Choose a section">
        <Button variant="outline" size="sm" aria-pressed={!section} onClick={() => onSelectSection(null)}>Whole piece</Button>
        <div className="score-form-strip-track">{document.sections.map((item, index) => <button key={item.id} type="button" className="score-section-choice" style={{ flexGrow: item.endBar - item.startBar }} aria-pressed={selectedSectionId === item.id} data-highlighted={lit(item.id, "section")} title={`${item.name} · bars ${item.startBar + 1}–${item.endBar}`} onClick={() => onSelectSection(item.id)}>{sectionLabel(item, index)}</button>)}</div>
      </div> : null}
      {section ? <Button className="score-overview-toggle" variant="ghost" size="sm" aria-expanded={showOverview} onClick={() => setShowOverview(!showOverview)}>{showOverview ? "Hide whole-piece overview" : "Show whole-piece overview"}</Button> : null}
      {!section || showOverview ? <>
      {document.parts.length > 12 ? <div className="score-role-toggles" role="group" aria-label="Visible role lanes">{[...new Set(document.parts.map((part) => part.role))].map((role) => <Button size="sm" variant="ghost" aria-pressed={!collapsedRoles.includes(role)} key={role} onClick={() => setCollapsedRoles((prior) => prior.includes(role) ? prior.filter((item) => item !== role) : [...prior, role])}>{roleNames[role] ?? role} {collapsedRoles.includes(role) ? "+" : "−"}</Button>)}</div> : null}
      <div className="score-scroll-frame" data-more={overflow.more || undefined}><div className="score-scroll" ref={scroller} onScroll={measure} tabIndex={0} role="region" aria-label={`${draft ? "Confirmed draft" : "Saved"} arrangement overview`}><div className="score-canvas" style={{ "--score-bars": document.bars } as CSSProperties}>
        <div className="score-heading-row"><span className="score-part-label">Parts · {document.bars} bars</span><div className="score-form-ruler" {...(rulerChooses ? { role: "group", "aria-label": "Choose a section" } : {})}>{document.sections.map((item, index) => {
          const style = { left: `${item.startBar / document.bars * 100}%`, width: `${(item.endBar - item.startBar) / document.bars * 100}%` }
          return rulerChooses ? <button key={item.id} type="button" className="score-section-choice score-ruler-section" style={style} aria-pressed="false" data-highlighted={lit(item.id, "section")} title={`${item.name} · bars ${item.startBar + 1}–${item.endBar}`} onClick={() => onSelectSection(item.id)}>{sectionLabel(item, index)}</button>
            : <span key={item.id} className="score-ruler-section" style={style} data-active={selectedSectionId === item.id || undefined} data-highlighted={lit(item.id, "section")}>{sectionLabel(item, index)}</span>
        })}</div></div>
        {overview.lanes.filter((lane) => !collapsedRoles.includes(lane.role)).map((lane) => {
          const lanePins = pins.filter((pin) => pin.partId === lane.partId && pin.endBar <= document.bars)
          const dragging = pinDrag?.partId === lane.partId ? pinDrag : null
          return <div className="score-lane" key={lane.partId} data-part-id={lane.partId} data-selected={selectedPartId === lane.partId} data-highlighted={lit(lane.partId, "part")}>
          <button type="button" className="score-part-label" data-part-id={lane.partId} onClick={() => inspect(lane.partId)} aria-label={`Inspect ${lane.name}, ${roleNames[lane.role] ?? lane.role}, ${lane.totalNoteOnsets} note starts and ${lane.totalClips} clips`} aria-pressed={selectedPartId === lane.partId}><small>{roleNames[lane.role] ?? lane.role}</small><strong>{lane.name}</strong></button>
          <motion.div className="score-lane-picture" key={`${lane.partId}:${changeKey}`} data-confirmed-change={changedIds.has(lane.partId) || undefined} data-pinnable={onPinRange ? "true" : undefined} title={onPinRange ? "Drag across bars to pin a note" : undefined} initial={animate && changedIds.has(lane.partId) ? { backgroundColor: "#e8cfa2" } : false} animate={{ backgroundColor: animate && changedIds.has(lane.partId) ? "#e8cfa2" : "#fffdf7" }} transition={{ duration: 0.55 }}
            onPointerDown={onPinRange ? (event) => { if (event.pointerType === "touch" || event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); const bar = barAt(event); setPinDrag({ partId: lane.partId, anchor: bar, current: bar }) } : undefined}
            onPointerMove={dragging ? (event) => { const bar = barAt(event); setPinDrag((prior) => prior && prior.current !== bar ? { ...prior, current: bar } : prior) } : undefined}
            onPointerUp={dragging ? (event) => { const bar = barAt(event); setPinDrag(null); onPinRange?.(lane.partId, Math.min(dragging.anchor, bar), Math.max(dragging.anchor, bar) + 1) } : undefined}
            onPointerCancel={() => setPinDrag(null)}>
            <svg className="score-lane-svg" viewBox="0 0 1000 48" preserveAspectRatio="none" role="img" aria-label={`${lane.name}: ${lane.totalNoteOnsets} note starts across ${document.bars} bars; ${lane.blocks.length} phrase or clip placements${lanePins.length ? `; ${lanePins.length} pinned ${lanePins.length === 1 ? "note" : "notes"}` : ""}`}>
              {document.sections.map((item) => <rect key={item.id} x={item.startBar / document.bars * 1000} y="0" width={(item.endBar - item.startBar) / document.bars * 1000} height="48" className={`${selectedSectionId === item.id ? "score-section-active" : "score-section-area"}${lit(item.id, "section") ? " score-section-highlight" : ""}`} />)}
              {lane.density.map((count, bar) => count ? <rect key={bar} x={(bar + 0.12) / document.bars * 1000} y={lane.contour ? 18 : 40 - Math.min(26, 5 + Math.log2(count + 1) * 5)} width={Math.max(1, 0.76 / document.bars * 1000)} height={lane.contour ? 28 : Math.min(26, 5 + Math.log2(count + 1) * 5)} className={lane.contour ? "score-density-hit" : `score-density role-${lane.role}`}><title>Bar {bar + 1}: {count} note starts</title></rect> : null)}
              {lane.contour ? <path className={`score-contour role-${lane.role}`} d={lane.contour.path} /> : null}
              {lane.blocks.slice(0, 120).map((block, index) => <rect key={block.key} x={block.startTick / documentEnd(document) * 1000} y={block.kind === "motif" ? 4 + index % 2 * 5 : 3} width={Math.max(2, (block.endTick - block.startTick) / documentEnd(document) * 1000)} height={block.kind === "motif" ? 7 : 12} rx="3" className={`score-block ${block.kind} family-${Math.max(0, families.indexOf(block.familyId ?? "")) % 4} ${highlightFamily && block.familyId !== highlightFamily ? "is-muted" : ""}`}><title>{block.label} · {block.familyId ? `F${families.indexOf(block.familyId) + 1}` : "clip"} · bars {occupiedBars(block.startTick, block.endTick, width)}{block.derivedFromMotifId ? " · variation" : ""}</title></rect>)}
              {lanePins.map((pin) => <rect key={pin.id} className="score-pin" x={pin.startBar / document.bars * 1000} y="1" width={(pin.endBar - pin.startBar) / document.bars * 1000} height="46" rx="3"><title>Pinned note, {pinBars(pin)}: {pin.note}</title></rect>)}
              {dragging ? <rect className="score-pin-selection" x={Math.min(dragging.anchor, dragging.current) / document.bars * 1000} y="1" width={(Math.abs(dragging.current - dragging.anchor) + 1) / document.bars * 1000} height="46" rx="3" /> : null}
            </svg>
            {lit(lane.partId, "part") && highlight?.reveal ? <span key={highlight.nonce} className="score-lane-flash" aria-hidden="true" /> : null}
          </motion.div>
        </div> })}
      </div></div></div>
      {overflow.scrollable ? <p className="score-scroll-hint">Scroll sideways for all {document.bars} bars.</p> : null}
      <details className="score-caption"><summary>About this view</summary><p>{overview.noteOnsets.toLocaleString()}{overview.truncated ? "+" : ""} note starts. Lines trace stored pitch and timing within each part’s own range; they are not loudness or audio. Upper ribbons are phrases and sound clips. {onPinRange ? "Drag across a part’s bars, or use Pin a note in a part’s details, to leave a note for your next change." : ""}</p></details>
      {overview.truncated || overview.lanes.some((lane) => lane.blocks.length > 120 || (lane.totalNoteOnsets > 0 && !lane.contour)) ? <p className="score-caption">This overview is condensed. Select a part for details.</p> : null}
      </> : null}
      {families.length ? <details className="score-theme-disclosure"><summary>Follow a recurring phrase · {families.length} families</summary><div className="score-themes" role="group" aria-label="Highlight recurring phrases">{families.map((family, index) => <Button key={family} variant={highlightFamily === family ? "default" : "outline"} size="sm" aria-pressed={highlightFamily === family} onClick={() => setHighlightFamily(highlightFamily === family ? null : family)}>F{index + 1} · {familyName(family)}</Button>)}</div>{highlightFamily ? <p>{document.motifs.filter((motif) => motifFamily(document, motif.id) === highlightFamily).map((motif) => `${motif.name}${motif.derivedFromMotifId ? " (variation)" : " (original)"}`).join(" · ")}</p> : null}</details> : null}
    </> : null}
    {animateConfirmed && delta && (delta.parts.length || delta.formChanged) ? <div className="score-activity" role="status"><strong>Confirmed update</strong>{delta.formChanged ? " · form or tempo changed" : ""}<span>{delta.parts.length} {delta.parts.length === 1 ? "part" : "parts"} updated together: {delta.parts.slice(0, 4).map((part) => `${part.name} (${part.kinds.join(", ")})`).join("; ")}{delta.parts.length > 4 ? `; ${delta.parts.length - 4} more` : ""}.</span></div> : null}
    {section && referenceSection ? <div className="score-detail" aria-label={`${section.name} details`}>
      <div className="score-detail-heading"><div><small>INSPECTING · BARS {referenceSection.startBar + 1}–{referenceSection.endBar}</small><h3>{section.name}</h3><p>{section.intent}</p></div>{onChangeSection ? <Button variant="outline" size="sm" onClick={() => onChangeSection(section.id)}>Change this section</Button> : null}</div>
      <div className="score-window-controls"><span>Bars {startBar + 1}–{endBar} · pitch labels on each part</span><div><Button variant="outline" size="sm" aria-label="Previous bars" disabled={startBar <= referenceSection.startBar} onClick={() => setDetailStart({ section: section.id, bar: Math.max(referenceSection.startBar, startBar - 8) })}><ArrowLeft className="size-4" /></Button><Button variant="outline" size="sm" aria-label="Next bars" disabled={endBar >= referenceSection.endBar} onClick={() => setDetailStart({ section: section.id, bar: endBar })}><ArrowRight className="size-4" /></Button></div></div>
      <div className="score-detail-lanes"><div className="score-detail-ruler"><span>Part / pitch</span><div>{Array.from({ length: endBar - startBar }, (_, index) => <span key={index}>{startBar + index + 1}</span>)}</div><span>Events</span></div>
        {parts.slice(0, detailLimit).map((part, index) => <ScoreDetailLane key={part.id} document={document} reference={coordinateReference ?? baseline} before={baseline} part={part} from={from} to={to} width={width} family={highlightFamily} inspect={() => inspect(part.id)} animate={animate && index < 4} changeKey={changeKey} pins={pins.filter((pin) => pin.partId === part.id)} highlighted={Boolean(lit(part.id, "part"))} flash={lit(part.id, "part") && highlight?.reveal ? highlight.nonce : null} />)}
        {!parts.length ? <p className="score-empty">No changed parts in this section. Include unchanged parts to inspect it.</p> : null}
      </div>
      {parts.length > detailLimit ? <Button className="mt-2" variant="outline" size="sm" onClick={() => setDetailLimit((limit) => limit + 8)}>Show more score parts ({parts.length - detailLimit} remaining)</Button> : null}
      <p className="score-caption">Up to 120 notes per part in this window. Select a part for exact values. Dashed outlines show previous notes; gold outlines show additions.</p>
    </div> : <p className="score-inspector-hint">Choose a section for note detail, or a part name for its sounds and musical facts.</p>}
    <Sheet open={Boolean(selectedPart)} onOpenChange={(open) => { if (!open) onInspectPart(null) }}><SheetContent className="score-inspector-sheet" initialFocus={inspectorTitle} finalFocus={inspectorReturn}>
      <SheetHeader><SheetTitle ref={inspectorTitle} tabIndex={-1}>{selectedPart?.name ?? "Part"}</SheetTitle><SheetDescription>{section?.name ?? "Whole piece"} · inspecting only; your change scope stays separate.</SheetDescription></SheetHeader>
      {selectedPart ? <><ScoreInspector document={document} part={selectedPart} from={section ? from : 0} to={section ? to : documentEnd(document)} />
        {onChangePart || onKeepPart || onPinRange ? <div className="score-inspector-actions">{onKeepPart ? <Button variant="outline" aria-pressed={protectedPartIds.includes(selectedPart.id)} onClick={() => onKeepPart(selectedPart.id)}><LockKeyhole className="size-4" />{protectedPartIds.includes(selectedPart.id) ? "Allow changes" : "Keep unchanged"}</Button> : null}{onPinRange ? <Button variant="outline" onClick={() => { const id = selectedPart.id; inspectorReturn.current = window.document.querySelector<HTMLElement>(`.score-part-label[data-part-id="${CSS.escape(id)}"]`); onInspectPart(null); onPinRange(id, section && referenceSection ? referenceSection.startBar : 0, section && referenceSection ? referenceSection.endBar : document.bars) }}><MapPin className="size-4" />Pin a note</Button> : null}{onChangePart ? <Button disabled={protectedPartIds.includes(selectedPart.id)} onClick={() => { inspectorReturn.current = window.document.getElementById("native-direction"); onInspectPart(null); onChangePart(selectedPart.id) }}>Change this part</Button> : null}</div> : null}</> : null}
    </SheetContent></Sheet>
  </div></MotionConfig>
})
