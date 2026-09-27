import { describe, expect, it } from "vitest";
import { JobControlError, type JobRecord } from "@pocket/core";
import { processJob, withLeaseMonitor } from "@pocket/worker";

const job: JobRecord = {
  id: "00000000-0000-4000-8000-000000000001",
  ownerId: "00000000-0000-4000-8000-000000000002",
  projectId: "00000000-0000-4000-8000-000000000003",
  kind: "native-generation",
  state: "running",
  stage: "constructing",
  request: {},
  baseRevisionId: null,
  expectedHeadRevisionId: null,
  leaseOwner: "monitor-test",
  leaseGeneration: 1,
  attemptId: "00000000-0000-4000-8000-000000000004",
  leaseUntil: new Date(Date.now() + 3_000).toISOString(),
  deadlineAt: new Date(Date.now() + 30_000).toISOString(),
  attempts: 1,
  cancellationRequestedAt: null
};

const waitForAbort = (signal: AbortSignal) => new Promise<void>((_resolve, reject) => {
  signal.addEventListener("abort", () => reject(signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason))), { once: true });
});

describe("worker lease monitor", () => {
  it("rejects retired payloads before consulting the database or a provider", async () => {
    await expect(processJob({ ...job, kind: "generation" } as unknown as JobRecord)).rejects.toThrow("Unsupported retired job kind");
  });
  it("turns a heartbeat database failure into a typed monitor-unavailable abort", async () => {
    await expect(withLeaseMonitor(job, waitForAbort, {
      intervalMs: 5,
      renew: () => Promise.reject(new Error("database connection interrupted"))
    })).rejects.toMatchObject({ name: "JobControlError", code: "MONITOR_UNAVAILABLE" });
  });

  it("renews a slow stage and propagates the authoritative typed control reason", async () => {
    let renewals = 0;
    try {
      await withLeaseMonitor(job, waitForAbort, {
        intervalMs: 5,
        renew: () => Promise.resolve(++renewals < 3 ? null : "LEASE_LOST")
      });
      throw new Error("Expected lease monitor to stop the slow stage");
    } catch (error) {
      expect(error).toBeInstanceOf(JobControlError);
      expect(error).toMatchObject({ code: "LEASE_LOST" });
      expect(renewals).toBe(3);
    }
  });
});
