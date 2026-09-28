import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, it } from "vitest";
import { getPool, getConfig, saveAudiotoolSession, issueAccess, revokeAccess, startHostedSession, hostedIdentity, hashCredential, encodeWav } from "@pocket/core";

const base = "http://127.0.0.1:19279", origin = "https://pocket.example";
const owners: string[] = [];
let child: ChildProcess, a: string, b: string, ownerA: string, project: string, asset: string;
async function start() {
  child = spawn(process.execPath, ["--import", "tsx", "apps/api/src/server.ts"], { windowsHide: true, stdio: "ignore", env: {
    ...process.env, APP_ENV: "production", HOSTED_AUTH_MODE: "invite", DEV_LOCAL_AUTH: "false", SERVE_WEB: "true", APP_ORIGIN: origin, PORT: "19279",
    AUDIOTOOL_SESSION_KEY: Buffer.alloc(32, 9).toString("base64"), AUDIOTOOL_CLIENT_ID: "", AUDIOTOOL_REDIRECT_URL: `${origin}/auth/audiotool/callback`,
    FIXTURE_MODE: "true", OPENAI_API_KEY: "", GEMINI_API_KEY: "", GOOGLE_API_KEY: "", LANGSMITH_API_KEY: "", LANGSMITH_TRACING: "false", AI_GATEWAY_API_KEY: "", VERCEL_AI_GATEWAY_API_KEY: ""
  } });
  for (let n=0; n<150; n++) {
    if (child.exitCode !== null) throw new Error(`Hosted API exited ${child.exitCode}`);
    if (await fetch(`${base}/healthz`).then((r) => r.ok).catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Hosted API did not start");
}
async function stop() { if (child && child.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill("SIGTERM"); await exited; } }
function call(path: string, cookie?: string, body?: unknown, requestOrigin = origin) {
  return fetch(`${base}/api/v1${path}`, { method: body === undefined ? "GET" : "POST", headers: { Origin: requestOrigin, ...(cookie ? { Cookie: cookie } : {}), "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function signIn(code: string) {
  const result = await call("/auth/login", undefined, { code });
  expect(result.status).toBe(200);
  const header = result.headers.get("set-cookie")!;
  expect(header).toContain("HttpOnly"); expect(header).toContain("Secure"); expect(header).toContain("SameSite=Lax"); expect(header).toContain("__Host-pocket-session=");
  return header.split(";")[0]!;
}
beforeAll(async () => {
  await start();
  await getPool().query("DELETE FROM hosted_login_window");
  const inviteA = await issueAccess(`Host A ${randomUUID()}`), inviteB = await issueAccess(`Host B ${randomUUID()}`);
  owners.push(inviteA.ownerId, inviteB.ownerId); ownerA=inviteA.ownerId;
  a=await signIn(inviteA.code); b=await signIn(inviteB.code);
  project=(await (await call("/projects", a, { title: "Private hosted test" })).json()).project.id as string;
}, 60_000);
afterAll(async () => {
  await stop();
  await getPool().query("DELETE FROM asset WHERE owner_id=ANY($1::uuid[])", [owners]);
  await getPool().query("DELETE FROM project WHERE owner_id=ANY($1::uuid[])", [owners]);
  await getPool().query("DELETE FROM audiotool_session WHERE owner_id=ANY($1::uuid[])", [owners]);
  await getPool().query("DELETE FROM hosted_access WHERE owner_id=ANY($1::uuid[])", [owners]);
  await getPool().query("DELETE FROM app_user WHERE id=ANY($1::uuid[])", [owners]);
  await getPool().query("DELETE FROM hosted_login_window");
});

it("serves the built app and deep links, never repository secrets or unknown API routes", async () => {
  for (const path of ["/", `/sessions/${project}`, `/sessions/${project}/start`, "/auth/audiotool/callback"]) {
    const response=await fetch(base+path); expect(response.status).toBe(200); expect(response.headers.get("content-type")).toContain("text/html");
  }
  for (const path of ["/.env", "/.local/secrets/audiotool-session.key", "/package.json", "/%2e%2e/.env"]) expect((await fetch(base+path)).status).toBe(404);
  expect((await call("/does-not-exist", a)).status).toBe(404);
  expect((await call("/projects")).status).toBe(401);
  expect((await call("/producer-models")).status).toBe(401);
});
it("isolates project, native, job, source and activity routes between authenticated users", async () => {
  expect((await (await call("/projects", b)).json()).projects).toEqual([]);
  for (const path of [`/projects/${project}`, `/projects/${project}/native`, `/projects/${project}/activity`, `/projects/${project}/activity/stream`]) expect((await call(path,b)).status).toBe(404);
  expect((await call(`/jobs/${randomUUID()}`,b)).status).toBe(404);
  const forbidden=await fetch(`${base}/api/v1/projects/${project}/native/constructions`,{method:"POST",headers:{Cookie:b,Origin:origin,"Content-Type":"application/json","Idempotency-Key":randomUUID()},body:JSON.stringify({direction:"A private song",expectedNativeHeadId:null})});
  expect(forbidden.status).toBe(404);
  const wav=encodeWav(new Float32Array(800).fill(0.1),new Float32Array(800).fill(0.1),8000);
  const data=new FormData(); data.set("file",new Blob([new Uint8Array(wav)],{type:"audio/wav"}),"owned.wav");
  const uploaded=await fetch(`${base}/api/v1/projects/${project}/assets`,{method:"POST",headers:{Cookie:a,Origin:origin},body:data});
  expect(uploaded.status).toBe(201); asset=(await uploaded.json()).asset.id as string;
  expect((await call(`/assets/${asset}/audio`,b)).status).toBe(404);
  const audio=await fetch(`${base}/api/v1/assets/${asset}/audio`,{headers:{Cookie:a,Range:"bytes=0-15"}});
  expect(audio.status).toBe(206); expect((await audio.arrayBuffer()).byteLength).toBe(16);
  expect(audio.headers.get("cache-control")).toContain("no-store");
});
it("rejects cross-site/missing-origin mutations, invalid codes and forged cookies", async () => {
  expect((await call("/projects",a,{title:"CSRF"},"https://evil.example")).status).toBe(403);
  expect((await fetch(`${base}/api/v1/projects`,{method:"POST",headers:{Cookie:a,"Content-Type":"application/json"},body:"{}"})).status).toBe(403);
  expect((await call("/auth/login",undefined,{code:"wrong"})).status).toBe(401);
  expect((await call("/projects","__Host-pocket-session=forged")).status).toBe(401);
});
it("retains sessions, project ownership and source bytes across an actual API restart", async () => {
  const config=getConfig(), prior=config.AUDIOTOOL_SESSION_KEY;
  try {
    config.AUDIOTOOL_SESSION_KEY=Buffer.alloc(32,9).toString("base64");
    await saveAudiotoolSession(ownerA,"fixture-owner",{accessToken:"fixture-access-123456789",refreshToken:"",expiresAt:Date.now()+3600_000});
  } finally { config.AUDIOTOOL_SESSION_KEY=prior; }
  await stop(); await start();
  expect((await call(`/projects/${project}`,a)).status).toBe(200);
  expect((await call(`/assets/${asset}/audio`,a)).status).toBe(200);
  expect((await call(`/projects/${project}`,b)).status).toBe(404);
  expect((await (await call("/status",a)).json()).nexus.session.connected).toBe(true);
  expect((await (await call("/status",b)).json()).nexus.session.connected).toBe(false);
},60_000);
it("logout revokes the session and closes its existing stream", async () => {
  const controller=new AbortController();
  try {
    const stream=await fetch(`${base}/api/v1/projects/${project}/activity/stream`,{headers:{Cookie:a,Origin:origin},signal:controller.signal});
    expect(stream.status).toBe(200); const reader=stream.body!.getReader(); await reader.read();
    expect((await call("/auth/logout",a,{})).status).toBe(200);
    expect((await call(`/projects/${project}`,a)).status).toBe(401);
    await expect(Promise.race([(async()=>{while(!(await reader.read()).done){ /* drain pending events */ } return "closed";})(),new Promise((resolve)=>setTimeout(()=>resolve("timeout"),6000))])).resolves.toBe("closed");
  } finally { controller.abort(); }
});
it("rotation/revocation and expiration do not reset owner identity or spending", async () => {
  const invite=await issueAccess("Same owner",ownerA); const session=await startHostedSession(invite.code);
  expect(session?.ownerId).toBe(ownerA); expect(await hostedIdentity(session!.token)).not.toBeNull();
  await getPool().query("UPDATE hosted_session SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[hashCredential(session!.token)]);
  expect(await hostedIdentity(session!.token)).toBeNull();
  const second=await startHostedSession(invite.code); await revokeAccess(ownerA);
  expect(await hostedIdentity(second!.token)).toBeNull(); expect(await startHostedSession(invite.code)).toBeNull();
  expect((await getPool().query("SELECT owner_id FROM project WHERE id=$1",[project])).rows[0].owner_id).toBe(ownerA);
});
it("throttles invalid logins durably without storing cleartext codes or tokens", async () => {
  await getPool().query("UPDATE hosted_login_window SET attempts=60,started_at=now()");
  expect((await call("/auth/login",undefined,{code:"invalid"})).status).toBe(429);
  const stored=await getPool().query("SELECT code_hash FROM hosted_access WHERE owner_id=$1",[ownerA]);
  expect(stored.rows[0].code_hash).toMatch(/^[a-f0-9]{64}$/);
});
it("rotation fences a contending old-code login instead of leaving a late valid session", async () => {
  await getPool().query("DELETE FROM hosted_login_window");
  const first=await issueAccess("Rotate race",ownerA);
  const [login] = await Promise.all([startHostedSession(first.code),issueAccess("Rotate race",ownerA)]);
  if(login) expect(await hostedIdentity(login.token)).toBeNull();
  expect(await startHostedSession(first.code)).toBeNull();
});
