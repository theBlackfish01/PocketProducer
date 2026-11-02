// Manual, network-disabled Docker probe; not a live generation or a RAM limit.
// The offline setup clears provider/tracing keys before loading the producer.
import "../setup/offline-env.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import type { JobRecord } from "@pocket/core";

function snapshot(stage: string) {
  console.log(JSON.stringify({ stage, elapsedMs: Math.round(performance.now()), memory: process.memoryUsage() }));
}
console.log(JSON.stringify({ node: process.version, allocator: {
  arenas: process.env.MALLOC_ARENA_MAX ?? "default",
  trim: process.env.MALLOC_TRIM_THRESHOLD_ ?? "default",
  mmap: process.env.MALLOC_MMAP_THRESHOLD_ ?? "default"
} }));
snapshot("before imports");
const { NativeToolSession, seedNativeDocument, fixtureConstruct, validateNativeOffline } = await import("@pocket/core");
snapshot("after imports");
const direction = "A complete warm 32-bar groove";
const session = new NativeToolSession({} as JobRecord, seedNativeDocument(direction), false);
await fixtureConstruct(session, direction, []);
let first: Awaited<ReturnType<typeof validateNativeOffline>> | undefined;
for (let run = 0; run < 3; run++) {
  const started = performance.now();
  const result = await validateNativeOffline(session.document);
  const validationMs = Math.round(performance.now() - started);
  if (first) assert.deepEqual(result, first); else first = result;
  const hash = createHash("sha256").update(JSON.stringify(result)).digest("hex");
  console.log(JSON.stringify({ run, validationMs, hash, readback: result.readback }));
  snapshot("after validation");
  await setTimeout(5_000);
  snapshot("after five seconds idle");
}
await setTimeout(10_000);
snapshot("final idle");
// The pinned SDK owns a long-lived Go/WASM runtime; this standalone diagnostic
// ends here. No DB connection, server, paid call or remote copy was started.
process.exit(0);
