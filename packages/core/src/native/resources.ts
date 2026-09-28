import { decodeWav, measureDecodedWav } from "../audio/wav.js";
import { canonicalHash } from "../domain/hash.js";

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

// Versioned, inspectable parameter hypotheses. These are executable SDK
// settings, not Audiotool presets or evidence that anyone has heard them.
export const NATIVE_RECIPE_VERSION = "local-palette-v2";
export const nativePresetRecipes = [
  { id: "soft-glass", name: "Soft glass", character: "Rounded sustained keys with a long attack", role: "harmony", provenance: "Pocket Producer original parameter recipe; unheard", device: { type: "heisenberg", parameters: { "operatorA.gain": 0.5, "operatorB.gain": 0.16, "operatorB.modulationFactorA": 0.18, "filter.cutoffFrequencyHz": 1700, "envelopeMain.attackTimeNormalized": 0.34, "envelopeMain.sustainFactor": 0.72 } }, effects: [{ type: "stompboxReverb", parameters: { roomSizeFactor: 0.58, mix: 0.23 } }] },
  { id: "low-hollow", name: "Low hollow", character: "Restrained low register with a soft edge", role: "bass", provenance: "Pocket Producer original parameter recipe; unheard", device: { type: "pulverisateur", parameters: { "filter.cutoffFrequencyHz": 640, "filter.resonance": 0.38 } }, effects: [{ type: "stompboxCompressor", parameters: { thresholdDb: -12, ratio: 0.4 } }] },
  { id: "short-echo", name: "Short echo", character: "Dry phrase with a restrained rhythmic reply", role: "lead", provenance: "Pocket Producer original parameter recipe; unheard", device: { type: "heisenberg", parameters: { "filter.cutoffFrequencyHz": 3200, "envelopeMain.sustainFactor": 0.42 } }, effects: [{ type: "stompboxDelay", parameters: { feedbackFactor: 0.22, mix: 0.18, stepCount: 2 } }] },
  { id: "rubber-pulse", name: "Rubber pulse", character: "Short syncopated bass with upper harmonics", role: "bass", provenance: "Pocket Producer original parameter recipe; unheard", device: { type: "heisenberg", parameters: { "operatorA.gain": 0.65, "operatorB.gain": 0.2, "operatorB.modulationFactorA": 0.32, "filter.cutoffFrequencyHz": 1100, "envelopeMain.decayTimeNormalized": 0.19, "envelopeMain.sustainFactor": 0.32 } }, effects: [{ type: "stompboxCompressor", parameters: { thresholdDb: -16, ratio: 0.45 } }] },
  { id: "bright-stabs", name: "Bright stabs", character: "Brief chord accents that can open during a build", role: "harmony", provenance: "Pocket Producer original parameter recipe; unheard", device: { type: "heisenberg", parameters: { "operatorA.gain": 0.55, "operatorB.gain": 0.24, "operatorB.modulationFactorA": 0.25, "filter.cutoffFrequencyHz": 3900, "envelopeMain.decayTimeNormalized": 0.17, "envelopeMain.sustainFactor": 0.27 } }, effects: [{ type: "stompboxChorus", parameters: { delayTimeMs: 28, lfoFrequencyHz: 0.65, lfoModulationDepth: 0.23 } }] },
  { id: "airline", name: "Airline", character: "A higher sustained counterline with room to breathe", role: "lead", provenance: "Pocket Producer original parameter recipe; unheard", device: { type: "heisenberg", parameters: { "operatorA.gain": 0.51, "operatorB.gain": 0.11, "filter.cutoffFrequencyHz": 4800, "envelopeMain.attackTimeNormalized": 0.11, "envelopeMain.sustainFactor": 0.68 } }, effects: [{ type: "stompboxReverb", parameters: { roomSizeFactor: 0.46, mix: 0.17 } }] },
  { id: "dry-step-kit", name: "Dry step kit", character: "Four fixed drum voices for a simple, editable pulse; steps are on/off", role: "drums", provenance: "Pocket Producer original parameter recipe; not a Gakki kit and unheard", device: { type: "beatbox8", parameters: { "bassdrum.gain": 0.82, "bassdrum.decay": 0.28, "snaredrum.gain": 0.66, "snaredrum.snappy": 0.57, "openHihat.decay": 0.24 } }, effects: [] }
] as const;

