import { randomUUID } from "node:crypto";
import { createOfflineDocument } from "@pocket/core/test-support";
import { afterAll, beforeAll, expect, it } from "vitest";
import { advanceNativeSync, applyNativeSnapshot, beginNativeSync, canonicalHash, claimJobById, commitNativeRevision, createNativeJob, createProject, dispatchOutbox, finishNativeSync, getPool, heartbeat, jobSnapshot, nativeDocumentSchema, nativeSnapshot, nativeStructuralReadback, seedNativeDocument } from "@pocket/core";
import { boundedNativeWait, nativeSynchronization } from "@pocket/worker";

let owner = "";
beforeAll(async () => { owner = (await getPool().query("INSERT INTO app_user(provider_subject,display_name) VALUES($1,'Export layout test') RETURNING id", [randomUUID()])).rows[0].id; });
afterAll(async () => {
  await getPool().query("DELETE FROM native_revision_sync WHERE owner_id=$1", [owner]);
  await getPool().query("DELETE FROM native_sync WHERE owner_id=$1", [owner]);
  await getPool().query("DELETE FROM native_project_head WHERE owner_id=$1", [owner]);
  await getPool().query("UPDATE job SET result_native_revision_id=NULL WHERE owner_id=$1", [owner]);
  await getPool().query("DELETE FROM native_revision WHERE owner_id=$1", [owner]);
  await getPool().query("DELETE FROM job WHERE owner_id=$1", [owner]);
  await getPool().query("DELETE FROM project WHERE owner_id=$1", [owner]);
  await getPool().query("DELETE FROM app_user WHERE id=$1", [owner]);
});

async function setup() {
  const project = await createProject(owner, "Mixed note export");
  const command = await createNativeJob({ ownerId: owner, projectId: project.id, kind: "native-generation", idempotencyKey: randomUUID(), request: { direction: "A groove with a fill" }, expectedHeadId: null });
  await dispatchOutbox();
  const generation = (await claimJobById(command.id, "export-layout-test"))!;
  const base = seedNativeDocument("A groove with a fill");
  const document = nativeDocumentSchema.parse({ ...base,
    motifs: [{ id: "pulse", partId: "starting-voice", name: "Pulse", lengthTicks: 3840, notes: [{ id: "hit", startTick: 0, durationTicks: 480, pitch: 60, velocity: 0.7 }] }],
    parts: [{ ...base.parts[0], placements: [{ id: "repeat", motifId: "pulse", startTick: 0, repeats: 4, transpose: 0 }], notes: [{ id: "fill", startTick: 8000, durationTicks: 240, pitch: 64, velocity: 0.8 }] }]
  });
  await commitNativeRevision(generation, document, "Fixture", {});
  const revision = (await nativeSnapshot(owner, project.id)).current!;
  const newCopyJob = async () => {
    const made = await createNativeJob({ ownerId: owner, projectId: project.id, kind: "native-sync", idempotencyKey: randomUUID(), request: { baseNativeRevisionId: revision.id, expectedNativeHeadId: revision.id }, expectedHeadId: revision.id });
    await dispatchOutbox();
    return (await claimJobById(made.id, "export-copy-test"))!;
  };
  const offline = await createOfflineDocument({ validated: true });
  let creates = 0;
  const connection = { client: {
    projects: { createProject: async () => {
      const checkpoint = (await getPool().query("SELECT mapping_version FROM native_revision_sync WHERE revision_id=$1", [revision.id])).rows[0];
      expect(checkpoint.mapping_version).toBe("nexus-native-v9");
      creates++;
      return { project: { name: "projects/layout-fixture" } };
    } },
    samples: { upload: (): Promise<never> => Promise.reject(new Error("Unexpected sample upload")) },
    open: () => Promise.resolve(Object.assign(offline, { start: async () => {}, stop: async () => {}, dawUrl: "https://offline.invalid/studio" }))
  }, awaitTokenPersistence: async () => {} };
  return { project, revision, document, newCopyJob, offline, connection, creates: () => creates };
}

it("stops the SDK's endless retry when a bounded remote wait gives up", async () => {
  let attempts = 0, aborted = false;
  // Like the Audiotool SDK on an unresolvable host: retry until the call's signal aborts.
  const sdkLike = async (signal: AbortSignal) => {
    while (!signal.aborted) { attempts++; await new Promise((resolve) => setTimeout(resolve, 20)); }
    aborted = true;
    return new Error("createProject was aborted");
  };
  const job = { deadlineAt: new Date(Date.now() + 150).toISOString() } as Parameters<typeof boundedNativeWait>[1];
  await expect(boundedNativeWait(sdkLike, job, new AbortController().signal, "native project create")).rejects.toThrow(/timed out after dispatch/);
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(aborted).toBe(true);
  const settled = attempts;
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(attempts).toBe(settled);
});

