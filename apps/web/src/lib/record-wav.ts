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

export interface RecordingSession { stop(): Promise<File>; discard(): void }

export async function startWavRecording(): Promise<RecordingSession> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false } });
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  // ScriptProcessor remains the compatibility fallback until the AudioWorklet asset is served separately.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const processor = context.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  processor.onaudioprocess = (event) => chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  source.connect(processor); processor.connect(context.destination);
  const finish = async (use: boolean) => {
    processor.disconnect(); source.disconnect(); stream.getTracks().forEach((track) => track.stop()); await context.close();
    if (!use) return null;
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0); const samples = new Float32Array(length); let offset = 0;
    for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
    return new File([encodeMono(samples, context.sampleRate)], `recording-${new Date().toISOString().replace(/[:.]/g, "-")}.wav`, { type: "audio/wav" });
  };
  return { stop: async () => { const file = await finish(true); if (!file) throw new Error("Recording unavailable"); return file; }, discard: () => { void finish(false); } };
}
