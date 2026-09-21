import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { REPOSITORY_ROOT } from "../config.js";
import { getPool } from "../db/pool.js";
import type { AudiotoolExportClient } from "./adapter.js";

const tokenSchema = z.object({
  accessToken: z.string().min(16).max(16_384),
  refreshToken: z.string().min(16).max(16_384),
  expiresAt: z.number().int().positive()
});

export type AudiotoolTokenData = z.infer<typeof tokenSchema>;
const keyPath = resolve(REPOSITORY_ROOT, ".local/secrets/audiotool-session.key");

async function sessionKey(): Promise<Buffer> {
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

export async function saveAudiotoolSession(ownerId: string, userName: string, input: unknown): Promise<void> {
  const tokens = tokenSchema.parse(input);
  const encrypted = await encryptTokens(ownerId, tokens);
  await getPool().query(
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
  const result = await getPool().query("SELECT user_name,expires_at FROM audiotool_session WHERE owner_id=$1", [ownerId]);
  const row = result.rows[0];
  return row ? { connected: true, userName: String(row.user_name), expiresAt: new Date(row.expires_at).toISOString() } : { connected: false, userName: null, expiresAt: null };
}

export async function deleteAudiotoolSession(ownerId: string): Promise<void> {
  await getPool().query("DELETE FROM audiotool_session WHERE owner_id=$1", [ownerId]);
}

export function createAudiotoolTokenRefreshHandler(ownerId: string, userName: string, persist: typeof saveAudiotoolSession = saveAudiotoolSession): { onTokenRefresh(tokens: AudiotoolTokenData): void; awaitPersistence(): Promise<void> } {
  let pending = Promise.resolve();
  return {
    onTokenRefresh(tokens) { pending = persist(ownerId, userName, tokens); },
    awaitPersistence() { return pending; }
  };
}

export async function createAudiotoolServerClient(ownerId: string, clientId: string): Promise<{ client: AudiotoolExportClient; awaitTokenPersistence(): Promise<void> } | null> {
  const session = await loadAudiotoolSession(ownerId);
  if (!session) return null;
  const [nexusModule, nodeModule] = await Promise.all([import("@audiotool/nexus"), import("@audiotool/nexus/node")]);
  const nexus = nexusModule as unknown as {
    createServerAuth(options: AudiotoolTokenData & { clientId: string; onTokenRefresh(tokens: AudiotoolTokenData): void }): unknown;
    createAudiotoolClient(options: { auth: unknown; transport: unknown; wasm: unknown }): Promise<unknown>;
  };
  const node = nodeModule as unknown as { createNodeTransport(): unknown; createDiskWasmLoader(): unknown };
  const refresh = createAudiotoolTokenRefreshHandler(ownerId, session.userName);
  const auth = nexus.createServerAuth({
    ...session.tokens,
    clientId,
    onTokenRefresh: refresh.onTokenRefresh
  });
  const client = await nexus.createAudiotoolClient({ auth, transport: node.createNodeTransport(), wasm: node.createDiskWasmLoader() });
  return { client: client as AudiotoolExportClient, awaitTokenPersistence: refresh.awaitPersistence };
}
