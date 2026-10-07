import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import Fastify from "../../apps/api/node_modules/fastify/fastify.js";
import { registerAuth } from "../../apps/api/src/auth.js";
import { registerActivityRoutes } from "../../apps/api/src/activity-stream.js";
import { createApi } from "../../apps/api/src/server.js";
import { beginAudiotoolSignIn, finishAudiotoolSignIn, getConfig, getPool, hostedIdentity, linkAudiotoolOwner, loadAudiotoolSession, revokeAccess, createProject, listProjects, getProjectSnapshot, createNativeJob, type OAuthFetch } from "@pocket/core";

const config = getConfig(), original = { ...config };
const subject = `users/auth-${randomUUID()}`, otherSubject = `users/other-${randomUUID()}`;
const owners: string[] = [];
let owner: string;
const transport = vi.fn<OAuthFetch>((input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url === "https://oauth.audiotool.com/oauth2/token") {
    expect(init?.redirect).toBe("error");
    const body = init?.body as URLSearchParams;
    expect(body.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.get("client_id")).toBe("registered-fixture");
    const code = body.get("code");
    if (code === "bad") return Promise.resolve(new Response("private provider failure", { status: 400 }));
    return Promise.resolve(Response.json({ access_token: `fixture-access-token-${code}`, expires_in: 3600 }));
  }
  expect(url).toBe("https://rpc.audiotool.com/audiotool.auth.v1.AuthService/GetWhoami");
  expect(init?.body).toBe("{}");
  const bearer = (init?.headers as Record<string,string>).Authorization!;
  if (bearer.endsWith("unknown")) return Promise.resolve(Response.json({ whoami: { userName: "Unknown User" } }));
  return Promise.resolve(Response.json({ whoami: { userName: bearer.endsWith("other") ? otherSubject : subject } }));
});
const app = Fastify({ logger: false });
const origin = "https://pocket.example";
const start = async (expectedOwner?: string) => {
  const data = await beginAudiotoolSignIn("/", expectedOwner);
  return { state: new URL(data.url).searchParams.get("state")!, verifier: data.verifier };
};
async function finish(code="normal", expectedOwner?: string) {
  const attempt = await start(expectedOwner);
  return finishAudiotoolSignIn({ state: attempt.state, code }, attempt.verifier, transport);
}
beforeAll(async () => {
  Object.assign(config, { DEV_LOCAL_AUTH: false, HOSTED_AUTH_MODE: "audiotool", AUDIOTOOL_CLIENT_ID: "registered-fixture", AUDIOTOOL_SCOPES: "user:read project:write", APP_ORIGIN: origin, AUDIOTOOL_REDIRECT_URL: `${origin}/auth/audiotool/callback`, AUDIOTOOL_SESSION_KEY: Buffer.alloc(32,8).toString("base64") });
  await getPool().query("DELETE FROM hosted_login_window");
  await registerAuth(app, transport);
  registerActivityRoutes(app, origin);
  app.get("/api/v1/projects", async request => ({ projects: await listProjects(request.ownerId) }));
  app.get<{ Params:{id:string} }>("/api/v1/projects/:id", request => getProjectSnapshot(request.ownerId,request.params.id));
  app.post("/api/v1/probe", () => ({ ok: true }));
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await getPool().query("DELETE FROM job WHERE owner_id=ANY($1::uuid[])", [owners]);
  await getPool().query("DELETE FROM project WHERE owner_id=ANY($1::uuid[])", [owners]);
  await getPool().query("DELETE FROM audiotool_session WHERE owner_id=ANY($1::uuid[])", [owners]);
  await getPool().query("DELETE FROM audiotool_identity WHERE owner_id=ANY($1::uuid[])", [owners]);
  await getPool().query("DELETE FROM owner_usage_limit WHERE owner_id=ANY($1::uuid[])", [owners]);
  await getPool().query("DELETE FROM hosted_access WHERE owner_id=ANY($1::uuid[])", [owners]);
  await getPool().query("DELETE FROM app_user WHERE id=ANY($1::uuid[])", [owners]);
  await getPool().query("DELETE FROM hosted_login_window");
  Object.assign(config,original);
});
it("uses fixed PKCE endpoints, rejects open redirects and stores no clear OAuth credentials", async () => {
  const attempt = await beginAudiotoolSignIn("https://evil.example");
  const url = new URL(attempt.url);
  expect(url.origin).toBe("https://oauth.audiotool.com"); expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("code_challenge")).not.toBe(attempt.verifier);
  const row = (await getPool().query("SELECT * FROM hosted_oauth_attempt ORDER BY expires_at DESC LIMIT 1")).rows[0];
  expect(row.return_path).toBe("/"); expect(JSON.stringify(row)).not.toContain(attempt.verifier); expect(JSON.stringify(row)).not.toContain(url.searchParams.get("state"));
});
it("requires matching browser binding, unexpired state and one-time code before external dispatch", async () => {
  const attempt = await start(); transport.mockClear();
  await expect(finishAudiotoolSignIn({ state: attempt.state, code:"normal" },"x".repeat(43),transport)).rejects.toThrow();
  await expect(finishAudiotoolSignIn({ state: attempt.state, code:"normal" },undefined,transport)).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
  const results = await Promise.allSettled([1,2].map(() => finishAudiotoolSignIn({ state:attempt.state,code:"normal",userName:"users/victim" },attempt.verifier,transport)));
  expect(results.filter(x=>x.status==="fulfilled")).toHaveLength(1); expect(transport).toHaveBeenCalledTimes(2);
  const successful = results.find(x=>x.status==="fulfilled")!;
  owner=successful.value.ownerId; owners.push(owner);
  expect((await hostedIdentity(successful.value.token))?.ownerId).toBe(owner);
  expect((await loadAudiotoolSession(owner))?.userName).toBe(subject);
  expect((await loadAudiotoolSession(owner))?.tokens.refreshToken).toBe("");
  const expired = await start(); await getPool().query("UPDATE hosted_oauth_attempt SET expires_at=now()-interval '1 second'");
  transport.mockClear(); await expect(finishAudiotoolSignIn({state:expired.state,code:"normal"},expired.verifier,transport)).rejects.toThrow(); expect(transport).not.toHaveBeenCalled();
});
it("returns the same owner under concurrent sign-ins without resetting allowance or projects", async () => {
  const project = await createProject(owner,"Keep this music");
  await getPool().query("INSERT INTO owner_usage_limit(owner_id,limit_microusd) VALUES($1,1234567)",[owner]);
  const before = await getPool().query("SELECT count(*)::int AS count FROM effect");
  const results = await Promise.all([finish(),finish()]);
  expect(results.map(x=>x.ownerId)).toEqual([owner,owner]);
  expect((await listProjects(owner)).some(x=>x.id===project.id)).toBe(true);
  expect((await getPool().query("SELECT count(*)::int AS count FROM effect")).rows).toEqual(before.rows);
  expect((await getPool().query("SELECT limit_microusd::text AS amount FROM owner_usage_limit WHERE owner_id=$1",[owner])).rows[0].amount).toBe("1234567");
});
it("rejects denied, malformed or unavailable provider identity without exposing response details", async () => {
  for(const code of ["bad","unknown"]) await expect(finish(code)).rejects.toThrow("could not be verified");
  const attempt=await start(); transport.mockClear();
  await expect(finishAudiotoolSignIn({state:attempt.state,error:"access_denied"},attempt.verifier,transport)).rejects.toThrow(); expect(transport).not.toHaveBeenCalled();
  const offline=await start(); await expect(finishAudiotoolSignIn({state:offline.state,code:"normal"},offline.verifier)).rejects.toThrow();
});
it("prebinding is explicit and unique, preserves original owner, and cannot be claimed with a display name", async () => {
  const id=(await getPool().query<{id:string}>("INSERT INTO app_user(provider_subject,display_name) VALUES($1,'Old listener') RETURNING id",[`test:${randomUUID()}`])).rows[0]!.id;
  owners.push(id); await linkAudiotoolOwner(id,otherSubject);
  expect((await finish("other")).ownerId).toBe(id);
  await expect(linkAudiotoolOwner(owner,otherSubject)).rejects.toThrow();
  await expect(finish("other",owner)).rejects.toThrow();
  expect((await loadAudiotoolSession(owner))?.userName).toBe(subject);
});
it("serves open OAuth entry with CSRF checks and denies cross-owner API/activity access", async () => {
  expect((await app.inject({url:"/api/v1/auth/session"})).json().mode).toBe("audiotool");
  expect((await app.inject({url:"/api/v1/auth/audiotool/start",method:"POST",payload:{}})).statusCode).toBe(403);
  expect((await app.inject({url:"/api/v1/auth/login",method:"POST",headers:{origin},payload:{code:"anything"}})).statusCode).toBe(404);
  const started = await app.inject({url:"/api/v1/auth/audiotool/start",method:"POST",headers:{origin},payload:{returnPath:"//evil.example"}});
  const url=new URL(started.json().url as string), binding=started.cookies[0]!;
  const callback=await app.inject({url:`/auth/audiotool/callback?state=${url.searchParams.get("state")}&code=normal`,cookies:{[binding.name]:binding.value}});
  expect(callback.statusCode).toBe(302); expect(callback.headers.location).toBe("/"); expect(callback.headers["cache-control"]).toBe("no-store");
  const sessionCookie=callback.cookies.find((c: { name: string })=>c.name==="pocket-session")!;
  const second=await finish("other"), project=(await listProjects(owner))[0]!;
  for(const suffix of ["", "/activity", "/activity/stream"]) expect((await app.inject({url:`/api/v1/projects/${project.id}${suffix}`,headers:{origin},cookies:{"pocket-session":second.token}})).statusCode).toBe(404);
  expect((await app.inject({url:`/api/v1/projects/${project.id}`,cookies:{[sessionCookie.name]:sessionCookie.value}})).statusCode).toBe(200);
  await app.inject({url:"/api/v1/auth/logout",method:"POST",headers:{origin},cookies:{[sessionCookie.name]:sessionCookie.value}});
  expect((await app.inject({url:"/api/v1/projects",cookies:{[sessionCookie.name]:sessionCookie.value}})).statusCode).toBe(401);
});
it("bounds owner writes durably and preserves duplicate job receipts under hosted queue limits", async () => {
  const session=await finish();
  await getPool().query("INSERT INTO hosted_write_window(owner_id,started_at,attempts) VALUES($1,now(),30) ON CONFLICT(owner_id) DO UPDATE SET started_at=now(),attempts=30",[owner]);
  expect((await app.inject({url:"/api/v1/probe",method:"POST",headers:{origin},cookies:{"pocket-session":session.token}})).statusCode).toBe(429);
  const project=await createProject(owner,"Queue one"), second=await createProject(owner,"Queue two");
  const input={ownerId:owner,projectId:project.id,kind:"native-generation" as const,idempotencyKey:randomUUID(),request:{direction:"Test"},expectedHeadId:null};
  const created=await createNativeJob(input); expect((await createNativeJob(input)).id).toBe(created.id);
  await expect(createNativeJob({...input,projectId:second.id,idempotencyKey:randomUUID()})).rejects.toThrow("already running in one of your sessions");
  const api=await createApi(transport);
  try {
    const stopped=await api.inject({url:`/api/v1/jobs/${created.id}/cancel`,method:"POST",headers:{origin},cookies:{"pocket-session":session.token}});
    expect(stopped.statusCode).toBe(200); expect(stopped.json().state).toBe("cancelled");
    expect((await api.inject({url:`/api/v1/jobs/${created.id}/cancel`,method:"POST",headers:{origin:"https://evil.example"},cookies:{"pocket-session":session.token}})).statusCode).toBe(403);
  } finally { await api.close(); }
});
it("serializes contending submissions and caps the global hosted queue across distinct owners", async () => {
  const queueOwners: string[]=[];
  for(let n=0;n<9;n++) {
    const id=(await getPool().query<{id:string}>("INSERT INTO app_user(provider_subject,display_name) VALUES($1,'Queue fixture') RETURNING id",[`queue:${randomUUID()}`])).rows[0]!.id;
    owners.push(id); queueOwners.push(id);
  }
  const inputs=await Promise.all(queueOwners.map(async id=>({ownerId:id,projectId:(await createProject(id,"Queue limit")).id,kind:"native-generation" as const,idempotencyKey:randomUUID(),request:{direction:"Queue only, no calls"},expectedHeadId:null})));
  try {
    const results=await Promise.allSettled(inputs.map(input=>createNativeJob(input)));
    expect(results.filter(x=>x.status==="fulfilled")).toHaveLength(8);
    const rejected=results.find(x=>x.status==="rejected")!; expect(String(rejected.reason)).toContain("shared studio is busy");
  } finally { await getPool().query("UPDATE job SET state='cancelled' WHERE owner_id=ANY($1::uuid[])",[queueOwners]); }
});
it("OAuth sessions use production cookie flags and logout terminates a live activity stream", async () => {
  const savedEnvironment=config.APP_ENV, savedServe=config.SERVE_WEB;
  config.APP_ENV="production"; config.SERVE_WEB=true;
  const productionApp=Fastify({logger:false});
  const controller=new AbortController();
  try {
    await registerAuth(productionApp,transport); registerActivityRoutes(productionApp,origin);
    const started=await productionApp.inject({url:"/api/v1/auth/audiotool/start",method:"POST",headers:{origin},payload:{}});
    expect(started.headers["set-cookie"]).toContain("__Host-pocket-session-oauth=");
    expect(started.headers["set-cookie"]).toContain("Secure");
    const url=new URL(started.json().url as string), binding=started.cookies[0]!;
    const callback=await productionApp.inject({url:`/auth/audiotool/callback?state=${url.searchParams.get("state")}&code=normal`,cookies:{[binding.name]:binding.value}});
    const headers=callback.headers["set-cookie"] as string[];
    expect(headers[0]).toContain("__Host-pocket-session="); expect(headers[0]).toContain("Secure"); expect(headers[0]).toContain("HttpOnly");
    const session=headers[0]!.split(";")[0]!;
    const address=await productionApp.listen({host:"127.0.0.1",port:0});
    const project=(await listProjects(owner))[0]!;
    const stream=await fetch(`${address}/api/v1/projects/${project.id}/activity/stream`,{headers:{Cookie:session,Origin:origin},signal:controller.signal});
    expect(stream.status).toBe(200); const reader=stream.body!.getReader(); await reader.read();
    expect((await fetch(`${address}/api/v1/auth/logout`,{method:"POST",headers:{Cookie:session,Origin:origin}})).status).toBe(200);
    await expect(Promise.race([(async()=>{while(!(await reader.read()).done){ /* drain confirmed events */ } return "closed";})(),new Promise(resolve=>setTimeout(()=>resolve("timeout"),6000))])).resolves.toBe("closed");
  } finally { controller.abort(); config.APP_ENV=savedEnvironment; config.SERVE_WEB=savedServe; await productionApp.close(); }
});
it("revocation prevents fresh OAuth login and invalidates existing sessions without deleting history", async () => {
  const session=await finish(); await revokeAccess(owner);
  expect(await hostedIdentity(session.token)).toBeNull(); await expect(finish()).rejects.toThrow();
  expect((await listProjects(owner)).length).toBeGreaterThan(0);
});
