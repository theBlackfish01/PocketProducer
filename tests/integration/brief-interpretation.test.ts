import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { cancelJob, captureMissingJobBrief, claimJobById, createNativeJob, createProject, dispatchOutbox, getPool, interpretNativeDirection, nativeSnapshot, readProjectActivity, type BriefGenerator } from "@pocket/core";
import { briefKeep, briefRole, scriptedBrief } from "@pocket/core/test-support";
import { processJob } from "@pocket/worker";

let ownerId = "", otherId = "";
const rooms: string[] = [];
beforeAll(async () => {
  for (const name of ["Brief tests", "Other brief owner"]) {
    const id = (await getPool().query<{ id: string }>("INSERT INTO app_user(provider_subject,display_name) VALUES($1,$2) RETURNING id", [`brief-${randomUUID()}`, name])).rows[0]!.id;
    if (ownerId) otherId = id; else ownerId = id;
  }
});
afterAll(async () => {
  for (const id of rooms) {
    await getPool().query("DELETE FROM native_sync WHERE project_id=$1", [id]);
    await getPool().query("DELETE FROM native_project_head WHERE project_id=$1", [id]);
    await getPool().query("UPDATE job SET result_native_revision_id=NULL WHERE project_id=$1", [id]);
    await getPool().query("DELETE FROM native_revision WHERE project_id=$1", [id]);
    await getPool().query("DELETE FROM job WHERE project_id=$1", [id]);
  }
  await getPool().query("DELETE FROM effect WHERE prompt_assistance_id IN (SELECT id FROM prompt_assistance WHERE owner_id=ANY($1::uuid[]))", [[ownerId, otherId]]);
  await getPool().query("DELETE FROM prompt_assistance WHERE owner_id=ANY($1::uuid[])", [[ownerId, otherId]]);
  for (const id of rooms) await getPool().query("DELETE FROM project WHERE id=$1", [id]);
  await getPool().query("DELETE FROM app_user WHERE id=ANY($1::uuid[])", [[ownerId, otherId]]);
});
async function room(owner = ownerId) { const id = (await createProject(owner, "Brief checks")).id; rooms.push(id); return id; }
const counted = (generator: BriefGenerator) => { const calls: string[] = []; return { calls, generator: ((context, tokens) => { calls.push(context); return generator(context, tokens); }) as BriefGenerator }; };

it("reads a fixture brief as guidance only, without a job, a version or spend", async () => {
  const projectId = await room();
  const checked = await interpretNativeDirection(ownerId, projectId, randomUUID(), { direction: "Keep the bass unchanged at 96 BPM", expectedHeadId: null });
  expect(checked).toMatchObject({ provenance: "fixture", checks: [], keep: [], guidance: [], rejected: [] });
  const effect = await getPool().query("SELECT e.step,e.state,e.actual_cost_microusd FROM effect e JOIN prompt_assistance p ON p.id=e.prompt_assistance_id WHERE p.id=$1", [checked.interpretationId]);
  expect(effect.rows[0]).toMatchObject({ step: "native-brief", state: "succeeded", actual_cost_microusd: "0" });
  expect((await getPool().query("SELECT 1 FROM job WHERE project_id=$1", [projectId])).rowCount).toBe(0);
});

