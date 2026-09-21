import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { createServer } from "../apps/web/node_modules/vite/dist/node/index.js";

interface TestViteServer {
  middlewares: { use(path: string, handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void): void };
  close(): Promise<void>;
}

const webPort = Number(process.env.WEB_PORT ?? 15_173);
const server = await createServer({
  root: resolve("apps/web"),
  server: { host: "127.0.0.1", port: webPort, strictPort: true },
  plugins: [{
    name: "pocket-producer-e2e-shutdown",
    configureServer(vite: TestViteServer) {
      vite.middlewares.use("/__test_shutdown", (request: IncomingMessage, response: ServerResponse, next: () => void) => {
        if (request.method !== "POST") { next(); return; }
        response.statusCode = 202;
        response.setHeader("Content-Type", "application/json");
        response.end('{"status":"stopping"}');
        setImmediate(() => { void vite.close().finally(() => process.exit(0)); });
      });
    }
  }]
});

await server.listen();