it("pins new v9 copies before dispatch and verifies the separated layout through the worker", async () => {
  const test = await setup();
  const job = await test.newCopyJob();
  const timer = setInterval(() => { void heartbeat(job); }, 500);
  try {
    await nativeSynchronization(job, new AbortController().signal, test.connection);
    expect(test.creates()).toBe(1);
    expect(test.offline.queryEntities.ofTypes("noteTrack").get()).toHaveLength(2);
    expect((await nativeSnapshot(owner, test.project.id)).synchronization).toMatchObject({ state: "verified", mappingVersion: "nexus-native-v9" });
    expect((await jobSnapshot(owner, job.id)).state).toBe("succeeded");
  } finally { clearInterval(timer); }
});

it.each([
  { version: null, state: "created" }, { version: null, state: "apply_in_flight" },
  { version: "nexus-native-v8", state: "created" }, { version: "nexus-native-v8", state: "apply_in_flight" }
] as const)("recovers an interrupted $version / $state copy without changing layout or duplicating effects", async ({ version, state }) => {
  const test = await setup();
  const job = await test.newCopyJob();
  const timer = setInterval(() => { void heartbeat(job); }, 500);
  try {
    expect((await beginNativeSync(job, test.revision.documentHash)).mappingVersion).toBe("nexus-native-v9");
    await getPool().query("UPDATE native_revision_sync SET mapping_version=$2 WHERE revision_id=$1", [test.revision.id, version]);
    await advanceNativeSync(job, "create_in_flight", "created", { remoteProjectName: "projects/layout-fixture" });
    const expected = await createOfflineDocument({ validated: true });
    await applyNativeSnapshot(expected, test.document, {}, {}, {}, "nexus-native-v8");
    if (state === "apply_in_flight") {
      await advanceNativeSync(job, "created", "apply_in_flight", { remoteUrl: "https://offline.invalid/studio" });
      await applyNativeSnapshot(test.offline, test.document, {}, {}, {}, "nexus-native-v8");
    }
    await nativeSynchronization(job, new AbortController().signal, test.connection);
    expect(test.creates()).toBe(0);
    expect(nativeStructuralReadback(test.offline)).toEqual(nativeStructuralReadback(expected));
    expect((await nativeSnapshot(owner, test.project.id)).synchronization).toMatchObject({ state: "verified", mappingVersion: "nexus-native-v8" });
    expect((await jobSnapshot(owner, job.id)).state).toBe("succeeded");
  } finally { clearInterval(timer); }
});

it.each(["nexus-native-v7", "nexus-native-v8"])("rechecks the original %s verified hash and still detects Studio edits", async version => {
  const test = await setup();
  const first = await test.newCopyJob();
  await beginNativeSync(first, test.revision.documentHash);
  await getPool().query("UPDATE native_revision_sync SET mapping_version=$2 WHERE revision_id=$1", [test.revision.id, version]);
  await advanceNativeSync(first, "create_in_flight", "created", { remoteProjectName: "projects/layout-fixture" });
  await advanceNativeSync(first, "created", "apply_in_flight");
  await applyNativeSnapshot(test.offline, test.document, {}, {}, {}, "nexus-native-v8");
  const before = canonicalHash(nativeStructuralReadback(test.offline));
  await finishNativeSync(first, "projects/layout-fixture", "https://offline.invalid/studio", before, "apply_in_flight");
  const recheck = await test.newCopyJob();
  await nativeSynchronization(recheck, new AbortController().signal, test.connection);
  expect((await jobSnapshot(owner, recheck.id)).state).toBe("succeeded");
  expect((await nativeSnapshot(owner, test.project.id)).synchronization).toMatchObject({ state: "verified", mappingVersion: version, observedHash: before });
  const note = test.offline.queryEntities.ofTypes("note").get()[0]!;
  await test.offline.modify(t => t.update(note.fields.pitch, 72));
  const changed = canonicalHash(nativeStructuralReadback(test.offline));
  const conflict = await test.newCopyJob();
  await nativeSynchronization(conflict, new AbortController().signal, test.connection);
  expect((await jobSnapshot(owner, conflict.id)).error_code).toBe("NATIVE_REMOTE_CONFLICT");
  expect(canonicalHash(nativeStructuralReadback(test.offline))).toBe(changed);
  expect(test.creates()).toBe(0);
});
