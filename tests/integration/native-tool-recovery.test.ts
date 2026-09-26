import { randomUUID } from "node:crypto";
import { AIMessage, fakeModel } from "@pocket/core/test-support";
import { createNativeJob, createNativeLibrary, createProject, dispatchOutbox, getPool, jobSnapshot, nativeSnapshot, claimJobById, resumeNativePartialJob } from "@pocket/core";
import { processJob } from "@pocket/worker";
import { expect, it } from "vitest";

it("recovers from parallel invalid Nexus inspection and schema errors, then commits real native music", async () => {
  const pool = getPool();
  const ownerId = (await pool.query<{ id: string }>("INSERT INTO app_user(provider_subject,display_name) VALUES($1,'Tool recovery owner') RETURNING id", [`recovery-${randomUUID()}`])).rows[0]!.id;
  const projectId = (await createProject(ownerId, "Recoverable producer tools")).id;
  try {
    const accepted = await createNativeJob({ ownerId, projectId, kind: "native-generation", idempotencyKey: `tool-recovery-${randomUUID()}`, request: { direction: "A four-bar lead phrase", sourceAssetIds: [], expectedNativeHeadId: null }, expectedHeadId: null });
    await dispatchOutbox();
    const job = await claimJobById(accepted.id, "tool-recovery-worker");
    if (!job) throw new Error("Job was not claimable");
    const form = { title: "Recovered lead", tempoBpm: 92, meter: { numerator: 4, denominator: 4 }, sections: [{ id: "whole", name: "Whole", bars: 4 }], parts: [{ id: "lead", name: "Lead", role: "melody", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, motifs: [], placements: [], freeNotes: [{ beat: 0, durationBeats: 1, pitch: 64, velocity: 0.7 }] }] };
    const model = fakeModel()
      .respondWithTools([
        { name: "inspect_native_capability", args: { path: "beatbox8Pattern.length" } },
        { name: "inspect_native_capability", args: { path: "/beatbox8Pattern/length?" } },
        { name: "inspect_native_capability", args: { path: 42 } },
        { name: "discover_native_capabilities", args: { query: "beatbox8Pattern" } },
        { name: "search_native_resources", args: { query: "synth" } },
        { name: "search_audiotool_presets", args: { deviceType: "heisenberg", query: "warm" } }
      ])
      .respondWithTools([{ name: "inspect_native_capability", args: { path: "/beatbox8Pattern/length" } }, { name: "compose_native_form", args: form }])
      .respond(new AIMessage("The editable lead phrase is complete."));
    await processJob(job, { scriptedModel: model, library: createNativeLibrary(null) });
    const snapshot = await jobSnapshot(ownerId, accepted.id);
    expect(snapshot.state, snapshot.error_message ?? "").toBe("succeeded");
    const recoveryContext = JSON.stringify(model.calls[1]?.messages);
    expect(recoveryContext).toContain("INVALID_SCHEMA_PATH");
    expect(recoveryContext).toContain("INVALID_ARGUMENTS");
    expect(recoveryContext).toContain("OPTIONAL_LIBRARY_UNAVAILABLE");
    expect(recoveryContext).toContain("beatbox8Pattern");
    expect(recoveryContext).toContain("synth");
    expect((await nativeSnapshot(ownerId, projectId)).current?.document.parts[0]?.notes.some((note) => note.pitch === 64)).toBe(true);
  } finally {
    await pool.query("DELETE FROM native_revision_sync WHERE project_id=$1", [projectId]);
    await pool.query("DELETE FROM native_sync WHERE project_id=$1", [projectId]);
    await pool.query("DELETE FROM native_project_head WHERE project_id=$1", [projectId]);
    await pool.query("UPDATE job SET result_native_revision_id=NULL WHERE project_id=$1", [projectId]);
    await pool.query("DELETE FROM native_revision WHERE project_id=$1", [projectId]);
    await pool.query("DELETE FROM job WHERE project_id=$1", [projectId]);
    await pool.query("DELETE FROM project WHERE id=$1", [projectId]);
    await pool.query("DELETE FROM app_user WHERE id=$1", [ownerId]);
  }
}, 120_000);

