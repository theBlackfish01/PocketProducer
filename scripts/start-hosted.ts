import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, access } from "node:fs/promises";
import { constants } from "node:fs";
import { createServer } from "node:http";
import { getConfig, storageRoot } from "@pocket/core";

const config = getConfig(); // Fail closed before binding any public socket.
if (!config.SERVE_WEB || config.DEV_LOCAL_AUTH) throw new Error("Hosted startup requires built-web serving and individual authentication");
await mkdir(storageRoot(), { recursive: true });
await access(storageRoot(), constants.W_OK);
if (config.HOSTED_MAINTENANCE) {
  // No migrations, API, jobs or provider work until the operator finishes the
  // data/ledger transfer. Keeps an SSH-able service and a narrow health endpoint.
  const server = createServer((request, response) => {
    response.writeHead(request.url === "/healthz" ? 200 : 503, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "300" });
    response.end(request.url === "/healthz" ? "maintenance" : "Pocket Producer is being prepared. Please check back shortly.");
  });
  server.listen(config.PORT ?? config.API_PORT, config.APP_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => { server.close(() => process.exit(0)); });
} else {
const children: ChildProcess[] = [];
let stopping = false;
function stop(exitCode: number) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  const force = setTimeout(() => { for (const child of children) child.kill("SIGKILL"); process.exit(exitCode); }, 10_000);
  const check = setInterval(() => {
    if (children.every((child) => child.exitCode !== null || child.signalCode !== null)) { clearTimeout(force); clearInterval(check); process.exit(exitCode); }
  }, 100);
}
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => stop(0));
function launch(path: string) {
  const child = spawn(process.execPath, ["--import", "tsx", path], { stdio: ["ignore", "inherit", "inherit", "ipc"], windowsHide: true });
  children.push(child);
  child.on("error", () => stop(1));
  return child;
}
const migration = launch("packages/core/src/db/migrate.ts");
await new Promise<void>((resolve, reject) => {
  migration.once("error", reject);
  migration.once("exit", (code) => code === 0 ? resolve() : reject(new Error("Database migration failed; application was not started")));
});
if (!stopping) {
  const worker = launch("apps/worker/src/worker.ts");
  let lastHeartbeat = Date.now(), apiStarted = false;
  worker.on("message", (message) => {
    if (message !== "worker-ready" && message !== "worker-heartbeat") return;
    lastHeartbeat = Date.now();
    if (!apiStarted && !stopping) {
      apiStarted = true;
      const api = launch("apps/api/src/server.ts");
      api.on("exit", () => { if (!stopping) stop(1); });
    }
  });
  worker.on("exit", () => { if (!stopping) stop(1); });
  setInterval(() => { if (Date.now() - lastHeartbeat > 60_000) stop(1); }, 5_000).unref();
}
}
