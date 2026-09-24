import { decodeWav, measureDecodedWav } from "../audio/wav.js";

export interface NativeSourceSegment { startSeconds: number; endSeconds: number; rms: number; nonSilentRatio: number }
export interface NativeSourceProfile { durationSeconds: number; peak: number; rms: number; segments: NativeSourceSegment[] }

export function profileOwnedSourceWav(bytes: Buffer): NativeSourceProfile {
  const audio = decodeWav(bytes);
  const whole = measureDecodedWav(audio);
  const segments: NativeSourceSegment[] = [];
  const count = Math.min(8, Math.max(1, Math.ceil(audio.durationSeconds / 2)));
  for (let index = 0; index < count; index++) {
    const first = Math.floor(index * audio.frames / count);
    const last = Math.floor((index + 1) * audio.frames / count);
    const slice = { ...audio, frames: last - first, durationSeconds: (last - first) / audio.sampleRate, channels: audio.channels.map((channel) => channel.subarray(first, last)) };
    const measured = measureDecodedWav(slice);
    segments.push({ startSeconds: first / audio.sampleRate, endSeconds: last / audio.sampleRate, rms: Number(measured.rms.toFixed(5)), nonSilentRatio: Number(measured.nonSilentRatio.toFixed(3)) });
  }
  return { durationSeconds: audio.durationSeconds, peak: Number(whole.peak.toFixed(5)), rms: Number(whole.rms.toFixed(5)), segments };
}

export const nativePresetRecipes = [
  { id: "soft-glass", name: "Soft glass", provenance: "Pocket Producer local parameter recipe", device: { type: "heisenberg", parameters: { "operatorA.gain": 0.25, "filter.cutoffFrequencyHz": 1700, "envelopeMain.attackTimeNormalized": 0.34 } }, effects: [{ type: "stompboxReverb", parameters: { roomSizeFactor: 0.58, mix: 0.23 } }] },
  { id: "low-hollow", name: "Low hollow", provenance: "Pocket Producer local parameter recipe", device: { type: "pulverisateur", parameters: { "filter.cutoffFrequencyHz": 640, "filter.resonance": 0.38 } }, effects: [{ type: "stompboxCompressor", parameters: { thresholdDb: -12, ratio: 0.4 } }] },
  { id: "short-echo", name: "Short echo", provenance: "Pocket Producer local effect recipe", device: { type: "heisenberg", parameters: { "filter.cutoffFrequencyHz": 3200 } }, effects: [{ type: "stompboxDelay", parameters: { feedbackFactor: 0.22, mix: 0.18, stepCount: 2 } }] }
] as const;

export function searchNativeResources(query: string, sources: Array<{ assetId: string; name?: string; assetHash: string; durationSeconds: number; rights: string; profile?: NativeSourceProfile }>) {
  const normalized = query.trim().toLowerCase();
  return {
    ownedSamples: sources.filter((value) => !normalized || `${value.name ?? ""} ${value.assetId}`.toLowerCase().includes(normalized)).slice(0, 16).map((value) => ({ ...value, provenance: "selected owned source", state: "local-ready/remote-unverified" as const })),
    presetRecipes: nativePresetRecipes.filter((value) => !normalized || `${value.name} ${value.id} ${value.device.type}`.toLowerCase().includes(normalized)),
    remoteLibrary: "not queried; an Audiotool catalogue result is not an owned or selected source"
  };
}
