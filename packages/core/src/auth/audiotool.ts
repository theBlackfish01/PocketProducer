import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { getConfig } from "../config.js";
import { getPool } from "../db/pool.js";
import { saveAudiotoolSession, type AudiotoolTokenData } from "../nexus/session.js";
import { hashCredential, throttleHostedLogin } from "./access.js";

// Fixed endpoints from pinned @audiotool/nexus 0.0.17 (index.js browser auth).
const authorizeUrl = "https://oauth.audiotool.com/oauth2/auth";
const tokenUrl = "https://oauth.audiotool.com/oauth2/token";
const whoamiUrl = "https://rpc.audiotool.com/audiotool.auth.v1.AuthService/GetWhoami";
export type OAuthFetch = typeof fetch;
const credential = /^[A-Za-z0-9_-]{43}$/;
export const audiotoolSubject = z.string().regex(/^users\/[A-Za-z0-9_-]{1,128}$/);
const failure = () => Object.assign(new Error("Audiotool sign-in could not be verified. Please try again."), { statusCode: 401 });
export function safeSignInReturn(value: unknown): string {
  return typeof value === "string" && /^\/sessions\/[a-f0-9-]{36}(\/start)?$/.test(value) ? value : "/";
}
export async function beginAudiotoolSignIn(returnPath: unknown, expectedOwnerId?: string) {
  await throttleHostedLogin();
  const config = getConfig();
  if (!config.AUDIOTOOL_CLIENT_ID) throw Object.assign(new Error("Audiotool sign-in is not configured."), { statusCode: 503 });
  const state = randomBytes(32).toString("base64url"), verifier = randomBytes(32).toString("base64url");
  await getPool().query("DELETE FROM hosted_oauth_attempt WHERE expires_at<now()");
  await getPool().query(`INSERT INTO hosted_oauth_attempt(state_hash,verifier_hash,expected_owner_id,return_path,expires_at)
    VALUES($1,$2,$3,$4,now()+interval '10 minutes')`, [hashCredential(state), hashCredential(verifier), expectedOwnerId ?? null, safeSignInReturn(returnPath)]);
  const url = new URL(authorizeUrl);
  url.search = new URLSearchParams({ response_type: "code", client_id: config.AUDIOTOOL_CLIENT_ID, scope: config.AUDIOTOOL_SCOPES,
    redirect_uri: config.AUDIOTOOL_REDIRECT_URL, state, code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url") }).toString();
  return { url: url.href, verifier };
}

/** Fail closed before external IO; consuming once also fences contending callbacks. */
export async function finishAudiotoolSignIn(query: unknown, verifier: string | undefined, transport: OAuthFetch = fetch) {
  const parsed = z.object({ state: z.string().regex(credential), code: z.string().min(1).max(4096).optional(), error: z.string().max(256).optional() }).safeParse(query);
  if (!parsed.success || !verifier || !credential.test(verifier)) throw failure();
  const attempt = (await getPool().query<{ expected_owner_id: string | null; return_path: string }>(`DELETE FROM hosted_oauth_attempt
    WHERE state_hash=$1 AND verifier_hash=$2 AND expires_at>now() RETURNING expected_owner_id,return_path`, [hashCredential(parsed.data.state), hashCredential(verifier)])).rows[0];
  if (!attempt || parsed.data.error || !parsed.data.code) throw failure();
  // Ordinary fixtures cannot accidentally contact OAuth. Tests inject transport,
  // never a configurable live URL or a production token/identity bypass.
  if (getConfig().FIXTURE_MODE && transport === fetch) throw failure();
  const config = getConfig();
  let tokens: AudiotoolTokenData, subject: string;
  try {
    const response = await transport(tokenUrl, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000), headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: config.AUDIOTOOL_CLIENT_ID!, grant_type: "authorization_code", code: parsed.data.code,
        redirect_uri: config.AUDIOTOOL_REDIRECT_URL, code_verifier: verifier, token_endpoint_auth_method: "none" }) });
    if (!response.ok) throw failure();
    const data = z.object({ access_token: z.string().min(16).max(16384), refresh_token: z.string().min(16).max(16384).optional(), expires_in: z.number().int().positive().max(31_536_000) }).parse(await response.json());
    tokens = { accessToken: data.access_token, refreshToken: data.refresh_token ?? "", expiresAt: Date.now() + data.expires_in * 1000 };
    const identity = await transport(whoamiUrl, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${tokens.accessToken}`, "Content-Type": "application/json" }, body: "{}" });
    if (!identity.ok) throw failure();
    subject = z.object({ whoami: z.object({ userName: audiotoolSubject }) }).parse(await identity.json()).whoami.userName;
  } catch { throw failure(); } // Never return provider payloads, codes or tokens in logs/errors.
  const result = await admitAudiotoolIdentity(subject, tokens, attempt.expected_owner_id);
  return { ...result, returnPath: attempt.return_path };
}

async function admitAudiotoolIdentity(subject: string, tokens: AudiotoolTokenData, expectedOwner: string | null) {
  const client = await getPool().connect();
  const token = randomBytes(32).toString("base64url");
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`pocket-identity:${subject}`]);
    let ownerId = (await client.query<{ owner_id: string }>("SELECT owner_id FROM audiotool_identity WHERE subject=$1", [subject])).rows[0]?.owner_id;
    // Reconnect may refresh only this signed-in account, never silently switch it.
    if (expectedOwner && ownerId !== expectedOwner) throw failure();
    if (!ownerId) {
      ownerId = (await client.query<{ id: string }>("INSERT INTO app_user(provider_subject,display_name) VALUES($1,$2) RETURNING id", [`audiotool:${subject}`, subject.slice(6)])).rows[0]!.id;
      await client.query("INSERT INTO audiotool_identity(subject,owner_id) VALUES($1,$2)", [subject, ownerId]);
      await client.query("INSERT INTO hosted_access(owner_id) VALUES($1)", [ownerId]);
    }
    const access = (await client.query<{ revoked_at: Date | null }>("SELECT revoked_at FROM hosted_access WHERE owner_id=$1 FOR UPDATE", [ownerId])).rows[0];
    if (!access || access.revoked_at) throw failure();
    // OAuth, unlike an invitation, has no invitation-expiry prerequisite.
    await client.query("UPDATE hosted_access SET expires_at=NULL WHERE owner_id=$1", [ownerId]);
    await saveAudiotoolSession(ownerId, subject, tokens, client);
    await client.query("INSERT INTO hosted_session(token_hash,owner_id,expires_at) VALUES($1,$2,now()+interval '7 days')", [hashCredential(token), ownerId]);
    await client.query("DELETE FROM hosted_session WHERE expires_at<now()");
    await client.query("COMMIT");
    return { token, ownerId };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

/** Operator-only prebinding for the original installation. No name-based auto-link. */
export async function linkAudiotoolOwner(ownerId: string, input: string) {
  const subject = audiotoolSubject.parse(input), client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`pocket-identity:${subject}`]);
    const owner = await client.query("SELECT id FROM app_user WHERE id=$1 FOR UPDATE", [ownerId]);
    if (!owner.rowCount) throw new Error("Owner does not exist");
    // Uniqueness rejects ambiguous/previously bound owners; never merge accounts.
    await client.query("INSERT INTO audiotool_identity(subject,owner_id) VALUES($1,$2)", [subject, ownerId]);
    await client.query("INSERT INTO hosted_access(owner_id) VALUES($1) ON CONFLICT(owner_id) DO NOTHING", [ownerId]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function throttleHostedWrite(ownerId: string) {
  const result = await getPool().query<{ attempts: number }>(`INSERT INTO hosted_write_window(owner_id,started_at,attempts) VALUES($1,now(),1)
    ON CONFLICT(owner_id) DO UPDATE SET attempts=CASE WHEN hosted_write_window.started_at<now()-interval '1 minute' THEN 1 ELSE hosted_write_window.attempts+1 END,
    started_at=CASE WHEN hosted_write_window.started_at<now()-interval '1 minute' THEN now() ELSE hosted_write_window.started_at END RETURNING attempts`, [ownerId]);
  if (result.rows[0]!.attempts>30) throw Object.assign(new Error("Please wait a minute before making more changes."), { statusCode: 429 });
}