it("pauses an unexpected graph tool failure only when model effects are confirmed, then resumes without repeating the first call", async () => {
  const pool = getPool();
  const ownerId = (await pool.query<{ id: string }>("INSERT INTO app_user(provider_subject,display_name) VALUES($1,'Graph recovery owner') RETURNING id", [`graph-recovery-${randomUUID()}`])).rows[0]!.id;
  const projectId = (await createProject(ownerId, "Unexpected tool recovery")).id;
  try {
    const accepted = await createNativeJob({ ownerId, projectId, kind: "native-generation", idempotencyKey: `graph-recovery-${randomUUID()}`, request: { direction: "A four-bar lead phrase", sourceAssetIds: [], expectedNativeHeadId: null }, expectedHeadId: null });
    await dispatchOutbox();
    const firstJob = await claimJobById(accepted.id, "graph-recovery-first");
    if (!firstJob) throw new Error("Job was not claimable");
    const brokenLibrary = { ...createNativeLibrary(null), searchPresets: () => Promise.reject(new TypeError("Unexpected local library defect")) };
    await processJob(firstJob, { scriptedModel: fakeModel().respondWithTools([{ name: "search_audiotool_presets", args: { deviceType: "heisenberg", query: "warm" } }]), library: brokenLibrary });
    const paused = await jobSnapshot(ownerId, accepted.id);
    const effects = (await pool.query("SELECT step,state,cost_status FROM effect WHERE job_id=$1 ORDER BY created_at", [accepted.id])).rows;
    expect(paused.state, `${paused.error_message ?? ""} ${JSON.stringify(effects)}`).toBe("needs_attention");
    expect(paused.error_code).toBe("NATIVE_PARTIAL");
    expect((await nativeSnapshot(ownerId, projectId)).current).toBeNull();

    await resumeNativePartialJob(ownerId, projectId, accepted.id);
    const resumed = await claimJobById(accepted.id, "graph-recovery-second");
    if (!resumed) throw new Error("Paused job was not claimable");
    const form = { title: "Resumed lead", tempoBpm: 92, meter: { numerator: 4, denominator: 4 }, sections: [{ id: "whole", name: "Whole", bars: 4 }], parts: [{ id: "lead", name: "Lead", role: "melody", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, motifs: [], placements: [], freeNotes: [{ beat: 0, durationBeats: 1, pitch: 64, velocity: 0.7 }] }] };
    const continuation = fakeModel().respondWithTools([{ name: "compose_native_form", args: form }]).respond(new AIMessage("The resumed arrangement is structurally complete."));
    await processJob(resumed, { scriptedModel: continuation, library: createNativeLibrary(null) });
    expect((await jobSnapshot(ownerId, accepted.id)).state).toBe("succeeded");
    expect(JSON.stringify(continuation.calls[0]?.messages)).toContain("Continue this same unfinished request");
  } finally {
    await pool.query("DELETE FROM native_revision_sync WHERE project_id=$1", [projectId]);
    await pool.query("DELETE FROM native_sync WHERE project_id=$1", [projectId]);
    await pool.query("DELETE FROM native_project_head WHERE project_id=$1", [projectId]);
    await pool.query("UPDATE job SET result_native_revision_id=NULL WHERE project_id=$1", [projectId]);
    await pool.query("DELETE FROM native_revision WHERE project_id=$1", [projectId]);
    await pool.query("DELETE FROM job WHERE project_id=$1", [projectId]);
    await pool.query("DELETE FROM project WHERE id=$1", [projectId]);
    await pool.query("DELETE FROM app_user WHERE id=$1", [ownerId]);
  }
}, 120_000);
