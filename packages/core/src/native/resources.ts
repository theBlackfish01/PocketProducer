import { decodeWav, measureDecodedWav } from "../audio/wav.js";

export interface NativeSourceSegment { startSeconds: number; endSeconds: number; rms: number; nonSilentRatio: number }
export interface NativeSourceProfile { durationSeconds: number; peak: number; rms: number; nonSilentRatio: number; segments: NativeSourceSegment[]; leadingSilenceSeconds: number; suggestedSlices: Array<{ startSeconds: number; endSeconds: number; reason: string }>; limitations: string }

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
  const windowFrames = Math.max(1, Math.floor(audio.sampleRate / 8));
  const windows: Array<{ start: number; end: number; rms: number }> = [];
  for (let first = 0; first < audio.frames; first += windowFrames) {
    const last = Math.min(audio.frames, first + windowFrames);
    let energy = 0;
    for (const channel of audio.channels) for (let frame = first; frame < last; frame++) energy += channel[frame]! ** 2;
    windows.push({ start: first / audio.sampleRate, end: last / audio.sampleRate, rms: Math.sqrt(energy / ((last - first) * audio.channels.length)) });
  }
  const activityThreshold = Math.max(0.008, whole.rms * 0.35);
  const firstActive = windows.find((window) => window.rms >= activityThreshold);
  const leadingSilenceSeconds = firstActive?.start ?? audio.durationSeconds;
  const ranked = windows.map((window, index) => ({ ...window, score: window.rms - (windows[index - 1]?.rms ?? 0) * 0.4 })).filter((window) => window.rms >= activityThreshold).sort((a, b) => b.score - a.score);
  const suggestedSlices: NativeSourceProfile["suggestedSlices"] = [];
  for (const window of ranked) {
    const startSeconds = Number(window.start.toFixed(3));
    if (suggestedSlices.some((slice) => Math.abs(slice.startSeconds - startSeconds) < 0.35)) continue;
    suggestedSlices.push({ startSeconds, endSeconds: Number(Math.min(audio.durationSeconds, window.end + 0.25).toFixed(3)), reason: "Measured activity/onset candidate; inspect before placement" });
    if (suggestedSlices.length === 6) break;
  }
  suggestedSlices.sort((a, b) => a.startSeconds - b.startSeconds);
  return { durationSeconds: audio.durationSeconds, peak: Number(whole.peak.toFixed(5)), rms: Number(whole.rms.toFixed(5)), nonSilentRatio: Number(whole.nonSilentRatio.toFixed(3)), segments, leadingSilenceSeconds: Number(leadingSilenceSeconds.toFixed(3)), suggestedSlices, limitations: "Energy-based candidates only; tempo, pitch, instrument identity and rights are not inferred." };
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
