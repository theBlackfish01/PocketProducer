import { getPool } from "./pool.js";

/**
 * Delete the contents of an explicitly identified obsolete test project.
 * Financial jobs/effects and their minimal project identity remain for accounting,
 * not for a compatibility UI. Native work (including unfinished jobs) is a hard veto.
 */
export async function retireAudioTestProject(ownerId: string, projectId: string): Promise<{ removedVersions: number; removedSources: number }> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const project = await client.query("SELECT id FROM project WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE", [projectId, ownerId]);
    if (project.rowCount !== 1) throw new Error("Active owned test project not found");
    const native = await client.query("SELECT 1 FROM native_revision WHERE project_id=$1 UNION ALL SELECT 1 FROM job WHERE project_id=$1 AND kind LIKE 'native-%' LIMIT 1", [projectId]);
    if (native.rowCount) throw new Error("Refusing to delete a project with native work");
    const active = await client.query("SELECT 1 FROM job WHERE project_id=$1 AND state IN ('queued','running','cancel_requested') LIMIT 1", [projectId]);
    if (active.rowCount) throw new Error("Refusing to delete a project with active work");
    await client.query("UPDATE project SET current_revision_id=NULL,deleted_at=now(),updated_at=now() WHERE id=$1", [projectId]);
    await client.query("UPDATE job SET base_revision_id=NULL,expected_head_revision_id=NULL,result_revision_id=NULL WHERE project_id=$1", [projectId]);
    await client.query("DELETE FROM project_export WHERE project_id=$1", [projectId]);
    await client.query("DELETE FROM audio_analysis WHERE project_id=$1", [projectId]);
    await client.query("UPDATE revision SET parent_revision_id=NULL WHERE project_id=$1", [projectId]);
    const versions = await client.query("DELETE FROM revision WHERE project_id=$1", [projectId]);
    const sources = await client.query("DELETE FROM asset WHERE project_id=$1", [projectId]);
    await client.query("COMMIT");
    return { removedVersions: versions.rowCount ?? 0, removedSources: sources.rowCount ?? 0 };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
