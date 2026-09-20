import { useCallback, useEffect, useRef, useState } from "react"
import { Pause, Play, RotateCcw, Volume2 } from "lucide-react"
import WaveSurfer from "wavesurfer.js"

import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"

function formatTime(seconds: number) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  return `${Math.floor(safe / 60)}:${Math.floor(safe % 60).toString().padStart(2, "0")}`
}

export function usePlayback() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState<string | null>(null)

  if (!audioRef.current && typeof Audio !== "undefined") audioRef.current = new Audio()

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const time = () => setCurrentTime(audio.currentTime)
    const metadata = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
    const ended = () => setPlaying(false)
    const failed = () => { setPlaying(false); setError("This audio could not be played.") }
    audio.addEventListener("timeupdate", time); audio.addEventListener("loadedmetadata", metadata); audio.addEventListener("ended", ended); audio.addEventListener("error", failed)
    return () => { audio.pause(); audio.removeEventListener("timeupdate", time); audio.removeEventListener("loadedmetadata", metadata); audio.removeEventListener("ended", ended); audio.removeEventListener("error", failed) }
  }, [])

  const load = useCallback((url: string, keepPosition = true) => {
    const audio = audioRef.current
    if (!audio || audio.dataset.url === url) return
    const previous = keepPosition ? audio.currentTime : 0
    audio.pause(); audio.dataset.url = url; audio.src = url; audio.load(); audio.currentTime = previous; setCurrentTime(previous); setPlaying(false); setError(null)
  }, [])
  const toggle = useCallback(async () => {
    const audio = audioRef.current; if (!audio) return
    if (audio.paused) { await audio.play(); setPlaying(true) } else { audio.pause(); setPlaying(false) }
  }, [])
  const seek = useCallback((value: number) => { const audio = audioRef.current; if (audio) { audio.currentTime = value; setCurrentTime(value) } }, [])
  const setVolume = useCallback((value: number) => { if (audioRef.current) audioRef.current.volume = value }, [])
  return { audio: audioRef.current, playing, currentTime, duration, error, load, toggle, seek, setVolume }
}

interface AudioPlayerProps {
  audio: HTMLAudioElement | null
  playing: boolean
  currentTime: number
  duration: number
  error: string | null
  peaks: number[]
  versionLabel: string
  onToggle(): void
  onSeek(value: number): void
  onVolume(value: number): void
}

export function AudioPlayer({ audio, playing, currentTime, duration, error, peaks, versionLabel, onToggle, onSeek, onVolume }: AudioPlayerProps) {
  const waveformRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!waveformRef.current || !audio || duration <= 0) return
    const wave = WaveSurfer.create({
      container: waveformRef.current,
      media: audio,
      peaks: [peaks.length > 0 ? peaks : [0]],
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
  }, [audio, duration, peaks])

  return (
    <div className="player-card">
      <div className="player-meta"><span>{versionLabel}</span><span>{formatTime(duration)} total</span></div>
      <div className="waveframe" aria-hidden="true"><div ref={waveformRef} className="wave-canvas" data-testid="waveform" /></div>
      <div className="seek-row">
        <span className="time">{formatTime(currentTime)}</span>
        <Slider aria-label="Seek through the current version" min={0} max={Math.max(duration, 1)} step={0.1} value={[Math.min(currentTime, Math.max(duration, 1))]} onValueChange={(value) => onSeek(Array.isArray(value) ? value[0] ?? 0 : value)} />
        <span className="time">-{formatTime(Math.max(0, duration - currentTime))}</span>
      </div>
      <div className="transport">
        <Button className="round-play" size="icon-lg" aria-label={playing ? "Pause current version" : "Play current version"} onClick={onToggle}>{playing ? <Pause /> : <Play />}</Button>
        <Button size="icon" variant="ghost" aria-label="Return to start" onClick={() => onSeek(0)}><RotateCcw /></Button>
        <Volume2 aria-hidden="true" className="ml-1 size-4 text-muted-foreground" />
        <Slider aria-label="Playback volume" className="max-w-28" min={0} max={1} step={0.05} defaultValue={[0.82]} onValueChange={(value) => onVolume(Array.isArray(value) ? value[0] ?? .82 : value)} />
      </div>
      {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
    </div>
  )
}
