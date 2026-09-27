import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { AIMessage, createOfflineDocument, fakeModel } from "@pocket/core/test-support";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { advanceNativeSync, applyNativeOperations, AudiotoolSessionExpiredError, beginNativeSync, beginOwnedSampleUpload, canonicalHash, claimJobById, commitNativeRevision, completeProviderEffect, createNativeJob, createNativeLibrary, createProject, dispatchOutbox, encodeWav, extendNativePartialJob, failJob, failProviderEffect, finishOwnedSampleUpload, getConfig, getPool, heartbeat, insertAsset, markEffectDispatched, markOwnedSampleUncertain, materializedNotes, nativeDraftView, nativePresetFingerprint, nativeSnapshot, needsAttentionJob, produceNative, profileOwnedSourceWav, readyOwnedSampleResources, reconcileNativeSyncReadback, recordNativeProducerCompletion, requeueJob, reserveProviderEffect, resumeNativePartialJob, selectNativeRevision, storeImmutableAudio, protectedPartHash, NativeToolSession, seedNativeDocument, fixtureConstruct, jobSnapshot, cancelJob, validateNativeOffline, type GeminiGenerateClient, type JobRecord, type NativeLibraryClient, type NativePreset } from "@pocket/core";
import { nativeSynchronization, optionalNativeLibraryConnection, processJob } from "@pocket/worker";
import { abandonNativePartialJob, readProjectActivity } from "@pocket/core";

const subject = `native-test-${randomUUID()}`;
let ownerId = "";
let projectId = "";
const extraProjects: string[] = [];
const extraPaths: string[] = [];

it("keeps offline native construction available after Audiotool consent expires", async () => {
  const expired = await optionalNativeLibraryConnection("owner", "client", () => Promise.reject(new AudiotoolSessionExpiredError()));
  expect(expired).toBeNull();
  await expect(optionalNativeLibraryConnection("owner", "client", () => Promise.reject(new Error("database unavailable")))).rejects.toThrow(/database unavailable/);
});

beforeAll(async () => {
  ownerId = (await getPool().query<{ id: string }>("INSERT INTO app_user(provider_subject,display_name) VALUES($1,'Native test owner') RETURNING id", [subject])).rows[0]!.id;
  projectId = (await createProject(ownerId, "Native integration room")).id;
});

afterAll(async () => {
  if (!projectId) return;
  for (const id of extraProjects) {
    await getPool().query("DELETE FROM native_sample_upload WHERE project_id=$1", [id]);
    await getPool().query("DELETE FROM native_revision_sync WHERE project_id=$1", [id]);
    await getPool().query("DELETE FROM native_sync WHERE project_id=$1", [id]);
    await getPool().query("DELETE FROM native_project_head WHERE project_id=$1", [id]);
    await getPool().query("UPDATE job SET result_native_revision_id=NULL WHERE project_id=$1", [id]);
    await getPool().query("DELETE FROM native_revision WHERE project_id=$1", [id]);
    await getPool().query("DELETE FROM job WHERE project_id=$1", [id]);
    await getPool().query("DELETE FROM asset WHERE project_id=$1", [id]);
    await getPool().query("DELETE FROM project WHERE id=$1", [id]);
  }
  await getPool().query("DELETE FROM native_revision_sync WHERE project_id=$1", [projectId]);
  await getPool().query("DELETE FROM native_sync WHERE project_id=$1", [projectId]);
  await getPool().query("DELETE FROM native_project_head WHERE project_id=$1", [projectId]);
  await getPool().query("UPDATE job SET result_native_revision_id=NULL WHERE project_id=$1", [projectId]);
  await getPool().query("DELETE FROM native_revision WHERE project_id=$1", [projectId]);
  await getPool().query("DELETE FROM job WHERE project_id=$1", [projectId]);
  await getPool().query("DELETE FROM project WHERE id=$1", [projectId]);
  await getPool().query("DELETE FROM native_sample_analysis_cache WHERE owner_id=$1", [ownerId]);
  await getPool().query("DELETE FROM app_user WHERE id=$1", [ownerId]);
  for (const path of extraPaths) await unlink(path).catch(() => undefined);
});

async function claim(id: string, worker = "native-test"): Promise<JobRecord> {
  await dispatchOutbox();
  const result = await claimJobById(id, worker);
  if (!result) throw new Error("Native job was not claimable");
  return result;
}

