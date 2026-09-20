import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { encodeWav } from "@pocket/core";

const sampleRate = 48_000;
const seconds = 4;
const frames = sampleRate * seconds;
const left = new Float32Array(frames);
const right = new Float32Array(frames);
let noiseState = 73;

for (let frame = 0; frame < frames; frame += 1) {
  const t = frame / sampleRate;
  const beatTime = t % 0.5;
  noiseState ^= noiseState << 13;
  noiseState ^= noiseState >>> 17;
  noiseState ^= noiseState << 5;
  const noise = (noiseState >>> 0) / 2_147_483_648 - 1;
  const click = noise * Math.exp(-beatTime * 52) * 0.24;
  const tone = Math.sin(2 * Math.PI * 196 * t) * Math.exp(-beatTime * 9) * 0.08;
  left[frame] = click + tone;
  right[frame] = click * 0.88 + tone;
}

const directory = resolve(process.cwd(), ".local", "fixtures");
const path = resolve(directory, "owned-percussion.wav");
await mkdir(directory, { recursive: true });
await writeFile(path, encodeWav(left, right, sampleRate));
process.stdout.write(`${path}\n`);
