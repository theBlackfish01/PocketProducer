import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  analyzePreview, appendJobEvent, claimNextJob, commitCancelled, commitRevision, compileArrangement, decodeWav, dispatchOutbox, failJob,
  getConfig, getPool, getRevision, heartbeat, isCancelled, produceArrangement, protectedTrackHash, providerAvailability,
  measureDecodedWav, recordAudioAnalysis, renderAssets, renderComposition, safeStoragePath, simplifyDrums, validateComposition, writeNexusManifest, type AudioAnalysis, type JobRecord
} from "@pocket/core";

const config = getConfig();
const workerId = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
let stopping = false;

process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function stage(job: JobRecord, name: string, message: string) {
  await appendJobEvent(job.id, "stage", { stage: name, message }, name);
  if (!await heartbeat(job, workerId)) throw new Error("Worker lease lost");
  if (await isCancelled(job)) throw Object.assign(new Error("CANCELLED"), { code: "CANCELLED" });
}

async function generation(job: JobRecord): Promise<void> {
  const direction = typeof job.request.direction === "string" ? job.request.direction : "Make a warm, restrained instrumental.";
  const requestedSource = typeof job.request.sourceAssetId === "string" ? job.request.sourceAssetId : undefined;
  const assets = await renderAssets(job.ownerId, job.projectId);
  const sourceAssetId = requestedSource && assets.some((asset) => asset.id === requestedSource) ? requestedSource : assets[0]?.id;
  let sourceAnalysis: AudioAnalysis | undefined;
  if (sourceAssetId) {
    const source = assets.find((asset) => asset.id === sourceAssetId);
    if (source) {
      const bytes = await readFile(source.path);
      const measured = measureDecodedWav(decodeWav(bytes));
      sourceAnalysis = await analyzePreview({ jobId: job.id, path: source.path, hash: createHash("sha256").update(bytes).digest("hex"), purpose: "source-analysis", ...measured });
    }
  }
  await stage(job, "planning", "Shaping the arrangement");
  const producer = await produceArrangement({ jobId: job.id, direction, hasSource: Boolean(sourceAssetId) });
  await stage(job, "composing", "Writing parts into the Sunroom palette");
  let composition = validateComposition(compileArrangement(producer.plan, sourceAssetId));
  await stage(job, "rendering", "Rendering a real 48 kHz preview");
  const outputDirectory = safeStoragePath(job.ownerId, job.projectId, "renders", job.id);
  let render = await renderComposition(composition, outputDirectory, assets);
  await stage(job, "checking", "Checking timing, headroom and source lineage");
  if (render.rms < 0.001 || render.nonSilentRatio < 0.01 || render.peak <= 0) throw new Error("Rendered preview is silent");
  const previewBytes = await readFile(render.previewPath);
  const analysis = await analyzePreview({ jobId: job.id, path: render.previewPath, hash: createHash("sha256").update(previewBytes).digest("hex"), purpose: "preview-critique", durationSeconds: render.durationSeconds, peak: render.peak, rms: render.rms, nonSilentRatio: render.nonSilentRatio });
  let repairedDrums = 0;
  if (analysis.status === "available" && analysis.repairAction === "simplify-drums" && config.MAX_AUDIO_CRITIQUE_PASSES > 0) {
    const protectedMelody = protectedTrackHash(composition, "melody");
    const simplified = simplifyDrums(composition);
    if (simplified.removed > 0 && protectedTrackHash(simplified.composition, "melody") === protectedMelody) {
      composition = validateComposition(simplified.composition);
      repairedDrums = simplified.removed;
      render = await renderComposition(composition, join(outputDirectory, "repair-1"), assets);
    }
  }
  const revisionId = await commitRevision(job, {
    composition, previewPath: render.previewPath, stems: render.stems, waveformPeaks: render.waveformPeaks, durationSeconds: render.durationSeconds,
    peak: render.peak, rms: render.rms, nonSilentRatio: render.nonSilentRatio, title: producer.plan.title,
    summary: `Created a ${producer.plan.tempoBpm} BPM ${producer.plan.energy < 0.5 ? "restrained" : "energized"} instrumental${sourceAssetId ? " with the supplied source" : " from the owned Sunroom palette"}.${repairedDrums ? ` Gemini critique triggered one bounded repair that removed ${repairedDrums} Groove hi-hat hits.` : ""}`,
    protectedTrackHashes: {}, producer: { ...producer, analysisStatus: analysis.status, analysisUsage: analysis.usage, repairAction: analysis.repairAction }
  });
  for (const item of [sourceAnalysis, analysis]) {
    if (!item) continue;
    try { await recordAudioAnalysis({ ownerId: job.ownerId, projectId: job.projectId, revisionId, analysis: item }); }
    catch { await appendJobEvent(job.id, "analysis_record_failed", { purpose: item.purpose, message: "The audio version is safe; analysis metadata could not be stored." }); }
  }
}

