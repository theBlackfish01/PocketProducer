import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { afterAll, beforeAll, expect, it } from "vitest";
import { appendPublicActivity, cancelJob, claimJobById, createNativeJob, createProject, dispatchOutbox, getPool, readProjectActivity, saveNativePlan } from "@pocket/core";
import { processJob } from "@pocket/worker";
import { appendJobEvent, listProjects, nativeFingerprint, nativeSnapshot } from "@pocket/core";

let ownerId = "";
const rooms: string[] = [];
beforeAll(async () => { ownerId = (await getPool().query<{ id: string }>("INSERT INTO app_user(provider_subject,display_name) VALUES($1,'Activity tests') RETURNING id", [`activity-${randomUUID()}`])).rows[0]!.id; });
afterAll(async () => {
  for (const id of rooms) {
    await getPool().query("DELETE FROM native_sync WHERE project_id=$1", [id]);
    await getPool().query("DELETE FROM native_project_head WHERE project_id=$1", [id]);
    await getPool().query("UPDATE job SET result_native_revision_id=NULL WHERE project_id=$1", [id]);
    await getPool().query("DELETE FROM native_revision WHERE project_id=$1", [id]);
    await getPool().query("DELETE FROM job WHERE project_id=$1", [id]);
    await getPool().query("DELETE FROM project WHERE id=$1", [id]);
  }
  await getPool().query("DELETE FROM app_user WHERE id=$1", [ownerId]);
});
async function room() { const id = (await createProject(ownerId, "Activity isolation")).id; rooms.push(id); return id; }
function input(projectId: string, key = randomUUID()) { return { ownerId, projectId, kind: "native-generation" as const, idempotencyKey: key, request: { direction: "A warm evolving instrumental", sourceAssetIds: [], expectedNativeHeadId: null }, expectedHeadId: null }; }

it("keeps ordinary copy validation neutral and reserves attention for an actual failure", async () => {
  const projectId = await room();
  const made = await createNativeJob(input(projectId));
  await dispatchOutbox();
  await processJob((await claimJobById(made.id, "copy-message-seed"))!);
  const revision = (await nativeSnapshot(ownerId, projectId)).current!;
  const sync = await createNativeJob({ ownerId, projectId, kind: "native-sync", idempotencyKey: randomUUID(), expectedHeadId: revision.id, request: { baseNativeRevisionId: revision.id } });
  await appendJobEvent(sync.id, "stage", {}, "validating");
  await appendJobEvent(sync.id, "retrying", {});
  let events = (await readProjectActivity(ownerId, projectId)).events.filter(value => value.jobId === sync.id);
  expect(events).toHaveLength(2);
  expect(events.every(value => !value.payload.text.includes("needs attention"))).toBe(true);
  await appendJobEvent(sync.id, "needs_attention", { code: "NATIVE_REMOTE_CONFLICT" });
  events = (await readProjectActivity(ownerId, projectId)).events.filter(value => value.jobId === sync.id);
  expect(events.at(-1)!.payload.text).toContain("needs attention");
});

it("accepts one command across contending tabs and replays the same receipt and direction", async () => {
  const projectId = await room(), command = input(projectId);
  const accepted = await Promise.all([createNativeJob(command), createNativeJob(command)]);
  expect(accepted[0].id).toBe(accepted[1].id);
  expect(accepted.filter((item) => item.duplicate)).toHaveLength(1);
  await expect(createNativeJob(input(projectId))).rejects.toThrow(/already active/);
  const page = await readProjectActivity(ownerId, projectId);
  expect(page.events.map((item) => item.payload.kind)).toEqual(["request"]);
  expect(page.actions).toMatchObject({ canSubmit: false, canStop: true });
  await cancelJob(ownerId, accepted[0].id);
  const stopped = await readProjectActivity(ownerId, projectId, { after: page.cursor });
  expect(stopped.events.map((item) => item.payload.kind)).toEqual(["stopped"]);
  expect(stopped.actions.canSubmit).toBe(true);
  const reset = await readProjectActivity(ownerId, projectId, { after: stopped.cursor + 500 });
  expect(reset.reset).toBe(true);
  expect(reset.nextCursor).toBe(stopped.cursor);
  expect(reset.events.map((event) => event.payload.kind)).toEqual(["request", "stopped"]);
});

