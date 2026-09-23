import { claimJobById, closePool, createNativeJob, createProject, devOwnerId, dispatchOutbox, getConfig, getPool, jobSnapshot, listProjects, nativeSnapshot } from "@pocket/core";
import { processJob } from "@pocket/worker";

// One opt-in, ledger-bounded OpenAI construction. It never contacts Audiotool,
// invokes Gemini, renders audio or deletes an existing room.
const config = getConfig();
if (config.APP_ENV !== "development" || config.FIXTURE_MODE || !config.OPENAI_API_KEY) throw new Error("Live native verification requires development mode and the configured OpenAI key");
if (config.MAX_JOB_COST_USD > 0.25 || config.INITIAL_BUILD_API_BUDGET_USD > 5) throw new Error("The native verifier refuses a higher provider budget");
const ownerId = await devOwnerId();
const title = "Native OpenAI completed-blueprint verification 2026-09-23";
try {
  const existing = (await listProjects(ownerId)).find((project) => project.title === title);
  const project = existing ?? await createProject(ownerId, title);
  const previous = await getPool().query("SELECT id,state FROM job WHERE owner_id=$1 AND project_id=$2 AND kind='native-generation' ORDER BY created_at DESC LIMIT 1", [ownerId, project.id]);
  if (previous.rows[0]) {
    const result = await jobSnapshot(ownerId, String(previous.rows[0].id));
    const safeMessage = String(result.error_message ?? "").replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 240);
    const steps = await getPool().query("SELECT step_key,jsonb_array_length(operations) AS operation_count FROM native_job_step WHERE job_id=$1 ORDER BY ordinal", [previous.rows[0].id]);
    const effects = await getPool().query("SELECT provider,step,state,actual_cost_microusd,reservation_microusd FROM effect WHERE job_id=$1 ORDER BY created_at", [previous.rows[0].id]);
    const native = await nativeSnapshot(ownerId, project.id);
    console.log(JSON.stringify({ projectId: project.id, existingJobId: previous.rows[0].id, state: previous.rows[0].state, errorCode: result.error_code, errorMessage: safeMessage, revisionId: native.currentRevisionId, bars: native.current?.document.bars ?? null, tempoBpm: native.current?.document.tempoBpm ?? null, sectionNames: native.current?.document.sections.map((section) => section.name) ?? [], parts: native.current?.document.parts.length ?? null, steps: steps.rows, effects: effects.rows, noNewDispatch: true }));
  } else {
    const direction = "Build a 32-bar nocturnal electronic instrumental with a syncopated drum machine, warm bass, a memorable lead motif, two contrasting sections, spatial effects, and a restrained closing variation.";
    const accepted = await createNativeJob({ ownerId, projectId: project.id, kind: "native-generation", idempotencyKey: "native-openai-completed-2026-09-23", request: { direction, sourceAssetIds: [], expectedNativeHeadId: null }, expectedHeadId: null });
    await dispatchOutbox();
    const job = await claimJobById(accepted.id, "native-live-verifier");
    if (!job) throw new Error("Native verification job was not claimable");
    await processJob(job);
    const result = await jobSnapshot(ownerId, accepted.id);
    const native = await nativeSnapshot(ownerId, project.id);
    const effects = await getPool().query("SELECT provider,state,actual_cost_microusd,reservation_microusd FROM effect WHERE job_id=$1 ORDER BY created_at", [accepted.id]);
    console.log(JSON.stringify({ projectId: project.id, jobId: accepted.id, state: result.state, errorCode: result.error_code, revisionId: native.currentRevisionId, bars: native.current?.document.bars ?? null, parts: native.current?.document.parts.length ?? null, steps: native.current?.producer.steps ?? null, effects: effects.rows }));
  }
} finally {
  // LangGraph's checkpointer may keep an idle pool client alive after the
  // already-committed verification result. Do not leave this opt-in CLI hung.
  const guard = setTimeout(() => process.exit(process.exitCode ?? 0), 5_000);
  try { await closePool(); } finally { clearTimeout(guard); }
}
