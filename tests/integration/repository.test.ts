import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cancelJob,
  claimNextJob,
  closePool,
  createJob,
  createProject,
  dispatchOutbox,
  failJob,
  getPool,
  jobSnapshot,
  requireProject
} from "@pocket/core";

const subjectA = `test-owner-a-${randomUUID()}`;
const subjectB = `test-owner-b-${randomUUID()}`;
let ownerA = "";
let ownerB = "";
let projectId = "";

beforeAll(async () => {
  const owners = await getPool().query<{ id: string; provider_subject: string }>(
    "INSERT INTO app_user(provider_subject,display_name) VALUES($1,'Test owner A'),($2,'Test owner B') RETURNING id,provider_subject",
    [subjectA, subjectB]
  );
  ownerA = owners.rows.find((row) => row.provider_subject === subjectA)?.id ?? "";
  ownerB = owners.rows.find((row) => row.provider_subject === subjectB)?.id ?? "";
  projectId = (await createProject(ownerA, "Repository integration")).id;
});

afterAll(async () => {
  await getPool().query("DELETE FROM job WHERE project_id=$1", [projectId]);
  await getPool().query("DELETE FROM project WHERE id=$1", [projectId]);
  await getPool().query("DELETE FROM app_user WHERE provider_subject IN ($1,$2)", [subjectA, subjectB]);
  await closePool();
});

describe("durable job repository", () => {
  it("deduplicates identical requests and rejects key reuse", async () => {
    const idempotencyKey = `test-${randomUUID()}`;
    const first = await createJob({ ownerId: ownerA, projectId, kind: "generation", idempotencyKey, request: { direction: "Warm and spacious" } });
    const duplicate = await createJob({ ownerId: ownerA, projectId, kind: "generation", idempotencyKey, request: { direction: "Warm and spacious" } });
    expect(duplicate).toEqual({ id: first.id, duplicate: true });
    await expect(createJob({ ownerId: ownerA, projectId, kind: "generation", idempotencyKey, request: { direction: "Entirely different" } })).rejects.toMatchObject({ statusCode: 409 });
  });

  it("reclaims an expired lease with a new fencing generation", async () => {
    await dispatchOutbox();
    const firstClaim = await claimNextJob("worker-before-restart");
    expect(firstClaim).not.toBeNull();
    await getPool().query("UPDATE job SET lease_until=now()-interval '1 second' WHERE id=$1", [firstClaim?.id]);
    const secondClaim = await claimNextJob("worker-after-restart");
    expect(secondClaim?.id).toBe(firstClaim?.id);
    expect(secondClaim?.leaseGeneration).toBe((firstClaim?.leaseGeneration ?? 0) + 1);
    if (secondClaim) await failJob(secondClaim, "TEST_COMPLETE", "Expected integration-test terminal state");
    expect((await jobSnapshot(ownerA, secondClaim?.id ?? "")).state).toBe("failed");
  });

  it("records failed and cancelled revision jobs without crossing ownership", async () => {
    const cancelled = await createJob({ ownerId: ownerA, projectId, kind: "revision", idempotencyKey: `cancel-${randomUUID()}`, request: { direction: "Simplify drums and keep melody" } });
    await cancelJob(ownerA, cancelled.id);
    expect((await jobSnapshot(ownerA, cancelled.id)).state).toBe("cancel_requested");

    const failed = await createJob({ ownerId: ownerA, projectId, kind: "revision", idempotencyKey: `fail-${randomUUID()}`, request: { direction: "Unsupported revision scope" } });
    await dispatchOutbox();
    const claimed = await claimNextJob("revision-failure-worker");
    expect(claimed?.id).toBe(failed.id);
    if (claimed) await failJob(claimed, "UNSUPPORTED_REVISION", "Expected failed revision test");
    expect((await jobSnapshot(ownerA, failed.id)).state).toBe("failed");
    await expect(requireProject(ownerB, projectId)).rejects.toMatchObject({ statusCode: 404 });
    await expect(jobSnapshot(ownerB, cancelled.id)).rejects.toMatchObject({ statusCode: 404 });
  });
});
