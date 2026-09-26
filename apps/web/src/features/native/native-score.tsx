import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { MotionConfig, motion, useReducedMotion } from "motion/react"
import { ArrowLeft, ArrowRight, LockKeyhole } from "lucide-react"
import type { NativeDocument } from "../../lib/api"
import { Button } from "../../components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../components/ui/sheet"
import { motifFamily, projectScoreOverview, ticksPerBar } from "./score"
import { advanceConfirmedFrame, barLabel, confirmedChanges, documentEnd, roleNames, type ConfirmedFrame } from "./score-presentation"
import { ScoreInspector } from "./score-inspector"
import { ScoreDetailLane } from "./score-detail-lane"

interface Props {
  document: NativeDocument; identity: string; selectedSectionId: string | null
  onSelectSection(id: string | null): void; selectedPartId: string | null; onInspectPart(id: string | null): void
  draft?: boolean; comparisonBefore?: NativeDocument; coordinateReference?: NativeDocument; timelineReference?: NativeDocument
  animateConfirmed?: boolean; confirmedStepCount?: number; motionScope?: string
  onChangeSection?(id: string | null): void; onChangePart?(id: string): void; onKeepPart?(id: string): void
  protectedPartIds?: string[]; visiblePartIds?: string[]; detailOnly?: boolean; replay?: number
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
  const { document: inputDocument, identity, selectedSectionId, onSelectSection, selectedPartId, onInspectPart, draft = false, comparisonBefore, coordinateReference, timelineReference, animateConfirmed = false, confirmedStepCount, motionScope, onChangeSection, onChangePart, onKeepPart, protectedPartIds = [], visiblePartIds, detailOnly, replay = 0 } = props
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

