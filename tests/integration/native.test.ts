import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { advanceNativeSync, applyNativeOperations, beginNativeSync, claimJobById, commitNativeRevision, createNativeJob, createProject, dispatchOutbox, failJob, getPool, nativeSnapshot, requeueJob, selectNativeRevision, protectedPartHash, NativeToolSession, seedNativeDocument, fixtureConstruct, jobSnapshot, cancelJob, type JobRecord } from "@pocket/core";
import { processJob } from "@pocket/worker";

const subject = `native-test-${randomUUID()}`;
let ownerId = "";
let projectId = "";

beforeAll(async () => {
  ownerId = (await getPool().query<{ id: string }>("INSERT INTO app_user(provider_subject,display_name) VALUES($1,'Native test owner') RETURNING id", [subject])).rows[0]!.id;
  projectId = (await createProject(ownerId, "Native integration room")).id;
});

afterAll(async () => {
  if (!projectId) return;
  await getPool().query("DELETE FROM native_revision_sync WHERE project_id=$1", [projectId]);
  await getPool().query("DELETE FROM native_sync WHERE project_id=$1", [projectId]);
  await getPool().query("DELETE FROM native_project_head WHERE project_id=$1", [projectId]);
  await getPool().query("UPDATE job SET result_native_revision_id=NULL WHERE project_id=$1", [projectId]);
  await getPool().query("DELETE FROM native_revision WHERE project_id=$1", [projectId]);
  await getPool().query("DELETE FROM job WHERE project_id=$1", [projectId]);
  await getPool().query("DELETE FROM project WHERE id=$1", [projectId]);
  await getPool().query("DELETE FROM app_user WHERE id=$1", [ownerId]);
});

async function claim(id: string, worker = "native-test"): Promise<JobRecord> {
  await dispatchOutbox();
  const result = await claimJobById(id, worker);
  if (!result) throw new Error("Native job was not claimable");
  return result;
}