it("recovers the same feed after a real killed process and two contending workers", async () => {
  const projectId = await room(), accepted = await createNativeJob(input(projectId));
  await dispatchOutbox();
  const children: ChildProcess[] = [];
  const start = (mode: string) => {
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/test-native-process.ts", accepted.id, mode], {
      cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "ignore", "pipe", "ipc"],
      // Only the deliberately killed checkpoint needs a short lease. Finishing
      // performs synchronous SDK validation, just like the production worker.
      env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL, APP_ENV: "test", FIXTURE_MODE: "true", DEV_LOCAL_AUTH: "true", OPENAI_API_KEY: "", GEMINI_API_KEY: "", GOOGLE_API_KEY: "", LANGSMITH_TRACING: "false", LANGSMITH_API_KEY: "", JOB_LEASE_SECONDS: mode === "checkpoint" ? "3" : "45" },
    });
    children.push(child); return child;
  };
  const message = (child: ChildProcess) => Promise.race([once(child, "message").then(([value]) => value as string), once(child, "exit").then(([code]) => { throw new Error(`Probe exited before result: ${String(code)}`); })]);
  try {
    const first = start("checkpoint"); expect(await message(first)).toBe("checkpoint");
    const before = await readProjectActivity(ownerId, projectId);
    expect(before.events.filter((event) => event.payload.kind === "music")).toHaveLength(1);
    const exited = once(first, "exit"); first.kill("SIGKILL"); await exited;
    await getPool().query("UPDATE job SET lease_until=now()-interval '1 second' WHERE id=$1", [accepted.id]);
    const a = start("finish"), b = start("finish");
    expect((await Promise.all([message(a), message(b)])).sort()).toEqual(["contended", "finished"]);
    const after = await readProjectActivity(ownerId, projectId);
    expect(after.job?.state).toBe("succeeded");
    expect(after.events.filter((event) => event.payload.kind === "request")).toHaveLength(1);
    expect(after.events.filter((event) => event.payload.kind === "music")).toHaveLength(1);
    expect(after.events.filter((event) => event.payload.kind === "saved")).toHaveLength(1);
    expect((await readProjectActivity(ownerId, projectId, { after: before.cursor })).events.some((event) => event.payload.kind === "saved")).toBe(true);
  } finally { for (const child of children) { if (child.exitCode === null && child.signalCode === null) { const stopped = once(child, "exit"); child.kill("SIGKILL"); await stopped; } } }
}, 45_000);

it("points public music updates at saved parts and outlines only the owner's listed versions", async () => {
  const projectId = await room(), accepted = await createNativeJob(input(projectId));
  await dispatchOutbox();
  await processJob((await claimJobById(accepted.id, "activity-fingerprint"))!);
  // List first so the owner-scoped revision read fills the cache, not the snapshot.
  const listed = (await listProjects(ownerId)).find((project) => project.id === projectId)!;
  const snapshot = await nativeSnapshot(ownerId, projectId);
  const document = snapshot.current!.document;
  expect(listed.fingerprint).toEqual(nativeFingerprint(document));
  expect(listed.fingerprint!.lanes.length).toBeGreaterThan(0);
  expect(snapshot.current!.fingerprint).toEqual(listed.fingerprint);
  expect(snapshot.versions.every((version) => version.fingerprint?.version === 1)).toBe(true);
  const music = (await readProjectActivity(ownerId, projectId)).events.filter((event) => event.payload.kind === "music");
  const pointed = music.filter((event) => event.payload.partIds?.length);
  expect(pointed.length).toBeGreaterThan(0);
  for (const event of pointed) {
    const names = event.payload.partIds!.map((id) => document.parts.find((part) => part.id === id)?.name);
    expect(names.every(Boolean)).toBe(true);
    expect(event.payload.text).toContain(names[0]!);
  }
  const other = (await getPool().query<{ id: string }>("INSERT INTO app_user(provider_subject,display_name) VALUES($1,'Other activity owner') RETURNING id", [`activity-other-${randomUUID()}`])).rows[0]!.id;
  try { expect((await listProjects(other)).some((project) => project.id === projectId)).toBe(false); }
  finally { await getPool().query("DELETE FROM app_user WHERE id=$1", [other]); }
});

