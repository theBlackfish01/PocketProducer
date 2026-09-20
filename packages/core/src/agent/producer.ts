import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tool } from "@langchain/core/tools";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { ChatOpenAI } from "@langchain/openai";
import { createDeepAgent } from "deepagents";
import { providerStrategy } from "langchain";
import { z } from "zod";
import { getConfig, REPOSITORY_ROOT } from "../config.js";
import { arrangementPlanSchema, type ArrangementPlan } from "../domain/composition.js";
import { getPool } from "../db/pool.js";

const paletteTool = tool(
  () => ({
    id: "sunroom",
    style: "warm restrained downtempo electronic",
    tempoRange: [78, 112],
    roles: ["drums", "bass", "melody", "texture"],
    renderer: "deterministic 48 kHz sample/synthesis palette"
  }),
  { name: "list_supported_palettes", description: "Return the exact palette and renderer envelope available to this run.", schema: z.object({}) }
);

let checkpointReady: Promise<PostgresSaver> | undefined;

function checkpoint(): Promise<PostgresSaver> {
  checkpointReady ??= (async () => {
    const saver = new PostgresSaver(getPool(), undefined, { schema: "public" });
    await saver.setup();
    return saver;
  })();
  return checkpointReady;
}

async function runtimeFiles(direction: string, hasSource: boolean) {
  const created = new Date().toISOString();
  const skillNames = ["arrange-short-instrumental", "revise-protected-parts", "evaluate-preview"];
  const files: Record<string, { content: string; mimeType: string; created_at: string; modified_at: string }> = {};
  for (const name of skillNames) {
    const content = await readFile(resolve(REPOSITORY_ROOT, "agent-skills", name, "SKILL.md"), "utf8");
    files[`/skills/${name}/SKILL.md`] = { content, mimeType: "text/markdown", created_at: created, modified_at: created };
  }
  files["/workspace/brief.md"] = {
    content: `# Production brief\n\nDirection: ${direction}\nExact owned source available: ${hasSource ? "yes" : "no"}\nDuration: 16 bars / about 34–49 seconds\nPalette: sunroom\n`,
    mimeType: "text/markdown",
    created_at: created,
    modified_at: created
  };
  return files;
}

export function deterministicPlan(direction: string, hasSource: boolean): ArrangementPlan {
  const lower = direction.toLowerCase();
  const energetic = /energy|driv|punch|upbeat/.test(lower);
  const sparse = /sparse|restrained|minimal|space|warm/.test(lower);
  return {
    title: direction.trim().split(/[.!?]/)[0]?.slice(0, 64) || "New listening room",
    tempoBpm: energetic ? 108 : sparse ? 88 : 96,
    energy: energetic ? 0.78 : sparse ? 0.38 : 0.58,
    drumDensity: energetic ? 0.92 : sparse ? 0.48 : 0.7,
    bassMotion: /moving bass|active bass/.test(lower) ? 0.8 : 0.42,
    melodyContour: /rise|lift/.test(lower) ? "rising" : /fall|settle/.test(lower) ? "falling" : "wave",
    sourceRole: hasSource ? (/drum|percuss|rhythm/.test(lower) ? "percussion" : "texture") : "none",
    rationale: "Deterministic provider fallback constrained to the Sunroom palette."
  };
}

function usageFromResult(result: unknown): { inputTokens: number; outputTokens: number } {
  let inputTokens = 0;
  let outputTokens = 0;
  if (result && typeof result === "object" && "messages" in result && Array.isArray(result.messages)) {
    for (const message of result.messages) {
      if (message && typeof message === "object" && "usage_metadata" in message && message.usage_metadata && typeof message.usage_metadata === "object") {
        const usage = message.usage_metadata as { input_tokens?: number; output_tokens?: number };
        inputTokens += usage.input_tokens ?? 0;
        outputTokens += usage.output_tokens ?? 0;
      }
    }
  }
  return { inputTokens, outputTokens };
}

export async function estimateCheckpointUsage(threadId: string): Promise<{ inputTokens: number; outputTokens: number }> {
  const rows = await getPool().query<{ blob: Buffer }>("SELECT blob FROM checkpoint_writes WHERE thread_id=$1 AND channel='messages' AND type='json'", [threadId]);
  const totals = { inputTokens: 0, outputTokens: 0 };
  const seen = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const usage = record.usage_metadata;
    const id = typeof record.id === "string" ? record.id : undefined;
    if (usage && typeof usage === "object" && (!id || !seen.has(id))) {
      const tokens = usage as Record<string, unknown>;
      totals.inputTokens += typeof tokens.input_tokens === "number" ? tokens.input_tokens : 0;
      totals.outputTokens += typeof tokens.output_tokens === "number" ? tokens.output_tokens : 0;
      if (id) seen.add(id);
    }
    for (const child of Object.values(record)) visit(child);
  };
  for (const row of rows.rows) {
    try { visit(JSON.parse(row.blob.toString("utf8")) as unknown); } catch { /* A future serializer can omit usage rather than fail the job. */ }
  }
  return totals;
}

