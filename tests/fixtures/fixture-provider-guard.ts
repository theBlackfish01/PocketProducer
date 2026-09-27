import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzePreview, encodeWav, produceNative, NativeToolSession, seedNativeDocument } from "@pocket/core";

let dispatches = 0;
globalThis.fetch = (() => {
  dispatches += 1;
  throw new Error("Fixture mode attempted external transport");
});

const directory = await mkdtemp(join(tmpdir(), "pocket-fixture-guard-"));
const audioPath = join(directory, "guard.wav");
await writeFile(audioPath, encodeWav(new Float32Array(4_800), new Float32Array(4_800), 48_000));

const job = {
  id: "00000000-0000-4000-8000-000000000001",
  ownerId: "00000000-0000-4000-8000-000000000002",
  projectId: "00000000-0000-4000-8000-000000000003",
  kind: "native-generation" as const,
  state: "running",
  stage: "analyzing",
  request: {},
  baseRevisionId: null,
  expectedHeadRevisionId: null,
  leaseOwner: "fixture",
  leaseGeneration: 1,
  attemptId: "00000000-0000-4000-8000-000000000004",
  leaseUntil: new Date(Date.now() + 60_000).toISOString(),
  deadlineAt: new Date(Date.now() + 60_000).toISOString(),
  attempts: 1,
  cancellationRequestedAt: null
};

const analysis = await analyzePreview({
  job,
  path: audioPath,
  hash: "fixture-guard",
  durationSeconds: 0.1,
  peak: 0,
  rms: 0,
  nonSilentRatio: 0
});
const production = await produceNative({ session: new NativeToolSession(job, seedNativeDocument("Fixture"), false), direction: "Warm and sparse", mode: "generation", sources: [] });

if (analysis.status !== "unavailable" || production.provider !== "deterministic-fixture" || dispatches !== 0) {
  throw new Error(JSON.stringify({ analysis: analysis.status, producer: production.provider, dispatches }));
}
process.stdout.write("fixture-provider-guard:ok\n");