it("publishes production worker changes once and references the actual saved version", async () => {
  const projectId = await room(), accepted = await createNativeJob(input(projectId));
  await dispatchOutbox();
  const job = await claimJobById(accepted.id, "activity-worker");
  expect(job).not.toBeNull();
  await processJob(job!);
  const page = await readProjectActivity(ownerId, projectId);
  expect(page.job?.state).toBe("succeeded");
  expect(page.events.some((event) => event.payload.kind === "music")).toBe(true);
  const saved = page.events.filter((event) => event.payload.kind === "saved");
  expect(saved).toHaveLength(1);
  expect(saved[0]!.payload).toMatchObject({ revisionId: page.headId, selected: true, ordinal: 1 });
  const steps = await getPool().query("SELECT ordinal,result_hash FROM native_job_step WHERE job_id=$1 ORDER BY ordinal", [accepted.id]);
  expect(page.events.filter((event) => event.payload.kind === "music").map((event) => [event.payload.step, event.payload.documentHash])).toEqual(steps.rows.map((step) => [step.ordinal, step.result_hash]));
  expect(JSON.stringify(page.events)).not.toMatch(/_nativeRun|lease_generation|AIMessage|LANGSMITH|api_key/i);
  await expect(saveNativePlan(job!, { intent: "Stale worker", sections: [{ name: "Opening", purpose: "Introduce the theme" }], soundGoals: ["Warm keys"], hardConstraints: [], developmentTasks: ["Develop the theme"] })).rejects.toThrow(/lease/i);
  expect((await readProjectActivity(ownerId, projectId)).cursor).toBe(page.cursor);
});

it("rolls back projection with state and serializes cursor commit order without missed late commits", async () => {
  const projectId = await room(), a = await getPool().connect(), b = await getPool().connect();
  try {
    await a.query("BEGIN");
    await appendPublicActivity(a, { ownerId, projectId }, "rolled-back", { version: 1, kind: "working", text: "Must not appear" });
    await a.query("ROLLBACK");
    expect((await readProjectActivity(ownerId, projectId)).events).toEqual([]);
    await a.query("BEGIN"); await b.query("BEGIN");
    await appendPublicActivity(a, { ownerId, projectId }, "first", { version: 1, kind: "working", text: "First" });
    let secondCommitted = false;
    const pending = appendPublicActivity(b, { ownerId, projectId }, "second", { version: 1, kind: "working", text: "Second" }).then(async () => { await b.query("COMMIT"); secondCommitted = true; });
    const snapshot = await readProjectActivity(ownerId, projectId);
    expect(snapshot.cursor).toBe(0); expect(secondCommitted).toBe(false);
    await a.query("COMMIT"); await pending;
    const tail = await readProjectActivity(ownerId, projectId, { after: snapshot.cursor, limit: 1 });
    expect(tail.events.map((event) => event.payload.text)).toEqual(["First"]);
    expect((await readProjectActivity(ownerId, projectId, { after: tail.nextCursor })).events.map((event) => event.payload.text)).toEqual(["Second"]);
    await a.query("BEGIN"); await appendPublicActivity(a, { ownerId, projectId }, "first", { version: 1, kind: "working", text: "Duplicate" }); await a.query("COMMIT");
    expect((await readProjectActivity(ownerId, projectId)).events).toHaveLength(2);
    await expect(readProjectActivity(randomUUID(), projectId)).rejects.toThrow(/not found/);
    await getPool().query("UPDATE project SET deleted_at=now() WHERE id=$1", [projectId]);
    await expect(readProjectActivity(ownerId, projectId)).rejects.toThrow(/not found/);
  } finally { await a.query("ROLLBACK"); await b.query("ROLLBACK"); a.release(); b.release(); }
});

it("does not reverse project and clock locks when selection overlaps a worker update", async () => {
  const projectId = await room();
  await getPool().query("INSERT INTO project_activity_clock(project_id) VALUES($1)", [projectId]);
  const selecting = await getPool().connect(), publishing = await getPool().connect();
  try {
    await selecting.query("BEGIN"); await publishing.query("BEGIN");
    await selecting.query("SELECT id FROM project WHERE id=$1 FOR UPDATE", [projectId]);
    await publishing.query("SELECT cursor FROM project_activity_clock WHERE project_id=$1 FOR UPDATE", [projectId]);
    // Mirrors selection's project -> clock order against a publisher that already
    // owns its clock. The old direct FK tried project KEY SHARE after this lock.
    await Promise.all([
      appendPublicActivity(publishing, { ownerId, projectId }, "worker", { version: 1, kind: "working", text: "Confirmed progress" }).then(() => publishing.query("COMMIT")),
      appendPublicActivity(selecting, { ownerId, projectId }, "selection", { version: 1, kind: "selected", text: "Explicit selection" }).then(() => selecting.query("COMMIT")),
    ]);
    expect((await readProjectActivity(ownerId, projectId)).events.map((event) => event.payload.text)).toEqual(["Confirmed progress", "Explicit selection"]);
  } finally { await Promise.all([selecting.query("ROLLBACK"), publishing.query("ROLLBACK")]); selecting.release(); publishing.release(); }
});
