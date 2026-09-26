import { describe, expect, it } from "vitest";
import { getConfig, producerTraceConfig, type JobRecord } from "@pocket/core";

describe("producer observability boundary", () => {
  it("keeps fixture runs offline and hides trace payloads by default", () => {
    expect(getConfig().FIXTURE_MODE).toBe(true);
    expect(process.env.LANGSMITH_TRACING).toBe("false");
    expect(process.env.LANGSMITH_HIDE_INPUTS).toBe("true");
    expect(process.env.LANGSMITH_HIDE_OUTPUTS).toBe("true");
  });

  it("correlates runs without copying a direction or source into metadata", () => {
    const job = {
      id: "job-1", attemptId: "attempt-2", leaseGeneration: 3,
      kind: "native-revision", ownerId: "private-owner", projectId: "private-project",
      request: { direction: "private musical direction", sourceName: "private.wav" }
    } as unknown as JobRecord;
    const trace = producerTraceConfig(job, "native", "test-model", 1);
    expect(trace).toMatchObject({
      runName: "native-construction",
      tags: ["pocket-producer", "native", "native-revision"],
      metadata: { job_id: "job-1", attempt_id: "attempt-2", lease_generation: 3, review_pass: 2 }
    });
    const serialized = JSON.stringify(trace);
    expect(serialized).not.toContain("private musical direction");
    expect(serialized).not.toContain("private.wav");
    expect(serialized).not.toContain("private-owner");
    expect(serialized).not.toContain("private-project");
  });
});
