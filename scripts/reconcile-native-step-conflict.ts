import { closePool, getPool, nativeDraftView, reconcileNativeStepConflict } from "@pocket/core";

try {
  const [jobId, expectedHash, action] = process.argv.slice(2);
  if (!jobId || !/^[a-f0-9]{8}-[a-f0-9-]{27}$/.test(jobId) || (action !== undefined && action !== "--apply")) throw new Error("Usage: node --import tsx scripts/reconcile-native-step-conflict.ts JOB_ID [INSPECTED_DRAFT_HASH --apply]");
  const job = (await getPool().query<{ owner_id: string; project_id: string }>("SELECT owner_id,project_id FROM job WHERE id=$1", [jobId])).rows[0];
  if (!job) throw new Error("Job not found");
  if (action === "--apply") {
    if (!expectedHash) throw new Error("An inspected draft hash is required");
    await reconcileNativeStepConflict(job.owner_id, job.project_id, jobId, expectedHash);
  }
  const draft = await nativeDraftView(job.owner_id, job.project_id, jobId);
  console.log(JSON.stringify({ applied: action === "--apply", jobId, documentHash: draft.documentHash, stepCount: draft.stepCount, headMatches: draft.headMatches, canContinue: draft.canContinue, continuationReason: draft.continuationReason, providerCallsDispatched: 0 }));
} finally { await closePool(); }
