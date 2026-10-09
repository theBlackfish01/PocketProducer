import { randomUUID } from "node:crypto";
import { AIMessage, fakeModel, scriptedBrief } from "@pocket/core/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claimJobById, createNativeJob, createNativeLibrary, createProject, dispatchOutbox, getPool, jobSnapshot, nativeArcEvidence, nativeDraftView, nativeFormOperations, nativeSnapshot, readNativeExample, readProjectActivity, type NativeOperation } from "@pocket/core";
import { processJob } from "@pocket/worker";
import { interpretNativeDirection } from "@pocket/core";

let ownerId = "", projectId = "";
beforeAll(async () => {
  ownerId = (await getPool().query<{ id: string }>("INSERT INTO app_user(provider_subject,display_name) VALUES($1,'Sound craft fixture') RETURNING id", [`sound-craft-${randomUUID()}`])).rows[0]!.id;
  projectId = (await createProject(ownerId, "Groove then rise fixture")).id;
});
afterAll(async () => {
  if (!projectId) return;
  await getPool().query("DELETE FROM native_revision_sync WHERE project_id=$1", [projectId]);
  await getPool().query("DELETE FROM native_sync WHERE project_id=$1", [projectId]);
  await getPool().query("DELETE FROM native_project_head WHERE project_id=$1", [projectId]);
  await getPool().query("UPDATE job SET result_native_revision_id=NULL WHERE project_id=$1", [projectId]);
  await getPool().query("DELETE FROM native_revision WHERE project_id=$1", [projectId]);
  await getPool().query("DELETE FROM job WHERE project_id=$1", [projectId]);
  await getPool().query("DELETE FROM effect WHERE prompt_assistance_id IN (SELECT id FROM prompt_assistance WHERE project_id=$1)", [projectId]);
  await getPool().query("DELETE FROM prompt_assistance WHERE project_id=$1", [projectId]);
  await getPool().query("DELETE FROM project WHERE id=$1", [projectId]);
  await getPool().query("DELETE FROM app_user WHERE id=$1", [ownerId]);
});

describe("scripted producer groove-to-rise production path", () => {
  it("keeps an inspected groove as a durable first step before constructing a contrasting middle and payoff", async () => {
    const direction = "Something synth and disco, something like Daft Punk, and in the middle there should be a very prominent upswing that's exciting somehow.";
    const groove = readNativeExample("disco-groove-study");
    const rise = readNativeExample("disco-rise-study");
    const ops = nativeFormOperations(rise.form, []);
    const structure = ops.find((item) => item.kind === "setStructure")!;
    const motifs = ops.filter((item) => item.kind === "defineMotif");
    const partOps = ops.filter((item) => item.kind === "addPart");
    const extraMotifs = motifs.filter((item) => !["pulse", "bass-question", "stabs"].includes(item.motif.id));
    const development: NativeOperation[] = [structure, ...extraMotifs,
      ...partOps.map((item): NativeOperation => ({ kind: "replacePlacements", partId: item.part.id, placements: item.part.placements })),
      { kind: "addAutomation", partId: "keys", automation: partOps.find((item) => item.part.id === "keys")!.part.automation[0]! },
      { kind: "setDelayBus", bus: { id: "short-echo", name: "Short echo", feedbackFactor: 0.27, stepCount: 2, stepLengthIndex: 2 } },
      { kind: "setSend", partId: "lead", busId: "short-echo", gain: 0.16 }
    ];
    // The requested upswing is a hard check because the captured brief records it.
    const checked = await interpretNativeDirection(ownerId, projectId, randomUUID(), { direction, expectedHeadId: null }, scriptedBrief({ construction: [{ kind: "rise", quote: "a very prominent upswing" }] }));
    const created = await createNativeJob({ ownerId, projectId, kind: "native-generation", idempotencyKey: "groove-then-rise", request: { direction, sourceAssetIds: [], expectedNativeHeadId: null, interpretationId: checked.interpretationId }, expectedHeadId: null });
    await dispatchOutbox();
    const job = await claimJobById(created.id, "sound-craft-fixture");
    expect(job).not.toBeNull();
    const model = fakeModel()
      .respondWithTools([{ name: "record_native_plan", args: { intent: "An original synth-disco pocket with a contrasting middle rise", sections: [{ name: "Pocket", purpose: "Set groove" }, { name: "Answer", purpose: "Change the response" }, { name: "Rise", purpose: "Increase motion" }, { name: "Arrival", purpose: "Release the rise" }], soundGoals: ["A tight rhythm and rubber bass"], hardConstraints: [], developmentTasks: ["Build groove first", "Change middle phrase and controls", "Make a distinct arrival"] } }])
      .respondWithTools([{ name: "compose_native_form", args: groove.form }])
      .respondWithTools([{ name: "inspect_native_section", args: { sectionId: "pocket" } }])
      .respondWithTools([{ name: "review_native_score", args: {} }])
      .respondWithTools([{ name: "apply_native_batch", args: { stepKey: "middle-rise-and-arrival", operations: development } }])
      .respondWithTools([{ name: "inspect_native_section", args: { sectionId: "rise" } }])
      .respondWithTools([{ name: "review_native_score", args: {} }])
      .respond(new AIMessage("The confirmed draft now has a different middle and arrival; listening remains pending."));
    await processJob(job!, { scriptedModel: model, library: createNativeLibrary(null) });
    expect((await jobSnapshot(ownerId, created.id)).state).toBe("succeeded");
    const draft = await nativeDraftView(ownerId, projectId, created.id);
    expect(draft.stepCount).toBe(2);
    const snapshot = await nativeSnapshot(ownerId, projectId);
    expect(snapshot.current?.document.bars).toBe(16);
    expect(snapshot.current?.document.sections.map((item) => item.name)).toEqual(["Pocket", "Answer", "Rise", "Arrival"]);
    expect(nativeArcEvidence(snapshot.current!.document).symbolicArcEvidenced).toBe(true);
    expect(snapshot.current?.document.audio.state).toBe("deferred");
    expect(snapshot.synchronization.state).toBe("local");
    const reviews = await getPool().query<{ creative_review_history: Array<{ documentHash: string; modelUsed: boolean }> }>("SELECT creative_review_history FROM native_job_plan WHERE job_id=$1", [created.id]);
    // The early groove is inspectable but lacks the requested middle rise:
    // preflight now saves the review allowance for the completed form.
    expect(JSON.stringify(model.calls[4]!.messages)).toContain("no review call was spent");
    expect(reviews.rows[0]?.creative_review_history).toHaveLength(1);
    expect(reviews.rows[0]!.creative_review_history[0]!.documentHash).toBe(snapshot.current!.documentHash);
    expect(reviews.rows[0]!.creative_review_history.every((review) => !review.modelUsed)).toBe(true);
    const capabilities = await getPool().query<{ payload: Record<string, unknown> }>("SELECT payload FROM job_event WHERE job_id=$1 AND event_type='capabilities' ORDER BY sequence DESC LIMIT 1", [created.id]);
    expect(capabilities.rows[0]?.payload).toMatchObject({ model: "scripted", library: "injected-test-client", nativeMixListening: false, sourceAnalysis: false });
    const activity = await readProjectActivity(ownerId, projectId, { limit: 100 });
    expect(activity.events.some((event) => event.payload.text.includes("source-sample listening is unavailable"))).toBe(false);
  }, 120_000);
});
