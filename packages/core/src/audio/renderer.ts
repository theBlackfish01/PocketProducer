import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { canonicalHash, type Composition } from "../domain/composition.js";
import { decodeWav, encodeWav, mono } from "./wav.js";

const SAMPLE_RATE = 48_000;

function gain(db: number): number {
  return 10 ** (db / 20);
}

function midiFrequency(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

function namedMidi(note: string): number {
  const match = /^([A-G])([b#]?)(-?\d)$/.exec(note);
  if (!match) return 48;
  const names: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const accidental = match[2] === "b" ? -1 : match[2] === "#" ? 1 : 0;
  return (Number(match[3]) + 1) * 12 + (names[match[1]!] ?? 0) + accidental;
}

function pseudoNoise(length: number, seed: number): Float32Array {
  const result = new Float32Array(length);
  let state = seed || 1;
  for (let index = 0; index < length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    result[index] = ((state >>> 0) / 2_147_483_648 - 1);
  }
  return result;
}

function builtin(assetId: string, seconds: number, seed: number): Float32Array {
  const frames = Math.max(1, Math.ceil(seconds * SAMPLE_RATE));
  const output = new Float32Array(frames);
  if (assetId === "builtin:kick") {
    for (let i = 0; i < frames; i += 1) {
      const t = i / SAMPLE_RATE;
      output[i] = Math.sin(2 * Math.PI * (48 + 82 * Math.exp(-t * 26)) * t) * Math.exp(-t * 11);
    }
  } else if (assetId === "builtin:snare" || assetId === "builtin:hat") {
    const noise = pseudoNoise(frames, seed + assetId.length);
    const decay = assetId.endsWith("hat") ? 45 : 17;
    for (let i = 1; i < frames; i += 1) {
      const t = i / SAMPLE_RATE;
      const high = noise[i]! - noise[i - 1]! * 0.82;
      output[i] = high * Math.exp(-t * decay) * (assetId.endsWith("hat") ? 0.4 : 0.7);
    }
  } else {
    const suffix = assetId.split(":").at(-1) ?? "C3";
    const note = Number.isFinite(Number(suffix)) ? Number(suffix) : namedMidi(suffix);
    const frequency = midiFrequency(note);
    for (let i = 0; i < frames; i += 1) {
      const t = i / SAMPLE_RATE;
      const attack = Math.min(1, t / 0.018);
      const release = Math.min(1, (seconds - t) / 0.16);
      const tone = Math.sin(2 * Math.PI * frequency * t) + 0.24 * Math.sin(2 * Math.PI * frequency * 2 * t);
      output[i] = tone * 0.42 * attack * Math.max(0, release);
    }
  }
  return output;
}

function resampleLinear(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === SAMPLE_RATE) return input;
  const output = new Float32Array(Math.ceil(input.length * SAMPLE_RATE / inputRate));
  for (let index = 0; index < output.length; index += 1) {
    const position = index * inputRate / SAMPLE_RATE;
    const left = Math.floor(position);
    const fraction = position - left;
    output[index] = (input[left] ?? 0) * (1 - fraction) + (input[Math.min(left + 1, input.length - 1)] ?? 0) * fraction;
  }
  return output;
}

export interface RenderAsset {
  id: string;
  path: string;
}

export interface RenderResult {
  compositionHash: string;
  previewPath: string;
  stems: Record<string, string>;
  durationSeconds: number;
  sampleRate: number;
  peak: number;
  rms: number;
  nonSilentRatio: number;
  waveformPeaks: number[];
}

export interface RenderOptions {
  signal?: AbortSignal;
  checkpoint?: () => Promise<void>;
}

async function renderCheckpoint(options: RenderOptions): Promise<void> {
  if (options.signal?.aborted) throw Object.assign(new Error("Rendering aborted"), { code: "CANCELLED" });
  await options.checkpoint?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
}

export async function renderComposition(composition: Composition, outputDirectory: string, assets: RenderAsset[], options: RenderOptions = {}): Promise<RenderResult> {
  const secondsPerTick = 60 / composition.tempoBpm / composition.ppq;
  const durationSeconds = composition.durationTicks * secondsPerTick + composition.tailSeconds;
  const frames = Math.ceil(durationSeconds * SAMPLE_RATE);
  const masterLeft = new Float32Array(frames);
  const masterRight = new Float32Array(frames);
  const stems: Record<string, string> = {};
  const sourceCache = new Map<string, Float32Array>();

  await mkdir(outputDirectory, { recursive: true });
  for (const track of composition.tracks) {
    await renderCheckpoint(options);
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    for (const item of track.events) {
      const eventSeconds = item.durationTicks * secondsPerTick;
      let sample: Float32Array;
      if (item.assetId.startsWith("source:")) {
        const id = item.assetId.slice("source:".length);
        const asset = assets.find((candidate) => candidate.id === id);
        if (!asset) throw new Error(`Missing source asset ${id}`);
        const cached = sourceCache.get(id);
        if (cached) sample = cached;
        else {
          const decoded = decodeWav(await readFile(asset.path));
          sample = resampleLinear(mono(decoded), decoded.sampleRate);
          sourceCache.set(id, sample);
        }
      } else {
        sample = builtin(item.assetId, eventSeconds, composition.seed + item.startTick);
      }
      const startFrame = Math.round(item.startTick * secondsPerTick * SAMPLE_RATE);
      const eventGain = gain(item.gainDb + track.gainDb);
      const leftGain = eventGain * Math.sqrt((1 - track.pan) / 2);
      const rightGain = eventGain * Math.sqrt((1 + track.pan) / 2);
      const maximum = Math.min(sample.length, frames - startFrame, Math.ceil(eventSeconds * SAMPLE_RATE));
      for (let i = 0; i < maximum; i += 1) {
        const fade = Math.min(1, i / 96, (maximum - i) / 96);
        left[startFrame + i] = (left[startFrame + i] ?? 0) + (sample[i] ?? 0) * leftGain * fade;
        right[startFrame + i] = (right[startFrame + i] ?? 0) + (sample[i] ?? 0) * rightGain * fade;
      }
      if (item.startTick % (composition.ppq * 4) === 0) await renderCheckpoint(options);
    }
    const stemPath = join(outputDirectory, `${track.id}.wav`);
    await writeFile(stemPath, encodeWav(left, right, SAMPLE_RATE));
    stems[track.id] = stemPath;
    for (let start = 0; start < frames; start += 131_072) {
      const end = Math.min(frames, start + 131_072);
      for (let i = start; i < end; i += 1) {
        masterLeft[i] = (masterLeft[i] ?? 0) + (left[i] ?? 0);
        masterRight[i] = (masterRight[i] ?? 0) + (right[i] ?? 0);
      }
      await renderCheckpoint(options);
    }
  }

  let peak = 0;
  let squareSum = 0;
  let nonSilent = 0;
  for (let start = 0; start < frames; start += 131_072) {
    const end = Math.min(frames, start + 131_072);
    for (let i = start; i < end; i += 1) peak = Math.max(peak, Math.abs(masterLeft[i] ?? 0), Math.abs(masterRight[i] ?? 0));
    await renderCheckpoint(options);
  }
  const safety = peak > 0.92 ? 0.92 / peak : 1;
  const buckets = 240;
  const waveformPeaks = Array.from({ length: buckets }, () => 0);
  for (let start = 0; start < frames; start += 131_072) {
    const end = Math.min(frames, start + 131_072);
    for (let i = start; i < end; i += 1) {
      masterLeft[i] = Math.tanh((masterLeft[i] ?? 0) * safety);
      masterRight[i] = Math.tanh((masterRight[i] ?? 0) * safety);
      const value = Math.max(Math.abs(masterLeft[i] ?? 0), Math.abs(masterRight[i] ?? 0));
      squareSum += value * value;
      if (value > 0.0005) nonSilent += 1;
      const bucket = Math.min(buckets - 1, Math.floor(i / frames * buckets));
      waveformPeaks[bucket] = Math.max(waveformPeaks[bucket] ?? 0, value);
    }
    await renderCheckpoint(options);
  }
  const previewPath = join(outputDirectory, "preview.wav");
  await mkdir(dirname(previewPath), { recursive: true });
  await writeFile(previewPath, encodeWav(masterLeft, masterRight, SAMPLE_RATE));
  return {
    compositionHash: canonicalHash(composition),
    previewPath,
    stems,
    durationSeconds,
    sampleRate: SAMPLE_RATE,
    peak: Math.max(...waveformPeaks),
    rms: Math.sqrt(squareSum / frames),
    nonSilentRatio: nonSilent / frames,
    waveformPeaks
  };
}
