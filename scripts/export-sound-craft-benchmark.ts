import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { createOfflineDocument } from "@pocket/core/test-support";
import { applyNativeOperations, applyNativeSnapshot, canonicalHash, closePool, getPool, materializedNotes, nativeArcEvidence, nativeDocumentSchema, nativeFormOperations, nativePresetRecipes, nativeStructuralReadback, readNativeExample, readNativeRecipe, seedNativeDocument, symbolicNativeReview } from "@pocket/core";

// Read-only, provider-free evidence package. An executable musical reference
// is not a new real-model run and an offline SDK document is not a recording.
const brief = "Something synth and disco, something like Daft Punk, and in the middle there should be a very prominent upswing that's exciting somehow.";
const baselineRevisionId = "1eae5430-0411-425d-a798-96fcbcf6d7d4";
const destinationRoot = resolve(process.cwd(), ".local", "benchmarks");
await mkdir(destinationRoot, { recursive: true });
const destination = await mkdtemp(resolve(destinationRoot, "sound-craft-"));
const gitHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const trackedDiff = execFileSync("git", ["diff", "--binary", "HEAD"], { encoding: "utf8", maxBuffer: 16_000_000 });
const workingState = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" });
const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean);
const fingerprint = createHash("sha256").update(trackedDiff).update(workingState);
for (const path of untracked) fingerprint.update(path).update(createHash("sha256").update(await readFile(resolve(process.cwd(), path))).digest("hex"));
const workingTreeFingerprint = fingerprint.digest("hex");
const evidence: Array<Record<string, unknown>> = [];
const resources = nativePresetRecipes.map((item) => {
  const recipe = readNativeRecipe(item.id);
  return { id: recipe.id, version: recipe.version, configurationHash: recipe.configurationHash, deviceHash: canonicalHash(recipe.device), auditionStatus: recipe.auditionStatus, usageTerms: recipe.usageTerms };
});
for (const id of ["disco-groove-study", "disco-rise-study", "sparse-motif-handoff"]) {
  const reference = readNativeExample(id);
  const document = applyNativeOperations(seedNativeDocument(brief), [...nativeFormOperations(reference.form, []), ...reference.extraOperations]);
  const offline = await createOfflineDocument({ validated: true });
  const mapped = await applyNativeSnapshot(offline, document);
  const symbolic = symbolicNativeReview(document, null);
  evidence.push({ id, evidenceLevel: "authored-executable-reference/offline-Nexus/unheard", canonicalHash: canonicalHash(document), sdkReadbackHash: canonicalHash(nativeStructuralReadback(offline)), bars: document.bars, roles: document.parts.map((part) => ({ id: part.id, role: part.role, materializedNotes: materializedNotes(document, part.id).length, device: part.device.type, deviceHash: canonicalHash(part.device), matchingLocalPatch: resources.find((recipe) => recipe.deviceHash === canonicalHash(part.device))?.id ?? null, presetPinned: Boolean(part.device.preset), appliedEffects: part.effects.map((effect) => effect.type) })), sections: symbolic.sections.map((section) => ({ id: section.id, name: section.name, bars: [section.firstBar, section.lastBar], onsets: section.totalOnsets })), arcEvidence: nativeArcEvidence(document), soundWarnings: symbolic.soundWarnings, mapped });
  await writeFile(resolve(destination, `${id}.native.json`), JSON.stringify(document, null, 2), { flag: "wx" });
}
let baseline: Record<string, unknown> | null = null;
try {
  const result = await getPool().query<{ document: unknown; document_hash: string }>("SELECT document,document_hash FROM native_revision WHERE id=$1", [baselineRevisionId]);
  if (result.rows[0]) {
    const document = nativeDocumentSchema.parse(result.rows[0].document);
    const symbolic = symbolicNativeReview(document, null);
    baseline = { revisionId: baselineRevisionId, evidenceLevel: "prior-real-model/previously-user-heard/prior-live-Nexus-copy", canonicalHash: result.rows[0].document_hash, bars: document.bars, parts: document.parts.length, devices: document.parts.map((part) => ({ id: part.id, type: part.device.type, presetPinned: Boolean(part.device.preset) })), sections: symbolic.sections.map((section) => ({ id: section.id, name: section.name, bars: [section.firstBar, section.lastBar], onsets: section.totalOnsets })), arcEvidence: nativeArcEvidence(document), soundWarnings: symbolic.soundWarnings };
  }
} catch { baseline = { revisionId: baselineRevisionId, evidenceLevel: "baseline-unavailable-for-local-read" }; }
finally { await closePool(); }
await writeFile(resolve(destination, "comparison.json"), JSON.stringify({ generatedAt: new Date().toISOString(), exactBrief: brief, execution: { mode: "authored-offline-reference", gitHead, workingTreeFingerprint, model: null, profile: null, realJobId: null, newProviderCostUsd: 0, liveNexusProject: null, humanListening: "pending" }, resourceCatalog: resources, baseline, studies: evidence, conclusions: ["The new studies are authored examples and scripted-path fixtures, not a new OpenAI benchmark result.", "A matched patch ID does not imply that a recipe's optional insert effects were applied; each study lists its actual effects.", "Canonical and offline Nexus validity do not establish sound quality or a playable mix.", "A 16-bar rise/arrival is structurally distinct; human audition is still required before full-song qualification."] }, null, 2), { flag: "wx" });
await writeFile(resolve(destination, "AUDITION.md"), `# Sound-craft audition handoff\n\nExact brief: ${brief}\n\nThe three JSON scores here are validated, editable canonical **reference studies**, not results of a new real-model request. There is **no new full-mix WAV** because native rendering remains deferred. Do not play older audio as though it were these scores. A JSON study is not yet a selectable Listening Room version or an Audiotool project.\n\nA later authorized normal-product run should first make an eight-bar groove and a middle build/arrival, then save an exact revision and explicitly copy that version to a separate Audiotool project for Studio playback. Compare groove identity, bass/drum pocket, middle lift, arrival, sound palette and originality against the previously heard Midnight Escalator copy. Record what actually changes your impression; symbolic counts are not a listening verdict.\n\nIn Pocket Producer, Sounds → Audiotool sound library → Inspect slices lets you audition one short original sample and save a piece-specific listening note. That player is **source-only**, not the score.\n`, { flag: "wx" });
await writeFile(resolve(destination, "LISTENING-NOTES.md"), `# Listening comparison — pending

Do not score until an exact new revision is copied/read back and played in Audiotool Studio. The previously heard baseline copy is https://beta.audiotool.com/studio?project=38484bad-5b23-4c49-880d-7447337b3318. Record the new revision and Studio project IDs before listening. Compare the core groove, middle build→arrival and full piece at broadly similar perceived loudness, without flattening their internal dynamics. “Uncertain/no preference” is a valid result.

| Dimension (1 weak, 3 competent, 5 compelling) | Baseline | New exact revision | What I heard |
| --- | --- | --- | --- |
| Sound identity | pending | pending | |
| Groove | pending | pending | |
| Development | pending | pending | |
| Middle upswing/payoff | pending | pending | |
| Clarity/balance | pending | pending | |
| Brief satisfaction | pending | pending | |

Preferred result: pending. Two passages that most affect that judgment: pending. Source or preset audition that changed the choice: pending. This is a human listening record, not a Gemini or symbolic verdict.
`, { flag: "wx" });
process.stdout.write(`${destination}\n`);
