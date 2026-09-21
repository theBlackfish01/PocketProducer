function encodeMono(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  text(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); text(8, "WAVE"); text(12, "fmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32_767), true));
  return new Blob([buffer], { type: "audio/wav" });
}

export interface RecordingSession {
  readonly maxSeconds: number
  stop(): Promise<File>
  discard(): void
}

export interface RecordingOptions { maxSeconds?: number; maxBytes?: number }

export async function startWavRecording(options: RecordingOptions = {}): Promise<RecordingSession> {
  const maxSeconds = Math.min(60, Math.max(1, options.maxSeconds ?? 30))
  const maxBytes = Math.min(10 * 1024 * 1024, Math.max(46, options.maxBytes ?? 5 * 1024 * 1024))
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false } });
  let context: AudioContext
  let source: MediaStreamAudioSourceNode
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- bounded compatibility path until the AudioWorklet asset is served
  let processor: ScriptProcessorNode
  try {
    context = new AudioContext();
    source = context.createMediaStreamSource(stream);
    // ScriptProcessor remains the compatibility fallback until the AudioWorklet asset is served separately.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    processor = context.createScriptProcessor(4096, 1, 1);
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop())
    throw error
  }
  const chunks: Float32Array[] = [];
  const maxFrames = Math.min(Math.floor(context.sampleRate * maxSeconds), Math.floor((maxBytes - 44) / 2))
  let capturedFrames = 0
  let captureStop: Promise<void> | null = null
  let discarded = false
  let completedFile: Promise<File> | null = null

  const stopCapture = () => {
    if (captureStop) return captureStop
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- bounded compatibility path until the AudioWorklet asset is served
    processor.onaudioprocess = null
    try { processor.disconnect() } catch { /* already disconnected */ }
    try { source.disconnect() } catch { /* already disconnected */ }
    stream.getTracks().forEach((track) => track.stop())
    captureStop = context.close().catch(() => undefined)
    return captureStop
  }

  // eslint-disable-next-line @typescript-eslint/no-deprecated
  processor.onaudioprocess = (event) => {
    if (discarded || capturedFrames >= maxFrames) return
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- see the bounded ScriptProcessor compatibility note above
    const input = event.inputBuffer.getChannelData(0)
    const remaining = maxFrames - capturedFrames
    const chunk = new Float32Array(input.subarray(0, Math.min(input.length, remaining)))
    chunks.push(chunk)
    capturedFrames += chunk.length
    if (capturedFrames >= maxFrames) void stopCapture()
  };
  source.connect(processor); processor.connect(context.destination);
  if (context.state === "suspended") {
    try { await context.resume() }
    catch (error) { await stopCapture(); throw error }
  }

  const finish = async () => {
    await stopCapture()
    if (discarded) throw new Error("Recording was discarded")
    if (capturedFrames === 0) throw new Error("No audio was captured")
    const samples = new Float32Array(capturedFrames); let offset = 0;
    for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
    chunks.length = 0
    return new File([encodeMono(samples, context.sampleRate)], `recording-${new Date().toISOString().replace(/[:.]/g, "-")}.wav`, { type: "audio/wav" });
  };
  return {
    maxSeconds,
    stop: () => { completedFile ??= finish(); return completedFile },
    discard: () => { discarded = true; chunks.length = 0; void stopCapture() }
  };
}
