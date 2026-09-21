function encodeMono(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index))
  }
  text(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); text(8, "WAVE"); text(12, "fmt "); view.setUint32(16, 16, true)
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, samples.length * 2, true)
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32_767), true))
  return new Blob([buffer], { type: "audio/wav" })
}

export interface RecordingSession {
  readonly maxSeconds: number
  readonly stoppedByLimit: boolean
  stop(): Promise<File>
  discard(): void
}

export interface RecordingOptions {
  maxSeconds?: number
  maxBytes?: number
  signal?: AbortSignal
  onLimitReached?(): void
}

function abortError(): DOMException {
  return new DOMException("Recording was cancelled", "AbortError")
}

export async function startWavRecording(options: RecordingOptions = {}): Promise<RecordingSession> {
  const maxSeconds = Math.min(60, Math.max(1, options.maxSeconds ?? 30))
  const maxBytes = Math.min(10 * 1024 * 1024, Math.max(46, options.maxBytes ?? 5 * 1024 * 1024))
  if (options.signal?.aborted) throw abortError()
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false } })
  const stopTracks = () => stream.getTracks().forEach((track) => track.stop())
  if (options.signal?.aborted) {
    stopTracks()
    throw abortError()
  }

  let context: AudioContext | undefined
  let source: MediaStreamAudioSourceNode | undefined
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- bounded compatibility path until the AudioWorklet asset is served
  let processor: ScriptProcessorNode | undefined
  let wallClockTimer: ReturnType<typeof setTimeout> | undefined
  let captureStop: Promise<void> | undefined
  let discarded = false
  let reachedLimit = false
  const chunks: Float32Array[] = []
  let capturedFrames = 0

  const stopCapture = (): Promise<void> => {
    if (captureStop) return captureStop
    captureStop = (async () => {
      if (wallClockTimer !== undefined) globalThis.clearTimeout(wallClockTimer)
      options.signal?.removeEventListener("abort", discard)
      if (processor) {
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- bounded compatibility path until the AudioWorklet asset is served
        processor.onaudioprocess = null
        try { processor.disconnect() } catch { /* already disconnected */ }
      }
      if (source) {
        try { source.disconnect() } catch { /* already disconnected */ }
      }
      stopTracks()
      if (context) await context.close().catch(() => undefined)
    })()
    return captureStop
  }
  const discard = () => {
    discarded = true
    chunks.length = 0
    void stopCapture()
  }

  try {
    context = new AudioContext()
    source = context.createMediaStreamSource(stream)
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- bounded compatibility path until the AudioWorklet asset is served
    processor = context.createScriptProcessor(4096, 1, 1)
    const maxFrames = Math.min(Math.floor(context.sampleRate * maxSeconds), Math.floor((maxBytes - 44) / 2))
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- bounded compatibility path until the AudioWorklet asset is served
    processor.onaudioprocess = (event) => {
      if (discarded || captureStop || capturedFrames >= maxFrames) return
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- see the bounded ScriptProcessor compatibility note above
      const input = event.inputBuffer.getChannelData(0)
      const count = Math.min(input.length, maxFrames - capturedFrames)
      if (count > 0) {
        chunks.push(new Float32Array(input.subarray(0, count)))
        capturedFrames += count
      }
      if (capturedFrames >= maxFrames) {
        reachedLimit = true
        void stopCapture().then(() => options.onLimitReached?.())
      }
    }
    source.connect(processor)
    processor.connect(context.destination)
    if (context.state === "suspended") await context.resume()
    if (options.signal?.aborted) { discard(); throw abortError() }
    options.signal?.addEventListener("abort", discard, { once: true })
    wallClockTimer = globalThis.setTimeout(() => {
      reachedLimit = true
      void stopCapture().then(() => options.onLimitReached?.())
    }, maxSeconds * 1_000)
  } catch (error) {
    await stopCapture()
    throw error
  }

  let completedFile: Promise<File> | undefined
  const finish = async () => {
    await stopCapture()
    if (discarded) throw new Error("Recording was discarded")
    if (capturedFrames === 0) throw new Error("No audio was captured")
    const samples = new Float32Array(capturedFrames)
    let offset = 0
    for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length }
    chunks.length = 0
    return new File([encodeMono(samples, context?.sampleRate ?? 48_000)], `recording-${new Date().toISOString().replace(/[:.]/g, "-")}.wav`, { type: "audio/wav" })
  }
  return {
    maxSeconds,
    get stoppedByLimit() { return reachedLimit },
    stop: () => { completedFile ??= finish(); return completedFile },
    discard
  }
}