describe("audio-independent native job lifecycle", () => {
  it("pauses unchanged tool loops and restores previously read guidance on the same job", async () => {
    const scratchId = (await createProject(ownerId, "Retained guidance recovery")).id;
    extraProjects.push(scratchId);
    const accepted = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "read-recovery", request: { direction: "A four-bar lead phrase", sourceAssetIds: [], expectedNativeHeadId: null }, expectedHeadId: null });
    const model = fakeModel().respondWithTools([{ name: "read_native_recipe", args: { id: "rubber-pulse" } }]).respondWithTools([{ name: "compose_native_form", args: { title: "Retained phrase", tempoBpm: 92, meter: { numerator: 4, denominator: 4 }, sections: [{ id: "whole", name: "Whole", bars: 4 }], parts: [{ id: "lead", name: "Lead", role: "melody", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, motifs: [], placements: [], freeNotes: [{ beat: 0, durationBeats: 1, pitch: 64, velocity: 0.7 }] }] } }]);
    for (let i = 0; i < 20; i++) model.respondWithTools([{ name: "inspect_native_section", args: { sectionId: "whole" } }]);
    await processJob(await claim(accepted.id, "read-recovery-before"), { scriptedModel: model, library: createNativeLibrary(null) });
    const paused = await jobSnapshot(ownerId, accepted.id);
    expect(paused.state).toBe("needs_attention");
    expect(paused.error_message).toContain("REPEATED_NO_PROGRESS");
    expect(model.callCount).toBeLessThan(20);
    expect((await nativeDraftView(ownerId, scratchId, accepted.id)).canContinue).toBe(true);
    await resumeNativePartialJob(ownerId, scratchId, accepted.id);
    const continued = fakeModel().respondWithTools([{ name: "apply_native_batch", args: { stepKey: "finish", operations: [{ kind: "setMix", partId: "lead", gain: 0.65 }] } }]).respond(new AIMessage("Finished."));
    await processJob(await claim(accepted.id, "read-recovery-after"), { scriptedModel: continued, library: createNativeLibrary(null) });
    expect(JSON.stringify(continued.calls[0]!.messages)).toContain("rubber-pulse");
    expect(JSON.stringify(continued.calls[0]!.messages)).toContain("priorGuidance");
    expect((await jobSnapshot(ownerId, accepted.id)).state).toBe("succeeded");
  }, 120_000);
  it("keeps making checked progress past 50 turns with the finishing checklist in real model inputs", async () => {
    const scratchId = (await createProject(ownerId, "Finishing with headroom")).id;
    extraProjects.push(scratchId);
    const direction = "A four-bar lead phrase";
    const accepted = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "past-fifty", request: { direction, sourceAssetIds: [], expectedNativeHeadId: null }, expectedHeadId: null });
    const model = fakeModel().respondWithTools([{ name: "compose_native_form", args: { title: "Evolving phrase", tempoBpm: 92, meter: { numerator: 4, denominator: 4 }, sections: [{ id: "whole", name: "Whole", bars: 4 }], parts: [{ id: "lead", name: "Lead", role: "melody", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, motifs: [], placements: [], freeNotes: [{ beat: 0, durationBeats: 1, pitch: 64, velocity: 0.7 }] }] } }]);
    for (let i = 1; i <= 51; i++) model.respondWithTools([{ name: "apply_native_batch", args: { stepKey: `phrase-detail-${i}`, operations: [{ kind: "addNotes", partId: "lead", notes: [{ id: `detail-${i}`, startTick: i * 240, durationTicks: 120, pitch: 60 + i % 8, velocity: 0.5 }] }] } }]);
    model.respond(new AIMessage("The phrase is developed."));
    await processJob(await claim(accepted.id, "finishing-worker"), { scriptedModel: model, library: createNativeLibrary(null) });
    expect((await jobSnapshot(ownerId, accepted.id)).state).toBe("succeeded");
    expect(model.callCount).toBe(53);
    expect(JSON.stringify(model.calls[0]!.messages)).toContain("outstandingRequirements");
    expect(JSON.stringify(model.calls[45]!.messages)).toContain("Do not add optional features");
    expect((await nativeSnapshot(ownerId, scratchId)).current?.document.parts[0]?.notes).toHaveLength(52);
  }, 120_000);
  it("keeps an explicit chord sequence unfinished until the worker constructs the requested pitches", async () => {
    const scratchId = (await createProject(ownerId, "Grounded chord progression")).id;
    extraProjects.push(scratchId);
    const direction = "Start with Dm9–Bbmaj7–Fmaj9–Cadd9 and leave the harmony editable";
    const accepted = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "grounded-chord-progress", request: { direction, sourceAssetIds: [], expectedNativeHeadId: null }, expectedHeadId: null });
    const pitches = [[62, 65, 72, 76], [58, 62, 69], [53, 57, 64, 67], [60, 64, 74]];
    const notes = pitches.flatMap((chord, bar) => chord.map((pitch, index) => ({ id: `chord-${bar}-${index}`, startTick: bar * 3840, durationTicks: 2880, pitch, velocity: 0.65 })));
    const wrongNotes = notes.map((note) => note.id === "chord-2-2" ? { ...note, pitch: 63 } : note);
    const form = { title: "Four chords", tempoBpm: 96, meter: { numerator: 4, denominator: 4 }, sections: [{ id: "whole", name: "Whole", bars: 4 }], parts: [{ id: "chords", name: "Chords", role: "harmony", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, motifs: [], placements: [], freeNotes: wrongNotes.map((note) => ({ beat: note.startTick / 960, durationBeats: note.durationTicks / 960, pitch: note.pitch, velocity: note.velocity })) }] };
    const model = fakeModel().respondWithTools([{ name: "compose_native_form", args: form }])
      .respond(new AIMessage("I drafted the four chords."))
      .respondWithTools([{ name: "apply_native_batch", args: { stepKey: "correct-major-nine", operations: [{ kind: "replaceNotes", partId: "chords", notes }] } }])
      .respond(new AIMessage("The third harmony now has its major seventh."));
    await processJob(await claim(accepted.id, "grounded-chord-worker"), { scriptedModel: model, library: createNativeLibrary(null) });
    expect((await jobSnapshot(ownerId, accepted.id)).state).toBe("succeeded");
    expect((await nativeDraftView(ownerId, scratchId, accepted.id)).stepCount).toBe(2);
    expect(JSON.stringify(model.calls[2]!.messages)).toContain("Requested chord progression");
    expect((await nativeSnapshot(ownerId, scratchId)).current?.document.parts[0]?.notes.some((note) => note.pitch === 64 && note.startTick === 7680)).toBe(true);
  }, 120_000);
  it("pauses at a scripted graph-step boundary and resumes confirmed work on a fresh graph attempt", async () => {
    const scratchId = (await createProject(ownerId, "Graph boundary recovery")).id;
    extraProjects.push(scratchId);
    const direction = "A four-bar lead phrase";
    const accepted = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "graph-boundary", request: { direction, sourceAssetIds: [], expectedNativeHeadId: null }, expectedHeadId: null });
    const form = { title: "Lead phrase", tempoBpm: 92, meter: { numerator: 4, denominator: 4 }, sections: [{ id: "whole", name: "Whole", bars: 4 }], parts: [{ id: "lead", name: "Lead", role: "melody", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, motifs: [], placements: [], freeNotes: [{ beat: 0, durationBeats: 1, pitch: 64, velocity: 0.7 }] }] };
    const before = fakeModel().respondWithTools([{ name: "compose_native_form", args: form }]).respondWithTools([{ name: "apply_native_batch", args: { stepKey: "detail", operations: [{ kind: "setMix", partId: "lead", gain: 0.65 }] } }]).respond(new AIMessage("Finished structure."));
    await processJob(await claim(accepted.id, "graph-before"), { scriptedModel: before, library: createNativeLibrary(null), testGraphStepLimit: 5 });
    const paused = await jobSnapshot(ownerId, accepted.id);
    expect(paused.state, paused.error_message ?? "").toBe("needs_attention");
    expect(paused.error_code).toBe("NATIVE_PARTIAL");
    expect((await nativeDraftView(ownerId, scratchId, accepted.id)).stepCount).toBe(1);
    await resumeNativePartialJob(ownerId, scratchId, accepted.id);
    const after = fakeModel().respondWithTools([{ name: "apply_native_batch", args: { stepKey: "detail", operations: [{ kind: "setMix", partId: "lead", gain: 0.65 }] } }]).respond(new AIMessage("Finished structure."));
    await processJob(await claim(accepted.id, "graph-after"), { scriptedModel: after, library: createNativeLibrary(null) });
    expect((await jobSnapshot(ownerId, accepted.id)).state).toBe("succeeded");
    expect((await nativeDraftView(ownerId, scratchId, accepted.id)).stepCount).toBe(2);
    expect((await nativeSnapshot(ownerId, scratchId)).current?.document.parts[0]?.gain).toBe(0.65);
  }, 120_000);
  it("follows a preservation request through the real revision worker without excluding the bass", async () => {
    const scratchId = (await createProject(ownerId, "Scoped preservation revision")).id;
    extraProjects.push(scratchId);
    const first = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "preservation-base", request: { direction: "A melody and bass in four bars", sourceAssetIds: [], expectedNativeHeadId: null }, expectedHeadId: null });
    const form = { title: "Two voices", tempoBpm: 96, meter: { numerator: 4, denominator: 4 }, sections: [{ id: "whole", name: "Whole", bars: 4 }], parts: [
      { id: "lead", name: "Lead", role: "melody", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, motifs: [], placements: [], freeNotes: [{ beat: 0, durationBeats: 1, pitch: 64, velocity: 0.7 }] },
      { id: "bass", name: "Bass", role: "bass", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, motifs: [], placements: [], freeNotes: [{ beat: 0, durationBeats: 1, pitch: 40, velocity: 0.7 }] }
    ] };
    await processJob(await claim(first.id, "preserve-base"), { scriptedModel: fakeModel().respondWithTools([{ name: "compose_native_form", args: form }]).respond(new AIMessage("Editable melody and bass built.")), library: createNativeLibrary(null) });
    const firstOutcome = await jobSnapshot(ownerId, first.id);
    expect(firstOutcome.state, firstOutcome.error_message ?? "").toBe("succeeded");
    const base = await nativeSnapshot(ownerId, scratchId);
    expect(base.current).not.toBeNull();
    const revision = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-revision", idempotencyKey: "preserve-bass-revision", request: { direction: "Make the melody brighter without changing the bass.", sourceAssetIds: [], baseNativeRevisionId: base.currentRevisionId, expectedNativeHeadId: base.currentRevisionId }, expectedHeadId: base.currentRevisionId });
    const model = fakeModel().respondWithTools([{ name: "apply_native_batch", args: { stepKey: "brighten-lead-only", operations: [{ kind: "setDevice", partId: "lead", device: { type: "heisenberg", parameters: { "filter.cutoffFrequencyHz": 2400 } } }] } }]).respond(new AIMessage("Lead filter opened; bass retained."));
    await processJob(await claim(revision.id, "preserve-bass"), { scriptedModel: model, library: createNativeLibrary(null) });
    const saved = await nativeSnapshot(ownerId, scratchId);
    expect((await jobSnapshot(ownerId, revision.id)).state).toBe("succeeded");
    expect(protectedPartHash(saved.current!.document, "bass")).toBe(protectedPartHash(base.current!.document, "bass"));
    expect(protectedPartHash(saved.current!.document, "lead")).not.toBe(protectedPartHash(base.current!.document, "lead"));
    expect(saved.current?.document.parts).toHaveLength(2);
  }, 120_000);
  it("repairs a wrong scoped candidate through the worker before saving the selected version", async () => {
    const scratchId = (await createProject(ownerId, "Living arrangement revision")).id;
    extraProjects.push(scratchId);
    const form = { title: "Two rooms", tempoBpm: 120, meter: { numerator: 4, denominator: 4 }, sections: [{ id: "first-main", name: "First Main", bars: 4 }, { id: "second-main", name: "Second Main", bars: 4 }], parts: [
      { id: "drums", name: "Soft drums", role: "percussion", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, motifs: [], placements: [], freeNotes: [0, 4, 16, 17, 18, 19].map((beat) => ({ beat, durationBeats: 0.25, pitch: 36, velocity: 0.7 })) },
      { id: "bass", name: "Warm bass", role: "bass", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, motifs: [], placements: [], freeNotes: [{ beat: 16, durationBeats: 1, pitch: 40, velocity: 0.7 }] },
      { id: "lead", name: "Theme lead", role: "melody", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, motifs: [{ id: "theme", name: "Main theme", lengthBeats: 4, notes: [{ beat: 0, durationBeats: 1, pitch: 64, velocity: 0.7 }] }], placements: [{ id: "theme-first", motifId: "theme", startBar: 0, repeats: 1 }, { id: "theme-return", motifId: "theme", startBar: 4, repeats: 1 }], freeNotes: [] },
      { id: "air", name: "Air", role: "harmony", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, motifs: [], placements: [], freeNotes: [{ beat: 16, durationBeats: 4, pitch: 60, velocity: 0.5 }], effects: [{ id: "wash", type: "stompboxReverb", parameters: { feedbackFactor: 0.8, mix: 0.4 } }] }
    ] };
    const first = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "living-base", request: { direction: "A theme with drums, bass and harmony", sourceAssetIds: [], expectedNativeHeadId: null }, expectedHeadId: null });
    await processJob(await claim(first.id, "living-base"), { scriptedModel: fakeModel().respondWithTools([{ name: "compose_native_form", args: form }]).respond(new AIMessage("A structured arrangement was made.")), library: createNativeLibrary(null) });
    const base = (await nativeSnapshot(ownerId, scratchId)).current!;
    expect(base.document.parts).toHaveLength(4);
    const direction = "Give this more space. Thin the drums, shorten the ambience, but keep the theme and bass.";
    const revision = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-revision", idempotencyKey: "living-scoped-repair", request: { direction, sourceAssetIds: [], baseNativeRevisionId: base.id, expectedNativeHeadId: base.id, targetSectionId: "second-main" }, expectedHeadId: base.id });
    const bass = base.document.parts.find((part) => part.id === "bass")!;
    const drums = base.document.parts.find((part) => part.id === "drums")!;
    const wrong = [{ kind: "replaceNotes", partId: "bass", notes: bass.notes.map((note) => ({ ...note, pitch: note.pitch + 1 })) }];
    const repair = [{ kind: "replaceNotes", partId: "bass", notes: bass.notes }, { kind: "replaceNotes", partId: "drums", notes: drums.notes.filter((note) => note.startTick < 16 * 960 || note.startTick < 18 * 960) }, { kind: "setSectionEffectFeedback", partId: "air", sectionId: "second-main", effectId: "wash", feedbackFactor: 0.35 }];
    const model = fakeModel().respondWithTools([{ name: "apply_native_batch", args: { stepKey: "wrong-candidate", operations: wrong } }]).respond(new AIMessage("I changed the mix."))
      .respondWithTools([{ name: "apply_native_batch", args: { stepKey: "actual-local-repair", operations: repair } }]).respond(new AIMessage("The drum events were reduced locally and feedback was lowered only in Second Main; the theme and bass remain."));
    await processJob(await claim(revision.id, "living-revision"), { scriptedModel: model, library: createNativeLibrary(null) });
    const saved = (await nativeSnapshot(ownerId, scratchId)).current!;
    expect((await jobSnapshot(ownerId, revision.id)).state).toBe("succeeded");
    expect(saved.parentRevisionId).toBe(base.id);
    expect(saved.document.parts.find((part) => part.id === "drums")!.notes).toHaveLength(drums.notes.length - 2);
    expect(protectedPartHash(saved.document, "bass")).toBe(protectedPartHash(base.document, "bass"));
    expect(saved.document.motifs).toEqual(base.document.motifs);
    expect(saved.document.parts.find((part) => part.id === "air")!.automation[0]?.points).toEqual([{ tick: 0, value: 0.8, interpolation: "step" }, { tick: 15360, value: 0.35, interpolation: "step" }, { tick: 30720, value: 0.8, interpolation: "step" }]);
    expect(JSON.stringify(model.calls.map((call) => call.messages))).toMatch(/Requested preservation of Warm bass in Second Main was not met/);
    expect(JSON.stringify(model.calls.map((call) => call.messages))).toMatch(/Requested reduction of drums was not constructed/);
    await selectNativeRevision(ownerId, scratchId, base.id, saved.id);
    expect((await nativeSnapshot(ownerId, scratchId)).currentRevisionId).toBe(base.id);
    await selectNativeRevision(ownerId, scratchId, saved.id, base.id);
    expect((await nativeSnapshot(ownerId, scratchId)).currentRevisionId).toBe(saved.id);
  }, 120_000);
  it("runs 48 model turns through the worker without confusing graph steps with the captured call limit", async () => {
    const scratchId = (await createProject(ownerId, "Sustained graph construction")).id;
    extraProjects.push(scratchId);
    const direction = "Write a four-bar melody";
    const accepted = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "sustained-graph-48", request: { direction, profile: "extended", sourceAssetIds: [], expectedNativeHeadId: null }, expectedHeadId: null });
    const model = fakeModel().respondWithTools([{ name: "compose_native_form", args: { title: "Sustained phrase", tempoBpm: 92, meter: { numerator: 4, denominator: 4 }, sections: [{ id: "whole", name: "Whole", bars: 4 }], parts: [{ id: "lead", name: "Lead", role: "melody", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, motifs: [], placements: [], freeNotes: [{ beat: 0, durationBeats: 1, pitch: 64, velocity: 0.7 }] }] } }]);
    for (let index = 0; index < 46; index++) model.respondWithTools([{ name: "apply_native_batch", args: { stepKey: `turn-${index}`, operations: [{ kind: "setMix", partId: "lead", gain: index % 2 ? 0.61 : 0.59 }] } }]);
    model.respond(new AIMessage("Confirmed the editable phrase; no audio was heard."));
    const job = await claim(accepted.id, "sustained-graph-worker");
    await processJob(job, { scriptedModel: model, library: createNativeLibrary(null) });
    expect(model.callCount).toBe(48);
    expect((await jobSnapshot(ownerId, accepted.id)).state).toBe("succeeded");
    expect((await nativeDraftView(ownerId, scratchId, accepted.id)).stepCount).toBe(47);
    expect((await nativeSnapshot(ownerId, scratchId)).current?.document.parts[0]?.gain).toBe(0.61);
  }, 120_000);
  it("pauses after a known paid batch, extends the same run and completes without duplicate accounting", async () => {
    const scratchId = (await createProject(ownerId, "Financial pause and continuation")).id;
    extraProjects.push(scratchId);
    const direction = "Four-bar melody with bass";
    const accepted = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "financial-pause-same-job", request: { direction, profile: "standard", sourceAssetIds: [], expectedNativeHeadId: null }, expectedHeadId: null });
    const original = (await getPool().query<{ request: Record<string, unknown> }>("SELECT request FROM job WHERE id=$1", [accepted.id])).rows[0]!.request;
    const priceScale = ((original._nativeRun as { pricing: { outputUsdPerMillion: number } }).pricing.outputUsdPerMillion / 50);
    await getPool().query("UPDATE job SET request=$2::jsonb WHERE id=$1", [accepted.id, JSON.stringify({ ...original, _nativeRunCurrent: { ...original._nativeRun as Record<string, unknown>, maxJobCostUsd: 0.9 * priceScale } })]);
    const form = { title: "Known first phrase", tempoBpm: 90, meter: { numerator: 4, denominator: 4 }, sections: [{ id: "whole", name: "Whole", bars: 4 }], parts: [{ id: "lead", name: "Lead", role: "melody", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, motifs: [], placements: [], freeNotes: [{ beat: 0, durationBeats: 1, pitch: 64, velocity: 0.7 }] }] };
    const costlyMessage = new AIMessage({ content: "", tool_calls: [{ id: "form-first", name: "compose_native_form", args: form }] });
    Object.assign(costlyMessage, { usage_metadata: { input_tokens: 1_000, output_tokens: 10_000, total_tokens: 11_000 } });
    const firstModel = fakeModel().respond(costlyMessage);
    await processJob(await claim(accepted.id, "before-financial-pause"), { scriptedModel: firstModel, library: createNativeLibrary(null) });
    const paused = await jobSnapshot(ownerId, accepted.id);
    expect(paused.state).toBe("needs_attention");
    expect(paused.error_code).toBe("NATIVE_PARTIAL");
    const draft = await nativeDraftView(ownerId, scratchId, accepted.id);
    expect(draft.stepCount).toBe(1);
    expect(draft.canContinue).toBe(false);
    expect(draft.canExtend).toBe(true);
    expect(draft.budget.spentUsd).toBeGreaterThan(0.5 * priceScale);
    expect((await nativeSnapshot(ownerId, scratchId)).current).toBeNull();
    await expect(resumeNativePartialJob(ownerId, scratchId, accepted.id)).rejects.toThrow(/allowance/);
    await extendNativePartialJob(ownerId, scratchId, accepted.id, { maxJobCostUsd: 2 });
    await expect(extendNativePartialJob(ownerId, scratchId, accepted.id, { maxJobCostUsd: 2 })).rejects.toThrow(/no higher allowance/);
    expect((await nativeDraftView(ownerId, scratchId, accepted.id)).canContinue).toBe(true);
    await resumeNativePartialJob(ownerId, scratchId, accepted.id);
    const secondModel = fakeModel().respondWithTools([{ name: "apply_native_batch", args: { stepKey: "add-confirmed-bass", operations: [{ kind: "addPart", part: { id: "bass", name: "Bass", role: "bass", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, notes: [{ id: "bass-note", startTick: 960, durationTicks: 960, pitch: 40, velocity: 0.7 }], placements: [], sourceRegions: [], effects: [], automation: [] } }] } }]).respond(new AIMessage("The lead and bass are structurally present; no audio was heard."));
    await processJob(await claim(accepted.id, "after-financial-pause"), { scriptedModel: secondModel, library: createNativeLibrary(null) });
    expect((await jobSnapshot(ownerId, accepted.id)).state).toBe("succeeded");
    expect((await nativeSnapshot(ownerId, scratchId)).current?.document.parts.map((part) => part.id)).toEqual(["lead", "bass"]);
    const effects = await getPool().query<{ step: string; state: string; actual_cost_microusd: string; reservation_microusd: string }>("SELECT step,state,actual_cost_microusd::text,reservation_microusd::text FROM effect WHERE job_id=$1 AND step='producer-model-call' ORDER BY created_at", [accepted.id]);
    expect(effects.rows).toHaveLength(3);
    expect(Number(effects.rows[1]!.reservation_microusd)).toBeLessThan(Number(effects.rows[0]!.reservation_microusd));
    expect(effects.rows.reduce((sum, row) => sum + Number(row.actual_cost_microusd), 0)).toBeGreaterThan(500_000 * priceScale);
    expect((await nativeDraftView(ownerId, scratchId, accepted.id)).stepCount).toBe(2);
  }, 120_000);
  it("continues a known zero-step financial pause without inventing a musical draft or replaying the first call", async () => {
    const scratchId = (await createProject(ownerId, "Zero-step budget recovery")).id;
    extraProjects.push(scratchId);
    const direction = "A sparse four-bar phrase with a deliberate answer";
    const accepted = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "zero-step-financial-pause", request: { direction, profile: "standard", sourceAssetIds: [], expectedNativeHeadId: null }, expectedHeadId: null });
    const original = (await getPool().query<{ request: Record<string, unknown> }>("SELECT request FROM job WHERE id=$1", [accepted.id])).rows[0]!.request;
    const priceScale = ((original._nativeRun as { pricing: { outputUsdPerMillion: number } }).pricing.outputUsdPerMillion / 50);
    await getPool().query("UPDATE job SET request=$2::jsonb WHERE id=$1", [accepted.id, JSON.stringify({ ...original, _nativeRunCurrent: { ...original._nativeRun as Record<string, unknown>, maxJobCostUsd: 0.9 * priceScale } })]);
    const plan = { intent: "A restrained question and answer", sections: [{ name: "Whole", purpose: "Introduce and answer one motif" }], soundGoals: ["Dry, close lead"], hardConstraints: ["Four bars"], developmentTasks: ["Write the answer"] };
    const costlyPlan = new AIMessage({ content: "", tool_calls: [{ id: "first-plan", name: "record_native_plan", args: plan }] });
    Object.assign(costlyPlan, { usage_metadata: { input_tokens: 1_000, output_tokens: 10_000, total_tokens: 11_000 } });
    await processJob(await claim(accepted.id, "zero-step-before"), { scriptedModel: fakeModel().respond(costlyPlan), library: createNativeLibrary(null) });
    const paused = await jobSnapshot(ownerId, accepted.id);
    expect(paused.state).toBe("needs_attention");
    expect(paused.error_code).toBe("NATIVE_PARTIAL");
    const draft = await nativeDraftView(ownerId, scratchId, accepted.id);
    expect(draft.stepCount).toBe(0);
    expect(draft.document).toBeNull();
    expect(draft.plan?.plan.intent).toBe(plan.intent);
    expect(draft.canExtend).toBe(true);
    expect(draft.canContinue).toBe(false);
    const before = await getPool().query<{ step: string; state: string; actual_cost_microusd: string }>("SELECT step,state,actual_cost_microusd::text FROM effect WHERE job_id=$1 ORDER BY created_at", [accepted.id]);
    expect(before.rows.find((effect) => effect.step === "native-producer-result")?.state).toBe("dispatched");
    // Recreate the exact older defect on isolated data: a known zero-cost
    // aggregate was incorrectly marked failed after the paid plan call.
    await getPool().query("UPDATE effect SET state='failed',cost_status='observed',reservation_microusd=0 WHERE job_id=$1 AND step='native-producer-result'", [accepted.id]);
    expect((await nativeDraftView(ownerId, scratchId, accepted.id)).canExtend).toBe(true);
    await extendNativePartialJob(ownerId, scratchId, accepted.id, { maxJobCostUsd: 2 });
    expect((await nativeDraftView(ownerId, scratchId, accepted.id)).canContinue).toBe(true);
    await resumeNativePartialJob(ownerId, scratchId, accepted.id);
    const repairEvents = await getPool().query("SELECT event_type FROM job_event WHERE job_id=$1 AND event_type='aggregate_repaired'", [accepted.id]);
    expect(repairEvents.rowCount).toBe(1);
    const form = { title: "Quiet answer", tempoBpm: 90, meter: { numerator: 4, denominator: 4 }, sections: [{ id: "whole", name: "Whole", bars: 4 }], parts: [{ id: "lead", name: "Dry lead", role: "melody", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, motifs: [], placements: [], freeNotes: [{ beat: 0, durationBeats: 1, pitch: 62, velocity: 0.65 }, { beat: 8, durationBeats: 1, pitch: 65, velocity: 0.58 }] }] };
    const model = fakeModel().respondWithTools([{ name: "compose_native_form", args: form }]).respond(new AIMessage("The question and answer are now editable; no audio was heard."));
    await processJob(await claim(accepted.id, "zero-step-after"), { scriptedModel: model, library: createNativeLibrary(null) });
    expect((await jobSnapshot(ownerId, accepted.id)).state).toBe("succeeded");
    expect((await nativeSnapshot(ownerId, scratchId)).current?.document.parts[0]?.notes).toHaveLength(2);
    const after = await getPool().query<{ step: string; state: string; actual_cost_microusd: string }>("SELECT step,state,actual_cost_microusd::text FROM effect WHERE job_id=$1 ORDER BY created_at", [accepted.id]);
    expect(after.rows.filter((effect) => effect.step === "producer-model-call")).toHaveLength(3);
    expect(after.rows.find((effect) => effect.step === "native-producer-result")?.state).toBe("succeeded");
    expect(after.rows[1]?.actual_cost_microusd).toBe(before.rows[1]?.actual_cost_microusd);
  }, 120_000);
  it("retains a chosen palette through construction and runs a bounded ID-grounded symbolic review", async () => {
    const scratchId = (await createProject(ownerId, "Creative context and review")).id;
    extraProjects.push(scratchId);
    const direction = "Make a sparse four-bar motif with a soft answering phrase, not a busy loop.";
    const accepted = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "creative-context-review", request: { direction, sourceAssetIds: [], expectedNativeHeadId: null }, expectedHeadId: null });
    const plan = { intent: "A close motif followed by a quiet answer", sections: [{ name: "Whole", purpose: "State and answer the motif" }], soundGoals: ["Dry, soft lead"], hardConstraints: ["Four bars", "Sparse"], developmentTasks: ["Leave air between the two statements"] };
    const creative = { identity: "Close and restrained, with a descending reply", densityIntent: "Two short phrases with silence between", palette: [{ role: "melody", resourceKind: "synthesis", resourceId: "heisenberg", reason: "A quiet editable lead" }], guidanceRefs: ["descending-answer"], decisions: ["Keep the response lower than the opening"], definiteFailures: [], unfinishedTasks: ["Write the response"], evidenceLinks: [{ promise: "Opening phrase", sectionId: "whole", partId: "lead", firstBar: 0, lastBar: 4 }] };
    const form = { title: "Quiet answer", tempoBpm: 90, meter: { numerator: 4, denominator: 4 }, sections: [{ id: "whole", name: "Whole", bars: 4 }], parts: [{ id: "lead", name: "Lead", role: "melody", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, motifs: [], placements: [], freeNotes: [{ beat: 0, durationBeats: 1, pitch: 67, velocity: 0.65 }] }] };
    const producer = fakeModel().respondWithTools([{ name: "record_native_plan", args: plan }])
      .respondWithTools([{ name: "record_native_creative_state", args: creative }])
      .respondWithTools([{ name: "search_native_examples", args: { query: "sparse answer" } }])
      .respondWithTools([{ name: "compose_native_form", args: form }])
      .respondWithTools([{ name: "review_native_score", args: {} }])
      .respondWithTools([{ name: "apply_native_batch", args: { stepKey: "answer-after-review", operations: [{ kind: "addNotes", partId: "lead", notes: [{ id: "quiet-answer", startTick: 7680, durationTicks: 960, pitch: 62, velocity: 0.55 }] }] } }])
      .respondWithTools([{ name: "review_native_score", args: {} }])
      .respond(new AIMessage("The two phrases are editable; no audio was heard."));
    const reviewer = fakeModel()
      .respond(new AIMessage(JSON.stringify({ verdict: "The planned response has not been written yet.", findings: [{ priority: "high", sectionId: "whole", partId: "lead", observation: "Only the opening note is present.", suggestedChange: "Add a quieter, lower reply after a pause." }], noChangeReason: null })))
      .respond(new AIMessage(JSON.stringify({ verdict: "The lower reply now follows a deliberate pause.", findings: [], noChangeReason: "The contrast fits the sparse brief; no further structural edit is justified." })));
    await processJob(await claim(accepted.id, "creative-review-worker"), { scriptedModel: producer, scriptedReviewer: reviewer, library: createNativeLibrary(null) });
    expect((await jobSnapshot(ownerId, accepted.id)).state).toBe("succeeded");
    const draft = await nativeDraftView(ownerId, scratchId, accepted.id);
    expect(draft.plan?.plan.creativeState?.identity).toBe(creative.identity);
    expect(draft.plan?.review?.modelUsed).toBe(true);
    expect(draft.plan?.review?.verdict).toMatch(/lower reply/);
    expect(reviewer.callCount).toBe(2);
    expect(JSON.stringify(reviewer.calls[0]?.messages)).toContain(direction);
    expect(JSON.stringify(producer.calls.at(-1)?.messages)).toContain(creative.identity);
    expect(JSON.stringify(producer.calls[5]?.messages)).toContain("planned response has not been written");
    expect((await nativeSnapshot(ownerId, scratchId)).current?.document.parts[0]?.notes).toHaveLength(2);
    const effects = await getPool().query<{ step: string; state: string; idempotency_key: string }>("SELECT step,state,idempotency_key FROM effect WHERE job_id=$1", [accepted.id]);
    const modelEffects = effects.rows.filter((row) => row.step === "producer-model-call");
    expect(modelEffects.every((row) => row.state === "succeeded")).toBe(true);
    expect(modelEffects.filter((row) => row.idempotency_key.startsWith("native-review:"))).toHaveLength(2);
    expect(modelEffects.filter((row) => row.idempotency_key.startsWith("producer:"))).toHaveLength(producer.callCount);
    expect(new Set(modelEffects.map((row) => row.idempotency_key)).size).toBe(modelEffects.length);
  }, 120_000);
  it("restores the durable future plan to actual model input after compaction and worker restart", async () => {
    const scratchId = (await createProject(ownerId, "Durable producer memory")).id;
    extraProjects.push(scratchId);
    const direction = "A four-bar melody with a distinctive final pickup";
    const accepted = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "plan-memory-restart", request: { direction, sourceAssetIds: [], expectedNativeHeadId: null }, expectedHeadId: null });
    const original = (await getPool().query<{ request: Record<string, unknown> }>("SELECT request FROM job WHERE id=$1", [accepted.id])).rows[0]!.request;
    await getPool().query("UPDATE job SET request=$2::jsonb WHERE id=$1", [accepted.id, JSON.stringify({ ...original, _nativeRunCurrent: { ...original._nativeRun as Record<string, unknown>, maxCalls: 2 } })]);
    const plan = { intent: "A small phrase with a delayed resolution", sections: [{ name: "Whole", purpose: "State and turn the theme" }], soundGoals: ["Clear plucked color"], hardConstraints: ["Four bars"], developmentTasks: ["Place a quiet G-sharp pickup on the last eighth before the ending"] };
    const form = { title: "Pickup study", tempoBpm: 90, meter: { numerator: 4, denominator: 4 }, sections: [{ id: "whole", name: "Whole", bars: 4 }], parts: [{ id: "lead", name: "Lead", role: "melody", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, motifs: [], placements: [], freeNotes: [{ beat: 0, durationBeats: 1, pitch: 64, velocity: 0.7 }] }] };
    const firstModel = fakeModel().respondWithTools([{ name: "record_native_plan", args: plan }]).respondWithTools([{ name: "compose_native_form", args: form }]);
    await processJob(await claim(accepted.id, "plan-before-restart"), { scriptedModel: firstModel, library: createNativeLibrary(null) });
    expect((await jobSnapshot(ownerId, accepted.id)).state).toBe("needs_attention");
    expect((await nativeDraftView(ownerId, scratchId, accepted.id)).plan?.plan.developmentTasks).toContain(plan.developmentTasks[0]);
    await extendNativePartialJob(ownerId, scratchId, accepted.id, { maxCalls: 4 });
    await resumeNativePartialJob(ownerId, scratchId, accepted.id);
    const resumedModel = fakeModel().respondWithTools([{ name: "apply_native_batch", args: { stepKey: "fulfill-planned-pickup", operations: [{ kind: "addNotes", partId: "lead", notes: [{ id: "pickup", startTick: 14880, durationTicks: 240, pitch: 68, velocity: 0.35 }] }] } }]).respond(new AIMessage("The planned final pickup is constructed; no audio was heard."));
    await processJob(await claim(accepted.id, "plan-after-restart"), { scriptedModel: resumedModel, library: createNativeLibrary(null) });
    expect(JSON.stringify(resumedModel.calls[0]!.messages)).toContain(plan.developmentTasks[0]);
    expect((await jobSnapshot(ownerId, accepted.id)).state).toBe("succeeded");
    expect((await nativeSnapshot(ownerId, scratchId)).current?.document.parts[0]?.notes.map((note) => note.id)).toContain("pickup");
    const feed = await readProjectActivity(ownerId, scratchId);
    expect(feed.events.filter((event) => event.payload.kind === "request")).toHaveLength(1);
    expect(feed.events.filter((event) => event.payload.kind === "approach").map((event) => event.payload.text)).toEqual([plan.intent]);
    expect(feed.events.filter((event) => event.payload.kind === "music")).toHaveLength(2);
    expect(feed.events.some((event) => event.payload.kind === "paused")).toBe(true);
    expect(feed.events.some((event) => event.payload.kind === "continued")).toBe(true);
    expect(feed.events.filter((event) => event.payload.kind === "saved")).toHaveLength(1);
  }, 120_000);
  it("preserves a near-limit text-only brief through more than four model turns and three construction batches", async () => {
    const scratchId = (await createProject(ownerId, "Long text-only construction")).id;
    extraProjects.push(scratchId);
    const opening = "Create 4 bars at 90 BPM in 3/4 with a sparse melody and no percussion. ";
    const closing = " End with an answering phrase; keep the result editable.";
    const filler = "Leave deliberate space between phrases and let the mood evolve gently. ".repeat(500);
    const direction = opening + filler.slice(0, 32_000 - opening.length - closing.length) + closing;
    expect(direction).toHaveLength(32_000);
    const accepted = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "long-text-only-profile", request: { direction, profile: "extended", sourceAssetIds: [], expectedNativeHeadId: null }, expectedHeadId: null });
    const job = await claim(accepted.id, "long-text-only-worker");
    expect((job.request._nativeRun as { maxCalls: number }).maxCalls).toBe(80);
    expect((job.request._nativeRun as { pricing: { verifiedOn: string } }).pricing.verifiedOn).toMatch(/^20\d\d-/);
    const session = new NativeToolSession(job, seedNativeDocument(direction));
    const form = { title: "Quiet answer", tempoBpm: 90, meter: { numerator: 3, denominator: 4 }, sections: [{ id: "opening", name: "Opening", bars: 2 }, { id: "answer", name: "Answer", bars: 2 }], parts: [{ id: "lead", name: "Soft melody", role: "melody", device: { type: "heisenberg", parameters: {} }, gain: 0.56, pan: 0, motifs: [], placements: [], freeNotes: [{ beat: 0, durationBeats: 1, pitch: 62, velocity: 0.62 }] }] };
    const model = fakeModel()
      .respondWithTools([{ name: "record_native_plan", args: { intent: "Sparse three-quarter phrase and answer", sections: [{ name: "Opening", purpose: "Leave space" }, { name: "Answer", purpose: "Change the ending" }], soundGoals: ["Soft lead"], hardConstraints: ["No percussion", "Four bars"], developmentTasks: ["Answer the opening phrase"] } }])
      .respondWithTools([{ name: "compose_native_form", args: form }])
      .respondWithTools([{ name: "apply_native_batch", args: { stepKey: "answer-phrase", operations: [{ kind: "addNotes", partId: "lead", notes: [{ id: "answer-one", startTick: 5760, durationTicks: 960, pitch: 65, velocity: 0.58 }] }] } }])
      .respondWithTools([{ name: "apply_native_batch", args: { stepKey: "lead-color", operations: [{ kind: "setDevice", partId: "lead", device: { type: "heisenberg", parameters: { "filter.cutoffFrequencyHz": 1800 } } }] } }])
      .respondWithTools([{ name: "apply_native_batch", args: { stepKey: "master-headroom", operations: [{ kind: "setMaster", master: { gain: 0.82, pan: 0, limiterEnabled: false } }] } }])
      .respondWithTools([{ name: "inspect_native_section", args: { sectionId: "opening" } }, { name: "inspect_native_section", args: { sectionId: "answer" } }])
      .respondWithTools([{ name: "advance_native_stage", args: { stage: "reviewed" } }])
      .respond(new AIMessage("Four bars of editable melody with an answering phrase; audio was not heard."));
    const timer = setInterval(() => { void heartbeat(job); }, 750);
    try {
      const result = await produceNative({ session, direction, mode: "generation", sources: [], scriptedModel: model });
      expect(model.callCount).toBeGreaterThan(4);
      expect(session.applied).toHaveLength(4);
      expect(JSON.stringify(model.calls[0]!.messages)).toContain(closing.trim());
      expect(session.document.meter.numerator).toBe(3);
      expect(session.document.parts).toHaveLength(1);
      expect(session.document.parts[0]!.role).toBe("melody");
      expect((await nativeDraftView(ownerId, scratchId, job.id)).runLimits?.profile).toBe("extended");
      await commitNativeRevision(job, session.document, result.summary, result);
    } finally { clearInterval(timer); }
  }, 90_000);
  it("keeps a 32,001-character brief lossless through workspace inspection, exact tail retrieval and another dispatch", async () => {
    const scratchId = (await createProject(ownerId, "Long brief inspection")).id;
    extraProjects.push(scratchId);
    const ending = "最後の節では静かな旋律を残す — keep the last melody intact";
    const direction = "A four-bar melody. " + "soft spacious detail. ".repeat(1775);
    const brief = direction.slice(0, 32001 - ending.length) + ending;
    expect(brief.length).toBe(32001);
    const accepted = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "brief-after-inspect", request: { direction: brief, profile: "extended", sourceAssetIds: [], expectedNativeHeadId: null }, expectedHeadId: null });
    const job = await claim(accepted.id, "long-brief-inspection-worker");
    const form = { title: "Quiet final melody", tempoBpm: 92, meter: { numerator: 4, denominator: 4 }, sections: [{ id: "whole", name: "Whole", bars: 4 }], parts: [{ id: "lead", name: "Melody", role: "melody", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, motifs: [], placements: [], freeNotes: [{ beat: 0, durationBeats: 1, pitch: 64, velocity: 0.6 }] }] };
    const model = fakeModel().respondWithTools([{ name: "compose_native_form", args: form }])
      .respondWithTools([{ name: "inspect_native_workspace", args: {} }])
      .respondWithTools([{ name: "read_native_brief", args: { offset: 31920, length: 81 } }])
      .respondWithTools([{ name: "apply_native_batch", args: { stepKey: "finish-tail-intent", operations: [{ kind: "setMix", partId: "lead", gain: 0.62 }] } }])
      .respond(new AIMessage("The closing melody remains editable; no audio was heard."));
    const timer = setInterval(() => { void heartbeat(job); }, 750);
    try {
      const session = new NativeToolSession(job, seedNativeDocument(brief));
      await produceNative({ session, direction: brief, mode: "generation", sources: [], scriptedModel: model });
      expect(model.callCount).toBe(5);
      expect(JSON.stringify(model.calls[3]!.messages)).toContain(ending);
      expect(JSON.stringify(model.calls[2]!.messages)).not.toContain('"direction":"' + brief);
      expect(JSON.stringify(model.calls[4]!.messages).length).toBeLessThan(96_000);
      expect(session.document.direction).toBe(brief);
    } finally { clearInterval(timer); }
  }, 90_000);
  it("keeps a detailed text-only producer plan and develops section-specific harmony and groove through the real tool graph", async () => {
    const scratchId = (await createProject(ownerId, "Text-only developed song")).id;
    extraProjects.push(scratchId);
    const direction = "Write 8 bars in total at 128 BPM in D minor. No drums in intro; bring expressive ghost-note drums in chorus. Give the chorus voiced Dm9 and Bbmaj7 chords and an FM pluck with gentle saturation.";
    const accepted = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "text-only-staged-song", request: { direction, profile: "standard", sourceAssetIds: [], expectedNativeHeadId: null }, expectedHeadId: null });
    const job = await claim(accepted.id, "text-only-staged-worker");
    expect((job.request._nativeRun as { maxCalls: number }).maxCalls).toBe(80);
    const session = new NativeToolSession(job, seedNativeDocument(direction));
    const plan = { intent: "Dark minor introduction opens into a rhythmically active chorus", sections: [{ name: "Intro", purpose: "Establish the FM pluck without percussion" }, { name: "Chorus", purpose: "Develop harmony and bring in ghost-note drums" }], soundGoals: ["An FM pluck with restrained tube warmth"], hardConstraints: ["No intro percussion", "Eight bars at 128 BPM"], developmentTasks: ["Voice Dm9 and Bbmaj7", "Sequence chorus accents and ghost notes"] };
    const form = { title: "Minor lift", tempoBpm: 128, meter: { numerator: 4, denominator: 4 }, sections: [{ id: "intro", name: "Intro", bars: 4 }, { id: "chorus", name: "Chorus", bars: 4 }], parts: [
      { id: "pluck", name: "FM pluck", role: "melody", device: { type: "heisenberg", parameters: { "operatorC.modulationFactorA": 0.4, "operatorC.waveformIndex": 5 } }, gain: 0.62, pan: 0, motifs: [], placements: [], freeNotes: [{ beat: 0, durationBeats: 1, pitch: 62, velocity: 0.7 }], effects: [{ id: "warmth", type: "stompboxTube", parameters: { drive: 1.8, tone: 0, postGain: 0.7 } }] },
      { id: "chords", name: "Chords", role: "harmony", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, motifs: [], placements: [] },
      { id: "drums", name: "Expressive drums", role: "percussion", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, motifs: [], placements: [] }
    ] };
    const model = fakeModel()
      .respondWithTools([{ name: "record_native_plan", args: plan }])
      .respondWithTools([{ name: "compose_native_form", args: form }])
      .respondWithTools([{ name: "advance_native_stage", args: { stage: "building" } }])
      .respondWithTools([{ name: "apply_native_batch", args: { stepKey: "chorus-harmony-and-drums", operations: [
        { kind: "harmonizeSection", partId: "chords", sectionId: "chorus", cycleBars: 2, chords: [{ barOffset: 0, durationBars: 1, pitches: [50, 57, 60, 64, 69], velocity: 0.62, strumTicks: 20 }, { barOffset: 1, durationBars: 1, pitches: [46, 53, 57, 62, 65], velocity: 0.6, strumTicks: 20 }] },
        { kind: "sequenceSectionPattern", partId: "drums", sectionId: "chorus", cycleBars: 1, hits: [{ tick: 0, durationTicks: 240, pitch: 36, velocity: 0.85, timingOffsetTicks: 0 }, { tick: 840, durationTicks: 120, pitch: 38, velocity: 0.2, timingOffsetTicks: 20 }, { tick: 960, durationTicks: 240, pitch: 38, velocity: 0.65, timingOffsetTicks: 34 }] }
      ] } }])
      .respondWithTools([{ name: "inspect_native_section", args: { sectionId: "intro" } }, { name: "inspect_native_section", args: { sectionId: "chorus" } }])
      .respondWithTools([{ name: "advance_native_stage", args: { stage: "reviewed" } }])
      .respond(new AIMessage("The chorus has exact chord voicings and expressive drum onsets; no audio was heard."));
    const timer = setInterval(() => { void heartbeat(job); }, 750);
    try {
      const produced = await produceNative({ session, direction, mode: "generation", sources: [], scriptedModel: model });
      expect(produced.provider).toBe("scripted-deep-agent");
      expect(JSON.stringify(model.calls[0]!.messages)).toContain("No drums in intro");
      expect(session.document.parts.find((part) => part.id === "drums")?.notes.every((note) => note.startTick >= 4 * 3840)).toBe(true);
      expect(session.document.parts.find((part) => part.id === "chords")?.notes).toHaveLength(20);
      const draft = await nativeDraftView(ownerId, scratchId, job.id);
      expect(draft.plan?.stage).toBe("reviewed");
      expect(draft.plan?.inspectedDocumentHash).toBe(canonicalHash(session.document));
      expect((await validateNativeOffline(session.document)).readback.noteEntities).toBe(33);
      await commitNativeRevision(job, session.document, produced.summary, produced);
    } finally { clearInterval(timer); }
  }, 90_000);
  it("runs a model-directed form through the real Deep Agent tools and durable step ledger", async () => {
    const scratchId = (await createProject(ownerId, "Scripted creative orchestration")).id;
    extraProjects.push(scratchId);
    const direction = "A 12-bar three-quarter chamber pulse, sparse lead and a short echo";
    const request = { direction, sourceAssetIds: [], expectedNativeHeadId: null };
    const accepted = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "scripted-creative-generation", request, expectedHeadId: null });
    const job = await claim(accepted.id, "scripted-creative-worker");
    const session = new NativeToolSession(job, seedNativeDocument(direction));
    const form = { title: "Chamber pulse", tempoBpm: 84, meter: { numerator: 3, denominator: 4 }, sections: [
      { id: "solo", name: "Solo", bars: 4, intent: "Lead alone" }, { id: "pulse", name: "Pulse", bars: 4, intent: "Bass enters" }, { id: "release", name: "Release", bars: 4, intent: "Short echo" }
    ], parts: [{ id: "lead", name: "Soft lead", role: "melody", device: { type: "heisenberg", parameters: { "operatorA.gain": 0.31, "filter.cutoffFrequencyHz": 1800 } }, gain: 0.57, pan: -0.1,
      motifs: [{ id: "lead-call", name: "Lead call", lengthBeats: 12, notes: [{ beat: 0, durationBeats: 1.5, pitch: 64, velocity: 0.6 }, { beat: 4, durationBeats: 2, pitch: 67, velocity: 0.7 }, { beat: 8, durationBeats: 1.5, pitch: 71, velocity: 0.58 }] }],
      placements: [{ id: "first-call", motifId: "lead-call", startBar: 0, repeats: 1 }, { id: "last-call", motifId: "lead-call", startBar: 8, repeats: 1 }],
      effects: [{ id: "echo", type: "stompboxDelay", parameters: { feedbackFactor: 0.24, mix: 0.18 } }] }] };
    const model = fakeModel()
      .respondWithTools([{ name: "compose_native_form", args: form }])
      .respondWithTools([{ name: "inspect_native_part", args: { partId: "lead" } }])
      .respond(new AIMessage("The sparse 3/4 lead and delayed return are structurally in place; no audio was heard."));
    const timer = setInterval(() => { void heartbeat(job); }, 750);
    try {
      const result = await produceNative({ session, direction, mode: "generation", sources: [], scriptedModel: model });
      expect(result.provider).toBe("scripted-deep-agent");
      expect(model.callCount).toBe(3);
      expect(JSON.stringify(model.calls[1]!.messages)).toContain("documentHash");
      expect(JSON.stringify(model.calls[2]!.messages)).toContain("lead-call");
      expect(session.document.bars).toBe(12);
      expect(session.document.parts.map((part) => part.id)).toEqual(["lead"]);
      expect(session.document.parts[0]!.effects[0]!.parameters.feedbackFactor).toBe(0.24);
      expect(session.applied).toHaveLength(1);
      await commitNativeRevision(job, session.document, result.summary, result);
      const snapshot = await nativeSnapshot(ownerId, scratchId);
      expect(snapshot.current?.document.title).toBe("Chamber pulse");
      expect(snapshot.current?.document.meter.numerator).toBe(3);
      expect(snapshot.current?.producer.provider).toBe("scripted-deep-agent");
    } finally { clearInterval(timer); }
  }, 90_000);

  it("develops a non-default-meter form and shared processing through successive producer decisions", async () => {
    const scratchId = (await createProject(ownerId, "Developed chamber arrangement")).id;
    extraProjects.push(scratchId);
    const direction = "A 12-bar three-quarter lead theme that develops in the closing section";
    const accepted = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "developed-three-quarter", request: { direction, sourceAssetIds: [], expectedNativeHeadId: null }, expectedHeadId: null });
    const job = await claim(accepted.id, "developed-three-quarter-worker");
    const session = new NativeToolSession(job, seedNativeDocument(direction));
    const form = { title: "Returning light", tempoBpm: 84, meter: { numerator: 3, denominator: 4 }, sections: [
      { id: "opening", name: "Opening", bars: 4 }, { id: "middle", name: "Middle", bars: 4 }, { id: "return", name: "Return", bars: 4 }
    ], delayBus: { id: "shared-echo", name: "Shared echo", feedbackFactor: 0.32, stepCount: 3, stepLengthIndex: 2 }, master: { gain: 0.83, pan: 0, limiterEnabled: true }, parts: [{
      id: "lead", name: "Lead", role: "melody", device: { type: "heisenberg", parameters: { "operatorA.gain": 0.34 } }, gain: 0.62, pan: -0.1,
      sends: [{ busId: "shared-echo", gain: 0.24 }], motifs: [{ id: "call", name: "Call", lengthBeats: 12, notes: [{ beat: 0, durationBeats: 1, pitch: 64, velocity: 0.55 }, { beat: 5, durationBeats: 1.5, pitch: 67, velocity: 0.7 }] }],
      placements: [{ id: "first", motifId: "call", startBar: 0, repeats: 1 }, { id: "last", motifId: "call", startBar: 8, repeats: 1 }],
      automation: [{ id: "echo-entry", target: "send.shared-echo.gain", points: [{ tick: 0, value: 0.1 }, { tick: 32000, value: 0.6 }] }]
    }] };
    const model = fakeModel()
      .respondWithTools([{ name: "compose_native_form", args: form }])
      .respondWithTools([{ name: "inspect_native_section", args: { sectionId: "return", focusPartId: "lead" } }, { name: "apply_native_batch", args: { stepKey: "develop-return", operations: [{ kind: "developSectionNotes", partId: "lead", sectionId: "return", pitchShiftSemitones: 2, velocityFactor: 1.1 }] } }])
      .respond(new AIMessage("The return transposes the shared call locally while the earlier call stays unchanged; no audio was heard."));
    const timer = setInterval(() => { void heartbeat(job); }, 750);
    try {
      const produced = await produceNative({ session, direction, mode: "generation", sources: [], scriptedModel: model });
      expect(JSON.stringify(model.calls[2]!.messages)).toContain("return");
      const notes = materializedNotes(session.document, "lead");
      expect(notes.filter((note) => note.startTick < 12 * 960).map((note) => note.pitch)).toEqual([64, 67]);
      expect(notes.filter((note) => note.startTick >= 8 * 3 * 960).map((note) => note.pitch)).toEqual([66, 69]);
      const verified = await validateNativeOffline(session.document);
      expect(verified.readback.noteEntities).toBe(4);
      expect(session.document.delayBus?.id).toBe("shared-echo");
      expect(session.document.master?.limiterEnabled).toBe(true);
      await commitNativeRevision(job, session.document, produced.summary, produced);
      expect((await nativeSnapshot(ownerId, scratchId)).current?.document.parts[0]?.placements).toHaveLength(1);
    } finally { clearInterval(timer); }
  }, 90_000);

  it("keeps resource-search evidence in the next model input after a mutation", async () => {
    const scratchId = (await createProject(ownerId, "Native context evidence")).id;
    extraProjects.push(scratchId);
    const direction = "A four-bar glass phrase";
    const request = { direction, sourceAssetIds: [], expectedNativeHeadId: null };
    const accepted = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "search-after-compose", request, expectedHeadId: null });
    const job = await claim(accepted.id, "native-context-worker");
    const session = new NativeToolSession(job, seedNativeDocument(direction));
    const form = { title: "Glass phrase", tempoBpm: 90, meter: { numerator: 4, denominator: 4 }, sections: [{ id: "phrase", name: "Phrase", bars: 4 }], parts: [{ id: "glass", name: "Glass", role: "melody", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, motifs: [], placements: [], freeNotes: [{ beat: 0, durationBeats: 2, pitch: 67, velocity: 0.6 }] }] };
    const model = fakeModel().respondWithTools([{ name: "compose_native_form", args: form }]).respondWithTools([{ name: "search_native_resources", args: { query: "glass" } }]).respond(new AIMessage("The glass recipe was found after construction; no audio was heard."));
    const timer = setInterval(() => { void heartbeat(job); }, 750);
    try {
      await produceNative({ session, direction, mode: "generation", sources: [], scriptedModel: model });
      const afterMutation = JSON.stringify(model.calls[1]!.messages);
      const afterSearch = JSON.stringify(model.calls[2]!.messages);
      expect(afterSearch).toContain("soft-glass");
      expect(afterSearch).toContain("Pocket Producer original parameter recipe; unheard");
      expect(afterSearch).not.toBe(afterMutation);
    } finally { clearInterval(timer); }
  }, 90_000);

  it("serializes two edits from one actual agent turn and replays their durable predecessors", async () => {
    const scratchId = (await createProject(ownerId, "Parallel tool edits")).id;
    extraProjects.push(scratchId);
    const direction = "A 4-bar melody";
    const accepted = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "parallel-edits", request: { direction, sourceAssetIds: [], expectedNativeHeadId: null }, expectedHeadId: null });
    const job = await claim(accepted.id, "parallel-edits-worker");
    const session = new NativeToolSession(job, seedNativeDocument(direction));
    const form = { title: "Parallel edits", tempoBpm: 90, meter: { numerator: 4, denominator: 4 }, sections: [{ id: "whole", name: "Whole", bars: 4 }], parts: [{ id: "lead", name: "Lead", role: "melody", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, motifs: [], placements: [], freeNotes: [{ beat: 0, durationBeats: 1, pitch: 64, velocity: 0.7 }] }] };
    const model = fakeModel().respondWithTools([{ name: "compose_native_form", args: form }]).respondWithTools([
      { name: "apply_native_batch", args: { stepKey: "gain-edit", operations: [{ kind: "setMix", partId: "lead", gain: 0.2 }] } },
      { name: "apply_native_batch", args: { stepKey: "pan-edit", operations: [{ kind: "setMix", partId: "lead", pan: 0.8 }] } }
    ]).respond(new AIMessage("Both edits were applied; no audio was heard."));
    const timer = setInterval(() => { void heartbeat(job); }, 750);
    try {
      const result = await produceNative({ session, direction, mode: "generation", sources: [], scriptedModel: model });
      expect(session.document.parts[0]).toMatchObject({ gain: 0.2, pan: 0.8 });
      expect(session.applied).toHaveLength(3);
      const tentative = await nativeDraftView(ownerId, scratchId, job.id);
      expect(tentative).toMatchObject({ selected: false, stepCount: 3, documentHash: canonicalHash(session.document) });
      expect(tentative.document?.parts[0]).toMatchObject({ gain: 0.2, pan: 0.8 });
      await expect(nativeDraftView(randomUUID(), scratchId, job.id)).rejects.toMatchObject({ statusCode: 404 });
      await commitNativeRevision(job, session.document, result.summary, result);
      const restarted = new NativeToolSession(job, seedNativeDocument(direction));
      await restarted.replay();
      expect(restarted.document.parts[0]).toMatchObject({ gain: 0.2, pan: 0.8 });
      expect(canonicalHash(restarted.document)).toBe(canonicalHash((await nativeSnapshot(ownerId, scratchId)).current!.document));
      const rows = await getPool().query<{ predecessor_hash: string; result_hash: string }>("SELECT predecessor_hash,result_hash FROM native_job_step WHERE job_id=$1 ORDER BY ordinal", [job.id]);
      expect(rows.rows[1]!.predecessor_hash).toBe(rows.rows[0]!.result_hash);
      expect(rows.rows[2]!.predecessor_hash).toBe(rows.rows[1]!.result_hash);
    } finally { clearInterval(timer); }
  }, 90_000);

  it("detects an older inconsistent step ledger without rewriting accepted history", async () => {
    const scratchId = (await createProject(ownerId, "Historical step audit")).id;
    extraProjects.push(scratchId);
    const direction = "A compact instrumental phrase";
    const accepted = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "historical-step-audit", request: { direction, sourceAssetIds: [], expectedNativeHeadId: null }, expectedHeadId: null });
    const job = await claim(accepted.id, "historical-audit-worker");
    const session = new NativeToolSession(job, seedNativeDocument(direction));
    await fixtureConstruct(session, direction, []);
    const original = (await getPool().query<{ result_hash: string }>("SELECT result_hash FROM native_job_step WHERE job_id=$1 ORDER BY ordinal LIMIT 1", [job.id])).rows[0]!.result_hash;
    try {
      await getPool().query("UPDATE native_job_step SET result_hash=$2 WHERE job_id=$1 AND ordinal=1", [job.id, "0".repeat(64)]);
      await expect(new NativeToolSession(job, seedNativeDocument(direction)).replay()).rejects.toThrow(/NATIVE_HISTORY_INCONSISTENT/);
      expect((await getPool().query<{ result_hash: string }>("SELECT result_hash FROM native_job_step WHERE job_id=$1 AND ordinal=1", [job.id])).rows[0]!.result_hash).toBe("0".repeat(64));
    } finally {
      await getPool().query("UPDATE native_job_step SET result_hash=$2 WHERE job_id=$1 AND ordinal=1", [job.id, original]);
    }
    await expect(new NativeToolSession(job, seedNativeDocument(direction)).replay()).resolves.toBeUndefined();
  }, 90_000);

  it("keeps a valid sibling after a failed edit, fences duplicate keys and cancellation", async () => {
    const scratchId = (await createProject(ownerId, "Native step failure fencing")).id;
    extraProjects.push(scratchId);
    const direction = "A compact melody";
    const accepted = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "step-fencing", request: { direction, sourceAssetIds: [], expectedNativeHeadId: null }, expectedHeadId: null });
    const job = await claim(accepted.id, "step-fencing-worker");
    const session = new NativeToolSession(job, seedNativeDocument(direction));
    await fixtureConstruct(session, direction, []);
    const [bad, good] = await Promise.allSettled([
      session.apply("bad-sibling", [{ kind: "setMix", partId: "not-a-part", gain: 0.1 }]),
      session.apply("good-sibling", [{ kind: "setMix", partId: "hook", gain: 0.2 }])
    ]);
    expect(bad.status).toBe("rejected");
    expect(good.status, good.status === "rejected" ? String(good.reason) : "").toBe("fulfilled");
    expect(session.document.parts.find((part) => part.id === "hook")?.gain).toBe(0.2);
    expect((await session.apply("good-sibling", [{ kind: "setMix", partId: "hook", gain: 0.2 }])).replayed).toBe(true);
    await expect(session.apply("good-sibling", [{ kind: "setMix", partId: "hook", gain: 0.4 }])).rejects.toThrow(/REPLAY_CONFLICT/);
    const savedHash = canonicalHash(session.document);
    await cancelJob(ownerId, job.id);
    await expect(session.apply("after-cancel", [{ kind: "setMix", partId: "hook", pan: 0.3 }])).rejects.toThrow(/lease|cancel/i);
    expect(canonicalHash(session.document)).toBe(savedHash);
    const restarted = new NativeToolSession(job, seedNativeDocument(direction));
    await restarted.replay();
    expect(canonicalHash(restarted.document)).toBe(savedHash);
  }, 90_000);

  it("retains mixed write/search and failed-read evidence in the next dispatch", async () => {
    const scratchId = (await createProject(ownerId, "Mixed native context")).id;
    extraProjects.push(scratchId);
    const direction = "A 4-bar glass melody";
    const accepted = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "mixed-context", request: { direction, sourceAssetIds: [], expectedNativeHeadId: null }, expectedHeadId: null });
    const job = await claim(accepted.id, "mixed-context-worker");
    const session = new NativeToolSession(job, seedNativeDocument(direction));
    const form = { title: "Glass", tempoBpm: 90, meter: { numerator: 4, denominator: 4 }, sections: [{ id: "whole", name: "Whole", bars: 4 }], parts: [{ id: "glass", name: "Glass", role: "melody", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, motifs: [], placements: [], freeNotes: [{ beat: 0, durationBeats: 1, pitch: 67, velocity: 0.6 }] }] };
    const model = fakeModel().respondWithTools([{ name: "compose_native_form", args: form }, { name: "search_native_resources", args: { query: "glass" } }]).respondWithTools([{ name: "apply_native_batch", args: { stepKey: "pan-after-search", operations: [{ kind: "setMix", partId: "glass", pan: 0.3 }] } }, { name: "inspect_native_part", args: { partId: "missing" } }]).respond(new AIMessage("Kept the glass sound and changed pan; the missing part was not used."));
    const timer = setInterval(() => { void heartbeat(job); }, 750);
    try {
      await produceNative({ session, direction, mode: "generation", sources: [], scriptedModel: model });
      const afterFirst = JSON.stringify(model.calls[1]!.messages);
      const afterSecond = JSON.stringify(model.calls[2]!.messages);
      expect(afterFirst).toContain("soft-glass");
      expect(afterSecond).toContain("missing");
      expect(afterSecond).toContain("Unknown part");
      expect(session.document.parts[0]!.pan).toBe(0.3);
    } finally { clearInterval(timer); }
  }, 90_000);

  it("uses a searched Audiotool sample through production tools and trusted metadata resolution", async () => {
    const scratchId = (await createProject(ownerId, "Native library source flow")).id;
    extraProjects.push(scratchId);
    const direction = "A four-bar melody with a later texture sample";
    const request = { direction, sourceAssetIds: [], expectedNativeHeadId: null };
    const accepted = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "scripted-library-source", request, expectedHeadId: null });
    const job = await claim(accepted.id, "library-source-worker");
    const sample = { name: "samples/texture-001", displayName: "Long texture", ownerName: "users/fixture", durationSeconds: 14, bpm: 0, kind: "one-shot", visibility: "public", tags: ["texture"] };
    const library = createNativeLibrary({ samples: { list: () => Promise.resolve({ samples: [sample], nextPageToken: "" }), get: () => Promise.resolve(sample) }, presets: { search: () => Promise.resolve([]), get: () => Promise.resolve(new Error("missing")) } } as unknown as NativeLibraryClient);
    const session = new NativeToolSession(job, seedNativeDocument(direction), true, library);
    const form = { title: "Texture study", tempoBpm: 90, meter: { numerator: 4, denominator: 4 }, sections: [{ id: "whole", name: "Whole", bars: 4 }], parts: [{ id: "lead", name: "Lead", role: "melody", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, motifs: [], placements: [], freeNotes: [{ beat: 0, durationBeats: 1, pitch: 64, velocity: 0.7 }] }] };
    const region = { id: "texture-later", sampleName: sample.name, displayName: sample.displayName, ownerName: sample.ownerName, durationSeconds: sample.durationSeconds, bpm: 0, startTick: 3840, durationTicks: 1920, sourceStartSeconds: 5, sourceDurationSeconds: 3, playbackMode: "once", gain: 0.4, provenance: "audiotool-library" };
    const model = fakeModel().respondWithTools([{ name: "compose_native_form", args: form }]).respondWithTools([{ name: "search_audiotool_samples", args: { query: "texture" } }]).respondWithTools([{ name: "apply_native_batch", args: { stepKey: "place-found-texture", operations: [{ kind: "addPart", part: { id: "source", name: "Texture source", role: "source", device: { type: "audio", parameters: {} }, gain: 0.5, pan: 0.2, notes: [], placements: [], sourceRegions: [], libraryRegions: [region], effects: [], automation: [] } }] } }]).respond(new AIMessage("Placed the returned later sample interval; audio remains unverified."));
    const timer = setInterval(() => { void heartbeat(job); }, 750);
    try {
      const produced = await produceNative({ session, direction, mode: "generation", sources: [], scriptedModel: model });
      expect(produced.provider).toBe("scripted-deep-agent");
      expect(JSON.stringify(model.calls[2]!.messages)).toContain(sample.name);
      expect(session.document.parts.find((part) => part.id === "source")?.libraryRegions?.[0]?.sourceStartSeconds).toBe(5);
      const resource = await library.getSample(sample.name);
      expect((await validateNativeOffline(session.document, {}, {}, { [sample.name]: resource })).readback.noteEntities).toBe(1);
    } finally { clearInterval(timer); }
  }, 90_000);

  it("sequences measured, hash-pinned sample slices through the real worker path", async () => {
    const scratchId = (await createProject(ownerId, "Measured sample sequence")).id;
    extraProjects.push(scratchId);
    const sample = { name: "samples/two-hits", displayName: "Short texture", ownerName: "users/fixture", durationSeconds: 1, bpm: 90, kind: "one-shot", visibility: "public", tags: ["texture"] };
    const pcm = new Float32Array(48_000); pcm.fill(0.2, 4_000, 20_000);
    const bytes = encodeWav(pcm, pcm, 48_000);
    let downloads = 0;
    const library = createNativeLibrary({ samples: { list: () => Promise.resolve({ samples: [sample], nextPageToken: "" }), get: () => Promise.resolve(sample), download: () => { downloads++; return Promise.resolve(new Blob([Uint8Array.from(bytes)])); } }, presets: { search: () => Promise.resolve([]), get: () => Promise.resolve(new Error("missing")) } } as unknown as NativeLibraryClient);
    const direction = "A four-bar melody with two quiet sample accents";
    const accepted = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "measured-sample-sequence", request: { direction, sourceAssetIds: [], expectedNativeHeadId: null }, expectedHeadId: null });
    const form = { title: "Two accents", tempoBpm: 90, meter: { numerator: 4, denominator: 4 }, sections: [{ id: "whole", name: "Whole", bars: 4 }], parts: [
      { id: "lead", name: "Lead", role: "melody", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, motifs: [], placements: [], freeNotes: [{ beat: 0, durationBeats: 1, pitch: 64, velocity: 0.7 }] },
      { id: "texture", name: "Texture", role: "source", device: { type: "audio", parameters: {} }, gain: 0.5, pan: 0, motifs: [], placements: [], freeNotes: [] }
    ] };
    const model = fakeModel().respondWithTools([{ name: "compose_native_form", args: form }])
      .respondWithTools([{ name: "inspect_audiotool_sample_audio", args: { name: sample.name } }])
      .respondWithTools([{ name: "analyze_audiotool_sample", args: { name: sample.name } }])
      .respondWithTools([{ name: "analyze_audiotool_sample", args: { name: sample.name } }])
      .respondWithTools([{ name: "sequence_audiotool_sample", args: { stepKey: "two-texture-hits", partId: "texture", sectionId: "whole", sampleName: sample.name, hits: [{ sectionTick: 0, sourceStartSeconds: 0.08, sourceDurationSeconds: 0.18, gain: 0.3, playbackRate: 1 }, { sectionTick: 7680, sourceStartSeconds: 0.2, sourceDurationSeconds: 0.18, gain: 0.2, playbackRate: 1 }] } }])
      .respond(new AIMessage("Two exact slices were placed; the full arrangement was not heard."));
    let semanticCalls = 0;
    const semantic: GeminiGenerateClient = { generateContent: () => { semanticCalls++; return Promise.resolve({ text: JSON.stringify({ observations: ["Short airy accent"], musicalCharacter: ["Soft"], suggestedRole: "texture", confidence: "medium" }), usageMetadata: { promptTokenCount: 320, candidatesTokenCount: 24, thoughtsTokenCount: 8, totalTokenCount: 352 } }) as ReturnType<GeminiGenerateClient["generateContent"]>; } };
    await processJob(await claim(accepted.id, "sample-sequence-worker"), { scriptedModel: model, scriptedGeminiClient: semantic, library });
    expect((await jobSnapshot(ownerId, accepted.id)).state).toBe("succeeded");
    const regions = (await nativeSnapshot(ownerId, scratchId)).current!.document.parts.find((part) => part.id === "texture")!.libraryRegions;
    expect(regions).toHaveLength(2);
    expect(regions?.map((region) => [region.startTick, region.sourceStartSeconds, region.playbackMode])).toEqual([[0, 0.08, "once"], [7680, 0.2, "once"]]);
    expect(regions?.[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(regions?.[1]?.contentHash).toBe(regions?.[0]?.contentHash);
    expect(downloads).toBeGreaterThanOrEqual(2); // inspection, construction and final validation remain authoritative.
    expect(JSON.stringify(model.calls[2]?.messages)).toContain("suggestedSlices");
    expect(JSON.stringify(model.calls[3]?.messages)).toContain("Short airy accent");
    expect(semanticCalls).toBe(1);
    const semanticEffects = await getPool().query("SELECT state,cost_status FROM effect WHERE job_id=$1 AND step='library-sample-analysis'", [accepted.id]);
    expect(semanticEffects.rows).toEqual([expect.objectContaining({ state: "succeeded", cost_status: "observed" })]);
  }, 120_000);

  it("does not accept a score after an uncertain shortlisted-sample analysis", async () => {
    const scratchId = (await createProject(ownerId, "Uncertain sample analysis")).id;
    extraProjects.push(scratchId);
    const sample = { name: "samples/uncertain-accent", displayName: "Accent", ownerName: "users/fixture", durationSeconds: 1, bpm: 90, kind: "one-shot", visibility: "public", tags: ["texture"] };
    const pcm = new Float32Array(48_000); pcm.fill(0.15, 1_000, 8_000);
    const bytes = encodeWav(pcm, pcm, 48_000);
    const library = createNativeLibrary({ samples: { list: () => Promise.resolve({ samples: [sample], nextPageToken: "" }), get: () => Promise.resolve(sample), download: () => Promise.resolve(new Blob([Uint8Array.from(bytes)])) }, presets: { search: () => Promise.resolve([]), get: () => Promise.resolve(new Error("missing")) } } as unknown as NativeLibraryClient);
    const accepted = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "uncertain-sample-analysis", request: { direction: "A soft lead with a single sampled accent", sourceAssetIds: [], expectedNativeHeadId: null }, expectedHeadId: null });
    const form = { title: "Soft lead", tempoBpm: 90, meter: { numerator: 4, denominator: 4 }, sections: [{ id: "whole", name: "Whole", bars: 4 }], parts: [{ id: "lead", name: "Lead", role: "melody", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, motifs: [], placements: [], freeNotes: [{ beat: 0, durationBeats: 1, pitch: 64, velocity: 0.7 }] }] };
    const model = fakeModel().respondWithTools([{ name: "compose_native_form", args: form }]).respondWithTools([{ name: "analyze_audiotool_sample", args: { name: sample.name } }]).respond(new AIMessage("Finished"));
    const semantic: GeminiGenerateClient = { generateContent: () => Promise.reject(new TypeError("network interrupted")) };
    await processJob(await claim(accepted.id, "uncertain-sample-worker"), { scriptedModel: model, scriptedGeminiClient: semantic, library });
    expect((await jobSnapshot(ownerId, accepted.id)).state).toBe("needs_attention");
    expect((await nativeSnapshot(ownerId, scratchId)).currentRevisionId).toBeNull();
    const semanticEffects = await getPool().query("SELECT state,cost_status FROM effect WHERE job_id=$1 AND step='library-sample-analysis'", [accepted.id]);
    expect(semanticEffects.rows).toEqual([expect.objectContaining({ state: "uncertain", cost_status: "unknown" })]);
  }, 120_000);

  it("atomically limits distinct shortlisted analyses under contending reservations", async () => {
    const scratchId = (await createProject(ownerId, "Sample analysis contention")).id;
    extraProjects.push(scratchId);
    const accepted = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "sample-analysis-contention", request: { direction: "A quiet texture study", sourceAssetIds: [], expectedNativeHeadId: null }, expectedHeadId: null });
    const job = await claim(accepted.id, "sample-analysis-contender");
    const reserve = (index: number) => reserveProviderEffect({ job, provider: "gemini", step: "library-sample-analysis", idempotencyKey: `sample-${index}`, inputHash: `hash-${index}`, model: "fixture-gemini", promptVersion: "library-sample-analysis-v2", reservationMicrousd: 100, maxDistinctEffectsForStep: 2 });
    const raced = await Promise.allSettled([reserve(1), reserve(2), reserve(3)]);
    expect(raced.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    expect(raced.filter((result) => result.status === "rejected")).toEqual([expect.objectContaining({ reason: expect.objectContaining({ message: "MODEL_STEP_EFFECT_LIMIT_EXCEEDED" }) })]);
    expect((await getPool().query("SELECT id FROM effect WHERE job_id=$1 AND step='library-sample-analysis'", [accepted.id])).rowCount).toBe(2);
    const firstAccepted = raced.findIndex((result) => result.status === "fulfilled") + 1;
    expect((await reserve(firstAccepted)).id).toBe((raced[firstAccepted - 1] as PromiseFulfilledResult<Awaited<ReturnType<typeof reserve>>>).value.id);
  }, 120_000);

  it("commits a library-loop-only worker job and preserves its head when a later resource disappears", async () => {
    const scratchId = (await createProject(ownerId, "Library-only worker room")).id;
    extraProjects.push(scratchId);
    const sample = { name: "samples/worker-loop", displayName: "Worker loop", ownerName: "users/fixture", durationSeconds: 8, bpm: 90, kind: "loop", visibility: "public", tags: ["texture"] };
    let available = true;
    const library = createNativeLibrary({ samples: { list: () => Promise.resolve({ samples: [sample], nextPageToken: "" }), get: () => Promise.resolve(available ? sample : new Error("removed")) }, presets: { search: () => Promise.resolve([]), get: () => Promise.resolve(new Error("missing")) } } as unknown as NativeLibraryClient);
    const direction = "A 4-bar looping texture";
    const accepted = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "library-only-worker", request: { direction, sourceAssetIds: [], expectedNativeHeadId: null }, expectedHeadId: null });
    const form = { title: "Loop study", tempoBpm: 90, meter: { numerator: 4, denominator: 4 }, sections: [{ id: "whole", name: "Whole", bars: 4 }], parts: [{ id: "loop", name: "Loop", role: "source", device: { type: "audio", parameters: {} }, gain: 0.6, pan: 0, motifs: [], placements: [], librarySamples: [{ id: "loop-one", sampleName: sample.name, displayName: sample.displayName, ownerName: sample.ownerName, durationSeconds: 8, bpm: 90, startBar: 0, durationBars: 4, sourceStartSeconds: 0, sourceDurationSeconds: 8, playbackMode: "loop", gain: 0.5 }] }] };
    await processJob(await claim(accepted.id, "library-only-worker"), { library, scriptedModel: fakeModel().respondWithTools([{ name: "compose_native_form", args: form }]).respond(new AIMessage("Constructed a loop-only structure; audio not heard.")) });
    const saved = await nativeSnapshot(ownerId, scratchId);
    expect((await jobSnapshot(ownerId, accepted.id)).state).toBe("succeeded");
    expect(saved.current?.document.parts[0]?.libraryRegions).toHaveLength(1);
    expect(saved.current?.producer.offlineValidation).toBeDefined();
    available = false;
    const revision = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-revision", idempotencyKey: "removed-loop-revision", request: { direction: "Replace the unavailable loop", sourceAssetIds: [], expectedNativeHeadId: saved.currentRevisionId, baseNativeRevisionId: saved.currentRevisionId }, expectedHeadId: saved.currentRevisionId });
    await processJob(await claim(revision.id, "removed-loop-worker"), { library, scriptedModel: fakeModel().respondWithTools([{ name: "apply_native_batch", args: { stepKey: "replace-missing-loop", operations: [{ kind: "replaceLibrarySample", partId: "loop", region: { id: "loop-one", sampleName: sample.name, displayName: sample.displayName, ownerName: sample.ownerName, durationSeconds: 8, bpm: 90, startTick: 0, durationTicks: 15360, sourceStartSeconds: 0, sourceDurationSeconds: 8, playbackMode: "loop", gain: 0.4, provenance: "audiotool-library" } }] } }]).respond(new AIMessage("I could not verify the removed loop.")) });
    expect((await jobSnapshot(ownerId, revision.id)).state).not.toBe("succeeded");
    expect((await nativeSnapshot(ownerId, scratchId)).currentRevisionId).toBe(saved.currentRevisionId);
  }, 90_000);

  it("keeps a pinned preset version immutable when the same remote identity drifts before sync", async () => {
    const scratchId = (await createProject(ownerId, "Pinned sound history")).id;
    extraProjects.push(scratchId);
    const name = "presets/pinned-worker-sound";
    const meta = { name, displayName: "Pinned sound", ownerName: "users/fixture", tags: [] };
    const presetWithGain = async (gain: number) => { const doc = await createOfflineDocument({ validated: true }); let data: unknown; await doc.modify((t) => { data = t.createPresetFor(t.create("heisenberg", { operatorA: { gain } })); }); return { entityType: "heisenberg", _presetName: name, meta, data } as unknown as NativePreset; };
    let current = await presetWithGain(0.2);
    const client = { samples: { list: () => Promise.resolve({ samples: [], nextPageToken: "" }), get: () => Promise.resolve(new Error("missing")) }, presets: { search: () => Promise.resolve([current]), get: () => Promise.resolve(current) } } as unknown as NativeLibraryClient;
    const library = createNativeLibrary(client);
    const direction = "A 4-bar melody using the pinned sound";
    const accepted = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "pinned-sound", request: { direction, sourceAssetIds: [], expectedNativeHeadId: null }, expectedHeadId: null });
    const form = { title: "Pinned sound", tempoBpm: 90, meter: { numerator: 4, denominator: 4 }, sections: [{ id: "whole", name: "Whole", bars: 4 }], parts: [{ id: "lead", name: "Lead", role: "melody", device: { type: "heisenberg", parameters: {}, preset: { name, displayName: meta.displayName, ownerName: meta.ownerName, contentHash: nativePresetFingerprint(current) } }, gain: 0.6, pan: 0, motifs: [], placements: [], freeNotes: [{ beat: 0, durationBeats: 1, pitch: 64, velocity: 0.7 }] }] };
    await processJob(await claim(accepted.id, "pinned-sound-worker"), { library, scriptedModel: fakeModel().respondWithTools([{ name: "compose_native_form", args: form }]).respond(new AIMessage("The sound was pinned; no audio heard.")) });
    const saved = await nativeSnapshot(ownerId, scratchId);
    expect(saved.current?.document.parts[0]?.device.preset?.contentHash).toBe(nativePresetFingerprint(current));
    current = await presetWithGain(0.85);
    const sync = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-sync", idempotencyKey: "drift-sync", request: { baseNativeRevisionId: saved.currentRevisionId, expectedNativeHeadId: saved.currentRevisionId }, expectedHeadId: saved.currentRevisionId });
    let creates = 0;
    const remote = { client: { samples: client.samples, presets: client.presets, projects: { createProject: () => { creates++; return Promise.resolve(new Error("should not create")); } }, open: () => Promise.reject(new Error("should not open")) }, awaitTokenPersistence: () => Promise.resolve() };
    await expect(nativeSynchronization(await claim(sync.id, "drift-sync-worker"), new AbortController().signal, remote as never)).rejects.toThrow(/configuration changed/);
    expect(creates).toBe(0);
    expect((await nativeSnapshot(ownerId, scratchId)).currentRevisionId).toBe(saved.currentRevisionId);
  }, 90_000);

  it("recovers confirmed musical steps after a worker restart without redispatching a model call", async () => {
    const scratchId = (await createProject(ownerId, "Confirmed native restart")).id;
    extraProjects.push(scratchId);
    const direction = "A compact rhythmic study";
    const request = { direction, sourceAssetIds: [], expectedNativeHeadId: null };
    const accepted = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "recovered-aggregate", request, expectedHeadId: null });
    const first = await claim(accepted.id, "native-before-crash");
    const beforeCrash = new NativeToolSession(first, seedNativeDocument(direction));
    await fixtureConstruct(beforeCrash, direction, []);
    const operationHash = canonicalHash({ version: "native-producer-v2", jobId: first.id, request: first.request, model: getConfig().OPENAI_MODEL });
    const aggregate = await reserveProviderEffect({ job: first, provider: "openai", step: "native-producer-result", idempotencyKey: `native-producer:${operationHash}`, inputHash: operationHash, model: getConfig().OPENAI_MODEL, promptVersion: "native-producer-v2", reservationMicrousd: 0 });
    await markEffectDispatched(aggregate.id, first);
    const modelEffect = await reserveProviderEffect({ job: first, provider: "openai", step: "producer-model-call", idempotencyKey: "confirmed-call-before-crash", inputHash: "confirmed-call", model: getConfig().OPENAI_MODEL, promptVersion: "test", reservationMicrousd: 0 });
    await markEffectDispatched(modelEffect.id, first);
    expect(await completeProviderEffect({ effectId: modelEffect.id, job: first, output: { usage: { inputTokens: 0, outputTokens: 0 } }, actualCostMicrousd: 0 })).toBe("succeeded");
    const completedResult = { summary: "A complete rhythmic study", provider: "scripted-deep-agent", model: "scripted", costUsd: 0, usage: { inputTokens: 0, outputTokens: 0 }, steps: beforeCrash.applied };
    await recordNativeProducerCompletion(first, beforeCrash.document, beforeCrash.applied.length, completedResult);
    expect(await requeueJob(first, "PROCESS_EXIT", "Worker stopped after a confirmed batch")).toBe(true);
    const restarted = await claim(accepted.id, "native-after-crash");
    const resumed = new NativeToolSession(restarted, seedNativeDocument(direction));
    const model = fakeModel();
    const result = await produceNative({ session: resumed, direction, mode: "generation", sources: [], scriptedModel: model });
    expect(result.provider).toBe("scripted-deep-agent");
    expect(model.callCount).toBe(0);
    expect(resumed.applied).toHaveLength(1);
    await commitNativeRevision(restarted, resumed.document, result.summary, result);
    expect((await nativeSnapshot(ownerId, scratchId)).current?.document.parts.length).toBeGreaterThan(1);
  }, 60_000);

  it("continues a confirmed but unfinished ensemble instead of selecting its one-note sketch", async () => {
    const scratchId = (await createProject(ownerId, "Unfinished native ensemble")).id;
    extraProjects.push(scratchId);
    const direction = "A 48-bar ensemble with drums, bass, harmony, lead and transitions";
    const request = { direction, sourceAssetIds: [], expectedNativeHeadId: null };
    const accepted = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "unfinished-ensemble", request, expectedHeadId: null });
    const first = await claim(accepted.id, "unfinished-before-crash");
    const sketch = new NativeToolSession(first, seedNativeDocument(direction));
    await sketch.apply("first-note", [{ kind: "addNotes", partId: "starting-voice", notes: [{ id: "first", startTick: 0, durationTicks: 960, pitch: 60, velocity: 0.7 }] }]);
    const operationHash = canonicalHash({ version: "native-producer-v2", jobId: first.id, request: first.request, model: getConfig().OPENAI_MODEL });
    const aggregate = await reserveProviderEffect({ job: first, provider: "openai", step: "native-producer-result", idempotencyKey: `native-producer:${operationHash}`, inputHash: operationHash, model: getConfig().OPENAI_MODEL, promptVersion: "native-producer-v2", reservationMicrousd: 0 });
    await markEffectDispatched(aggregate.id, first);
    const modelEffect = await reserveProviderEffect({ job: first, provider: "openai", step: "producer-model-call", idempotencyKey: "confirmed-incomplete-call", inputHash: "confirmed-incomplete", model: getConfig().OPENAI_MODEL, promptVersion: "test", reservationMicrousd: 0 });
    await markEffectDispatched(modelEffect.id, first);
    expect(await completeProviderEffect({ effectId: modelEffect.id, job: first, output: { usage: { inputTokens: 0, outputTokens: 0 } }, actualCostMicrousd: 0 })).toBe("succeeded");
    expect((await nativeSnapshot(ownerId, scratchId)).current).toBeNull();
    expect(await requeueJob(first, "PROCESS_EXIT", "Worker stopped before completing the ensemble")).toBe(true);
    const resumedJob = await claim(accepted.id, "unfinished-after-crash");
    const resumed = new NativeToolSession(resumedJob, seedNativeDocument(direction));
    const roles = ["percussion", "bass", "harmony", "melody", "fx"] as const;
    const operations = [
      { kind: "setStructure", bars: 48, sections: [{ id: "opening", name: "Opening", startBar: 0, endBar: 16, intent: "Establish" }, { id: "development", name: "Development", startBar: 16, endBar: 32, intent: "Contrast" }, { id: "release", name: "Release", startBar: 32, endBar: 48, intent: "Return" }] },
      { kind: "removePart", partId: "starting-voice" },
      ...roles.map((role, index) => ({ kind: "addPart", part: { id: `role-${role}`, name: role, role, device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, notes: [{ id: `note-${role}`, startTick: index * 960, durationTicks: 960, pitch: 48 + index * 5, velocity: 0.6 }], placements: [], sourceRegions: [], effects: [], automation: [] } }))
    ];
    const model = fakeModel().respondWithTools([{ name: "apply_native_batch", args: { stepKey: "finish-ensemble", operations } }]).respond(new AIMessage("The requested roles and length are now present structurally."));
    const timer = setInterval(() => { void heartbeat(resumedJob); }, 750);
    try {
      const result = await produceNative({ session: resumed, direction, mode: "generation", sources: [], scriptedModel: model });
      expect(model.callCount).toBe(2);
      expect(result.provider).toBe("scripted-deep-agent");
      expect(resumed.document.bars).toBe(48);
      expect(resumed.document.parts).toHaveLength(5);
      await commitNativeRevision(resumedJob, resumed.document, result.summary, result);
      expect((await nativeSnapshot(ownerId, scratchId)).current?.document.bars).toBe(48);
    } finally { clearInterval(timer); }
  }, 90_000);

  async function pausedForAbandon(uncertain = false) {
    const room = (await createProject(ownerId, "Abandonment regression")).id; extraProjects.push(room);
    const request = { direction: "An unfinished melody", sourceAssetIds: [], expectedNativeHeadId: null };
    const accepted = await createNativeJob({ ownerId, projectId: room, kind: "native-generation", idempotencyKey: randomUUID(), request, expectedHeadId: null });
    const job = await claim(accepted.id, "abandon-test");
    const session = new NativeToolSession(job, seedNativeDocument(request.direction));
    await session.apply("confirmed-note", [{ kind: "addNotes", partId: "starting-voice", notes: [{ id: "one", startTick: 0, durationTicks: 960, pitch: 60, velocity: 0.7 }] }]);
    const aggregate = await reserveProviderEffect({ job, provider: "openai", step: "native-producer-result", idempotencyKey: randomUUID(), inputHash: canonicalHash(request), model: "fixture", promptVersion: "test", reservationMicrousd: 0 });
    await markEffectDispatched(aggregate.id, job);
    const call = await reserveProviderEffect({ job, provider: "openai", step: "producer-model-call", idempotencyKey: randomUUID(), inputHash: canonicalHash(request), model: "fixture", promptVersion: "test", reservationMicrousd: 100 });
    await markEffectDispatched(call.id, job);
    if (!uncertain) await completeProviderEffect({ effectId: call.id, job, actualCostMicrousd: 17, output: {} });
    await needsAttentionJob(job, "NATIVE_PARTIAL", "Confirmed draft retained");
    return { room, job, request };
  }

  it("abandons safe work idempotently, retains draft/accounting and permits a new direction", async () => {
    const { room, job, request } = await pausedForAbandon();
    const effects = (await getPool().query("SELECT * FROM effect WHERE job_id=$1 ORDER BY id", [job.id])).rows;
    await expect(abandonNativePartialJob(randomUUID(), room, job.id)).rejects.toThrow(/not found/);
    await abandonNativePartialJob(ownerId, room, job.id);
    await abandonNativePartialJob(ownerId, room, job.id);
    expect((await jobSnapshot(ownerId, job.id)).state).toBe("cancelled");
    expect((await nativeDraftView(ownerId, room, job.id)).stepCount).toBe(1);
    expect((await nativeSnapshot(ownerId, room)).current).toBeNull();
    expect((await getPool().query("SELECT * FROM effect WHERE job_id=$1 ORDER BY id", [job.id])).rows).toEqual(effects);
    await expect(resumeNativePartialJob(ownerId, room, job.id)).rejects.toThrow(/unfinished/);
    // A fresh receipt for the same text must not be fenced by the internal aggregate.
    const same = await createNativeJob({ ownerId, projectId: room, kind: "native-generation", idempotencyKey: randomUUID(), request, expectedHeadId: null });
    await cancelJob(ownerId, same.id);
    const next = await createNativeJob({ ownerId, projectId: room, kind: "native-generation", idempotencyKey: randomUUID(), request: { ...request, direction: "A different melody" }, expectedHeadId: null });
    await processJob(await claim(next.id));
    expect((await jobSnapshot(ownerId, next.id)).state).toBe("succeeded");
    expect((await nativeDraftView(ownerId, room, job.id)).stepCount).toBe(1);
  });

  it("never abandons uncertain provider outcomes or turns them into observed spending", async () => {
    const { room, job, request } = await pausedForAbandon(true);
    await expect(abandonNativePartialJob(ownerId, room, job.id)).rejects.toThrow(/uncertain/);
    expect((await jobSnapshot(ownerId, job.id)).state).toBe("needs_attention");
    await expect(createNativeJob({ ownerId, projectId: room, kind: "native-generation", idempotencyKey: randomUUID(), request: { ...request, direction: "Different" }, expectedHeadId: null })).rejects.toThrow(/active|decision/);
  });

  it("serializes abandonment against continuation and ordinary cancellation", async () => {
    const { room, job } = await pausedForAbandon();
    const results = await Promise.allSettled([abandonNativePartialJob(ownerId, room, job.id), resumeNativePartialJob(ownerId, room, job.id)]);
    expect(results.filter((value) => value.status === "fulfilled")).toHaveLength(1);
    expect(["cancelled", "queued"]).toContain((await jobSnapshot(ownerId, job.id)).state);
    await cancelJob(ownerId, job.id);
    const second = await pausedForAbandon();
    await Promise.all([abandonNativePartialJob(ownerId, second.room, second.job.id), cancelJob(ownerId, second.job.id)]);
    expect((await jobSnapshot(ownerId, second.job.id)).state).toBe("cancelled");
    expect((await nativeDraftView(ownerId, second.room, second.job.id)).stepCount).toBe(1);
  });

  it("resumes a saved partial request under the same job ID without selecting the sketch", async () => {
    const scratchId = (await createProject(ownerId, "Resumable native draft")).id;
    extraProjects.push(scratchId);
    const direction = "A 12-bar melody";
    const request = { direction, sourceAssetIds: [], expectedNativeHeadId: null };
    const accepted = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "partial-resume-original-key", request, expectedHeadId: null });
    const first = await claim(accepted.id, "partial-first-worker");
    const sketch = new NativeToolSession(first, seedNativeDocument(direction));
    await sketch.apply("first-note", [{ kind: "addNotes", partId: "starting-voice", notes: [{ id: "single", startTick: 0, durationTicks: 960, pitch: 60, velocity: 0.6 }] }]);
    const aggregate = await reserveProviderEffect({ job: first, provider: "openai", step: "native-producer-result", idempotencyKey: `native-producer:${canonicalHash({ version: "native-producer-v2", jobId: first.id, request, model: getConfig().OPENAI_MODEL })}`, inputHash: canonicalHash({ version: "native-producer-v2", jobId: first.id, request, model: getConfig().OPENAI_MODEL }), model: getConfig().OPENAI_MODEL, promptVersion: "native-producer-v2", reservationMicrousd: 0 });
    await markEffectDispatched(aggregate.id, first);
    await needsAttentionJob(first, "NATIVE_PARTIAL", "Saved partial sketch; not selected");
    expect((await nativeSnapshot(ownerId, scratchId)).current).toBeNull();
    await resumeNativePartialJob(ownerId, scratchId, accepted.id);
    const second = await claim(accepted.id, "partial-second-worker");
    expect(second.id).toBe(first.id);
    const resumed = new NativeToolSession(second, seedNativeDocument(direction));
    const operations = [
      { kind: "setStructure", bars: 12, sections: [{ id: "opening", name: "Opening", startBar: 0, endBar: 12, intent: "Develop" }] },
      { kind: "removePart", partId: "starting-voice" },
      { kind: "addPart", part: { id: "melody", name: "Melody", role: "melody", device: { type: "heisenberg", parameters: {} }, gain: 0.6, pan: 0, notes: [{ id: "one", startTick: 0, durationTicks: 960, pitch: 64, velocity: 0.65 }], placements: [], sourceRegions: [], effects: [], automation: [] } }
    ];
    const model = fakeModel().respondWithTools([{ name: "apply_native_batch", args: { stepKey: "complete-original-request", operations } }]).respond(new AIMessage("The complete twelve-bar structure is ready; no audio was heard."));
    const timer = setInterval(() => { void heartbeat(second); }, 750);
    try {
      const produced = await produceNative({ session: resumed, direction, mode: "generation", sources: [], scriptedModel: model });
      expect(resumed.applied).toHaveLength(2);
      await commitNativeRevision(second, resumed.document, produced.summary, produced);
      expect((await nativeSnapshot(ownerId, scratchId)).current?.document.bars).toBe(12);
    } finally { clearInterval(timer); }
  }, 90_000);

  it("reconciles a duplicate receipt but permits a fresh key only after a definite failed command", async () => {
    const scratchId = (await createProject(ownerId, "Native retry contract")).id;
    extraProjects.push(scratchId);
    const request = { direction: "A short original sketch", sourceAssetIds: [], expectedNativeHeadId: null };
    const first = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "first-attempt", request, expectedHeadId: null });
    const claimed = await claim(first.id);
    expect(await failJob(claimed, "DEFINITE_LOCAL_FAILURE", "No provider dispatched")).toBe(true);
    expect(await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "first-attempt", request, expectedHeadId: null })).toMatchObject({ id: first.id, duplicate: true });
    const fresh = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "fresh-attempt", request, expectedHeadId: null });
    expect(fresh.id).not.toBe(first.id);
    await cancelJob(ownerId, fresh.id);
  });

  it("cannot bypass a prior uncertain native request by changing its captured run profile", async () => {
    const scratchId = (await createProject(ownerId, "Run-profile retry fence")).id;
    extraProjects.push(scratchId);
    const request = { direction: "A four-bar text-only phrase", profile: "standard", sourceAssetIds: [], expectedNativeHeadId: null };
    const accepted = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "uncertain-profile-original", request, expectedHeadId: null });
    const job = await claim(accepted.id);
    await needsAttentionJob(job, "NATIVE_PARTIAL", "A prior outcome needs review");
    await getPool().query("UPDATE job SET request=jsonb_set(request,'{_nativeRun,maxCalls}','12'::jsonb) WHERE id=$1", [accepted.id]);
    await expect(createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "uncertain-profile-new-key", request, expectedHeadId: null })).rejects.toThrow(/reconciliation/);
    await cancelJob(ownerId, accepted.id);
  });

  it("explicitly extends a paused Standard run without changing its effect identity or job ID", async () => {
    const scratchId = (await createProject(ownerId, "Explicit native allowance extension")).id;
    extraProjects.push(scratchId);
    const request = { direction: "A four-bar melody", profile: "standard", sourceAssetIds: [], expectedNativeHeadId: null };
    const accepted = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "extend-same-run", request, expectedHeadId: null });
    const first = await claim(accepted.id);
    const session = new NativeToolSession(first, seedNativeDocument(request.direction));
    await session.apply("opening-note", [{ kind: "addNotes", partId: "starting-voice", notes: [{ id: "opening", startTick: 0, durationTicks: 960, pitch: 60, velocity: 0.6 }] }]);
    const originalHash = canonicalHash({ version: "native-producer-v2", jobId: first.id, request: first.request, model: getConfig().OPENAI_MODEL });
    const aggregate = await reserveProviderEffect({ job: first, provider: "openai", step: "native-producer-result", idempotencyKey: `native-producer:${originalHash}`, inputHash: originalHash, model: getConfig().OPENAI_MODEL, promptVersion: "native-producer-v2", reservationMicrousd: 0 });
    await markEffectDispatched(aggregate.id, first);
    await needsAttentionJob(first, "NATIVE_PARTIAL", "Confirmed sketch is paused");
    expect((await nativeDraftView(ownerId, scratchId, accepted.id)).canExtend).toBe(true);
    await extendNativePartialJob(ownerId, scratchId, accepted.id);
    const extended = await nativeDraftView(ownerId, scratchId, accepted.id);
    expect(extended.runLimits?.profile).toBe("extended");
    expect(extended.runLimits?.maxCalls).toBe(80);
    await expect(extendNativePartialJob(ownerId, scratchId, accepted.id)).rejects.toThrow(/no available profile extension/);
    expect(await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "extend-same-run", request, expectedHeadId: null })).toMatchObject({ id: accepted.id, duplicate: true });
    await resumeNativePartialJob(ownerId, scratchId, accepted.id);
    const second = await claim(accepted.id, "extended-worker");
    const originalRequest = { ...second.request }; delete originalRequest._nativeRunCurrent;
    expect(canonicalHash({ version: "native-producer-v2", jobId: second.id, request: originalRequest, model: getConfig().OPENAI_MODEL })).toBe(originalHash);
    expect(second.id).toBe(first.id);
    await cancelJob(ownerId, accepted.id);
  });

  it("uses two real owned WAV profiles and nonzero intervals in a source-led scripted construction", async () => {
    const scratchId = (await createProject(ownerId, "Two owned sources")).id;
    extraProjects.push(scratchId);
    const rate = 8_000;
    const firstAudio = new Float32Array(rate * 8);
    for (let index = rate * 4; index < firstAudio.length; index++) firstAudio[index] = Math.sin(index / 13) * 0.28;
    const secondAudio = new Float32Array(rate * 6);
    for (let index = rate; index < secondAudio.length; index++) secondAudio[index] = Math.sin(index / 29) * 0.16;
    const firstBytes = encodeWav(firstAudio, firstAudio, rate), secondBytes = encodeWav(secondAudio, secondAudio, rate);
    const storedA = await storeImmutableAudio(ownerId, scratchId, firstBytes), storedB = await storeImmutableAudio(ownerId, scratchId, secondBytes);
    extraPaths.push(storedA.path, storedB.path);
    const firstId = await insertAsset({ ownerId, projectId: scratchId, name: "Late field event", hash: storedA.hash, path: storedA.path, durationSeconds: 8, sampleRate: rate, channels: 2, provenance: "scripted-owned-fixture" });
    const secondId = await insertAsset({ ownerId, projectId: scratchId, name: "Room tap", hash: storedB.hash, path: storedB.path, durationSeconds: 6, sampleRate: rate, channels: 2, provenance: "scripted-owned-fixture" });
    const direction = "Make a sparse 12-bar piece from the later field event and the room tap; no opening silence";
    const request = { direction, sourceAssetIds: [firstId, secondId], expectedNativeHeadId: null };
    const accepted = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "two-owned-sources", request, expectedHeadId: null });
    const job = await claim(accepted.id);
    const session = new NativeToolSession(job, seedNativeDocument(direction));
    const sources = [{ assetId: firstId, assetHash: storedA.hash, name: "Late field event", durationSeconds: 8, rights: "Owned fixture", profile: profileOwnedSourceWav(firstBytes) }, { assetId: secondId, assetHash: storedB.hash, name: "Room tap", durationSeconds: 6, rights: "Owned fixture", profile: profileOwnedSourceWav(secondBytes) }];
    expect(sources[0]!.profile.segments[0]!.nonSilentRatio).toBe(0);
    expect(sources[0]!.profile.segments.at(-1)!.nonSilentRatio).toBeGreaterThan(0.9);
    const form = { title: "Later field", tempoBpm: 96, meter: { numerator: 4, denominator: 4 }, sections: [{ id: "listen", name: "Listen", bars: 4 }, { id: "reply", name: "Reply", bars: 4 }, { id: "thin", name: "Thin", bars: 4 }], parts: [
      { id: "field", name: "Late field event", role: "source", device: { type: "audio", parameters: {} }, gain: 0.62, pan: -0.18, motifs: [], placements: [], sources: [{ id: "field-cut", assetId: firstId, startBar: 0, durationBars: 1, sourceStartSeconds: 4.5, sourceDurationSeconds: 2.5, playbackMode: "once", gain: 0.65 }] },
      { id: "tap", name: "Room tap", role: "source", device: { type: "audio", parameters: {} }, gain: 0.5, pan: 0.2, motifs: [], placements: [], sources: [{ id: "tap-cut", assetId: secondId, startBar: 4, durationBars: 1, sourceStartSeconds: 1, sourceDurationSeconds: 3, playbackMode: "once", gain: 0.5 }] },
      { id: "answer", name: "Pitched answer", role: "melody", device: { type: "heisenberg", parameters: { "operatorA.gain": 0.44 } }, gain: 0.56, pan: 0, motifs: [{ id: "answer-phrase", name: "Answer", lengthBeats: 4, notes: [{ beat: 0, durationBeats: 1, pitch: 67, velocity: 0.6 }, { beat: 2, durationBeats: 1, pitch: 64, velocity: 0.5 }] }], placements: [{ id: "answer-entry", motifId: "answer-phrase", startBar: 4, repeats: 4 }] }
    ] };
    const model = fakeModel().respondWithTools([{ name: "search_native_resources", args: { query: "" } }]).respondWithTools([{ name: "compose_native_form", args: form }]).respond(new AIMessage("Selected the measured later intervals; no native mix was heard."));
    const timer = setInterval(() => { void heartbeat(job); }, 750);
    try {
      const produced = await produceNative({ session, direction, mode: "generation", sources, scriptedModel: model });
      expect(model.callCount).toBe(3);
      expect(session.document.sourceAssetIds).toEqual([firstId, secondId]);
      expect(session.document.parts[0]!.sourceRegions[0]!.sourceStartSeconds).toBe(4.5);
      expect(session.document.parts[1]!.sourceRegions[0]!.sourceStartSeconds).toBe(1);
      const local = await validateNativeOffline(session.document);
      expect(local.unresolvedSources).toEqual(["field-cut", "tap-cut"]);
      await commitNativeRevision(job, session.document, produced.summary, produced);
      expect((await nativeSnapshot(ownerId, scratchId)).current?.document.parts).toHaveLength(3);
      const nativeRevisionId = (await nativeSnapshot(ownerId, scratchId)).currentRevisionId!;
      const syncRequest = { baseNativeRevisionId: nativeRevisionId, expectedNativeHeadId: nativeRevisionId };
      const syncCommand = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-sync", idempotencyKey: "offline-source-sync", request: syncRequest, expectedHeadId: nativeRevisionId });
      const syncJob = await claim(syncCommand.id, "offline-source-sync-worker");
      const offline = await createOfflineDocument({ validated: true });
      let uploads = 0, opens = 0;
      const connection = { client: {
        projects: { createProject: () => Promise.resolve({ project: { name: "projects/offline-source-contract" } }) },
        samples: { upload: () => {
          uploads += 1;
          return Promise.resolve({ uploaded: Promise.resolve(), ready: Promise.resolve({ name: `samples/offline-source-${uploads}`, durationSeconds: uploads === 1 ? 8 : 6 }) });
        } },
        open: () => { opens += 1; return Promise.resolve(Object.assign(offline, { start: () => Promise.resolve(), stop: () => Promise.resolve(), dawUrl: "https://offline.invalid/studio" })); }
      }, awaitTokenPersistence: () => Promise.resolve() };
      await nativeSynchronization(syncJob, new AbortController().signal, connection);
      const synchronized = await nativeSnapshot(ownerId, scratchId);
      expect(uploads).toBe(2);
      expect(opens).toBe(2);
      expect(synchronized.synchronization).toMatchObject({ state: "verified", mappingVersion: "nexus-native-v8", revisionId: nativeRevisionId });
      expect(synchronized.synchronization.verifiedAt).toBeTruthy();
      expect((await readyOwnedSampleResources(ownerId, scratchId, [firstId, secondId]))[firstId]?.sampleName).toBe("samples/offline-source-1");
      expect((await jobSnapshot(ownerId, syncJob.id)).state).toBe("succeeded");
    } finally { clearInterval(timer); }
  }, 90_000);

  it("constructs a 48-bar five-role development outside the former fixed blueprint", async () => {
    const scratchId = (await createProject(ownerId, "Long-form scripted construction")).id;
    extraProjects.push(scratchId);
    const direction = "Start with pulse and haze, bring in chords and bass, break for a lead response, then return with a restrained coda";
    const request = { direction, sourceAssetIds: [], expectedNativeHeadId: null };
    const accepted = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "long-form-scripted", request, expectedHeadId: null });
    const job = await claim(accepted.id);
    const session = new NativeToolSession(job, seedNativeDocument(direction));
    const placement = (id: string, motifId: string, startBar: number, repeats: number) => ({ id, motifId, startBar, repeats });
    const note = (beat: number, pitch: number, durationBeats = 0.8, velocity = 0.65) => ({ beat, pitch, durationBeats, velocity });
    const form = { title: "Haze, break, return", tempoBpm: 104, meter: { numerator: 4, denominator: 4 }, sections: [
      { id: "seed", name: "Seed", bars: 4, intent: "Pulse and haze" }, { id: "growth", name: "Growth", bars: 12, intent: "Bass and chords enter" }, { id: "break", name: "Break", bars: 8, intent: "Lead responds" }, { id: "return", name: "Return", bars: 16, intent: "Fuller rhythmic return" }, { id: "coda", name: "Coda", bars: 8, intent: "Thin layers" }
    ], parts: [
      { id: "pulse", name: "Four-lane pulse", role: "percussion", device: { type: "beatbox8", parameters: { gain: 0.64 } }, gain: 0.64, pan: 0, motifs: [{ id: "pulse-cell", name: "Pulse cell", lengthBeats: 4, notes: [note(0, 36, 0.25, 1), note(1, 42, 0.25, 1), note(2, 38, 0.25, 1), note(3, 42, 0.25, 1)] }], placements: [placement("pulse-full", "pulse-cell", 0, 48)] },
      { id: "bass", name: "Walking low line", role: "bass", device: { type: "pulverisateur", parameters: { "filter.cutoffFrequencyHz": 620, "filter.resonance": 0.28 } }, gain: 0.72, pan: 0, motifs: [{ id: "bass-figure", name: "Low figure", lengthBeats: 8, notes: [note(0, 36), note(2, 43), note(4, 38), note(6, 43)] }], placements: [placement("bass-growth", "bass-figure", 4, 6), placement("bass-return", "bass-figure", 24, 8)], effects: [{ id: "bass-control", type: "stompboxCompressor", parameters: { thresholdDb: -10, ratio: 0.36 } }] },
      { id: "chords", name: "Held triads", role: "harmony", device: { type: "heisenberg", parameters: { "operatorA.gain": 0.28, "envelopeMain.attackTimeNormalized": 0.3 } }, gain: 0.54, pan: -0.2, motifs: [{ id: "triad", name: "Held triad", lengthBeats: 4, notes: [note(0, 60, 3.5, 0.5), note(0, 64, 3.5, 0.48), note(0, 67, 3.5, 0.46)] }], placements: [placement("chord-growth", "triad", 4, 12), placement("chord-return", "triad", 24, 16)], effects: [{ id: "chord-room", type: "stompboxReverb", parameters: { roomSizeFactor: 0.61, mix: 0.21 } }] },
      { id: "lead", name: "Answer line", role: "melody", device: { type: "heisenberg", parameters: { "operatorA.gain": 0.54 } }, gain: 0.61, pan: 0.12, motifs: [{ id: "answer-line", name: "Three-note answer", lengthBeats: 8, notes: [note(0, 72, 1.2), note(3, 69, 1.4), note(6, 76, 1)] }], placements: [placement("lead-break", "answer-line", 16, 4), placement("lead-return", "answer-line", 32, 4)] },
      { id: "haze", name: "Low haze", role: "texture", device: { type: "heisenberg", parameters: { "filter.cutoffFrequencyHz": 1100, "envelopeMain.attackTimeNormalized": 0.64 } }, gain: 0.36, pan: 0.25, motifs: [{ id: "haze-hold", name: "Haze hold", lengthBeats: 16, notes: [note(0, 55, 12, 0.38)] }], placements: [placement("haze-seed", "haze-hold", 0, 3), placement("haze-return", "haze-hold", 24, 3)] }
    ] };
    const model = fakeModel().respondWithTools([{ name: "compose_native_form", args: form }]).respond(new AIMessage("Five roles develop across five nonuniform sections; structural claims only."));
    const timer = setInterval(() => { void heartbeat(job); }, 750);
    try {
      const produced = await produceNative({ session, direction, mode: "generation", sources: [], scriptedModel: model });
      expect(model.callCount).toBe(2);
      expect(session.document.sections.map((section) => section.endBar - section.startBar)).toEqual([4, 12, 8, 16, 8]);
      expect(session.document.parts.map((part) => part.role)).toEqual(["percussion", "bass", "harmony", "melody", "texture"]);
      const offline = await validateNativeOffline(session.document);
      expect(offline.readback.drumMachines).toBe(1);
      expect(offline.readback.synths).toBe(4);
      expect(offline.readback.effectDevices).toBe(2);
      await commitNativeRevision(job, session.document, produced.summary, { ...produced, offlineValidation: offline });
      expect((await nativeSnapshot(ownerId, scratchId)).current?.document.bars).toBe(48);
    } finally { clearInterval(timer); }
  }, 90_000);
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
    // A paused request may become stale after explicit history selection. It
    // cannot continue, but abandoning it must not select or delete either version.
    const paused = await createNativeJob({ ownerId, projectId, kind: "native-revision", idempotencyKey: "stale-abandon", request: { ...request, direction: "A paused variation" }, expectedHeadId: first.id });
    const pausedJob = await claim(paused.id);
    await needsAttentionJob(pausedJob, "NATIVE_PARTIAL", "Paused before further work");
    await selectNativeRevision(ownerId, projectId, second.currentRevisionId!, first.id);
    await expect(resumeNativePartialJob(ownerId, projectId, paused.id)).rejects.toThrow(/selected version changed/);
    await abandonNativePartialJob(ownerId, projectId, paused.id);
    const retained = await nativeSnapshot(ownerId, projectId);
    expect(retained.currentRevisionId).toBe(second.currentRevisionId);
    expect(retained.versions.map((version) => version.documentHash)).toEqual(second.versions.map((version) => version.documentHash));
    await selectNativeRevision(ownerId, projectId, first.id, second.currentRevisionId!);
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

  it("reconciles a fenced copy only when its fresh structure and remote identity exactly match", async () => {
    const scratchId = (await createProject(ownerId, "Recheck a native copy")).id;
    extraProjects.push(scratchId);
    const created = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "seed-recheck", request: { direction: "A concise editable phrase", sourceAssetIds: [], expectedNativeHeadId: null }, expectedHeadId: null });
    await processJob(await claim(created.id));
    const current = (await nativeSnapshot(ownerId, scratchId)).current!;
    const sync = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-sync", idempotencyKey: "copy-recheck", request: { baseNativeRevisionId: current.id, expectedNativeHeadId: current.id }, expectedHeadId: current.id });
    const job = await claim(sync.id);
    await beginNativeSync(job, current.documentHash);
    await advanceNativeSync(job, "create_in_flight", "created", { remoteProjectName: "projects/offline-recheck" });
    await advanceNativeSync(job, "created", "apply_in_flight", { remoteUrl: "https://offline.invalid/studio" });
    await advanceNativeSync(job, "apply_in_flight", "conflict", { observedHash: "old-order-hash", errorMessage: "Earlier readback mismatch" });
    await needsAttentionJob(job, "NATIVE_REMOTE_CONFLICT", "Earlier readback mismatch");
    const expectedHash = canonicalHash((await validateNativeOffline(current.document)).structuralReadback);
    const details = { ownerId, projectId: scratchId, revisionId: current.id, jobId: job.id, remoteProjectName: "projects/offline-recheck", remoteUrl: "https://offline.invalid/studio", expectedHash, observedHash: expectedHash };
    await expect(reconcileNativeSyncReadback({ ...details, observedHash: "different" })).rejects.toThrow(/readback does not match/);
    await expect(reconcileNativeSyncReadback({ ...details, remoteProjectName: "projects/other" })).rejects.toThrow(/copy identity/);
    expect((await nativeSnapshot(ownerId, scratchId)).synchronization.state).toBe("conflict");
    await reconcileNativeSyncReadback(details);
    await reconcileNativeSyncReadback(details);
    expect((await nativeSnapshot(ownerId, scratchId)).synchronization).toMatchObject({ state: "verified", revisionId: current.id, mappingVersion: "nexus-native-v8" });
    expect((await jobSnapshot(ownerId, job.id)).state).toBe("succeeded");
    expect((await getPool().query("SELECT count(*)::int AS count FROM job_event WHERE job_id=$1 AND event_type='succeeded'", [job.id])).rows[0].count).toBe(1);
    expect((await getPool().query("SELECT count(*)::int AS count FROM project_activity WHERE job_id=$1 AND origin=$2", [job.id, `native-sync:${job.id}:verified`])).rows[0].count).toBe(1);
    await expect(reconcileNativeSyncReadback({ ...details, ownerId: randomUUID() })).rejects.toThrow(/no longer available/);
  }, 60_000);

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

  it("records late usage once after uncertainty without accepting stale output", async () => {
    const isolatedProjectId = (await createProject(ownerId, "Isolated uncertain outcome")).id;
    extraProjects.push(isolatedProjectId);
    const first = await createNativeJob({ ownerId, projectId: isolatedProjectId, kind: "native-generation", idempotencyKey: "seed-uncertain", request: { direction: "Warm theme", sourceAssetIds: [], expectedNativeHeadId: null }, expectedHeadId: null });
    await processJob(await claim(first.id));
    const base = await nativeSnapshot(ownerId, isolatedProjectId);
    const request = { direction: "Test a late accounting response", baseNativeRevisionId: base.currentRevisionId, expectedNativeHeadId: base.currentRevisionId, sourceAssetIds: [] };
    const accepted = await createNativeJob({ ownerId, projectId: isolatedProjectId, kind: "native-revision", idempotencyKey: "native-late-usage", request, expectedHeadId: base.currentRevisionId });
    const job = await claim(accepted.id);
    const effect = await reserveProviderEffect({ job, provider: "openai", step: "late-test", idempotencyKey: "late-test", inputHash: "late-test", model: "gpt-6-astra", promptVersion: "test", reservationMicrousd: 500 });
    await markEffectDispatched(effect.id, job);
    await failProviderEffect({ effectId: effect.id, job, errorClass: "TransportUnknown", uncertain: true });
    expect(await completeProviderEffect({ effectId: effect.id, job, output: { stale: true }, actualCostMicrousd: 321, providerRequestId: "req-native-late" })).toBe("uncertain");
    expect(await completeProviderEffect({ effectId: effect.id, job, output: { stale: true }, actualCostMicrousd: 321, providerRequestId: "req-native-late" })).toBe("uncertain");
    await expect(completeProviderEffect({ effectId: effect.id, job, output: {}, actualCostMicrousd: 322, providerRequestId: "req-native-late" })).rejects.toThrow(/USAGE_CONFLICT/);
    const stored = await getPool().query("SELECT e.state,e.cost_status,e.actual_cost_microusd,e.provider_request_id,e.output,j.actual_cost_microusd AS job_cost FROM effect e JOIN job j ON j.id=e.job_id WHERE e.id=$1", [effect.id]);
    expect(stored.rows[0]).toMatchObject({ state: "uncertain", cost_status: "observed", provider_request_id: "req-native-late" });
    expect(Number(stored.rows[0].actual_cost_microusd)).toBe(321);
    expect(Number(stored.rows[0].job_cost)).toBe(321);
    expect(stored.rows[0].output).toMatchObject({ errorClass: "TransportUnknown" });
    await cancelJob(ownerId, accepted.id);
  });

  it("fences an ambiguous owned-sample upload but accepts a late ready identity once", async () => {
    const scratchId = (await createProject(ownerId, "Sample checkpoint contract")).id;
    extraProjects.push(scratchId);
    const hash = "b".repeat(64);
    const assetId = await insertAsset({ ownerId, projectId: scratchId, name: "Owned late entry", hash, path: "unused-in-contract-test", durationSeconds: 8, sampleRate: 8000, channels: 2, provenance: "unit-owned-fixture" });
    const request = { direction: "Sample checkpoint only", sourceAssetIds: [assetId], expectedNativeHeadId: null };
    const created = await createNativeJob({ ownerId, projectId: scratchId, kind: "native-generation", idempotencyKey: "sample-checkpoint-job", request, expectedHeadId: null });
    const job = await claim(created.id);
    expect(await beginOwnedSampleUpload(job, assetId, hash)).toMatchObject({ state: "in_flight", createdNow: true });
    expect(await beginOwnedSampleUpload(job, assetId, hash)).toMatchObject({ state: "in_flight", createdNow: false });
    await markOwnedSampleUncertain(job, assetId, "worker stopped after dispatch");
    expect(await beginOwnedSampleUpload(job, assetId, hash)).toMatchObject({ state: "uncertain", createdNow: false });
    await finishOwnedSampleUpload(job, assetId, "samples/22222222-2222-4222-8222-222222222222", 8);
    expect(await readyOwnedSampleResources(ownerId, scratchId, [assetId])).toEqual({ [assetId]: { sampleName: "samples/22222222-2222-4222-8222-222222222222", durationSeconds: 8 } });
    await expect(finishOwnedSampleUpload(job, assetId, "samples/33333333-3333-4333-8333-333333333333", 8)).rejects.toThrow(/checkpoint changed/);
    await cancelJob(ownerId, created.id);
  });

  it("accepts an explicit protect then unlock through the job path while preserving another lock", async () => {
    const base = (await nativeSnapshot(ownerId, projectId)).current!;
    const lockRequest = { direction: "Vary the rhythm but preserve the lead and pad", baseNativeRevisionId: base.id, expectedNativeHeadId: base.id, protectionChange: { expectedPartIds: base.document.protectedPartIds, desiredPartIds: ["lead", "wide-pad"] }, targetPartId: "soft-pulse", sourceAssetIds: [] };
    const lockJob = await createNativeJob({ ownerId, projectId, kind: "native-revision", idempotencyKey: "explicit-lock-job", request: lockRequest, expectedHeadId: base.id });
    await processJob(await claim(lockJob.id));
    const locked = (await nativeSnapshot(ownerId, projectId)).current!;
    expect(locked.document.protectedPartIds).toEqual(["lead", "wide-pad"]);
    const padHash = protectedPartHash(locked.document, "wide-pad");
    const unlockRequest = { direction: "Change the lead instrument; retain the pad", baseNativeRevisionId: locked.id, expectedNativeHeadId: locked.id, protectionChange: { expectedPartIds: ["lead", "wide-pad"], desiredPartIds: ["wide-pad"] }, targetPartId: "lead", sourceAssetIds: [] };
    const unlockJob = await createNativeJob({ ownerId, projectId, kind: "native-revision", idempotencyKey: "explicit-unlock-job", request: unlockRequest, expectedHeadId: locked.id });
    await processJob(await claim(unlockJob.id));
    const unlocked = (await nativeSnapshot(ownerId, projectId)).current!;
    expect(unlocked.document.protectedPartIds).toEqual(["wide-pad"]);
    expect(unlocked.structuralDiff.protectionChange.removed).toContain("lead");
    expect(unlocked.structuralDiff.partChanges.find((value) => value.partId === "lead")?.fields).toContain("device");
    expect(protectedPartHash(unlocked.document, "wide-pad")).toBe(padHash);
    await expect(createNativeJob({ ownerId, projectId, kind: "native-revision", idempotencyKey: "stale-unlock", request: unlockRequest, expectedHeadId: locked.id })).rejects.toThrow(/head changed/);
    await selectNativeRevision(ownerId, projectId, locked.id, unlocked.id);
    expect((await nativeSnapshot(ownerId, projectId)).current?.document.protectedPartIds).toEqual(["lead", "wide-pad"]);
  }, 60_000);

  it("scripted producer inspects a shared phrase and revises only its targeted section instance", async () => {
    const base = (await nativeSnapshot(ownerId, projectId)).current!;
    const part = base.document.parts.find((value) => value.id === "soft-pulse")!;
    const original = base.document.motifs.find((value) => value.id === "soft-pulse-a")!;
    const oldThird = part.placements.find((value) => value.id === "soft-pulse-s1")!;
    const oldFourth = part.placements.find((value) => value.id === "soft-pulse-s2")!;
    expect(oldThird.motifId).toBe(oldFourth.motifId);
    const request = { direction: "Simplify only the pulse in Bloom; preserve the lead and pad", baseNativeRevisionId: base.id, expectedNativeHeadId: base.id, targetPartId: "soft-pulse", targetSectionId: "section-2", sourceAssetIds: [] };
    const accepted = await createNativeJob({ ownerId, projectId, kind: "native-revision", idempotencyKey: "scripted-targeted-instance", request, expectedHeadId: base.id });
    const job = await claim(accepted.id);
    const session = new NativeToolSession(job, base.document);
    const motifId = "soft-pulse-bloom-sparse";
    const operations = [{ kind: "varyMotifInstance", partId: "soft-pulse", placementId: oldFourth.id, newMotifId: motifId, name: "Sparse Bloom pulse", omitEvery: 2 }];
    const model = fakeModel()
      .respondWithTools([{ name: "inspect_native_part", args: { partId: "soft-pulse" } }])
      .respondWithTools([{ name: "apply_native_batch", args: { stepKey: "sparse-bloom-instance", operations } }])
      .respondWithTools([{ name: "inspect_native_section", args: { sectionId: "section-2" } }])
      .respond(new AIMessage("Only the Bloom instance uses the sparse motif; protected lead and pad remain structurally identical."));
    const timer = setInterval(() => { void heartbeat(job); }, 750);
    try {
      const produced = await produceNative({ session, direction: request.direction, mode: "revision", sources: [], targetPartId: "soft-pulse", targetSectionId: "section-2", scriptedModel: model });
      expect(model.callCount).toBe(4);
      expect(session.document.parts.find((value) => value.id === "soft-pulse")!.placements.find((value) => value.id === oldThird.id)!.motifId).toBe(original.id);
      expect(session.document.parts.find((value) => value.id === "soft-pulse")!.placements.find((value) => value.id === oldFourth.id)!.motifId).toBe(motifId);
      expect(protectedPartHash(session.document, "lead")).toBe(protectedPartHash(base.document, "lead"));
      expect(protectedPartHash(session.document, "wide-pad")).toBe(protectedPartHash(base.document, "wide-pad"));
      await commitNativeRevision(job, session.document, produced.summary, produced);
      const next = await nativeSnapshot(ownerId, projectId);
      expect(next.current?.structuralDiff.changedParts).toEqual(["soft-pulse"]);
      expect(next.comparisons[base.id]?.changedParts).toContain("soft-pulse");
      await selectNativeRevision(ownerId, projectId, base.id, next.currentRevisionId!);
      expect((await nativeSnapshot(ownerId, projectId)).currentRevisionId).toBe(base.id);
    } finally { clearInterval(timer); }
  }, 90_000);
});
