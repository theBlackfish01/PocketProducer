import { createServer } from "node:http";
import { runWorker } from "@pocket/worker";

const health = createServer((request, response) => {
  if (request.method === "POST" && request.url === "/shutdown") {
    response.writeHead(202, { "Content-Type": "application/json" });
    response.end('{"status":"stopping"}');
    setImmediate(() => process.kill(process.pid, "SIGINT"));
    return;
  }
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end('{"status":"ready"}');
});
const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? 18_788);
// Start the actual worker before exposing readiness. This prevents the test
// runner from racing a health-only process that has not begun polling yet.
const worker = runWorker();
await new Promise<void>((resolve, reject) => {
  health.once("error", reject);
  health.listen(healthPort, "127.0.0.1", resolve);
});
let stopping = false;
const closeHealth = () => {
  if (stopping) return;
  stopping = true;
  health.close();
  // Playwright launches through a shell on Windows. Give runWorker time to
  // close its pool, but never leave a provider-disabled test worker orphaned.
  setTimeout(() => process.exit(0), 2_000).unref();
};
process.once("SIGINT", closeHealth);
process.once("SIGTERM", closeHealth);
await worker;
