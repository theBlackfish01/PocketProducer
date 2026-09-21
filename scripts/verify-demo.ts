import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { closePool, devOwnerId, getPool, measureDecodedWav, decodeWav, protectedTrackHash, validateComposition } from "@pocket/core";

const pool = getPool();
const ownerId = await devOwnerId();
const projectResult = await pool.query<{ id: string; current_revision_id: string }>("SELECT id,current_revision_id FROM project WHERE owner_id=$1 AND title='Sunroom demo' AND current_revision_id IS NOT NULL", [ownerId]);
const project = projectResult.rows[0];
if (!project) throw new Error("Sunroom demo is missing");
const revisionResult = await pool.query<{ id: string; ordinal: number; parent_revision_id: string | null; composition: unknown; composition_hash: string; preview_path: string; stems: Record<string, string>; protected_track_hashes: Record<string, string> }>("SELECT id,ordinal,parent_revision_id,composition,composition_hash,preview_path,stems,protected_track_hashes FROM revision WHERE owner_id=$1 AND project_id=$2 ORDER BY ordinal", [ownerId, project.id]);
if (revisionResult.rows.length !== 2) throw new Error(`Expected two immutable revisions, found ${revisionResult.rows.length}`);
const first = revisionResult.rows[0];
const second = revisionResult.rows[1];
if (!first || !second) throw new Error("Revision rows unavailable");
const firstComposition = validateComposition(first.composition);
const secondComposition = validateComposition(second.composition);
const firstMelodyHash = protectedTrackHash(firstComposition, "melody");
const secondMelodyHash = protectedTrackHash(secondComposition, "melody");
if (firstMelodyHash !== secondMelodyHash || second.protected_track_hashes.melody !== firstMelodyHash) throw new Error("Protected melody hash changed");
const firstDrums = firstComposition.tracks.find((track) => track.id === "drums")?.events ?? [];
const secondDrumIds = new Set((secondComposition.tracks.find((track) => track.id === "drums")?.events ?? []).map((event) => event.id));
const removed = firstDrums.filter((event) => !secondDrumIds.has(event.id));
const groove = firstComposition.sections.find((section) => section.id === "groove");
if (!groove || removed.length !== 6 || removed.some((event) => !event.assetId.endsWith(":hat") || event.startTick < groove.startTick || event.startTick >= groove.endTick)) throw new Error("Drum revision escaped its structural scope");
const firstMelodyBytes = await readFile(first.stems.melody ?? "");
const secondMelodyBytes = await readFile(second.stems.melody ?? "");
const melodyStemHash = createHash("sha256").update(firstMelodyBytes).digest("hex");
if (melodyStemHash !== createHash("sha256").update(secondMelodyBytes).digest("hex")) throw new Error("Protected melody stem bytes changed");
const previews = [];
for (const revision of [first, second]) {
  const bytes = await readFile(revision.preview_path);
  previews.push({ ordinal: revision.ordinal, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), ...measureDecodedWav(decodeWav(bytes)) });
}
const exportResult = await pool.query<{ state: string; fidelity: { parts?: unknown[] } }>("SELECT state,fidelity FROM project_export WHERE owner_id=$1 AND revision_id=$2", [ownerId, second.id]);
const analysisResult = await pool.query<{ purpose: string; status: string }>("SELECT purpose,status FROM audio_analysis WHERE owner_id=$1 AND project_id=$2 ORDER BY purpose", [ownerId, project.id]);
const evidence = {
  projectId: project.id,
  currentRevision: project.current_revision_id,
  currentIsProtectedRevision: project.current_revision_id === second.id,
  immutableChain: second.parent_revision_id === first.id,
  compositionHashes: [first.composition_hash, second.composition_hash],
  removedGrooveHats: removed.length,
  protectedMelodyHash: firstMelodyHash,
  protectedMelodyStemSha256: melodyStemHash,
  previews,
  analyses: analysisResult.rows,
  nexus: { state: exportResult.rows[0]?.state ?? "missing", editableParts: exportResult.rows[0]?.fidelity.parts?.length ?? 0 }
};
if (!evidence.currentIsProtectedRevision || !evidence.immutableChain || evidence.nexus.state !== "awaiting_authorization" || evidence.nexus.editableParts !== 4) throw new Error("Demo state did not meet the milestone evidence checks");
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
await closePool();
