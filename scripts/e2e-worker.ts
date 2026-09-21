import { createServer } from "node:http";
import { runWorker } from "@pocket/worker";

const health = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end('{"status":"ready"}');
});
await new Promise<void>((resolve, reject) => {
  health.once("error", reject);
  health.listen(18788, "127.0.0.1", resolve);
});
const closeHealth = () => health.close();
process.once("SIGINT", closeHealth);
process.once("SIGTERM", closeHealth);
await runWorker();
