import { useCallback, useEffect, useRef, useState } from "react"
import { Pause, Play, RotateCcw, Undo2, Volume2 } from "lucide-react"
import WaveSurfer from "wavesurfer.js"

import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"

export interface PlaybackItem {
  kind: "source" | "revision"
  id: string
  url: string
  label: string
  durationSeconds: number
  peaks: number[]
}

function formatTime(seconds: number) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  return `${Math.floor(safe / 60)}:${Math.floor(safe % 60).toString().padStart(2, "0")}`
}

export function usePlayback() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const itemRef = useRef<PlaybackItem | null>(null)
  const [item, setItem] = useState<PlaybackItem | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolumeState] = useState(0.82)
  const [error, setError] = useState<string | null>(null)

  if (!audioRef.current && typeof Audio !== "undefined") {
    audioRef.current = new Audio()
    audioRef.current.preload = "metadata"
    audioRef.current.volume = 0.82
  }

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const time = () => setCurrentTime(audio.currentTime)
    const metadata = () => {
      const measured = Number.isFinite(audio.duration) ? audio.duration : 0
      setDuration(measured || itemRef.current?.durationSeconds || 0)
      if (audio.currentTime > measured && measured > 0) audio.currentTime = measured
    }
    const play = () => setPlaying(true)
    const pause = () => setPlaying(false)
    const ended = () => { setPlaying(false); setCurrentTime(audio.duration || 0) }
    const failed = () => { setPlaying(false); setError("This audio could not be played.") }
    audio.addEventListener("timeupdate", time)
    audio.addEventListener("loadedmetadata", metadata)
    audio.addEventListener("durationchange", metadata)
    audio.addEventListener("play", play)
    audio.addEventListener("pause", pause)
    audio.addEventListener("ended", ended)
    audio.addEventListener("error", failed)
    return () => {
      audio.pause()
      audio.removeEventListener("timeupdate", time)
      audio.removeEventListener("loadedmetadata", metadata)
      audio.removeEventListener("durationchange", metadata)
      audio.removeEventListener("play", play)
      audio.removeEventListener("pause", pause)
      audio.removeEventListener("ended", ended)
      audio.removeEventListener("error", failed)
    }
  }, [])

  const load = useCallback((next: PlaybackItem) => {
    const audio = audioRef.current
    itemRef.current = next
    setItem(next)
    setDuration(next.durationSeconds)
    setError(null)
    if (!audio || audio.dataset.identity === `${next.kind}:${next.id}`) return
    audio.pause()
    audio.dataset.identity = `${next.kind}:${next.id}`
    audio.src = next.url
    audio.load()
    setCurrentTime(0)
    setPlaying(false)
  }, [])

  const clear = useCallback(() => {
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.removeAttribute("src")
      delete audio.dataset.identity
      audio.load()
    }
    itemRef.current = null
    setItem(null)
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setError(null)
  }, [])

  const playItem = useCallback(async (next: PlaybackItem) => {
    load(next)
    const audio = audioRef.current
    if (!audio) return
    try { await audio.play(); setError(null) }
    catch { setPlaying(false); setError("Playback was blocked. Press Play when you are ready.") }
  }, [load])

  const toggle = useCallback(async () => {
    const audio = audioRef.current
    if (!audio || !itemRef.current) return
    if (!audio.paused) { audio.pause(); return }
    try { await audio.play(); setError(null) }
    catch { setPlaying(false); setError("Playback was blocked. Check browser audio permissions and try again.") }
  }, [])

  const seek = useCallback((value: number) => {
    const audio = audioRef.current
    if (!audio) return
    const maximum = Number.isFinite(audio.duration) ? audio.duration : itemRef.current?.durationSeconds ?? 0
    const clamped = Math.max(0, Math.min(value, maximum || 0))
    audio.currentTime = clamped
    setCurrentTime(clamped)
  }, [])

  const setVolume = useCallback((value: number) => {
    const clamped = Math.max(0, Math.min(1, value))
    if (audioRef.current) audioRef.current.volume = clamped
    setVolumeState(clamped)
  }, [])

  return { audio: audioRef.current, item, playing, currentTime, duration, volume, error, load, clear, playItem, toggle, seek, setVolume }
}

interface AudioPlayerProps {
  audio: HTMLAudioElement | null
  item: PlaybackItem
  playing: boolean
  currentTime: number
  duration: number
  volume: number
  error: string | null
  onToggle(): void
  onSeek(value: number): void
  onVolume(value: number): void
  onReturnToPiece?(): void
}

export function AudioPlayer({ audio, item, playing, currentTime, duration, volume, error, onToggle, onSeek, onVolume, onReturnToPiece }: AudioPlayerProps) {
  const waveformRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!waveformRef.current || !audio || duration <= 0 || item.peaks.length === 0) return
    const wave = WaveSurfer.create({
      container: waveformRef.current,
      media: audio,
      peaks: [item.peaks],
      duration,
      height: 88,
      waveColor: "#9fa79f",
      progressColor: "#25483b",
      cursorColor: "#b83f19",
      cursorWidth: 2,
      barWidth: 2,
      barGap: 3,
      barRadius: 2,
      normalize: false,
      interact: false
    })
    return () => wave.destroy()
  }, [audio, duration, item.id, item.peaks])

  const itemName = item.kind === "source" ? "source" : item.label.includes("· current") ? "current version" : item.label.toLowerCase()
  return (
    <div className="player-card">
      <div className="player-meta"><span>{item.label}</span><span>{formatTime(duration)} total</span></div>
      {item.kind === "source" && onReturnToPiece ? <Button className="mb-3" size="sm" variant="outline" onClick={onReturnToPiece}><Undo2 /> Return to current piece</Button> : null}
      <div className="waveframe" aria-hidden="true">
        {item.peaks.length > 0 ? <div ref={waveformRef} className="wave-canvas" data-testid="waveform" /> : <div className="wave-canvas grid place-items-center text-xs text-muted-foreground">Waveform unavailable for this source</div>}
      </div>
      <div className="seek-row">
        <span className="time">{formatTime(currentTime)}</span>
        <Slider aria-label={`Seek through the ${itemName}`} min={0} max={Math.max(duration, 1)} step={0.1} value={[Math.min(currentTime, Math.max(duration, 1))]} onValueChange={(value) => onSeek(Array.isArray(value) ? value[0] ?? 0 : value)} />
        <span className="time">-{formatTime(Math.max(0, duration - currentTime))}</span>
      </div>
      <div className="transport">
        <Button className="round-play" size="icon-lg" aria-label={playing ? `Pause ${itemName}` : `Play ${itemName}`} onClick={onToggle}>{playing ? <Pause /> : <Play />}</Button>
        <Button size="icon" variant="ghost" aria-label="Return to start" onClick={() => onSeek(0)}><RotateCcw /></Button>
        <Volume2 aria-hidden="true" className="ml-1 size-4 text-muted-foreground" />
        <Slider aria-label="Playback volume" className="max-w-28" min={0} max={1} step={0.05} value={[volume]} onValueChange={(value) => onVolume(Array.isArray(value) ? value[0] ?? .82 : value)} />
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
    </div>
  )
}
