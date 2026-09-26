// Isolated process harness: never accepts a production database or provider access.
import { claimJobById, closePool, fixtureConstruct, getConfig, NativeToolSession, seedNativeDocument } from "@pocket/core";
import { processJob } from "@pocket/worker";

const config = getConfig();
if (!config.FIXTURE_MODE || !new URL(config.DATABASE_URL).pathname.endsWith("_test") || process.env.LANGSMITH_TRACING !== "false") throw new Error("Native process probe requires isolated fixture mode with tracing disabled");
const [id, mode] = process.argv.slice(2);
if (!id) throw new Error("Missing isolated job ID");
try {
  const job = await claimJobById(id, `native-probe-${process.pid}`);
  if (!job) process.send?.("contended");
  else if (mode === "checkpoint") {
    const direction = typeof job.request.direction === "string" ? job.request.direction : "Warm instrumental";
    const session = new NativeToolSession(job, seedNativeDocument(direction));
    await fixtureConstruct(session, direction, []);
    process.send?.("checkpoint");
    await new Promise<void>(() => { setInterval(() => undefined, 1_000); });
  } else { await processJob(job); process.send?.("finished"); }
} finally { await closePool(); }