export function openAiCost(usage: { inputTokens: number; outputTokens: number }): number {
  return usage.inputTokens / 1_000_000 * 10 + usage.outputTokens / 1_000_000 * 50;
}

export async function produceArrangement(input: { jobId: string; direction: string; hasSource: boolean; forceFixture?: boolean }): Promise<{ plan: ArrangementPlan; provider: string; model: string; costUsd: number; usage: { inputTokens: number; outputTokens: number } }> {
  const config = getConfig();
  if (input.forceFixture || config.FIXTURE_MODE || !config.OPENAI_API_KEY) {
    return { plan: deterministicPlan(input.direction, input.hasSource), provider: "deterministic-fallback", model: "none", costUsd: 0, usage: { inputTokens: 0, outputTokens: 0 } };
  }
  const estimatedMaximum = 0.22;
  const spend = await getPool().query<{ total: string }>("SELECT COALESCE(SUM(actual_cost_usd),0)::text AS total FROM job");
  const spent = Number(spend.rows[0]?.total ?? 0);
  if (spent + estimatedMaximum > config.INITIAL_BUILD_API_BUDGET_USD || estimatedMaximum > config.MAX_JOB_COST_USD) {
    throw new Error("Configured application API budget would be exceeded");
  }
  const effect = await getPool().query<{ id: string }>(
    "INSERT INTO effect(job_id,step,idempotency_key,input_hash,state,provider) VALUES($1,'producer',$2,$3,'pending','openai') ON CONFLICT(job_id,idempotency_key) DO UPDATE SET updated_at=now() RETURNING id,state,output",
    [input.jobId, `producer:${input.jobId}`, input.jobId]
  );
  const effectId = effect.rows[0]?.id;
  if (!effectId) throw new Error("Unable to reserve producer effect");
  try {
    const model = new ChatOpenAI({
      model: config.OPENAI_MODEL,
      apiKey: config.OPENAI_API_KEY,
      useResponsesApi: true,
      reasoning: { effort: "low" },
      maxTokens: 900,
      maxRetries: 1,
      timeout: 60_000
    });
    const agent = createDeepAgent({
      name: "pocket-producer",
      model,
      tools: [paletteTool],
      responseFormat: providerStrategy(arrangementPlanSchema),
      checkpointer: await checkpoint(),
      skills: ["/skills/"],
      permissions: [
        { operations: ["read"], paths: ["/"] },
        { operations: ["read"], paths: ["/skills/**", "/workspace/**"] },
        { operations: ["write"], paths: ["/**"], mode: "deny" },
        { operations: ["read"], paths: ["/**"], mode: "deny" }
      ],
      systemPrompt: "You are Pocket Producer's main producer. Read /skills/arrange-short-instrumental/SKILL.md and /workspace/brief.md, call list_supported_palettes once, then immediately return one valid compact arrangement plan. Do not list the filesystem. Never claim to hear audio. Do not create raw timeline events; deterministic application code compiles the plan."
    });
    const agentInput = { messages: [{ role: "user", content: "Plan this supported instrumental now. Use the source when one is available." }], files: await runtimeFiles(input.direction, input.hasSource) };
    const result = await agent.invoke(
      agentInput as never,
      { configurable: { thread_id: input.jobId }, recursionLimit: 24 }
    );
    const plan = arrangementPlanSchema.parse((result as unknown as { structuredResponse: unknown }).structuredResponse);
    const usage = usageFromResult(result);
    const costUsd = openAiCost(usage);
    await getPool().query("UPDATE effect SET state='succeeded',output=$2,cost_usd=$3,updated_at=now() WHERE id=$1", [effectId, { plan, usage, model: config.OPENAI_MODEL }, costUsd]);
    await getPool().query("UPDATE job SET actual_cost_usd=actual_cost_usd+$2 WHERE id=$1", [input.jobId, costUsd]);
    return { plan, provider: "openai-deep-agent", model: config.OPENAI_MODEL, costUsd, usage };
  } catch (error) {
    const usage = await estimateCheckpointUsage(input.jobId);
    const costUsd = openAiCost(usage);
    await getPool().query("UPDATE effect SET state='failed',output=$2,cost_usd=$3,updated_at=now() WHERE id=$1", [effectId, { errorClass: error instanceof Error ? error.name : "UnknownError", usage }, costUsd]);
    await getPool().query("UPDATE job SET actual_cost_usd=$2 WHERE id=$1", [input.jobId, costUsd]);
    throw error;
  }
}
