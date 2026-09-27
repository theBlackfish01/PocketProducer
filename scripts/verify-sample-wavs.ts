import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { decodeWav, measureDecodedWav } from "@pocket/core";

const folder = process.argv[2];
if (!folder) throw new Error("Usage: tsx scripts/verify-sample-wavs.ts <folder-of-owned-or-review-WAVs>");
for (const name of (await readdir(folder)).filter((item) => item.toLowerCase().endsWith(".wav")).sort()) {
  const bytes = await readFile(join(folder, name));
  const decoded = decodeWav(bytes, { maxDurationSeconds: 30 });
  const measured = measureDecodedWav(decoded);
  console.log(JSON.stringify({ name, bitDepth: bytes.readUInt16LE(34), channels: decoded.channels.length, rate: decoded.sampleRate, seconds: Number(decoded.durationSeconds.toFixed(3)), peak: Number(measured.peak.toFixed(4)), nonSilentRatio: Number(measured.nonSilentRatio.toFixed(4)) }));
}
