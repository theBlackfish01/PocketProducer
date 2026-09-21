import { afterEach, describe, expect, it, vi } from "vitest";
import { startWavRecording } from "./record-wav.js";

class FakeProcessor {
  onaudioprocess: ((event: { inputBuffer: { getChannelData(channel: number): Float32Array } }) => void) | null = null;
  disconnected = false;
  connect(): void { /* no-op test graph */ }
  disconnect(): void { this.disconnected = true; }
}

class FakeSource {
  disconnected = false;
  connect(): void { /* no-op test graph */ }
  disconnect(): void { this.disconnected = true; }
}

afterEach(() => vi.unstubAllGlobals());

describe("bounded WAV recording", () => {
  it("caps captured bytes and releases every media resource on automatic limit and stop", async () => {
    const processor = new FakeProcessor();
    const source = new FakeSource();
    let trackStops = 0;
    let closes = 0;
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => Promise.resolve({ getTracks: () => [{ stop: () => { trackStops += 1; } }] }) } });
    vi.stubGlobal("AudioContext", class {
      sampleRate = 48_000;
      state = "running";
      destination = {};
      createMediaStreamSource(): FakeSource { return source; }
      createScriptProcessor(): FakeProcessor { return processor; }
      close(): Promise<void> { closes += 1; return Promise.resolve(); }
      resume(): Promise<void> { return Promise.resolve(); }
    });

    const recording = await startWavRecording({ maxSeconds: 30, maxBytes: 60 });
    processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(4_096).fill(0.25) } });
    const first = await recording.stop();
    const second = await recording.stop();
    expect(first.size).toBeLessThanOrEqual(60);
    expect(second).toBe(first);
    expect(trackStops).toBe(1);
    expect(closes).toBe(1);
    expect(processor.disconnected).toBe(true);
    expect(source.disconnected).toBe(true);
  });

  it("discards buffers and makes a discarded recording unusable", async () => {
    const processor = new FakeProcessor();
    let trackStops = 0;
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => Promise.resolve({ getTracks: () => [{ stop: () => { trackStops += 1; } }] }) } });
    vi.stubGlobal("AudioContext", class {
      sampleRate = 48_000;
      state = "running";
      destination = {};
      createMediaStreamSource(): FakeSource { return new FakeSource(); }
      createScriptProcessor(): FakeProcessor { return processor; }
      close(): Promise<void> { return Promise.resolve(); }
      resume(): Promise<void> { return Promise.resolve(); }
    });
    const recording = await startWavRecording({ maxSeconds: 1, maxBytes: 1_024 });
    processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array([0.2, 0.1]) } });
    recording.discard();
    await expect(recording.stop()).rejects.toThrow("discarded");
    expect(trackStops).toBe(1);
  });
});
