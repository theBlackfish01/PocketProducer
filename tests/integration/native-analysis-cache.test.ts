import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProject, getPool, listNativeSoundFeedback, loadCachedSampleOpinion, saveCachedSampleOpinion, saveNativeSoundFeedback, withSampleAnalysisLock, type AudioAnalysis } from "@pocket/core";

const owners: string[] = [];
let feedbackProjectId = "";
beforeAll(async () => {
  for (let index = 0; index < 2; index++) {
    const row = await getPool().query<{ id: string }>("INSERT INTO app_user(provider_subject,display_name) VALUES($1,$2) RETURNING id", [`sample-cache-${randomUUID()}`, `Cache test ${index}`]);
    owners.push(row.rows[0]!.id);
  }
  feedbackProjectId = (await createProject(owners[0]!, "Audition feedback test")).id;
});
afterAll(async () => {
  if (feedbackProjectId) await getPool().query("DELETE FROM project WHERE id=$1", [feedbackProjectId]);
  for (const owner of owners) {
    await getPool().query("DELETE FROM native_sample_analysis_cache WHERE owner_id=$1", [owner]);
    await getPool().query("DELETE FROM app_user WHERE id=$1", [owner]);
  }
});

describe("durable owner-scoped sample opinion", () => {
  it("survives a fresh query but never crosses owner, byte hash, model or prompt key", async () => {
    const hash = "a".repeat(64), model = "gemini-fixture", key = `gemini:library-sample-analysis:${hash}:library-sample-analysis-v2:${model}`;
    const analysis: AudioAnalysis = { status: "available", assetHash: hash, model, promptVersion: "library-sample-analysis-v2", purpose: "library-sample-analysis", inspectedInterval: { start: 0, end: 1 }, measured: { durationSeconds: 1, peak: 0.8, rms: 0.3, nonSilentRatio: 0.8 }, observations: ["A short noisy accent"], uncertainty: "Scripted opinion", suggestedActions: ["use-as-percussion"], suggestedSourceRole: "percussion", repairAction: "none", usage: { promptTokens: 2, candidateTokens: 3, thoughtsTokens: 0, totalTokens: 5 }, costMicrousd: 11 };
    await saveCachedSampleOpinion(owners[0]!, key, analysis);
    expect((await loadCachedSampleOpinion(owners[0]!, key, hash, model))?.observations).toEqual(["A short noisy accent"]);
    expect(await loadCachedSampleOpinion(owners[1]!, key, hash, model)).toBeNull();
    expect(await loadCachedSampleOpinion(owners[0]!, key, "b".repeat(64), model)).toBeNull();
    expect(await loadCachedSampleOpinion(owners[0]!, key, hash, "another-model")).toBeNull();
    expect(await loadCachedSampleOpinion(owners[0]!, key + ":v2", hash, model)).toBeNull();
    await saveCachedSampleOpinion(owners[0]!, key, { ...analysis, observations: ["Changed later"] });
    expect((await loadCachedSampleOpinion(owners[0]!, key, hash, model))?.observations).toEqual(["A short noisy accent"]);
  });
  it("retains explicit audition notes only in the owning project", async () => {
    const input = { sampleName: `samples/${randomUUID()}`, contentHash: "c".repeat(64), rating: "fits" as const, note: "Useful short attack" };
    await saveNativeSoundFeedback(owners[0]!, feedbackProjectId, input);
    expect((await listNativeSoundFeedback(owners[0]!, feedbackProjectId))[0]).toMatchObject(input);
    expect(await listNativeSoundFeedback(owners[1]!, feedbackProjectId)).toEqual([]);
    await expect(saveNativeSoundFeedback(owners[1]!, feedbackProjectId, input)).rejects.toThrow(/Project not found/);
    await saveNativeSoundFeedback(owners[0]!, feedbackProjectId, { ...input, rating: "not-for-this", note: "Too sharp here" });
    expect((await listNativeSoundFeedback(owners[0]!, feedbackProjectId))[0]?.note).toBe("Too sharp here");
  });
  it("serializes contending workers so a completed opinion becomes a zero-dispatch cache hit", async () => {
    const hash = "d".repeat(64), model = "gemini-fixture", key = `gemini:library-sample-analysis:${hash}:library-sample-analysis-v2:${model}`;
    const opinion: AudioAnalysis = { status: "available", assetHash: hash, model, promptVersion: "library-sample-analysis-v2", purpose: "library-sample-analysis", inspectedInterval: { start: 0, end: 1 }, measured: { durationSeconds: 1, peak: 0.8, rms: 0.3, nonSilentRatio: 0.8 }, observations: ["First confirmed opinion"], uncertainty: "Scripted", suggestedActions: [], suggestedSourceRole: "percussion", repairAction: "none", usage: { promptTokens: 2, candidateTokens: 3, thoughtsTokens: 0, totalTokens: 5 }, costMicrousd: 11 };
    let dispatches = 0;
    const worker = () => withSampleAnalysisLock(owners[0]!, key, async () => {
      const cached = await loadCachedSampleOpinion(owners[0]!, key, hash, model);
      if (cached) return cached;
      dispatches += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      await saveCachedSampleOpinion(owners[0]!, key, opinion);
      return opinion;
    });
    const [first, second] = await Promise.all([worker(), worker()]);
    expect(dispatches).toBe(1);
    expect(first.observations).toEqual(second.observations);
  });
});
