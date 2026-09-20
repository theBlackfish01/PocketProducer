import { randomUUID } from "node:crypto";
import { closePool, createJob, createProject, devOwnerId, getConfig, getPool, produceArrangement } from "@pocket/core";

const config = getConfig();
if (!config.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured in the root .env");
const ownerId = await devOwnerId();
const project = await createProject(ownerId, `Provider smoke ${new Date().toISOString()}`);
const created = await createJob({
  ownerId,
  projectId: project.id,
  kind: "generation",
  idempotencyKey: `live-${randomUUID()}`,
  request: { direction: "Make a warm restrained instrumental with a gentle lift." }
});

try {
  const result = await produceArrangement({ jobId: created.id, direction: "Make a warm restrained instrumental with a gentle lift.", hasSource: false });
  if (result.provider !== "openai-deep-agent") throw new Error(`Expected OpenAI Deep Agent, received ${result.provider}`);
  await getPool().query("UPDATE job SET state='succeeded',updated_at=now() WHERE id=$1", [created.id]);
  process.stdout.write(`${JSON.stringify({ ok: true, provider: result.provider, model: result.model, usage: result.usage, costUsd: result.costUsd })}\n`);
} catch (error) {
  await getPool().query("UPDATE job SET state='failed',error_code='LIVE_SMOKE_FAILED',error_message=$2,updated_at=now() WHERE id=$1", [created.id, error instanceof Error ? error.message.slice(0, 500) : "Unknown failure"]);
  throw error;
} finally {
  await closePool();
}
