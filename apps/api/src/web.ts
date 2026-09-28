import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { resolve, join, extname } from "node:path";
import type { FastifyInstance } from "fastify";
import { REPOSITORY_ROOT } from "@pocket/core";

/** Serve only files inventoried in the built frontend. Never expose the repository. */
export async function registerWeb(app: FastifyInstance) {
  const root = resolve(REPOSITORY_ROOT, "apps/web/dist");
  const files = new Map<string, string>();
  async function walk(directory: string, prefix: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const url = `${prefix}/${entry.name}`, path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path, url);
      else if (entry.isFile() && !entry.name.endsWith(".map")) files.set(url, path);
    }
  }
  await walk(root, "");
  if (!files.has("/index.html")) throw new Error("Build the frontend before starting production");
  const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".json": "application/json", ".webp": "image/webp" };
  app.get("/*", async (request, reply) => {
    const url = request.url.split("?")[0]!;
    const spa = url === "/" || url === "/auth/audiotool/callback" || /^\/sessions\/[a-f0-9-]{36}(\/start)?$/.test(url);
    const path = files.get(spa ? "/index.html" : url);
    if (!path) return reply.code(404).send({ message: "Page not found" });
    return reply.header("Content-Type", types[extname(path)] ?? "application/octet-stream")
      .header("Content-Length", (await stat(path)).size)
      .header("Cache-Control", url.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache")
      .send(createReadStream(path));
  });
}