describe("audio-independent native job lifecycle", () => {
  it("replays a completed tool step after worker loss, then commits without a fake audio asset", async () => {
    const direction = "An evolving 64-bar ambient journey with eight editable parts";
    const request = { direction, sourceAssetIds: [], expectedNativeHeadId: null };
    const accepted = await createNativeJob({ ownerId, projectId, kind: "native-generation", idempotencyKey: "native-first-command", request, expectedHeadId: null });
    expect((await createNativeJob({ ownerId, projectId, kind: "native-generation", idempotencyKey: "native-first-command", request, expectedHeadId: null })).id).toBe(accepted.id);
    const first = await claim(accepted.id, "first-native-worker");
    expect(await claimJobById(accepted.id, "contender")).toBeNull();
    const session = new NativeToolSession(first, seedNativeDocument(direction));
    await fixtureConstruct(session, direction, []);
    expect(session.applied).toHaveLength(1);
    expect(await requeueJob(first, "TEST_WORKER_RESTART", "Replay recorded native step" )).toBe(true);
    const restarted = await claim(accepted.id, "restarted-native-worker");
    await processJob(restarted);
    const finished = await jobSnapshot(ownerId, accepted.id);
    expect(finished.state).toBe("succeeded");
    const snapshot = await nativeSnapshot(ownerId, projectId);
    expect(snapshot.current?.document.bars).toBe(64);
    expect(snapshot.current?.document.parts.length).toBeGreaterThanOrEqual(8);
    expect(snapshot.context?.audio).toBe("deferred");
    expect(snapshot.current?.producer.provider).toBe("deterministic-fixture");
    expect(snapshot.current?.producer.offlineValidation).toMatchObject({ readback: { drumMachines: 2 } });
    const legacy = await getPool().query("SELECT current_revision_id FROM project WHERE id=$1", [projectId]);
    expect(legacy.rows[0]?.current_revision_id).toBeNull();
  }, 60_000);

  it("creates a protected structural revision, restores explicitly and fences stale heads", async () => {
    const prior = await nativeSnapshot(ownerId, projectId);
    const first = prior.current!;
    const request = { direction: "Vary the rhythmic phrase in the later section", baseNativeRevisionId: first.id, expectedNativeHeadId: first.id, protectedPartIds: ["lead"], targetPartId: "soft-pulse", targetSectionId: "section-4", sourceAssetIds: [] };
    const accepted = await createNativeJob({ ownerId, projectId, kind: "native-revision", idempotencyKey: "native-protected-revision", request, expectedHeadId: first.id });
    await processJob(await claim(accepted.id));
    const second = await nativeSnapshot(ownerId, projectId);
    expect(second.currentRevisionId).not.toBe(first.id);
    expect(second.current?.structuralDiff.changedParts).toContain("soft-pulse");
    expect(second.current?.document.protectedPartIds).toContain("lead");
    expect(protectedPartHash(second.current!.document, "lead")).toBe(protectedPartHash(first.document, "lead"));
    expect(second.context?.documentHash).toBe(second.current?.documentHash);
    await expect(createNativeJob({ ownerId, projectId, kind: "native-revision", idempotencyKey: "stale-native-command", request, expectedHeadId: first.id })).rejects.toThrow(/head changed/);
    await selectNativeRevision(ownerId, projectId, first.id, second.currentRevisionId!);
    const restored = await nativeSnapshot(ownerId, projectId);
    expect(restored.currentRevisionId).toBe(first.id);
    expect(restored.context?.documentHash).toBe(first.documentHash);
    expect(restored.synchronization.state).toBe("local");
  }, 60_000);

  it("keeps accepted history after a cancelled or invalid protected revision", async () => {
    const base = await nativeSnapshot(ownerId, projectId);
    const request = { direction: "Change the instrument on the protected lead", baseNativeRevisionId: base.currentRevisionId, expectedNativeHeadId: base.currentRevisionId, protectedPartIds: ["lead"], targetPartId: "lead", targetSectionId: "section-4", sourceAssetIds: [] };
    const invalid = await createNativeJob({ ownerId, projectId, kind: "native-revision", idempotencyKey: "invalid-protected-change", request, expectedHeadId: base.currentRevisionId });
    await processJob(await claim(invalid.id));
    expect((await jobSnapshot(ownerId, invalid.id)).state).toBe("failed");
    const cancelled = await createNativeJob({ ownerId, projectId, kind: "native-revision", idempotencyKey: "cancelled-native-change", request: { ...request, direction: "Add a later-section variation" }, expectedHeadId: base.currentRevisionId });
    await cancelJob(ownerId, cancelled.id);
    expect((await jobSnapshot(ownerId, cancelled.id)).state).toBe("cancelled");
    expect((await nativeSnapshot(ownerId, projectId)).currentRevisionId).toBe(base.currentRevisionId);
    await expect(nativeSnapshot(randomUUID(), projectId)).rejects.toThrow(/not found/);
  }, 60_000);

  it("fences a remote create after worker restart instead of duplicating it", async () => {
    const before = await nativeSnapshot(ownerId, projectId);
    const revision = before.current!;
    const request = { baseNativeRevisionId: revision.id, expectedNativeHeadId: revision.id };
    const created = await createNativeJob({ ownerId, projectId, kind: "native-sync", idempotencyKey: "native-sync-checkpoint", request, expectedHeadId: revision.id });
    const first = await claim(created.id, "native-sync-first");
    const initial = await beginNativeSync(first, revision.documentHash);
    expect(initial).toMatchObject({ state: "create_in_flight", createdNow: true, remoteProjectName: null });
    expect((await nativeSnapshot(ownerId, projectId)).synchronization.state).toBe("applying");
    expect(await requeueJob(first, "TEST_WORKER_RESTART", "Remote dispatch not replayable")).toBe(true);
    const restarted = await claim(created.id, "native-sync-restart");
    const checkpoint = await beginNativeSync(restarted, revision.documentHash);
    expect(checkpoint).toMatchObject({ state: "create_in_flight", createdNow: false, remoteProjectName: null });
    await expect(createNativeJob({ ownerId, projectId, kind: "native-sync", idempotencyKey: "second-sync-command", request, expectedHeadId: revision.id })).rejects.toThrow(/already active/);
    await advanceNativeSync(restarted, "create_in_flight", "uncertain", { errorMessage: "Reconcile prior create" });
    expect((await nativeSnapshot(ownerId, projectId)).synchronization.state).toBe("uncertain");
    await cancelJob(ownerId, created.id);
  });

  it("rejects an objective-only revision at the immutable commit boundary", async () => {
    const before = await nativeSnapshot(ownerId, projectId);
    const base = before.current!;
    const request = { direction: "Rename the objective only", baseNativeRevisionId: base.id, expectedNativeHeadId: base.id, protectedPartIds: [], sourceAssetIds: [] };
    const accepted = await createNativeJob({ ownerId, projectId, kind: "native-revision", idempotencyKey: "native-noop-commit", request, expectedHeadId: base.id });
    const job = await claim(accepted.id);
    const textOnly = applyNativeOperations(base.document, [{ kind: "setObjective", objective: "Different words, unchanged music" }]);
    await expect(commitNativeRevision(job, textOnly, "Text only", { provider: "test" })).rejects.toThrow(/no musical structure/);
    await failJob(job, "NO_MUSICAL_CHANGE", "Only the objective text changed");
    expect((await nativeSnapshot(ownerId, projectId)).currentRevisionId).toBe(base.id);
  });
});
