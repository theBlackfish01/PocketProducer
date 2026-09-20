import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { analyzePreview, closePool, decodeWav, devOwnerId, getPool, getRevision, measureDecodedWav, recordAudioAnalysis } from "@pocket/core";

const ownerId = await devOwnerId();
const project = await getPool().query<{ id: string; current_revision_id: string }>("SELECT id,current_revision_id FROM project WHERE owner_id=$1 AND title='Sunroom demo' AND current_revision_id IS NOT NULL LIMIT 1", [ownerId]);
const row = project.rows[0];
if (!row) throw new Error("Seeded Sunroom demo with a revision was not found");
const revision = await getRevision(ownerId, row.current_revision_id);
const files: Array<{ path: string; purpose: "source-analysis" | "preview-critique" }> = [{ path: String(revision.preview_path), purpose: "preview-critique" }];
const source = await getPool().query<{ object_path: string }>("SELECT object_path FROM asset WHERE owner_id=$1 AND project_id=$2 AND kind='source' ORDER BY created_at LIMIT 1", [ownerId, row.id]);
if (source.rows[0]) files.push({ path: source.rows[0].object_path, purpose: "source-analysis" });
const statuses: string[] = [];
for (const file of files) {
  const bytes = await readFile(file.path);
  const analysis = await analyzePreview({ path: file.path, hash: createHash("sha256").update(bytes).digest("hex"), purpose: file.purpose, ...measureDecodedWav(decodeWav(bytes)) });
  await recordAudioAnalysis({ ownerId, projectId: row.id, revisionId: row.current_revision_id, analysis });
  statuses.push(`${file.purpose}:${analysis.status}`);
}
process.stdout.write(`${JSON.stringify({ revisionId: row.current_revision_id, statuses })}\n`);
await closePool();