it("captures validated checks on the job, replays a key without a second call and refuses a changed direction", async () => {
  const projectId = await room();
  const direction = "A 4-bar melody at 90 BPM with no drums";
  const { calls, generator } = counted(scriptedBrief({ tempoBpm: { value: 90, quote: "at 90 BPM" }, roles: [briefRole("absent", "drums", "no drums")], guidance: [{ quote: "A 4-bar melody", reason: "Length of the idea" }] }));
  const key = randomUUID();
  const checked = await interpretNativeDirection(ownerId, projectId, key, { direction, expectedHeadId: null }, generator);
  expect(checked).toMatchObject({ provenance: "scripted", checks: ["90 BPM", "No drums"], rejected: [] });
  expect(await interpretNativeDirection(ownerId, projectId, key, { direction, expectedHeadId: null }, generator)).toEqual(checked);
  expect(calls).toHaveLength(1);
  expect(JSON.parse(calls[0]!)).toMatchObject({ mode: "generation", direction, document: null });
  await expect(interpretNativeDirection(ownerId, projectId, key, { direction: "Something else entirely", expectedHeadId: null }, generator)).rejects.toThrow(/already used/);

  await expect(createNativeJob({ ownerId, projectId, kind: "native-generation", idempotencyKey: randomUUID(), expectedHeadId: null, request: { direction: `${direction}.`, interpretationId: checked.interpretationId } })).rejects.toMatchObject({ code: "INTERPRETATION_STALE", statusCode: 409 });
  const foreign = await room(otherId);
  await expect(createNativeJob({ ownerId: otherId, projectId: foreign, kind: "native-generation", idempotencyKey: randomUUID(), expectedHeadId: null, request: { direction, interpretationId: checked.interpretationId } })).rejects.toMatchObject({ code: "INTERPRETATION_STALE" });
  const jobKey = randomUUID();
  const made = await createNativeJob({ ownerId, projectId, kind: "native-generation", idempotencyKey: jobKey, expectedHeadId: null, request: { direction, interpretationId: checked.interpretationId } });
  expect(await createNativeJob({ ownerId, projectId, kind: "native-generation", idempotencyKey: jobKey, expectedHeadId: null, request: { direction, interpretationId: checked.interpretationId } })).toEqual({ id: made.id, duplicate: true });
  const stored = (await getPool().query<{ request: { _brief: { tempoBpm: { value: number }; roles: unknown[]; provenance: string } } }>("SELECT request FROM job WHERE id=$1", [made.id])).rows[0]!.request;
  expect(stored._brief).toMatchObject({ provenance: "scripted", tempoBpm: { value: 90 }, roles: [{ kind: "absent", role: "drums" }] });
});

it("stores and replays a mistaken clear-ending role as guidance without adding an FX requirement", async () => {
  const projectId = await room();
  const direction = "A 16-bar lead melody with a clear ending";
  const { calls, generator } = counted(scriptedBrief({
    totalBars: { value: 16, quote: "A 16-bar lead melody" },
    roles: [briefRole("required", "lead", "lead melody"), briefRole("required", "transitions", "with a clear ending")]
  }));
  const key = randomUUID();
  const input = { direction, expectedHeadId: null };
  const checked = await interpretNativeDirection(ownerId, projectId, key, input, generator);
  expect(checked.rejected).toEqual([]);
  expect(checked.guidance).toEqual([{ quote: "with a clear ending", reason: "Transitions can use existing parts; a separate FX part is not required" }]);
  expect(checked.checks.join(" ")).not.toContain("transitions");
  expect(await interpretNativeDirection(ownerId, projectId, key, input, generator)).toEqual(checked);
  expect(calls).toHaveLength(1);
  const made = await createNativeJob({ ownerId, projectId, kind: "native-generation", idempotencyKey: randomUUID(), expectedHeadId: null, request: { direction, interpretationId: checked.interpretationId } });
  const stored = (await getPool().query("SELECT request->'_brief' AS brief FROM job WHERE id=$1", [made.id])).rows[0]!.brief;
  expect(stored.totalBars.value).toBe(16);
  expect(stored.roles).toMatchObject([{ kind: "required", role: "lead" }]);
  expect(stored.guidance).toEqual(checked.guidance);
});

it("keeps a revision's worded parts, reports them with the request and rejects unmatched words", async () => {
  const projectId = await room();
  const generation = await createNativeJob({ ownerId, projectId, kind: "native-generation", idempotencyKey: randomUUID(), expectedHeadId: null, request: { direction: "A warm evolving instrumental" } });
  await dispatchOutbox();
  await processJob((await claimJobById(generation.id, "brief-seed"))!);
  const current = (await nativeSnapshot(ownerId, projectId)).current!;
  const kept = current.document.parts[0]!;
  const direction = `Brighten the ending, keep ${kept.name} unchanged and leave room for the pad`;
  const checked = await interpretNativeDirection(ownerId, projectId, randomUUID(), { direction, expectedHeadId: current.id }, scriptedBrief({
    keep: [briefKeep(`keep ${kept.name} unchanged`, { partId: kept.id }), briefKeep("leave room for the pad", { partId: kept.id }, "pad")]
  }));
  expect(checked).toMatchObject({ keep: [kept.name], checks: [`Keep unchanged: ${kept.name}`], rejected: [{ quote: "leave room for the pad" }] });
  await expect(interpretNativeDirection(ownerId, projectId, randomUUID(), { direction, expectedHeadId: randomUUID() }, scriptedBrief())).rejects.toMatchObject({ code: "HEAD_CHANGED" });
  const made = await createNativeJob({ ownerId, projectId, kind: "native-revision", idempotencyKey: randomUUID(), expectedHeadId: current.id, request: { direction, baseNativeRevisionId: current.id, expectedNativeHeadId: current.id, interpretationId: checked.interpretationId } });
  const request = (await readProjectActivity(ownerId, projectId)).events.find((event) => event.jobId === made.id && event.payload.kind === "request")!;
  expect(request.payload.scope).toContain(`Keeping as written: ${kept.name}`);
});

