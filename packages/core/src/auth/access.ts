import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getPool } from "../db/pool.js";

export const sessionSeconds = 7 * 24 * 60 * 60;
export const hashCredential = (value: string) => createHash("sha256").update(value).digest("hex");
export interface HostedIdentity { ownerId: string; displayName: string }

/** Operator-only issuance. No HTTP registration endpoint and no allowance reset. */
export async function issueAccess(displayName: string, existingOwnerId?: string) {
  if (!displayName.trim() || displayName.length > 120) throw new Error("Display name must have 1–120 characters");
  const client = await getPool().connect();
  const code = randomBytes(32).toString("base64url");
  try {
    await client.query("BEGIN");
    const ownerId = existingOwnerId ?? (await client.query<{ id: string }>("INSERT INTO app_user(provider_subject,display_name) VALUES($1,$2) RETURNING id", [`invited:${randomUUID()}`, displayName.trim()])).rows[0]!.id;
    const exists = await client.query("SELECT id FROM app_user WHERE id=$1 FOR UPDATE", [ownerId]);
    if (!exists.rowCount) throw new Error("Owner does not exist");
    await client.query(`INSERT INTO hosted_access(owner_id,code_hash,expires_at) VALUES($1,$2,now()+interval '30 days')
      ON CONFLICT(owner_id) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,revoked_at=NULL`, [ownerId, hashCredential(code)]);
    await client.query("DELETE FROM hosted_session WHERE owner_id=$1", [ownerId]);
    await client.query("COMMIT");
    return { ownerId, code };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function revokeAccess(ownerId: string) {
  await getPool().query("UPDATE hosted_access SET revoked_at=now() WHERE owner_id=$1", [ownerId]);
}

export async function throttleHostedLogin() {
  // Committed independently: invalid attempts must not roll back the throttle.
  const rate = await getPool().query<{ attempts: number }>(`INSERT INTO hosted_login_window(singleton,started_at,attempts) VALUES(true,now(),1)
    ON CONFLICT(singleton) DO UPDATE SET
      attempts=CASE WHEN hosted_login_window.started_at < now()-interval '1 minute' THEN 1 ELSE hosted_login_window.attempts+1 END,
      started_at=CASE WHEN hosted_login_window.started_at < now()-interval '1 minute' THEN now() ELSE hosted_login_window.started_at END RETURNING attempts`);
  if (rate.rows[0]!.attempts > 60) throw Object.assign(new Error("Too many sign-in attempts. Try again in a minute."), { statusCode: 429 });
}

export async function startHostedSession(code: string) {
  await throttleHostedLogin();
  if (!/^[A-Za-z0-9_-]{43}$/.test(code)) return null;
  const token = randomBytes(32).toString("base64url");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // Serialize admission with rotation. Otherwise an old-code login could insert
    // a new session just after rotation deleted the old sessions.
    const access = await client.query<{ owner_id: string }>(`SELECT owner_id FROM hosted_access
      WHERE code_hash=$1 AND revoked_at IS NULL AND expires_at>now() FOR UPDATE`, [hashCredential(code)]);
    if (!access.rowCount) { await client.query("COMMIT"); return null; }
    const ownerId = access.rows[0]!.owner_id;
    await client.query(`INSERT INTO hosted_session(token_hash,owner_id,expires_at)
      SELECT $1,owner_id,LEAST(expires_at,now()+interval '7 days') FROM hosted_access WHERE owner_id=$2`, [hashCredential(token), ownerId]);
    await client.query("DELETE FROM hosted_session WHERE expires_at<now()");
    await client.query("COMMIT");
    return { token, ownerId };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function hostedIdentity(token: string | undefined): Promise<HostedIdentity | null> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const result = await getPool().query<{ owner_id: string; display_name: string }>(`SELECT s.owner_id,u.display_name FROM hosted_session s
    JOIN hosted_access a ON a.owner_id=s.owner_id JOIN app_user u ON u.id=s.owner_id
    WHERE s.token_hash=$1 AND s.expires_at>now() AND (a.expires_at IS NULL OR a.expires_at>now()) AND a.revoked_at IS NULL`, [hashCredential(token)]);
  const row = result.rows[0];
  return row ? { ownerId: row.owner_id, displayName: row.display_name } : null;
}

export async function endHostedSession(token: string | undefined) {
  if (token) await getPool().query("DELETE FROM hosted_session WHERE token_hash=$1", [hashCredential(token)]);
}
