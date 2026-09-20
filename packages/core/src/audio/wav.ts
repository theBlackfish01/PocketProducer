export interface DecodedWav {
  sampleRate: number;
  channels: Float32Array[];
  frames: number;
  durationSeconds: number;
}

export interface AudioMeasurements {
  durationSeconds: number;
  peak: number;
  rms: number;
  nonSilentRatio: number;
}

function assertRange(buffer: Buffer, offset: number, bytes: number): void {
  if (offset < 0 || offset + bytes > buffer.length) throw new Error("Malformed WAV chunk bounds");
}

export function decodeWav(buffer: Buffer): DecodedWav {
  if (buffer.length < 44 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Only RIFF/WAVE audio is accepted until FFmpeg is configured");
  }
  let offset = 12;
  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let dataOffset = -1;
  let dataLength = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    assertRange(buffer, body, size);
    if (id === "fmt ") {
      format = buffer.readUInt16LE(body);
      channels = buffer.readUInt16LE(body + 2);
      sampleRate = buffer.readUInt32LE(body + 4);
      bits = buffer.readUInt16LE(body + 14);
    } else if (id === "data") {
      dataOffset = body;
      dataLength = size;
      break;
    }
    offset = body + size + (size % 2);
  }
  if (![1, 3].includes(format) || ![1, 2].includes(channels) || sampleRate < 8_000 || sampleRate > 192_000 || dataOffset < 0) {
    throw new Error("Unsupported WAV format; use mono/stereo PCM16 or Float32 WAV");
  }
  if ((format === 1 && bits !== 16) || (format === 3 && bits !== 32)) throw new Error("Unsupported WAV bit depth");
  const bytesPerSample = bits / 8;
  const frames = Math.floor(dataLength / (bytesPerSample * channels));
  if (frames <= 0 || frames > sampleRate * 300) throw new Error("WAV is empty or exceeds five minutes");
  const result = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const position = dataOffset + (frame * channels + channel) * bytesPerSample;
      result[channel]![frame] = format === 1 ? buffer.readInt16LE(position) / 32_768 : buffer.readFloatLE(position);
    }
  }
  return { sampleRate, channels: result, frames, durationSeconds: frames / sampleRate };
}

export function encodeWav(left: Float32Array, right: Float32Array, sampleRate: number): Buffer {
  if (left.length !== right.length) throw new Error("Channel length mismatch");
  const dataLength = left.length * 4;
  const output = Buffer.alloc(44 + dataLength);
  output.write("RIFF", 0, "ascii");
  output.writeUInt32LE(36 + dataLength, 4);
  output.write("WAVEfmt ", 8, "ascii");
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(2, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * 4, 28);
  output.writeUInt16LE(4, 32);
  output.writeUInt16LE(16, 34);
  output.write("data", 36, "ascii");
  output.writeUInt32LE(dataLength, 40);
  for (let index = 0; index < left.length; index += 1) {
    output.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[index] ?? 0)) * 32_767), 44 + index * 4);
    output.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[index] ?? 0)) * 32_767), 46 + index * 4);
  }
  return output;
}

export function mono(decoded: DecodedWav): Float32Array {
  if (decoded.channels.length === 1) return decoded.channels[0]!;
  const output = new Float32Array(decoded.frames);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = ((decoded.channels[0]?.[index] ?? 0) + (decoded.channels[1]?.[index] ?? 0)) * 0.5;
  }
  return output;
}

export function measureDecodedWav(decoded: DecodedWav): AudioMeasurements {
  let peak = 0;
  let squareSum = 0;
  let nonSilent = 0;
  for (let frame = 0; frame < decoded.frames; frame += 1) {
    let value = 0;
    for (const channel of decoded.channels) value = Math.max(value, Math.abs(channel[frame] ?? 0));
    peak = Math.max(peak, value);
    squareSum += value * value;
    if (value > 0.0005) nonSilent += 1;
  }
  return { durationSeconds: decoded.durationSeconds, peak, rms: Math.sqrt(squareSum / decoded.frames), nonSilentRatio: nonSilent / decoded.frames };
}
