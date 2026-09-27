import { spawn } from "node:child_process";

const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? "postgresql://pocket:pocket_local_only@127.0.0.1:54329/pocket_producer_test";
if (!new URL(testDatabaseUrl).pathname.slice(1).endsWith("_test")) throw new Error("E2E setup requires a dedicated *_test database");
Object.assign(process.env, {
  AI_GATEWAY_API_KEY: "", VERCEL_AI_GATEWAY_API_KEY: "",
  APP_ENV: "test", DATABASE_URL: testDatabaseUrl, OBJECT_STORAGE_LOCAL_ROOT: process.env.TEST_OBJECT_STORAGE_LOCAL_ROOT ?? ".local/test-audio", FIXTURE_MODE: "true", DEV_LOCAL_AUTH: "true",
  OPENAI_API_KEY: "", GEMINI_API_KEY: "", GOOGLE_API_KEY: "", INITIAL_BUILD_API_BUDGET_USD: "0", MAX_JOB_COST_USD: "0"
});

const { closePool, getPool } = await import("@pocket/core");

const run = (script: string) => new Promise<void>((resolve, reject) => {
  const child = spawn(process.execPath, ["--import", "tsx", script], { cwd: process.cwd(), env: process.env, stdio: "inherit" });
  child.once("error", reject);
  child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${script} exited with code ${code ?? "unknown"}`)));
});

// Cleanup is intentionally scoped to the fixed loopback test identity. The
// database-name guard above prevents this harness from touching development.
const pool = getPool();
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const owner = (await client.query<{ id: string }>("SELECT id FROM app_user WHERE provider_subject='dev-loopback' FOR UPDATE")).rows[0]?.id;
  if (owner) {
    const projectIds = (await client.query<{ id: string }>("SELECT id FROM project WHERE owner_id=$1", [owner])).rows.map((row) => row.id);
    if (projectIds.length) {
      await client.query("DELETE FROM effect WHERE prompt_assistance_id IN (SELECT id FROM prompt_assistance WHERE project_id=ANY($1::uuid[]))", [projectIds]);
      await client.query("DELETE FROM prompt_assistance WHERE project_id=ANY($1::uuid[])", [projectIds]);
      await client.query("DELETE FROM native_revision_sync WHERE project_id=ANY($1::uuid[])", [projectIds]);
      await client.query("DELETE FROM native_sync WHERE project_id=ANY($1::uuid[])", [projectIds]);
      await client.query("DELETE FROM native_project_head WHERE project_id=ANY($1::uuid[])", [projectIds]);
      await client.query("UPDATE job SET result_native_revision_id=NULL WHERE project_id=ANY($1::uuid[])", [projectIds]);
      await client.query("DELETE FROM native_revision WHERE project_id=ANY($1::uuid[])", [projectIds]);
      await client.query("UPDATE project SET current_revision_id=NULL WHERE id=ANY($1::uuid[])", [projectIds]);
      await client.query("UPDATE job SET result_revision_id=NULL,base_revision_id=NULL,expected_head_revision_id=NULL WHERE project_id=ANY($1::uuid[])", [projectIds]);
      await client.query("DELETE FROM project_export WHERE project_id=ANY($1::uuid[])", [projectIds]);
      await client.query("DELETE FROM audio_analysis WHERE project_id=ANY($1::uuid[])", [projectIds]);
      await client.query("DELETE FROM revision WHERE project_id=ANY($1::uuid[])", [projectIds]);
      await client.query("DELETE FROM job WHERE project_id=ANY($1::uuid[])", [projectIds]);
      await client.query("DELETE FROM asset WHERE project_id=ANY($1::uuid[])", [projectIds]);
      await client.query("DELETE FROM project WHERE id=ANY($1::uuid[])", [projectIds]);
    }
    await client.query("DELETE FROM audiotool_session WHERE owner_id=$1", [owner]);
    await client.query("DELETE FROM app_user WHERE id=$1", [owner]);
  }
  await client.query("INSERT INTO app_user(provider_subject,display_name) VALUES('dev-loopback','Local listener')");
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
}
await closePool();
await run("scripts/generate-fixtures.ts");
