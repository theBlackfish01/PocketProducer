import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { getConfig, REPOSITORY_ROOT } from "../config.js";

export function storageRoot(): string {
  return resolve(REPOSITORY_ROOT, getConfig().OBJECT_STORAGE_LOCAL_ROOT);
}

export function safeStoragePath(...segments: string[]): string {
  const root = storageRoot();
  const candidate = resolve(root, ...segments);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) throw new Error("Storage path escaped configured root");
  return candidate;
}

export async function storeImmutableAudio(ownerId: string, projectId: string, buffer: Buffer): Promise<{ path: string; hash: string }> {
  const hash = createHash("sha256").update(buffer).digest("hex");
  const path = safeStoragePath(ownerId, projectId, "sources", `${hash}.wav`);
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, buffer, { flag: "wx" }).catch((error: unknown) => {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
  });
  return { path, hash };
}
