// Dedicated test database, no provider or trace access; exercises persisted routing.
import { claimJobById, closePool, createNativeLibrary, fixtureConstruct, getConfig, handoffNativeToLuna, NativeToolSession, seedNativeDocument } from "@pocket/core";
import { AIMessage, fakeModel } from "@pocket/core/test-support";
import { processJob } from "@pocket/worker";
const c = getConfig();
if (!c.FIXTURE_MODE || !new URL(c.DATABASE_URL).pathname.endsWith("_test") || c.LANGSMITH_TRACING || c.OPENAI_API_KEY || c.GEMINI_API_KEY || c.GOOGLE_API_KEY || c.AI_GATEWAY_API_KEY || c.VERCEL_AI_GATEWAY_API_KEY) throw new Error("Isolated offline handoff process required");
const [id, mode] = process.argv.slice(2);
if (!id) throw new Error("Missing job");
try {
  const job = await claimJobById(id, `handoff-${process.pid}`);
  if (!job) process.send?.("contended");
  else if (mode === "handoff") {
    const direction = String(job.request.direction);
    await fixtureConstruct(new NativeToolSession(job, seedNativeDocument(direction)), direction, []);
    if (!await handoffNativeToLuna(job, 1000)) throw new Error("Expected Sol handoff");
    process.send?.("checkpoint");
    await new Promise<void>(() => { setInterval(() => undefined, 1000); });
  } else {
    await processJob(job, { library: createNativeLibrary(null), scriptedModel: fakeModel().respond(new AIMessage("The arrangement is ready.")) });
    process.send?.("finished");
  }
} finally { await closePool(); }
