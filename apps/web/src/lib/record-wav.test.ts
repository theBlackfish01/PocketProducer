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

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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

  it("releases a stream when permission resolves after cancellation", async () => {
    let resolvePermission: ((stream: { getTracks(): Array<{ stop(): void }> }) => void) | undefined;
    let trackStops = 0;
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => new Promise((resolve) => { resolvePermission = resolve; }) } });
    const controller = new AbortController();
    const pending = startWavRecording({ signal: controller.signal });
    controller.abort();
    resolvePermission?.({ getTracks: () => [{ stop: () => { trackStops += 1; } }] });
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(trackStops).toBe(1);
  });

  it.each(["construct", "source", "processor", "source-connect", "processor-connect", "resume"])("cleans up every acquired resource when %s setup fails", async (failure) => {
    const source = new FakeSource();
    const processor = new FakeProcessor();
    let trackStops = 0;
    let closes = 0;
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => Promise.resolve({ getTracks: () => [{ stop: () => { trackStops += 1; } }] }) } });
    if (failure === "source-connect") source.connect = () => { throw new Error("source connect failed"); };
    if (failure === "processor-connect") processor.connect = () => { throw new Error("processor connect failed"); };
    vi.stubGlobal("AudioContext", class {
      sampleRate = 48_000;
      state = failure === "resume" ? "suspended" : "running";
      destination = {};
      constructor() { if (failure === "construct") throw new Error("context failed"); }
      createMediaStreamSource(): FakeSource { if (failure === "source") throw new Error("source failed"); return source; }
      createScriptProcessor(): FakeProcessor { if (failure === "processor") throw new Error("processor failed"); return processor; }
      close(): Promise<void> { closes += 1; return Promise.resolve(); }
      resume(): Promise<void> { return failure === "resume" ? Promise.reject(new Error("resume failed")) : Promise.resolve(); }
    });

    await expect(startWavRecording()).rejects.toThrow();
    expect(trackStops).toBe(1);
    expect(closes).toBe(failure === "construct" ? 0 : 1);
    if (!new Set(["construct", "source"]).has(failure)) expect(source.disconnected).toBe(true);
    if (!new Set(["construct", "source", "processor"]).has(failure)) expect(processor.disconnected).toBe(true);
  });

  it("uses the wall clock limit even without another processing callback and cleanup remains idempotent", async () => {
    vi.useFakeTimers();
    const source = new FakeSource();
    const processor = new FakeProcessor();
    let trackStops = 0;
    let closes = 0;
    let limitEvents = 0;
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
    const recording = await startWavRecording({ maxSeconds: 1, onLimitReached: () => { limitEvents += 1; } });
    processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array([0.2, -0.2]) } });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(recording.stoppedByLimit).toBe(true);
    expect(limitEvents).toBe(1);
    const first = await recording.stop();
    const second = await recording.stop();
    recording.discard();
    expect(second).toBe(first);
    expect(trackStops).toBe(1);
    expect(closes).toBe(1);
  });
});
