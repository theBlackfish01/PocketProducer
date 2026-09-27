import { useCallback, useEffect, useRef, useState } from "react"
import { Pause, Play, RotateCcw, Volume2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"

export interface SourcePlaybackItem {
  id: string
  url: string
  label: string
  durationSeconds: number
}

function formatTime(seconds: number) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  return `${Math.floor(safe / 60)}:${Math.floor(safe % 60).toString().padStart(2, "0")}`
}

export function useSourcePlayback() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const itemRef = useRef<SourcePlaybackItem | null>(null)
  const [item, setItem] = useState<SourcePlaybackItem | null>(null)
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

  const load = useCallback((next: SourcePlaybackItem) => {
    const audio = audioRef.current
    itemRef.current = next
    setItem(next)
    setDuration(next.durationSeconds)
    setError(null)
    if (!audio || audio.dataset.identity === next.id) return
    audio.pause()
    audio.dataset.identity = next.id
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

  const playItem = useCallback(async (next: SourcePlaybackItem) => {
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

interface SourcePlayerProps {
  player: ReturnType<typeof useSourcePlayback>
}

export function SourcePlayer({ player }: SourcePlayerProps) {
  if (!player.item) return null
  const name = player.item.label
  return <div className="source-transport" aria-label={`Sound preview: ${name}`}>
    <div className="player-meta"><strong>{name}</strong><span>Source preview</span></div>
    <div className="seek-row">
      <span className="time">{formatTime(player.currentTime)}</span>
      <Slider aria-label={`Seek through source ${name}`} min={0} max={Math.max(player.duration, 1)} step={0.1} value={[Math.min(player.currentTime, Math.max(player.duration, 1))]} onValueChange={(value) => player.seek(Array.isArray(value) ? value[0] ?? 0 : value)} />
      <span className="time">{formatTime(player.duration)}</span>
    </div>
    <div className="transport">
      <Button size="icon" aria-label={`${player.playing ? "Pause" : "Play"} source ${name}`} onClick={() => void player.toggle()}>{player.playing ? <Pause /> : <Play />}</Button>
      <Button size="icon" variant="ghost" aria-label="Return source to start" onClick={() => player.seek(0)}><RotateCcw /></Button>
      <Volume2 aria-hidden="true" className="size-4 text-muted-foreground" />
      <Slider aria-label="Source volume" className="max-w-28" min={0} max={1} step={0.05} value={[player.volume]} onValueChange={(value) => player.setVolume(Array.isArray(value) ? value[0] ?? .82 : value)} />
    </div>
    {player.error ? <p role="alert" className="mt-3 text-sm text-destructive">{player.error}</p> : null}
  </div>
}
