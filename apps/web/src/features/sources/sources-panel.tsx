import { useEffect, useRef, useState } from "react"
import { Mic, Play, Square, Upload, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { api, type Asset } from "@/lib/api"
import { startWavRecording, type RecordingSession } from "@/lib/record-wav"
import { SourcePlayer, useSourcePlayback } from "./source-player"

interface SourcesPanelProps {
  projectId: string
  assets: Asset[]
  selectedIds: string[]
  onSelection(ids: string[]): void
  onChanged(): Promise<void>
}

export function SourcesPanel({ projectId, assets, selectedIds, onSelection, onChanged }: SourcesPanelProps) {
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const sessionRef = useRef<RecordingSession | null>(null)
  const recordingAbortRef = useRef<AbortController | null>(null)
  const lifetime = useRef<AbortController | null>(null)
  const refreshRef = useRef(onChanged)
  refreshRef.current = onChanged
  const player = useSourcePlayback()

  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    // Recover an upload whose acknowledgement arrived after a previous close.
    void refreshRef.current().catch(() => undefined)
    return () => { controller.abort(); recordingAbortRef.current?.abort(); sessionRef.current?.discard(); sessionRef.current = null }
  }, [projectId])

  const upload = async (file: File) => {
    const signal = lifetime.current?.signal
    if (!signal || signal.aborted) return
    setBusy(true); setError(null)
    try {
      await api.upload(projectId, file, signal)
      // Refresh the owning room even if the sheet closed after acceptance.
      // The shell guards this read against navigation to a different room.
      await onChanged()
      if (!signal.aborted) setNotice("Sound added. Select it to use it in your next direction.")
    } catch (cause) {
      if (!signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to add this sound")
    } finally { if (!signal.aborted) setBusy(false); if (fileRef.current) fileRef.current.value = "" }
  }

  const record = async () => {
    const controller = new AbortController()
    recordingAbortRef.current = controller
    setBusy(true); setError(null); setNotice("Allow microphone access to record a sound.")
    player.clear()
    try {
      const session = await startWavRecording({
        signal: controller.signal,
        onLimitReached: () => { if (!controller.signal.aborted) setNotice("Recording limit reached. Choose Stop and use, or discard it.") }
      })
      if (controller.signal.aborted || lifetime.current?.signal.aborted) { session.discard(); return }
      sessionRef.current = session; setRecording(true)
      setNotice("Recording… up to 30 seconds. Stop and use when you're ready.")
    } catch (cause) {
      if (!controller.signal.aborted) { setNotice(null); setError(cause instanceof Error && cause.name !== "NotAllowedError" ? cause.message : "Microphone access was denied. You can still add a WAV.") }
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }

  const finishRecording = async () => {
    const session = sessionRef.current
    if (!session || busy) return
    setBusy(true)
    try {
      const file = await session.stop()
      sessionRef.current = null
      if (lifetime.current?.signal.aborted) return
      setRecording(false); setNotice(null)
      await upload(file)
    } catch (cause) {
      if (!lifetime.current?.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to save recording")
    } finally { if (!lifetime.current?.signal.aborted) setBusy(false) }
  }

  const discard = () => {
    recordingAbortRef.current?.abort(); sessionRef.current?.discard(); sessionRef.current = null
    setRecording(false); setBusy(false); setNotice(null)
  }

  return <section className="side-section" aria-label="Your sounds">
    <div className="section-heading"><h2>Your sounds</h2></div>
    <div className="source-add-actions">
      <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy || recording}><Upload /> Add WAV</Button>
      {recording ? <><Button onClick={() => void finishRecording()} disabled={busy}><Square /> Stop and use</Button><Button variant="ghost" onClick={discard} disabled={busy}><X /> Discard recording</Button></> : <Button variant="outline" onClick={() => void record()} disabled={busy}><Mic /> Record a sound</Button>}
    </div>
    <input ref={fileRef} className="sr-only" type="file" accept="audio/wav,.wav" aria-label="Upload a WAV source" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file) }} />
    {notice ? <p className="side-note" role="status">{notice}</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {assets.length ? <div className="source-card-list">{assets.map((asset) => <div className="source-card" key={asset.id}>
      <Button variant="ghost" size="icon" className="source-play" disabled={recording || busy} aria-label={`Play sound ${asset.name}`} onClick={() => void player.playItem({ id: asset.id, url: asset.audioUrl, label: asset.name, durationSeconds: asset.durationSeconds })}><Play /></Button>
      <div className="source-card-name"><strong>{asset.name}</strong><small>{Math.round(asset.durationSeconds)} seconds · your sound</small></div>
      <label className="source-select"><input type="checkbox" aria-label={`Use ${asset.name} in the next arrangement change`} checked={selectedIds.includes(asset.id)} onChange={(event) => onSelection(event.target.checked ? [...selectedIds, asset.id] : selectedIds.filter((id) => id !== asset.id))} /><span className="sr-only">Use in the next change</span></label>
    </div>)}</div> : <p className="side-empty">Add a sound if you want the producer to work with your own recording. You can also create from a direction alone.</p>}
    <SourcePlayer player={player} />
    <p className="side-note">Preview your original sounds here. Recordings stop at 30 seconds or 5 MB. Select sounds to include in your next direction.</p>
  </section>
}
