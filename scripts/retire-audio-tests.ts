import { closePool, devOwnerId, getPool, retireAudioTestProject } from "@pocket/core";

// Exact ids only. No title match, global purge, provider access or remote deletion.
const apply = process.argv.includes("--apply");
const ids = process.argv.slice(2).filter((arg) => arg !== "--apply");
if (!ids.length || ids.some((id) => !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id))) throw new Error("Supply exact project UUIDs; add --apply only after inspecting the dry run");
const owner = await devOwnerId();
try {
  for (const id of ids) {
    const row = (await getPool().query("SELECT p.id,p.title,(SELECT count(*) FROM native_revision WHERE project_id=p.id) AS native_versions,(SELECT count(*) FROM revision WHERE project_id=p.id) AS retired_versions FROM project p WHERE p.id=$1 AND p.owner_id=$2 AND p.deleted_at IS NULL", [id, owner])).rows[0];
    if (!row) throw new Error("Owned active project not found");
    process.stdout.write(JSON.stringify({ ...row, ...(apply ? await retireAudioTestProject(owner, id) : { dryRun: true }) }) + "\n");
  }
} finally { await closePool(); }
