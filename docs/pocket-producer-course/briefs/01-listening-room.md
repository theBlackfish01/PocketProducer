# Module 1: The Listening Room Journey

### Teaching Arc
- **Metaphor:** A recording studio control room: one desk hides many specialist rooms behind the glass.
- **Opening hook:** The listener types a direction and hears a playable version; trace that one click through the entire system.
- **Key insight:** The UI is a coordinator and display surface, not the music engine.
- **Why should I care?:** It tells you where a UI bug ends and a backend or worker bug begins.

### Code Snippets (pre-extracted)

File: apps/web/src/App.tsx (lines 106-115)
```tsx
  const submitDirection = async () => {
    if (draft.trim().length < 3) return
    setBusy(true); setError(null)
    try {
      const id = await ensureProject()
      const result = snapshot?.project.currentRevisionId
        ? await api.revise(id, snapshot.project.currentRevisionId, draft)
        : await api.generate(id, draft, snapshot?.assets[0]?.id)
      setJob(await api.job(result.jobId))
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to submit direction") }
```

File: apps/web/src/features/listening/audio-player.tsx (lines 33-45)
```tsx
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
```

### Interactive Elements
- [x] Code↔English translation of `submitDirection`.
- [x] Quiz: 3 scenario questions about separating UI/API/worker failures.
- [x] Data-flow animation: Listener → React UI → Fastify API → PostgreSQL queue → worker → audio files/database → browser player.
- [x] Visual actor cards: web, API, worker, core, PostgreSQL, providers.

### Reference Files to Read
- `references/interactive-elements.md` → Code ↔ English Translation Blocks, Message Flow / Data Flow Animation, Multiple-Choice Quizzes, Pattern/Feature Cards, Glossary Tooltips
- `references/design-system.md` → Module Structure, Responsive Breakpoints
- `references/content-philosophy.md` → all content rules
- `references/gotchas.md` → full checklist

### Connections
- Previous module: none; open with the concrete user action.
- Next module: API, Database, and Durable Jobs—zoom into the middle of the flow.
- Tone/style: warm developer notebook; vermillion accent; actors use Browser teal, API plum, Worker gold, PostgreSQL forest.