async function revision(job: JobRecord): Promise<void> {
  if (!job.baseRevisionId) throw new Error("Revision job is missing its base revision");
  const baseRow = await getRevision(job.ownerId, job.baseRevisionId);
  const base = validateComposition(baseRow.composition);
  const direction = typeof job.request.direction === "string" ? job.request.direction : "Simplify the drums; keep the melody.";
  if (!/drum/i.test(direction) || !/simpl|less|space|restrain/i.test(direction)) throw new Error("This milestone supports drum simplification revisions; make the requested scope explicit");
  await stage(job, "planning", "Locking the melody and scoping the drum change");
  const beforeHash = protectedTrackHash(base, "melody");
  const { composition, removed } = simplifyDrums(base);
  const afterHash = protectedTrackHash(composition, "melody");
  if (beforeHash !== afterHash) throw new Error("Protected melody validation failed");
  await stage(job, "rendering", "Re-rendering only the changed arrangement");
  const assets = await renderAssets(job.ownerId, job.projectId);
  const outputDirectory = safeStoragePath(job.ownerId, job.projectId, "renders", job.id);
  const render = await renderComposition(composition, outputDirectory, assets);
  const baseStems = baseRow.stems as Record<string, string>;
  if (baseStems.melody) {
    await mkdir(outputDirectory, { recursive: true });
    const protectedPath = join(outputDirectory, "melody-protected.wav");
    await copyFile(baseStems.melody, protectedPath);
    render.stems.melody = baseStems.melody;
  }
  await stage(job, "checking", "Verifying the protected melody and revision scope");
  await commitRevision(job, {
    composition, previewPath: render.previewPath, stems: render.stems, waveformPeaks: render.waveformPeaks, durationSeconds: render.durationSeconds,
    peak: render.peak, rms: render.rms, nonSilentRatio: render.nonSilentRatio, title: String(baseRow.title),
    summary: `Removed ${removed} hi-hat hits from Groove. Melody structure and protected stem preserved.`,
    protectedTrackHashes: { melody: beforeHash }, producer: { provider: "validated-semantic-revision", direction, removed }
  });
}

async function exportRevision(job: JobRecord): Promise<void> {
  if (!job.baseRevisionId) throw new Error("Export job is missing its revision");
  const revision = await getRevision(job.ownerId, job.baseRevisionId);
  const composition = validateComposition(revision.composition);
  await stage(job, "exporting", "Preparing editable per-part stems for Nexus");
  const result = await writeNexusManifest({ revisionId: job.baseRevisionId, composition, stems: revision.stems as Record<string, string>, outputDirectory: safeStoragePath(job.ownerId, job.projectId, "exports") });
  const available = providerAvailability(config).audiotool;
  await getPool().query(
    `INSERT INTO project_export(owner_id,project_id,revision_id,job_id,provider,state,fidelity,manifest_path,error_message)
     VALUES($1,$2,$3,$4,'audiotool',$5,$6,$7,$8)
     ON CONFLICT(revision_id,provider) DO UPDATE SET job_id=EXCLUDED.job_id,state=EXCLUDED.state,fidelity=EXCLUDED.fidelity,manifest_path=EXCLUDED.manifest_path,error_message=EXCLUDED.error_message,updated_at=now()`,
    [job.ownerId, job.projectId, job.baseRevisionId, job.id, available ? "queued" : "needs_auth", { parts: result.manifest.parts }, result.path, available ? "Live authorization flow is configured but remote mutation is not verified." : "Audiotool app registration/OAuth is required for live project creation."]
  );
  await getPool().query("UPDATE job SET state='succeeded',stage=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_generation=$2", [job.id, job.leaseGeneration]);
  await appendJobEvent(job.id, "succeeded", { localManifest: result.path, liveState: available ? "pending-verification" : "needs-auth" });
}

async function processJob(job: JobRecord): Promise<void> {
  try {
    if (await isCancelled(job)) return await commitCancelled(job);
    if (job.kind === "generation") await generation(job);
    else if (job.kind === "revision") await revision(job);
    else await exportRevision(job);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "CANCELLED") await commitCancelled(job);
    else if (job.attempts < 2 && error instanceof Error && /timeout|rate|ECONN|lease/i.test(error.message)) {
      await getPool().query("UPDATE job SET state='queued',stage=NULL,lease_until=NULL,lease_owner=NULL,error_code='TRANSIENT_RETRY',error_message=$2,updated_at=now() WHERE id=$1 AND lease_generation=$3", [job.id, error.message.slice(0, 300), job.leaseGeneration]);
      await appendJobEvent(job.id, "retrying", { attempt: job.attempts, message: "A temporary dependency error will be retried once." });
    } else await failJob(job, "JOB_FAILED", error instanceof Error ? error.message : "Unknown worker error");
  }
}

process.stdout.write(`Pocket Producer worker ${workerId} started\n`);
while (!stopping) {
  await dispatchOutbox();
  const job = await claimNextJob(workerId);
  if (job) await processJob(job);
  else await new Promise((resolve) => setTimeout(resolve, 600));
}
process.stdout.write("Worker stopped after current job\n");