  return <MotionConfig reducedMotion="user"><div className={`living-score ${draft ? "is-draft" : ""}`} data-score-identity={identity}>
    {!detailOnly ? <>
      <div className="score-section-nav" role="group" aria-label="Choose a section">
        <Button variant={!section ? "default" : "outline"} size="sm" onClick={() => onSelectSection(null)} aria-pressed={!section}>Whole piece</Button>
        {document.sections.map((item, index) => <button key={item.id} type="button" className="score-section-choice" aria-pressed={selectedSectionId === item.id} onClick={() => onSelectSection(item.id)}><small>{String(index + 1).padStart(2, "0")} · bars {item.startBar + 1}–{item.endBar}</small><strong>{item.name}</strong></button>)}
      </div>
      {section ? <Button className="score-overview-toggle" variant="ghost" size="sm" aria-expanded={showOverview} onClick={() => setShowOverview(!showOverview)}>{showOverview ? "Hide whole-piece overview" : "Show whole-piece overview"}</Button> : null}
      {!section || showOverview ? <>
      {document.parts.length > 12 ? <div className="score-role-toggles" role="group" aria-label="Visible role lanes">{[...new Set(document.parts.map((part) => part.role))].map((role) => <Button size="sm" variant="ghost" aria-pressed={!collapsedRoles.includes(role)} key={role} onClick={() => setCollapsedRoles((prior) => prior.includes(role) ? prior.filter((item) => item !== role) : [...prior, role])}>{roleNames[role] ?? role} {collapsedRoles.includes(role) ? "+" : "−"}</Button>)}</div> : null}
      <div className="score-scroll" tabIndex={0} role="region" aria-label={`${draft ? "Confirmed draft" : "Saved"} arrangement overview`}><div className="score-canvas">
        <div className="score-heading-row"><span className="score-part-label">Parts · {document.bars} bars</span><div className="score-form-ruler">{document.sections.map((item, index) => <span key={item.id} style={{ left: `${item.startBar / document.bars * 100}%`, width: `${(item.endBar - item.startBar) / document.bars * 100}%` }}>{String(index + 1).padStart(2, "0")}</span>)}</div></div>
        {overview.lanes.filter((lane) => !collapsedRoles.includes(lane.role)).map((lane) => <div className="score-lane" key={lane.partId} data-selected={selectedPartId === lane.partId}>
          <button type="button" className="score-part-label" onClick={() => inspect(lane.partId)} aria-label={`Inspect ${lane.name}, ${roleNames[lane.role] ?? lane.role}, ${lane.totalNoteOnsets} note starts and ${lane.totalClips} clips`} aria-pressed={selectedPartId === lane.partId}><small>{roleNames[lane.role] ?? lane.role}</small><strong>{lane.name}</strong></button>
          <motion.div className="score-lane-picture" key={`${lane.partId}:${changeKey}`} data-confirmed-change={changedIds.has(lane.partId) || undefined} initial={animate && changedIds.has(lane.partId) ? { backgroundColor: "#e8cfa2" } : false} animate={{ backgroundColor: animate && changedIds.has(lane.partId) ? "#e8cfa2" : "#fffdf7" }} transition={{ duration: 0.55 }}>
            <svg className="score-lane-svg" viewBox="0 0 1000 48" preserveAspectRatio="none" role="img" aria-label={`${lane.name}: ${lane.totalNoteOnsets} note starts across ${document.bars} bars; ${lane.blocks.length} phrase or clip placements`}>
              {document.sections.map((item) => <rect key={item.id} x={item.startBar / document.bars * 1000} y="0" width={(item.endBar - item.startBar) / document.bars * 1000} height="48" className={selectedSectionId === item.id ? "score-section-active" : "score-section-area"} />)}
              {lane.density.map((count, bar) => count ? <rect key={bar} x={(bar + 0.12) / document.bars * 1000} y={40 - Math.min(26, 5 + Math.log2(count + 1) * 5)} width={Math.max(1, 0.76 / document.bars * 1000)} height={Math.min(26, 5 + Math.log2(count + 1) * 5)} className={`score-density role-${lane.role}`}><title>Bar {bar + 1}: {count} note starts</title></rect> : null)}
              {lane.blocks.slice(0, 120).map((block, index) => <rect key={block.key} x={block.startTick / documentEnd(document) * 1000} y={block.kind === "motif" ? 4 + index % 2 * 5 : 3} width={Math.max(2, (block.endTick - block.startTick) / documentEnd(document) * 1000)} height={block.kind === "motif" ? 7 : 12} rx="3" className={`score-block ${block.kind} family-${Math.max(0, families.indexOf(block.familyId ?? "")) % 4} ${highlightFamily && block.familyId !== highlightFamily ? "is-muted" : ""}`}><title>{block.label} · {block.familyId ? `F${families.indexOf(block.familyId) + 1}` : "clip"} · bars {barLabel(block.startTick, width)}–{barLabel(block.endTick, width)}{block.derivedFromMotifId ? " · variation" : ""}</title></rect>)}
            </svg>
          </motion.div>
        </div>)}
      </div></div>
      <p className="score-caption">{overview.noteOnsets.toLocaleString()}{overview.truncated ? "+" : ""} note starts · height shows note density, not loudness. Upper ribbons are phrases and sound clips.{overview.lanes.some((lane) => lane.blocks.length > 120) ? " First 120 placements shown per part." : ""}</p>
      </> : null}
      {families.length ? <details className="score-theme-disclosure"><summary>Follow a recurring phrase · {families.length} families</summary><div className="score-themes" role="group" aria-label="Highlight recurring phrases">{families.map((family, index) => <Button key={family} variant={highlightFamily === family ? "default" : "outline"} size="sm" aria-pressed={highlightFamily === family} onClick={() => setHighlightFamily(highlightFamily === family ? null : family)}>F{index + 1} · {familyName(family)}</Button>)}</div>{highlightFamily ? <p>{document.motifs.filter((motif) => motifFamily(document, motif.id) === highlightFamily).map((motif) => `${motif.name}${motif.derivedFromMotifId ? " (variation)" : " (original)"}`).join(" · ")}</p> : null}</details> : null}
    </> : null}
    {animateConfirmed && delta && (delta.parts.length || delta.formChanged) ? <div className="score-activity" role="status"><strong>Confirmed update</strong>{delta.formChanged ? " · form or tempo changed" : ""}<span>{delta.parts.length} {delta.parts.length === 1 ? "part" : "parts"} updated together: {delta.parts.slice(0, 4).map((part) => `${part.name} (${part.kinds.join(", ")})`).join("; ")}{delta.parts.length > 4 ? `; ${delta.parts.length - 4} more` : ""}.</span></div> : null}
    {section && referenceSection ? <div className="score-detail" aria-label={`${section.name} details`}>
      <div className="score-detail-heading"><div><small>INSPECTING · BARS {referenceSection.startBar + 1}–{referenceSection.endBar}</small><h3>{section.name}</h3><p>{section.intent}</p></div>{onChangeSection ? <Button variant="outline" size="sm" onClick={() => onChangeSection(section.id)}>Change this section</Button> : null}</div>
      <div className="score-window-controls"><span>Bars {startBar + 1}–{endBar} · pitch labels on each part</span><div><Button variant="outline" size="sm" aria-label="Previous bars" disabled={startBar <= referenceSection.startBar} onClick={() => setDetailStart({ section: section.id, bar: Math.max(referenceSection.startBar, startBar - 8) })}><ArrowLeft className="size-4" /></Button><Button variant="outline" size="sm" aria-label="Next bars" disabled={endBar >= referenceSection.endBar} onClick={() => setDetailStart({ section: section.id, bar: endBar })}><ArrowRight className="size-4" /></Button></div></div>
      <div className="score-detail-lanes"><div className="score-detail-ruler"><span>Part / pitch</span><div>{Array.from({ length: endBar - startBar }, (_, index) => <span key={index}>{startBar + index + 1}</span>)}</div><span>Events</span></div>
        {parts.slice(0, detailLimit).map((part, index) => <ScoreDetailLane key={part.id} document={document} reference={coordinateReference ?? baseline} before={baseline} part={part} from={from} to={to} width={width} family={highlightFamily} inspect={() => inspect(part.id)} animate={animate && index < 4} changeKey={changeKey} />)}
        {!parts.length ? <p className="score-empty">No changed parts in this section. Include unchanged parts to inspect it.</p> : null}
      </div>
      {parts.length > detailLimit ? <Button className="mt-2" variant="outline" size="sm" onClick={() => setDetailLimit((limit) => limit + 8)}>Show more score parts ({parts.length - detailLimit} remaining)</Button> : null}
      <p className="score-caption">Up to 120 notes per part in this window. Select a part for exact values. Dashed outlines show previous notes; gold outlines show additions.</p>
    </div> : <p className="score-inspector-hint">Choose a section for note detail, or a part name for its sounds and musical facts.</p>}
    <Sheet open={Boolean(selectedPart)} onOpenChange={(open) => { if (!open) onInspectPart(null) }}><SheetContent className="score-inspector-sheet" initialFocus={inspectorTitle} finalFocus={inspectorReturn}>
      <SheetHeader><SheetTitle ref={inspectorTitle} tabIndex={-1}>{selectedPart?.name ?? "Part"}</SheetTitle><SheetDescription>{section?.name ?? "Whole piece"} · inspecting only; your change scope stays separate.</SheetDescription></SheetHeader>
      {selectedPart ? <><ScoreInspector document={document} part={selectedPart} from={section ? from : 0} to={section ? to : documentEnd(document)} />
        {onChangePart || onKeepPart ? <div className="score-inspector-actions">{onKeepPart ? <Button variant="outline" aria-pressed={protectedPartIds.includes(selectedPart.id)} onClick={() => onKeepPart(selectedPart.id)}><LockKeyhole className="size-4" />{protectedPartIds.includes(selectedPart.id) ? "Allow changes" : "Keep unchanged"}</Button> : null}{onChangePart ? <Button disabled={protectedPartIds.includes(selectedPart.id)} onClick={() => { inspectorReturn.current = window.document.getElementById("native-direction"); onInspectPart(null); onChangePart(selectedPart.id) }}>Change this part</Button> : null}</div> : null}</> : null}
    </SheetContent></Sheet>
  </div></MotionConfig>
})
