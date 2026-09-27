import type { JobRecord } from "./db/repository.js";

// Only stable application identifiers and bounded enums belong in trace
// metadata. Directions, source names, plans and provider payloads are private.
export function producerTraceConfig(job: JobRecord, workflow: "native", model: string, pass?: number) {
  return {
    runName: "native-construction",
    tags: ["pocket-producer", workflow, job.kind],
    metadata: {
      job_id: job.id,
      attempt_id: job.attemptId,
      lease_generation: job.leaseGeneration,
      job_kind: job.kind,
      workflow,
      model,
      ...(pass === undefined ? {} : { review_pass: pass + 1 })
    }
  };
}
