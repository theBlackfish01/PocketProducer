import { canonicalHash, closePool, createAudiotoolServerClient, getConfig, getNativeRevision, getPool, nativeStructuralReadback, reconcileNativeSyncReadback, validateNativeOffline, type NativeRemoteClient } from "@pocket/core";

async function main() {
  const jobId = process.argv[2];
  if (!jobId || !/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(jobId)) throw new Error("Pass one native-sync job ID");
  const result = await getPool().query<{
    owner_id: string; project_id: string; revision_id: string; state: string;
    remote_project_name: string | null; job_state: string;
  }>(`SELECT j.owner_id,j.project_id,s.revision_id,s.state,s.remote_project_name,j.state AS job_state
      FROM job j JOIN native_revision_sync s ON s.project_id=j.project_id AND s.revision_id::text=j.request->>'baseNativeRevisionId'
      WHERE j.id=$1 AND j.kind='native-sync'`, [jobId]);
  const saved = result.rows[0];
  if (!saved || !saved.remote_project_name || !(["conflict", "uncertain"].includes(saved.state) && saved.job_state === "needs_attention" || saved.state === "verified" && saved.job_state === "succeeded")) throw new Error("No fenced or verified native copy with a known remote identity to recheck");
  const revision = await getNativeRevision(saved.owner_id, saved.project_id, saved.revision_id);
  const expected = canonicalHash((await validateNativeOffline(revision.document)).structuralReadback);
  const clientId = getConfig().AUDIOTOOL_CLIENT_ID;
  if (!clientId) throw new Error("Audiotool app registration is unavailable");
  const connection = await createAudiotoolServerClient(saved.owner_id, clientId);
  if (!connection) throw new Error("Connect Audiotool before checking its copy");
  let remote: Awaited<ReturnType<NativeRemoteClient["open"]>> | undefined;
  let observed: string;
  let remoteUrl: string;
  try {
    remote = await (connection.client as unknown as NativeRemoteClient).open(saved.remote_project_name);
    await remote.start();
    observed = canonicalHash(nativeStructuralReadback(remote));
    remoteUrl = remote.dawUrl;
  } finally {
    if (remote) await remote.stop();
    await connection.awaitTokenPersistence();
  }
  if (observed !== expected) throw new Error("Audiotool still differs from the accepted local version; no status was changed and no remote write was attempted");
  await reconcileNativeSyncReadback({ ownerId: saved.owner_id, projectId: saved.project_id, revisionId: saved.revision_id, jobId, remoteProjectName: saved.remote_project_name, remoteUrl, expectedHash: expected, observedHash: observed });
  console.log(JSON.stringify({ state: "verified", revisionId: saved.revision_id, remoteUrl, mappingVersion: "nexus-native-v7", remoteWrite: false }));
}

try { await main(); }
finally { await closePool(); }
