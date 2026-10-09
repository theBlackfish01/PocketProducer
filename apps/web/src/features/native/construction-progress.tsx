import { useMemo } from "react"
import { Check, Pause } from "lucide-react"
import type { NativeDocument, NativeDraftView } from "../../lib/api"
import { words } from "../../lib/words"
import { projectScoreOverview } from "./score"

type DraftPlan = NonNullable<NativeDraftView["plan"]>
const steps = ["Plan", "Build", "Refine", "Review"] as const
const normalize = (name: string) => words(name).join(" ")

/** The recorded stage, never inferred from model prose. "Planned" means the
 * plan exists and building is next. */
export function activeStep(stage: DraftPlan["stage"] | undefined) {
  return !stage ? 0 : stage === "planned" || stage === "building" ? 1 : stage === "refining" ? 2 : 3
}

export interface GhostSection { key: string; name: string; purpose: string; state: "planned" | "shaped" | "has-music"; weight: number }

/** A plan section is only solid when the confirmed draft has a section of that
 * name with stored notes or clips in it. Plans are intentions, not music. */
export function ghostSections(plan: DraftPlan["plan"]["sections"], document: NativeDocument | null | undefined): GhostSection[] {
  const lanes = document ? projectScoreOverview(document).lanes : []
  const clipBars = (start: number, end: number) => Boolean(document?.parts.some((part) => [...part.sourceRegions, ...(part.libraryRegions ?? [])].some((clip) => {
    const width = document.ppq * document.meter.numerator * 4 / document.meter.denominator
    return clip.startTick < end * width && clip.startTick + clip.durationTicks > start * width
  })))
  const matched = plan.map((section) => document?.sections.find((candidate) => normalize(candidate.name) === normalize(section.name)) ?? null)
  const known = matched.filter((value) => value !== null)
  const average = known.length ? known.reduce((sum, value) => sum + value.endBar - value.startBar, 0) / known.length : 4
  return plan.map((section, index) => {
    const found = matched[index]
    const notes = found ? lanes.some((lane) => lane.density.slice(found.startBar, found.endBar).some(Boolean)) || clipBars(found.startBar, found.endBar) : false
    return { key: `${index}:${section.name}`, name: section.name, purpose: section.purpose, state: notes ? "has-music" : found ? "shaped" : "planned", weight: found ? found.endBar - found.startBar : average }
  })
}

export function ConstructionProgress({ plan, document, paused }: { plan: DraftPlan | null | undefined; document: NativeDocument | null | undefined; paused: boolean }) {
  // Without a recorded plan, confirmed notes still mean building has started.
  const active = plan ? activeStep(plan.stage) : document ? 1 : 0
  const sections = useMemo(() => plan ? ghostSections(plan.plan.sections, document) : [], [plan, document])
  return <section className="construction-progress" aria-label="Construction progress">
    <ol className="stage-tracker">{steps.map((label, index) => {
      const state = index < active ? "is-done" : index === active ? paused ? "is-paused" : "is-active" : "is-next"
      return <li key={label} className={state} aria-current={index === active ? "step" : undefined}>
        <span className="stage-dot" aria-hidden="true">{state === "is-done" ? <Check size={11} /> : state === "is-paused" ? <Pause size={10} /> : null}</span>
        {label}<span className="sr-only">{state === "is-done" ? " · done" : state === "is-paused" ? " · paused here" : state === "is-active" ? " · in progress" : ""}</span>
      </li>
    })}</ol>
    {sections.length ? <>
      <ol className="ghost-plan" aria-label="Planned sections">{sections.map((section) => <li key={section.key} className={`ghost-section is-${section.state}`} style={{ flexGrow: section.weight }} title={`${section.name}: ${section.purpose}`}>
        <strong>{section.name}</strong><small>{section.state === "has-music" ? "Notes saved" : section.state === "shaped" ? "No notes yet" : "Planned"}</small>
      </li>)}</ol>
      <p className="ghost-plan-note">Outlined sections are the producer’s plan, not music. Solid sections contain confirmed notes.</p>
    </> : null}
  </section>
}