it("reads malformed parts as visible rejections, and records unreadable output as a paid attempt", async () => {
  const projectId = await room();
  // Best effort: a wrong-shaped field is shown to the person; the rest of the check still stands.
  const partial = await interpretNativeDirection(ownerId, projectId, randomUUID(), { direction: "A short pulse", expectedHeadId: null }, () => Promise.resolve({ value: { roles: "everything" }, usage: { inputTokens: 30, outputTokens: 10 } }));
  expect(partial.rejected).toEqual([{ quote: "(part of the interpretation)", reason: "This part of the check could not be read" }]);
  const key = randomUUID();
  await expect(interpretNativeDirection(ownerId, projectId, key, { direction: "A short pulse", expectedHeadId: null }, () => Promise.resolve({ value: "not an interpretation", usage: { inputTokens: 30, outputTokens: 10 } }))).rejects.toMatchObject({ code: "INTERPRETATION_UNAVAILABLE" });
  const effect = await getPool().query("SELECT state,cost_status FROM effect WHERE idempotency_key=$1", [key]);
  expect(effect.rows[0]).toMatchObject({ state: "failed", cost_status: "observed" });
  await expect(interpretNativeDirection(ownerId, projectId, key, { direction: "A short pulse", expectedHeadId: null }, scriptedBrief())).rejects.toMatchObject({ code: "INTERPRETATION_UNAVAILABLE" });
});

it("records an explicit no-check choice, and checks an older request's direction once when it runs", async () => {
  const projectId = await room();
  const request = { direction: "A gentle 16-bar theme", sourceAssetIds: [], expectedNativeHeadId: null };
  const sent = await createNativeJob({ ownerId, projectId, kind: "native-generation", idempotencyKey: randomUUID(), request, expectedHeadId: null });
  const stored = (await getPool().query<{ request: Record<string, unknown> }>("SELECT request FROM job WHERE id=$1", [sent.id])).rows[0]!.request;
  // Sent without an interpretation: guidance only, recorded and visible, never mistaken for an older job.
  expect(stored._brief).toMatchObject({ provenance: "none", sections: [], roles: [] });
  const activity = await readProjectActivity(ownerId, projectId);
  expect(activity.events.find((event) => event.payload.kind === "request")?.payload.scope).toContain("Sent without enforced checks");
  // A request from before captured briefs has none at all; its direction is checked once.
  await getPool().query("UPDATE job SET request=request - '_brief' WHERE id=$1", [sent.id]);
  await dispatchOutbox();
  const legacy = (await claimJobById(sent.id, "legacy-brief"))!;
  await captureMissingJobBrief(legacy);
  expect(legacy.request._brief).toMatchObject({ provenance: "fixture" });
  const attached = (await getPool().query<{ request: Record<string, unknown> }>("SELECT request FROM job WHERE id=$1", [sent.id])).rows[0]!.request;
  expect(attached._brief).toMatchObject({ provenance: "fixture" });
  // Idempotent: a later run neither checks again nor replaces the capture.
  await captureMissingJobBrief(legacy);
  const checks = await getPool().query("SELECT 1 FROM prompt_assistance p JOIN effect e ON e.prompt_assistance_id=p.id WHERE p.project_id=$1 AND e.step='native-brief'", [projectId]);
  expect(checks.rowCount).toBe(1);
  await cancelJob(ownerId, sent.id);
});