const recipeGuidance: Record<(typeof nativePresetRecipes)[number]["id"], { register: string; articulation: string; usefulMotion: string; failureMode: string }> = {
  "soft-glass": { register: "Middle register, roughly C4–C6", articulation: "Long notes with gaps; avoid stacking every beat", usefulMotion: "Bring the filter forward gradually only after a quiet opening", failureMode: "A long attack can blur fast chord changes" },
  "low-hollow": { register: "Low register, roughly C2–C4", articulation: "Short bass responses and held roots", usefulMotion: "Modest cutoff movement rather than a full-range sweep", failureMode: "Low cutoff can hide pitch definition" },
  "short-echo": { register: "Middle to upper lead register", articulation: "Short calls with deliberate rests", usefulMotion: "Increase echo send for a phrase ending", failureMode: "Repeated replies may crowd the next downbeat" },
  "rubber-pulse": { register: "Bass register, roughly C2–C4", articulation: "Syncopated notes with varied lengths", usefulMotion: "Open the filter on a later return", failureMode: "Very low notes or long sustains can muddy the groove" },
  "bright-stabs": { register: "Middle chord register", articulation: "Brief offbeat voicings with unplayed beats", usefulMotion: "A bounded filter rise over several phrases", failureMode: "Dense voicings plus chorus can mask the lead" },
  airline: { register: "Upper melodic register", articulation: "Spaced call and response", usefulMotion: "Bring in the shared reverb on selected phrases", failureMode: "Sustained high notes can dominate a sparse texture" },
  "dry-step-kit": { register: "Four mapped drum voices only", articulation: "On/off kick, snare and hats; do not claim velocity expression", usefulMotion: "Add/remove steps or a brief gap before an arrival", failureMode: "This is not a resolved Gakki drum kit or humanized performance" }
};

function recipeEvidence(recipe: (typeof nativePresetRecipes)[number]) {
  return { version: NATIVE_RECIPE_VERSION, configurationHash: canonicalHash({ version: NATIVE_RECIPE_VERSION, device: recipe.device, effects: recipe.effects }), usageTerms: "Original Pocket Producer parameter settings; Audiotool device/use terms still apply", auditionStatus: "unheard" as const, guidance: recipeGuidance[recipe.id] };
}

export function readNativeRecipe(id: string) {
  const recipe = nativePresetRecipes.find((item) => item.id === id);
  if (!recipe) throw new Error("Unknown local sound recipe; search resources first");
  return { ...recipe, ...recipeEvidence(recipe), verified: "canonical-to-offline-Nexus mapping only", heard: false, applyWith: "Use setDevice and addEffect with fresh IDs; adapt to the brief and inspect the mapped result" };
}

export function searchNativeResources(query: string, sources: Array<{ assetId: string; name?: string; assetHash: string; durationSeconds: number; rights: string; profile?: NativeSourceProfile }>) {
  const normalized = query.trim().toLowerCase();
  const terms = [...new Set(normalized.match(/[a-z0-9]+/g) ?? [])].filter((term) => !["a", "the", "for", "with", "and", "sound", "sounds", "synth"].includes(term));
  const score = (text: string) => { const haystack = text.toLowerCase(); return (normalized && haystack.includes(normalized) ? 10 : 0) + terms.filter((term) => haystack.includes(term)).length; };
  const recipes = nativePresetRecipes.map((value) => ({ value, score: score(`${value.name} ${value.id} ${value.character} ${value.role} ${value.device.type}`) })).filter((item) => !terms.length || item.score > 0).sort((a, b) => b.score - a.score || a.value.id.localeCompare(b.value.id)).slice(0, 6);
  return {
    ownedSamples: sources.filter((value) => !normalized || `${value.name ?? ""} ${value.assetId}`.toLowerCase().includes(normalized)).slice(0, 16).map((value) => ({ ...value, provenance: "selected owned source", state: "local-ready/remote-unverified" as const })),
    presetRecipes: recipes.map(({ value }) => ({ ...value, ...recipeEvidence(value), heard: false })),
    guidance: recipes.length ? "Choose one relevant recipe, adapt its mapped settings and construct. Recipes are not heard evidence." : "No matching local recipe. Try bass, harmony, lead or drums; built-in devices remain available.",
    remoteLibrary: "not queried; an Audiotool catalogue result is not an owned or selected source"
  };
}
