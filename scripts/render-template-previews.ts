// Authoring only. Bake our six reference performances into static media for the picker.
// No part of this program is loaded by the application or worker.
import { spawnSync } from "node:child_process";
import { mkdir, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { barTicks, materializedNotes, nativeMusicHash, type NativeDocument } from "@pocket/core";
import { buildReference, starterReferences } from "@pocket/core/test-support";
import type { ArrangementTemplateId } from "@pocket/core/templates";

const rate = 32_000, tau = Math.PI * 2;
type Voice = "round" | "octave" | "bow" | "pad" | "tine" | "pluck" | "reed" | "lead" | "stab";
const voices: Record<ArrangementTemplateId, [Voice, Voice, Voice]> = {
  "french-house-v1": ["octave", "stab", "lead"],
  "broken-beat-v1": ["round", "tine", "tine"],
  "chamber-waltz-v1": ["bow", "pad", "tine"],
  "synthwave-v1": ["octave", "pad", "lead"],
  "bossa-nova-v1": ["round", "pluck", "reed"],
  "tidal-ambient-v1": ["bow", "pad", "tine"]
};
// Attack, decay, sustain and release, in seconds and linear amplitude.
const envelope: Record<Voice, [number, number, number, number]> = {
  round: [.007, .19, .44, .08], octave: [.007, .14, .47, .06], bow: [.17, .34, .76, .27],
  pad: [.18, .35, .76, .54], tine: [.005, .48, .19, .33], pluck: [.004, .20, .15, .12],
  reed: [.04, .23, .71, .14], lead: [.019, .17, .62, .17], stab: [.006, .115, .19, .12]
};
function color(voice: Voice, phase: number, time: number) {
  const fundamental = Math.sin(phase);
  switch (voice) {
    case "round": return fundamental + .30 * Math.sin(2 * phase) * Math.exp(-time * 6);
    case "octave": return .82 * fundamental + .34 * Math.sin(2 * phase) + .17 * Math.sin(3 * phase) * Math.exp(-time * 5);
    case "bow": return .78 * fundamental + .26 * Math.sin(2 * phase) + .18 * Math.sin(3 * phase * 1.001);
    case "pad": return .46 * fundamental + .32 * Math.sin(phase * 1.003) + .18 * Math.sin(phase * .997 + .8) + .12 * Math.sin(2 * phase);
    case "tine": return Math.sin(phase + 1.12 * Math.exp(-time * 6) * Math.sin(2 * phase)) + .15 * Math.sin(phase * 4.01) * Math.exp(-time * 3);
    case "pluck": return fundamental + Math.exp(-time * 9) * (.48 * Math.sin(2 * phase) + .24 * Math.sin(3 * phase) + .10 * Math.sin(5 * phase));
    case "reed": return Math.sin(phase + .085 * Math.sin(tau * 4.9 * time)) + .22 * Math.sin(2 * phase) + .10 * Math.sin(3 * phase);
    case "lead": return .76 * fundamental + .29 * Math.sin(phase * 1.002) + .26 * Math.sin(2 * phase) + .14 * Math.sin(3 * phase);
    case "stab": return .62 * fundamental + .31 * Math.sin(2 * phase) + .21 * Math.sin(3 * phase) + .095 * Math.sin(5 * phase);
  }
}
function pitched(track: Float32Array, start: number, held: number, pitch: number, level: number, voice: Voice) {
  const [attack, decay, sustain, release] = envelope[voice];
  const frequency = 440 * 2 ** ((pitch - 69) / 12);
  const body = (t: number) => Math.min(t / attack, 1) * (sustain + (1 - sustain) * Math.exp(-Math.max(0, t - attack) / decay));
  const endLevel = body(held);
  const length = Math.min(track.length - start, Math.ceil((held + release * 5) * rate));
  for (let i = 0; i < length; i++) {
    const t = i / rate;
    const amplitude = t <= held ? body(t) : endLevel * Math.exp(-(t - held) / release);
    track[start + i]! += level * amplitude * color(voice, t * tau * frequency, t);
  }
}
function drum(track: Float32Array, start: number, pitch: number, level: number, style: ArrangementTemplateId) {
  const rim = style === "bossa-nova-v1";
  const length = Math.min(track.length - start, Math.ceil((pitch === 46 ? .38 : .32) * rate));
  let state = (start + 32003 * pitch) | 1, previous = 0;
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const t = i / rate, noise = state / 2147483648 - 1, high = (noise - previous) * .5;
    previous = noise;
    let sample: number;
    if (pitch === 36) sample = .98 * Math.sin(tau * (49 * t + 2.4 * (1 - Math.exp(-t * 38)))) * Math.exp(-t * (rim ? 23 : 15)) + high * .13 * Math.exp(-t * 160);
    else if (pitch === 38) sample = rim
      ? .49 * (Math.sin(tau * 730 * t) + .42 * Math.sin(tau * 1217 * t)) * Math.exp(-t * 83) + high * .18 * Math.exp(-t * 67)
      : .36 * Math.sin(tau * 186 * t) * Math.exp(-t * 37) + .56 * high * Math.exp(-t * 21);
    else sample = (high + .14 * Math.sin(tau * 5131 * t) * Math.sin(tau * 3179 * t)) * (pitch === 46 ? .20 : .14) * Math.exp(-t * (pitch === 46 ? 17 : 80));
    track[start + i]! += level * sample;
  }
}
function mix(score: NativeDocument, id: ArrangementTemplateId) {
  const secondsPerTick = 60 / (score.tempoBpm * score.ppq);
  const frames = Math.ceil((score.bars * barTicks(score) * secondsPerTick + 1.7) * rate);
  const stereo = new Float32Array(frames * 2);
  for (const part of score.parts) {
    const track = new Float32Array(frames);
    const [bass, keys, lead] = voices[id];
    const voice = part.id === "bass" ? bass : part.id === "keys" ? keys : part.id === "lead" ? lead : "pluck";
    const accents = part.automation.find(curve => curve.target === "gain")?.points ?? [];
    let point = -1;
    for (const note of materializedNotes(score, part.id).sort((a, b) => a.startTick - b.startTick)) {
      while (point + 1 < accents.length && accents[point + 1]!.tick <= note.startTick) point++;
      const gain = point >= 0 ? accents[point]!.value : part.gain;
      const start = Math.round(note.startTick * secondsPerTick * rate);
      if (part.role === "percussion") drum(track, start, note.pitch, gain * .66, id);
      else pitched(track, start, note.durationTicks * secondsPerTick, note.pitch,
        gain * note.velocity ** 1.4 * (part.id === "keys" ? .34 : .75), voice);
    }
    const pan = (part.pan + 1) * Math.PI / 4;
    const wet = part.id === "bass" || part.role === "percussion" ? .035 : id === "tidal-ambient-v1" ? .25 : .12;
    for (let i = 0; i < frames; i++) {
      const dry = track[i]!;
      stereo[2 * i]! += Math.cos(pan) * dry + wet * ((track[i - 2371] ?? 0) + .48 * (track[i - 7321] ?? 0));
      stereo[2 * i + 1]! += Math.sin(pan) * dry + wet * ((track[i - 3253] ?? 0) + .44 * (track[i - 8723] ?? 0));
    }
  }
  return stereo;
}

