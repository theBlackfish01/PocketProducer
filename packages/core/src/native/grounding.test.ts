import { describe, expect, it } from "vitest";
import type { JobRecord } from "../db/repository.js";
import { NativeCorrectableError } from "./errors.js";
import { libraryFailure, NativeLibraryError, type NativeLibrary } from "./library.js";
import { NativeToolSession, nativeCompletionIssues, seedNativeDocument } from "./producer.js";
import { applyNativeOperations, type NativeOperation } from "./model.js";
import { capturedBrief } from "../test-support.js";

const job = (kind: "native-generation" | "native-revision" = "native-generation") => ({ id: "job", ownerId: "owner", projectId: "project", kind, request: {} }) as unknown as JobRecord;
const presetName = "presets/0b8f3f8e-5a6f-4a62-9d38-0d9a6e8b2c11";
const preset = { name: presetName, displayName: "Glass keys", ownerName: "Library", contentHash: "a".repeat(64) };
const metadata = { kind: "preset" as const, ...preset, deviceType: "heisenberg", tags: [] };
const lead = (devicePreset?: typeof preset) => ({ id: "lead", name: "Lead", role: "melody" as const, device: { type: "heisenberg" as const, parameters: {}, ...(devicePreset ? { preset: devicePreset } : {}) }, gain: 0.7, pan: 0, notes: [], placements: [], sourceRegions: [], effects: [], automation: [] });
const providerFailure = () => new NativeLibraryError("provider-failed", "upstream unavailable");

function fakeLibrary(getPreset: () => Promise<Awaited<ReturnType<NativeLibrary["getPreset"]>>>): NativeLibrary {
  const unused = () => Promise.reject(new Error("unused"));
  return { searchSamples: unused, getSample: unused, readSampleAudio: unused, inspectSampleAudio: unused, searchPresets: unused, getPreset, searchGmSounds: unused, getGmSound: unused };
}
const selectPreset: NativeOperation[] = [{ kind: "removePart", partId: "starting-voice" }, { kind: "addPart", part: lead(preset) }];

describe("library failure classification", () => {
  it("uses the SDK's numeric Connect status, not message text", () => {
    const connect = (code: number) => Object.assign(new Error("message text is ignored"), { code });
    expect(libraryFailure(connect(5), "x").code).toBe("not-found");
    expect(libraryFailure(connect(3), "x").code).toBe("invalid");
    expect(libraryFailure(connect(16), "x").code).toBe("unauthorized");
    expect(libraryFailure(connect(7), "x").code).toBe("unauthorized");
    expect(libraryFailure(connect(14), "x").code).toBe("provider-failed");
    expect(libraryFailure(new Error("not found"), "x").code).toBe("provider-failed");
    const existing = new NativeLibraryError("invalid", "kept");
    expect(libraryFailure(existing, "x")).toBe(existing);
  });
});

describe("remote identities must be grounded", () => {
  it("rejects an invented preset before any lookup, as a correctable proposal", async () => {
    let lookups = 0;
    const session = new NativeToolSession(job(), seedNativeDocument("A glass lead"), false, fakeLibrary(() => { lookups++; return Promise.resolve({ metadata, preset: {} as never }); }));
    const error = await session.apply("invented", selectPreset).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NativeCorrectableError);
    expect(error).toMatchObject({ code: "REMOTE_PRESET_NOT_INSPECTED" });
    expect(lookups).toBe(0);
    expect(session.applied).toHaveLength(0);
  });

  it("applies an inspected preset after verifying its current identity", async () => {
    const session = new NativeToolSession(job(), seedNativeDocument("A glass lead"), false, fakeLibrary(() => Promise.resolve({ metadata, preset: {} as never })));
    session.groundPreset(presetName);
    await session.apply("grounded", selectPreset);
    expect(session.document.parts[0]!.device.preset?.name).toBe(presetName);
  });

  it("retries once, tolerates two library outages per job, then stops", async () => {
    let calls = 0;
    const session = new NativeToolSession(job(), seedNativeDocument("A glass lead"), false, fakeLibrary(() => { calls++; return Promise.reject(providerFailure()); }));
    session.groundPreset(presetName);
    for (const attempt of [1, 2]) {
      const error = await session.apply(`outage-${attempt}`, selectPreset).catch((caught: unknown) => caught);
      expect(error).toMatchObject({ code: "REMOTE_LIBRARY_UNAVAILABLE" });
    }
    expect(calls).toBe(4);
    await expect(session.apply("outage-3", selectPreset)).rejects.toMatchObject({ code: "provider-failed" });
  });

  it("treats a recovered retry as success", async () => {
    let calls = 0;
    const session = new NativeToolSession(job(), seedNativeDocument("A glass lead"), false, fakeLibrary(() => ++calls === 1 ? Promise.reject(providerFailure()) : Promise.resolve({ metadata, preset: {} as never })));
    session.groundPreset(presetName);
    await session.apply("flaky", selectPreset);
    expect(session.libraryFailures).toBe(0);
  });

  it("grounds identities already accepted in the base document", async () => {
    const base = applyNativeOperations(seedNativeDocument("A glass lead"), [{ kind: "removePart", partId: "starting-voice" }, { kind: "addPart", part: lead(preset) }]);
    const session = new NativeToolSession(job("native-revision"), base, false, fakeLibrary(() => Promise.resolve({ metadata, preset: {} as never })));
    await session.apply("same-sound", [{ kind: "setMix", partId: "lead", gain: 0.5 }, { kind: "setDevice", partId: "lead", device: lead(preset).device }]);
    expect(session.applied).toHaveLength(1);
  });
});

describe("the starting sketch part is reserved", () => {
  it("rejects new music in the empty seed part or a re-added seed id, naming the fix", async () => {
    const session = new NativeToolSession(job(), seedNativeDocument("A melody"), false);
    for (const operations of [
      [{ kind: "addNotes", partId: "starting-voice", notes: [{ id: "n", startTick: 0, durationTicks: 960, pitch: 60, velocity: 0.7 }] }],
      [{ kind: "removePart", partId: "starting-voice" }, { kind: "addPart", part: { ...lead(), id: "starting-voice" } }],
      [{ kind: "defineMotif", motif: { id: "m", partId: "starting-voice", name: "M", lengthTicks: 960, notes: [{ id: "n", startTick: 0, durationTicks: 960, pitch: 60, velocity: 0.7 }] } }]
    ] as NativeOperation[][]) {
      const error = await session.apply(`reuse-${operations.length}-${operations[0]!.kind}`, operations).catch((caught: unknown) => caught);
      expect(error).toMatchObject({ code: "SEED_PART_RESERVED" });
      expect((error as Error).message).toContain("starting-voice");
    }
    await session.apply("replace", [{ kind: "removePart", partId: "starting-voice" }, { kind: "addPart", part: lead() }]);
    expect(session.document.parts.map((part) => part.id)).toEqual(["lead"]);
  });

  it("does not restrict revisions, and the completion issue names the part and fix", async () => {
    const session = new NativeToolSession(job("native-revision"), seedNativeDocument("A melody"), false);
    await session.apply("revise", [{ kind: "addNotes", partId: "starting-voice", notes: [{ id: "n", startTick: 0, durationTicks: 960, pitch: 60, velocity: 0.7 }] }]);
    const [issue] = nativeCompletionIssues(seedNativeDocument("A melody"), capturedBrief("A melody"), "generation").filter((value) => value.includes("starting sketch"));
    expect(issue).toContain("id starting-voice");
    expect(issue).toContain("removePart");
  });
});
