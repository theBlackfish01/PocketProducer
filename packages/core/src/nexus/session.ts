import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import type pg from "pg";
import { REPOSITORY_ROOT, getConfig } from "../config.js";
import { getPool } from "../db/pool.js";

const tokenSchema = z.object({
  accessToken: z.string().min(16).max(16_384),
  refreshToken: z.string().max(16_384).refine((value) => value === "" || value.length >= 16),
  expiresAt: z.number().int().positive()
});

export type AudiotoolTokenData = z.infer<typeof tokenSchema>;
export class AudiotoolSessionExpiredError extends Error {
  readonly statusCode = 409;
  constructor() { super("Audiotool access expired without a refresh token. Reconnect Audiotool in the browser."); this.name = "AudiotoolSessionExpiredError"; }
}
const keyPath = resolve(REPOSITORY_ROOT, ".local/secrets/audiotool-session.key");

async function sessionKey(): Promise<Buffer> {
  const configured = getConfig().AUDIOTOOL_SESSION_KEY;
  if (configured) {
    if (!/^[A-Za-z0-9+/]{43}=$/.test(configured)) throw new Error("Invalid Audiotool session encryption key");
    return Buffer.from(configured, "base64");
  }
  try {
    const existing = await readFile(keyPath);
    if (existing.length !== 32) throw new Error("Audiotool session key has an invalid length");
    return existing;
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
  }
  await mkdir(dirname(keyPath), { recursive: true });
  const generated = randomBytes(32);
  try {
    const handle = await open(keyPath, "wx", 0o600);
    try { await handle.writeFile(generated); } finally { await handle.close(); }
    return generated;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") return readFile(keyPath);
    throw error;
  }
}

async function encryptTokens(ownerId: string, tokens: AudiotoolTokenData) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await sessionKey(), iv);
  cipher.setAAD(Buffer.from(ownerId));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(tokens), "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64") };
}

async function decryptTokens(ownerId: string, row: { token_ciphertext: string; token_iv: string; token_tag: string }): Promise<AudiotoolTokenData> {
  const decipher = createDecipheriv("aes-256-gcm", await sessionKey(), Buffer.from(row.token_iv, "base64"));
  decipher.setAAD(Buffer.from(ownerId));
  decipher.setAuthTag(Buffer.from(row.token_tag, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(row.token_ciphertext, "base64")), decipher.final()]).toString("utf8");
  return tokenSchema.parse(JSON.parse(plaintext));
}

export async function saveAudiotoolSession(ownerId: string, userName: string, input: unknown, database: pg.Pool | pg.PoolClient = getPool()): Promise<void> {
  const tokens = tokenSchema.parse(input);
  const encrypted = await encryptTokens(ownerId, tokens);
  await database.query(
    `INSERT INTO audiotool_session(owner_id,user_name,token_ciphertext,token_iv,token_tag,expires_at)
     VALUES($1,$2,$3,$4,$5,to_timestamp($6::double precision/1000))
     ON CONFLICT(owner_id) DO UPDATE SET user_name=EXCLUDED.user_name,token_ciphertext=EXCLUDED.token_ciphertext,
       token_iv=EXCLUDED.token_iv,token_tag=EXCLUDED.token_tag,expires_at=EXCLUDED.expires_at,updated_at=now()`,
    [ownerId, userName.slice(0, 160), encrypted.ciphertext, encrypted.iv, encrypted.tag, tokens.expiresAt]
  );
}

export async function loadAudiotoolSession(ownerId: string): Promise<{ userName: string; tokens: AudiotoolTokenData } | null> {
  const result = await getPool().query("SELECT user_name,token_ciphertext,token_iv,token_tag FROM audiotool_session WHERE owner_id=$1", [ownerId]);
  const row = result.rows[0];
  if (!row) return null;
  return { userName: String(row.user_name), tokens: await decryptTokens(ownerId, row) };
}

export async function audiotoolSessionStatus(ownerId: string): Promise<{ connected: boolean; userName: string | null; expiresAt: string | null }> {
  const result = await getPool().query("SELECT user_name,expires_at,token_ciphertext,token_iv,token_tag FROM audiotool_session WHERE owner_id=$1", [ownerId]);
  const row = result.rows[0];
  if (!row) return { connected: false, userName: null, expiresAt: null };
  const tokens = await decryptTokens(ownerId, row);
  return { connected: Boolean(tokens.refreshToken) || tokens.expiresAt > Date.now() + 60_000, userName: String(row.user_name), expiresAt: new Date(row.expires_at).toISOString() };
}

export async function deleteAudiotoolSession(ownerId: string): Promise<void> {
  await getPool().query("DELETE FROM audiotool_session WHERE owner_id=$1", [ownerId]);
}

export function createAudiotoolTokenRefreshHandler(ownerId: string, userName: string, persist: typeof saveAudiotoolSession = saveAudiotoolSession): { onTokenRefresh(tokens: AudiotoolTokenData): void; awaitPersistence(): Promise<void> } {
  let pending = Promise.resolve();
  let latestExpiresAt = 0;
  let persistenceError: unknown;
  return {
    onTokenRefresh(tokens) {
      if (tokens.expiresAt < latestExpiresAt) return;
      latestExpiresAt = tokens.expiresAt;
      pending = pending.catch(() => undefined).then(async () => {
        try {
          await persist(ownerId, userName, tokens);
          persistenceError = undefined;
        } catch (error) {
          persistenceError = error;
        }
      });
    },
    async awaitPersistence() {
      await pending;
      if (persistenceError) throw persistenceError instanceof Error ? persistenceError : new Error("Audiotool token persistence failed with a non-Error rejection");
    }
  };
}

export async function createAudiotoolServerClient(ownerId: string, clientId: string) {
  const session = await loadAudiotoolSession(ownerId);
  if (!session) return null;
  if (!session.tokens.refreshToken && session.tokens.expiresAt <= Date.now() + 60_000) {
    throw new AudiotoolSessionExpiredError();
  }
  const [nexusModule, nodeModule] = await Promise.all([import("@audiotool/nexus"), import("@audiotool/nexus/node")]);
  const refresh = createAudiotoolTokenRefreshHandler(ownerId, session.userName);
  const auth = nexusModule.createServerAuth({
    ...session.tokens,
    clientId,
    onTokenRefresh: refresh.onTokenRefresh
  });
  const client = await nexusModule.createAudiotoolClient({ auth, transport: nodeModule.createNodeTransport(), wasm: nodeModule.createDiskWasmLoader() });
  return { client, awaitTokenPersistence: refresh.awaitPersistence };
}