const directory = resolve("apps/web/public/templates");
await mkdir(directory, { recursive: true });
for (const ref of starterReferences) {
  const score = buildReference(ref), pcm = mix(score, ref.id);
  const destination = resolve(directory, ref.id + ".mp3");
  const tempFile = resolve(directory, "." + ref.id + "-" + randomUUID() + ".mp3");
  try {
    const encoded = spawnSync(process.env.TEMPLATE_FFMPEG ?? "ffmpeg", [
      "-v", "error", "-y", "-f", "f32le", "-ar", String(rate), "-ac", "2", "-i", "pipe:0",
      "-af", "loudnorm=I=-17:TP=-1.5:LRA=10", "-ar", "44100", "-codec:a", "libmp3lame", "-q:a", "4",
      "-metadata", "title=" + ref.title, "-metadata", "comment=Pocket Producer reference " + nativeMusicHash(score), tempFile
    ], { input: Buffer.from(pcm.buffer), encoding: "utf8" });
    if (encoded.error || encoded.status !== 0) throw new Error(encoded.error?.message ?? encoded.stderr);
    await rename(tempFile, destination);
  } finally {
    await rm(tempFile, { force: true });
  }
  console.log(ref.title, String(Math.round(pcm.length / (2 * rate))) + "s");
}
