import { readFile } from "node:fs/promises";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { getConfig } from "../config.js";
import { canonicalHash } from "../domain/composition.js";
import { getPool } from "../db/pool.js";

const critiqueSchema = z.object({
  observations: z.array(z.string().max(300)).max(4),
  drumDensity: z.enum(["balanced", "too-dense", "too-sparse"]),
  mixProblems: z.array(z.string().max(200)).max(3),
  repairAction: z.enum(["none", "simplify-drums"])
});

export interface AudioAnalysis {
  status: "available" | "unavailable";
  assetHash: string;
  model: string | null;
  promptVersion: "audio-critique-v1";
  purpose: "source-analysis" | "preview-critique";
  inspectedInterval: { start: number; end: number };
  measured: { durationSeconds: number; peak: number; rms: number; nonSilentRatio: number };
  observations: string[];
  uncertainty: string;
  suggestedActions: string[];
  repairAction: "none" | "simplify-drums";
  usage: { promptTokens: number; candidateTokens: number; totalTokens: number };
}

export async function analyzePreview(input: { jobId?: string; path: string; hash: string; purpose?: AudioAnalysis["purpose"]; durationSeconds: number; peak: number; rms: number; nonSilentRatio: number }): Promise<AudioAnalysis> {
  const config = getConfig();
  const key = config.GEMINI_API_KEY ?? config.GOOGLE_API_KEY;
  const purpose = input.purpose ?? "preview-critique";
  const measured = { durationSeconds: input.durationSeconds, peak: input.peak, rms: input.rms, nonSilentRatio: input.nonSilentRatio };
  if (!key) {
    return { status: "unavailable", assetHash: input.hash, model: null, promptVersion: "audio-critique-v1", purpose, inspectedInterval: { start: 0, end: input.durationSeconds }, measured, observations: [], uncertainty: "Gemini audio analysis is not configured.", suggestedActions: [], repairAction: "none", usage: { promptTokens: 0, candidateTokens: 0, totalTokens: 0 } };
  }
  let effectId: string | undefined;
  if (input.jobId) {
    const callCount = await getPool().query<{ count: string }>("SELECT count(*)::text AS count FROM effect WHERE job_id=$1 AND provider='gemini'", [input.jobId]);
    const spend = await getPool().query<{ total: string }>("SELECT COALESCE(SUM(actual_cost_usd+estimated_cost_usd),0)::text AS total FROM job");
    const currentJob = await getPool().query<{ estimated_cost_usd: string }>("SELECT estimated_cost_usd::text FROM job WHERE id=$1", [input.jobId]);
    const estimatedCallCost = config.GEMINI_ESTIMATED_CALL_COST_USD;
    if (Number(callCount.rows[0]?.count ?? 0) >= config.MAX_MODEL_CALLS_PER_JOB || Number(spend.rows[0]?.total ?? 0) + estimatedCallCost > config.INITIAL_BUILD_API_BUDGET_USD || Number(currentJob.rows[0]?.estimated_cost_usd ?? 0) + estimatedCallCost > config.MAX_JOB_COST_USD) {
      return { status: "unavailable", assetHash: input.hash, model: config.GEMINI_MODEL, promptVersion: "audio-critique-v1", purpose, inspectedInterval: { start: 0, end: input.durationSeconds }, measured, observations: [], uncertainty: "Gemini analysis was skipped by the configured model-call or spending fence.", suggestedActions: [], repairAction: "none", usage: { promptTokens: 0, candidateTokens: 0, totalTokens: 0 } };
    }
    const idempotencyKey = `gemini:${purpose}:${input.hash}:audio-critique-v1`;
    const reserved = await getPool().query<{ id: string }>(
      "INSERT INTO effect(job_id,step,idempotency_key,input_hash,state,provider) VALUES($1,$2,$3,$4,'pending','gemini') ON CONFLICT(job_id,idempotency_key) DO NOTHING RETURNING id",
      [input.jobId, purpose, idempotencyKey, canonicalHash({ hash: input.hash, purpose, measured })]
    );
    effectId = reserved.rows[0]?.id;
    if (!effectId) {
      const prior = await getPool().query<{ state: string; output: { analysis?: AudioAnalysis } | null }>("SELECT state,output FROM effect WHERE job_id=$1 AND idempotency_key=$2", [input.jobId, idempotencyKey]);
      if (prior.rows[0]?.state === "succeeded" && prior.rows[0].output?.analysis) return prior.rows[0].output.analysis;
      return { status: "unavailable", assetHash: input.hash, model: config.GEMINI_MODEL, promptVersion: "audio-critique-v1", purpose, inspectedInterval: { start: 0, end: input.durationSeconds }, measured, observations: [], uncertainty: "A previous Gemini attempt did not complete; it was not repeated to avoid duplicate billing.", suggestedActions: [], repairAction: "none", usage: { promptTokens: 0, candidateTokens: 0, totalTokens: 0 } };
    }
    await getPool().query("UPDATE job SET estimated_cost_usd=estimated_cost_usd+$2 WHERE id=$1", [input.jobId, estimatedCallCost]);
  }
  const bytes = await readFile(input.path);
  const client = new GoogleGenAI({ apiKey: key });
  try {
    const response = await client.models.generateContent({
      model: config.GEMINI_MODEL,
      contents: [{ role: "user", parts: [
        { inlineData: { mimeType: "audio/wav", data: bytes.toString("base64") } },
        { text: purpose === "source-analysis" ? "Listen to this supplied source. Describe its useful musical character without inventing measured facts. Never request copyrighted imitation." : "Listen to this short instrumental. Assess arrangement clarity, drum density and obvious mix problems. Choose simplify-drums only when drums clearly crowd the arrangement. Never suggest changing protected melody." }
      ] }],
      config: {
        temperature: 0.1,
        responseMimeType: "application/json",
        responseJsonSchema: {
          type: "object",
          additionalProperties: false,
          required: ["observations", "drumDensity", "mixProblems", "repairAction"],
          properties: {
            observations: { type: "array", maxItems: 4, items: { type: "string" } },
            drumDensity: { type: "string", enum: ["balanced", "too-dense", "too-sparse"] },
            mixProblems: { type: "array", maxItems: 3, items: { type: "string" } },
            repairAction: { type: "string", enum: ["none", "simplify-drums"] }
          }
        }
      }
    });
    const critique = critiqueSchema.parse(JSON.parse(response.text ?? "{}"));
    const usage = {
      promptTokens: response.usageMetadata?.promptTokenCount ?? 0,
      candidateTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      totalTokens: response.usageMetadata?.totalTokenCount ?? 0
    };
    const analysis: AudioAnalysis = {
      status: "available", assetHash: input.hash, model: config.GEMINI_MODEL, promptVersion: "audio-critique-v1", purpose,
      inspectedInterval: { start: 0, end: input.durationSeconds }, measured,
      observations: [...critique.observations, ...critique.mixProblems],
      uncertainty: "Subjective model opinion; measured facts and protected hashes remain authoritative.", suggestedActions: critique.repairAction === "none" ? [] : [critique.repairAction],
      repairAction: critique.repairAction,
      usage
    };
    if (effectId) await getPool().query("UPDATE effect SET state='succeeded',output=$2,updated_at=now() WHERE id=$1", [effectId, JSON.stringify({ analysis })]);
    return analysis;
  } catch (error) {
    if (effectId) await getPool().query("UPDATE effect SET state='failed',output=$2,updated_at=now() WHERE id=$1", [effectId, JSON.stringify({ errorClass: error instanceof Error ? error.name : "UnknownError" })]);
    throw error;
  }
}
