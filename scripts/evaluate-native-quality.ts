import { getPool, closePool, nativeQualityCases, evaluateNativeQuality, nativePlanSchema, nativeDocumentSchema, type NativeQualityCaseId } from "@pocket/core";

const args = process.argv.slice(2);
if (args.includes("--list")) {
  process.stdout.write(JSON.stringify(nativeQualityCases, null, 2) + "\n");
  process.exit(0);
}
const value = (flag: string) => args[args.indexOf(flag) + 1];
const jobId = value("--job"), caseId = value("--case") as NativeQualityCaseId | undefined;
if (!jobId || !caseId || !/^[a-f0-9-]{36}$/i.test(jobId) || !nativeQualityCases.some((item) => item.id === caseId)) {
  process.stderr.write("Usage: pnpm eval:native --list | --case <fixed-case-id> --job <existing-job-uuid>\n");
  process.exit(2);
}
try {
  const job = await getPool().query<{ id: string; kind: string; state: string; request: Record<string, unknown>; created_at: Date; updated_at: Date; actual_cost_microusd: string }>("SELECT id,kind,state,request,created_at,updated_at,actual_cost_microusd::text FROM job WHERE id=$1", [jobId]);
  const row = job.rows[0];
  if (!row || !["native-generation", "native-revision"].includes(row.kind)) throw new Error("An existing native construction/revision job ID is required");
  const direction = typeof row.request.direction === "string" ? row.request.direction : "";
  const accepted = await getPool().query<{ id: string; document: unknown; producer: Record<string, unknown> }>("SELECT id,document,producer FROM native_revision WHERE creator_job_id=$1", [jobId]);
  const baseId = typeof row.request.baseNativeRevisionId === "string" ? row.request.baseNativeRevisionId : null;
  const base = baseId ? await getPool().query<{ document: unknown }>("SELECT document FROM native_revision WHERE id=$1 AND project_id=(SELECT project_id FROM job WHERE id=$2)", [baseId, jobId]) : null;
  const plan = await getPool().query<{ plan: unknown }>("SELECT plan FROM native_job_plan WHERE job_id=$1", [jobId]);
  const steps = await getPool().query<{ count: string }>("SELECT COUNT(*)::text AS count FROM native_job_step WHERE job_id=$1", [jobId]);
  const effects = await getPool().query<{ state: string; step: string; actual_cost_microusd: string; reservation_microusd: string; output: unknown }>("SELECT state,step,actual_cost_microusd::text,reservation_microusd::text,output FROM effect WHERE job_id=$1", [jobId]);
  const modelEffects = effects.rows.filter((effect) => effect.step === "producer-model-call");
  const usage = modelEffects.reduce((total, effect) => {
    const raw = effect.output && typeof effect.output === "object" && "usage" in effect.output ? effect.output.usage as Record<string, unknown> : {};
    for (const key of ["inputTokens", "outputTokens", "cachedInputTokens", "cacheWriteTokens"] as const) total[key] += typeof raw[key] === "number" ? raw[key] : 0;
    return total;
  }, { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0 });
  const result = accepted.rows[0] ? evaluateNativeQuality({ caseId, document: accepted.rows[0].document, direction, plan: plan.rows[0] ? nativePlanSchema.parse(plan.rows[0].plan) : null, ...(base?.rows[0] ? { base: nativeDocumentSchema.parse(base.rows[0].document) } : {}), targetSectionId: typeof row.request.targetSectionId === "string" ? row.request.targetSectionId : null, selectedSourceIds: Array.isArray(row.request.sourceAssetIds) ? row.request.sourceAssetIds.filter((item): item is string => typeof item === "string") : [] }) : null;
  process.stdout.write(JSON.stringify({ caseId, jobId, jobState: row.state, savedPlan: Boolean(plan.rows[0]), confirmedMusicalSteps: Number(steps.rows[0]?.count ?? 0), acceptedRevisionId: accepted.rows[0]?.id ?? null, evidenceLevel: !accepted.rows[0] ? "no-accepted-score" : accepted.rows[0].producer.provider === "openai-deep-agent" ? "real-model/structural-unheard" : "scripted-or-other/structural-unheard", matchedFixedBrief: direction === nativeQualityCases.find((item) => item.id === caseId)?.brief, elapsedSeconds: Math.round((row.updated_at.getTime() - row.created_at.getTime()) / 1000), observedCostUsd: Number(row.actual_cost_microusd) / 1_000_000, modelCalls: modelEffects.length, usage, unresolvedEffects: effects.rows.filter((effect) => !["succeeded", "failed"].includes(effect.state)).map((effect) => ({ step: effect.step, state: effect.state, heldUsd: Number(effect.reservation_microusd) / 1_000_000 })), score: result, note: "Structure and provider telemetry only. Null human-review fields are not zero scores; no audio was heard by this evaluator." }, null, 2) + "\n");
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : "Native evaluation failed") + "\n");
  process.exitCode = 1;
} finally { await closePool(); }
