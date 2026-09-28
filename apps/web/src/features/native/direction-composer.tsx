import { useEffect, useRef, useState, type ReactNode } from "react"
import { ArrowRight, Plus, Sparkles, Undo2 } from "lucide-react"
import { Button } from "../../components/ui/button"
import { Textarea } from "../../components/ui/textarea"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../../components/ui/dialog"
import { api, type ProducerModelOption } from "../../lib/api"
import { RepositoryLink } from "../../components/repository-link"

interface Props {
  projectId: string; headId: string | null; direction: string; onDirection(value: string): void
  revision: boolean; active: boolean; busy: boolean; canSubmit: boolean; onSubmit(model: string): void
  sectionId: string | null; partId: string | null; protectedPartIds: string[]; sourceIds: string[]
  sections: Array<{ id: string; name: string }>; onSection(id: string | null): void
  partName: string | undefined; clearPart(): void; protectedNames: string[]
  profile: "standard" | "extended"; onProfile(value: "standard" | "extended"): void
  model: string; onModel(value: string): void
  children?: ReactNode
  onAddSound?(): void
}

export function DirectionComposer(props: Props) {
  const [models, setModels] = useState<ProducerModelOption[]>([])
  const [modelsFailed, setModelsFailed] = useState(false)
  const [fallbackModel, setFallbackModel] = useState<string | null>(null)
  const [repositoryPublic, setRepositoryPublic] = useState(false)
  useEffect(() => {
    let controller: AbortController | undefined
    const refresh = () => {
      controller?.abort()
      const request = new AbortController(); controller = request
      void api.producerModels(request.signal).then((data) => {
        if (!Array.isArray(data.models)) throw new Error("Model list unavailable")
        if (!request.signal.aborted) { setModels(data.models); setFallbackModel(data.fallbackModel ?? null); setRepositoryPublic(data.repository?.public === true); setModelsFailed(false) }
      }).catch(() => { if (!request.signal.aborted) setModelsFailed(true) })
    }
    refresh()
    window.addEventListener("focus", refresh)
    const interval = window.setInterval(() => { if (!document.hidden) refresh() }, 30_000)
    return () => { controller?.abort(); window.removeEventListener("focus", refresh); window.clearInterval(interval) }
  }, [props.projectId, props.active])
  const effectiveModel = props.model === "gpt-6-sol" && fallbackModel ? fallbackModel : props.model
  const modelUnavailable = Boolean(models.find((model) => model.id === effectiveModel && !model.available))
  const allUnavailable = models.length > 0 && models.every((model) => !model.available)
  const userLimited = models.some((model) => model.reason === "user")
  const helperUnavailable = models.some((model) => model.id === "gpt-6-luna" && !model.available)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [draftOpen, setDraftOpen] = useState(false)
  const [announcement, setAnnouncement] = useState("")
  const scope = JSON.stringify([props.projectId, props.headId, props.sectionId, props.partId, props.protectedPartIds, props.sourceIds])
  const undoKey = `pocket-producer:prompt-edit:${props.projectId}`
  const [undo, setUndo] = useState<{ original: string; suggestion: string } | null>(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(undoKey) ?? "null") as { scope?: string; original?: unknown; suggestion?: unknown } | null
      return value?.scope === scope && typeof value.original === "string" && value.original.length <= 32_768 && typeof value.suggestion === "string" && value.suggestion.length <= 32_768 ? { original: value.original, suggestion: value.suggestion } : null
    } catch { return null }
  })
  const controller = useRef<AbortController | null>(null)
  const recent = useRef<string[]>([])
  const previousScope = useRef(scope)
  const current = useRef({ scope, direction: props.direction })
  current.current = { scope, direction: props.direction }
  useEffect(() => () => { controller.current?.abort() }, [])
  useEffect(() => {
    if (previousScope.current === scope) return
    previousScope.current = scope
    controller.current?.abort(); controller.current = null; setPending(false); setMessage(null); setUndo(null)
  }, [scope])
  useEffect(() => {
    try { if (undo) sessionStorage.setItem(undoKey, JSON.stringify({ scope, ...undo })); else sessionStorage.removeItem(undoKey) } catch { /* Writing a suggestion still works when browser storage is unavailable. */ }
  }, [scope, undo, undoKey])
  const assist = async () => {
    if (controller.current) return
    const capture = { ...current.current }
    const request = new AbortController(); controller.current = request
    setPending(true); setMessage(null)
    try {
      const result = await api.assistPrompt(props.projectId, {
        mode: props.direction.trim() ? "rewrite" : "inspire", direction: props.direction,
        expectedHeadId: props.headId, sectionId: props.sectionId, partId: props.partId,
        protectedPartIds: props.protectedPartIds, sourceIds: props.sourceIds, recent: recent.current,
      }, crypto.randomUUID(), request.signal)
      if (request.signal.aborted || current.current.scope !== capture.scope || current.current.direction !== capture.direction) return
      setUndo({ original: capture.direction, suggestion: result.prompt }); props.onDirection(result.prompt)
      recent.current = [...recent.current, result.prompt].slice(-3)
      setAnnouncement(result.provenance === "fixture" ? "Test suggestion added. You can edit it." : "Prompt updated. You can edit it or undo.")
    } catch {
      if (!request.signal.aborted) setMessage("Prompt help couldn't finish. Your words are unchanged; you can keep writing.")
    } finally {
      if (controller.current === request) { controller.current = null; setPending(false) }
    }
  }
  return <section className="direction-section" aria-labelledby="direction-heading">
    <div className={!props.active && !props.revision ? "sr-only" : "section-heading"}><h2 id="direction-heading">{props.active ? "Next change" : props.revision ? "What would you like to change?" : "Your direction"}</h2></div>
    {props.children}
    <span className="sr-only" role="status">{announcement}</span>
    {props.active ? <Button type="button" variant="ghost" aria-expanded={draftOpen} aria-controls="next-direction-form" onClick={() => setDraftOpen((value) => !value)}>{draftOpen ? "Close draft" : props.direction.trim() ? "Edit next change" : "Draft next change"}</Button> : null}
    <form id="next-direction-form" hidden={props.active && !draftOpen} className="composer native-composer" onSubmit={(event) => { event.preventDefault(); if (!props.active && !pending && props.canSubmit && !modelUnavailable) props.onSubmit(effectiveModel) }}>
      {props.revision ? <div className="direction-scope"><label>Change scope <select aria-label="Change scope" value={props.sectionId ?? ""} onChange={(event) => props.onSection(event.target.value || null)} disabled={props.busy}><option value="">Whole piece</option>{props.sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}</select></label>{props.partName ? <Button type="button" variant="ghost" size="sm" onClick={props.clearPart} aria-label={`Clear change target ${props.partName}`}>{props.partName} ×</Button> : null}</div> : null}
      <label htmlFor="native-direction" className="sr-only">Describe your arrangement</label>
      <Textarea id="native-direction" value={props.direction} maxLength={32_768} onChange={(event) => {
        controller.current?.abort(); controller.current = null; setPending(false); setMessage(null); props.onDirection(event.target.value)
      }} placeholder={props.revision ? "A little more movement here. Keep the bass and melody…" : "A mood, a rhythm, a place. What does your music feel like?"} disabled={props.busy} />
      {props.protectedNames.length ? <p className="direction-kept">Keep unchanged: {props.protectedNames.join(", ")}</p> : null}
      <div className="direction-footer"><div className="prompt-helper-actions">
        {!props.active ? <label className="producer-model-picker"><span className="sr-only">Producer model</span><select aria-label="Producer model" value={effectiveModel} disabled={props.busy || !models.length} onChange={(event) => props.onModel(event.target.value)}>{models.length ? models.map((model) => <option key={model.id} value={model.id} disabled={!model.available}>{model.label}{!model.available ? " · unavailable" : ""}</option>) : <option value={props.model}>{modelsFailed ? "Model list unavailable" : "Loading models…"}</option>}</select></label> : null}
        {!props.active && !helperUnavailable && (props.direction.trim() || !props.revision) ? <Button type="button" variant="ghost" size="sm" onClick={() => void assist()} disabled={props.busy || pending}><Sparkles size={15} />{pending ? props.direction.trim() ? "Rewriting…" : "Finding an idea…" : props.direction.trim() ? "Rewrite prompt" : "Inspire me"}</Button> : null}
        {pending ? <Button type="button" size="sm" variant="ghost" onClick={() => { controller.current?.abort(); controller.current = null; setPending(false) }}>Cancel</Button> : null}
        {undo && props.direction === undo.suggestion ? <Button type="button" variant="ghost" size="sm" onClick={() => { props.onDirection(undo.original); setUndo(null); setMessage(null) }}><Undo2 size={14} />Undo rewrite</Button> : null}
        {props.onAddSound && !props.active ? <Button type="button" variant="ghost" size="sm" onClick={props.onAddSound}><Plus size={15} />{props.sourceIds.length ? `Sounds (${props.sourceIds.length})` : "Add sound"}</Button> : null}
        {!props.active ? <Button type="button" variant="ghost" size="sm" onClick={() => setOptionsOpen(true)}>Options</Button> : null}
      </div>
      {!props.active ? <Button className="direction-submit" type="submit" disabled={pending || !props.canSubmit || modelUnavailable}><Sparkles size={16} />{props.busy ? "Starting…" : props.revision ? "Make this change" : "Create arrangement"}<ArrowRight size={16} /></Button> : null}
      </div>
      {!props.active && (allUnavailable || fallbackModel) ? <div className="demo-availability" role="status"><p>{allUnavailable ? userLimited ? "You've reached your demo usage limit. Your saved arrangements are still available." : "The shared demo allowance is unavailable. Your saved arrangements are still available." : "Sol's shared allowance is unavailable. Luna is available."}</p>{allUnavailable ? <RepositoryLink isPublic={repositoryPublic} /> : null}</div> : null}
      {!props.active && modelUnavailable && !allUnavailable && !fallbackModel ? <p className="demo-availability" role="status">This model is unavailable. Choose another producer.</p> : null}
      {undo && props.direction !== undo.suggestion ? <details className="prompt-original"><summary>Original direction</summary><p>{undo.original || "The direction was empty."}</p></details> : null}
      {message ? <p className="prompt-helper-message" role="status">{message}</p> : null}
      {props.direction.length > 30_000 ? <small>{props.direction.length.toLocaleString()} / 32,768</small> : null}
    </form>
    <Dialog open={optionsOpen} onOpenChange={setOptionsOpen}><DialogContent><DialogHeader><DialogTitle>Creation options</DialogTitle><DialogDescription>Choose how much detail to explore.</DialogDescription></DialogHeader><label className="direction-options">Depth <select value={props.profile} disabled={props.active || props.busy} onChange={(event) => props.onProfile(event.target.value as Props["profile"])}><option value="standard">Focused arrangement</option><option value="extended">Detailed composition</option></select></label></DialogContent></Dialog>
  </section>
}
