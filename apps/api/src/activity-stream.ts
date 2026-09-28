import type { ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import { readProjectActivity } from "@pocket/core";
import { z } from "zod";
import { stillAuthenticated } from "./auth.js";

const cursorSchema = z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
type Client = { response: ServerResponse; cursor: number; authorized(): Promise<boolean> };

/** One short-lived DB read per active room per tick, never a held connection per browser. */
export function registerActivityRoutes(app: FastifyInstance, origin: string) {
  const rooms = new Map<string, { clients: Set<Client>; timer: ReturnType<typeof setTimeout> | null }>();
  app.get("/api/v1/projects/:projectId/activity", async (request) => {
    const ownerId = request.ownerId;
    const { projectId } = z.object({ projectId: z.uuid() }).parse(request.params);
    const query = z.object({ after: cursorSchema.optional(), before: cursorSchema.optional(), limit: z.coerce.number().int().min(1).max(100).optional() }).parse(request.query);
    return readProjectActivity(ownerId, projectId, query);
  });
  app.get("/api/v1/projects/:projectId/activity/stream", async (request, reply) => {
    const ownerId = request.ownerId;
    const { projectId } = z.object({ projectId: z.uuid() }).parse(request.params);
    if (request.headers.origin && request.headers.origin !== origin) throw Object.assign(new Error("Session stream requires the configured origin"), { statusCode: 403 });
    const query = z.object({ after: cursorSchema.default(0) }).parse(request.query);
    const cursor = cursorSchema.parse(request.headers["last-event-id"] ?? query.after);
    const initial = await readProjectActivity(ownerId, projectId, { after: cursor }); // authorize before hijack
    if ([...rooms.values()].reduce((sum, room) => sum + room.clients.size, 0) >= 64) return reply.code(503).send({ message: "Too many open session streams" });
    reply.hijack();
    const response = reply.raw;
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no", "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true" });
    response.write(": connected\n\n");
    // Reset this client independently: another tab may already tail the same room
    // with a valid cursor, so the shared minimum alone cannot detect its stale one.
    if (initial.reset) response.write(`id: ${initial.nextCursor}\nevent: workspace\ndata: ${JSON.stringify(initial)}\n\n`);
    const client = { response, cursor: initial.reset ? initial.nextCursor : cursor, authorized: () => stillAuthenticated(request) };
    let room = rooms.get(projectId);
    if (!room) { room = { clients: new Set(), timer: null }; rooms.set(projectId, room); }
    room.clients.add(client);
    const remove = () => {
      room.clients.delete(client);
      if (!room.clients.size) { if (room.timer) clearTimeout(room.timer); rooms.delete(projectId); }
    };
    response.on("close", remove);
    if (room.clients.size === 1) {
      const tick = async () => {
        if (!room.clients.size) return;
        try {
          const minimum = Math.min(...[...room.clients].map((value) => value.cursor));
          const page = await readProjectActivity(ownerId, projectId, { after: minimum, limit: 100 });
          for (const value of room.clients) {
            if (!await value.authorized()) { value.response.end(); continue; }
            if (value.response.destroyed || value.response.writableLength > 262_144) { value.response.destroy(); continue; }
            if (page.reset) value.cursor = 0;
            else if (value.cursor > page.cursor) { value.response.end(); continue; } // polling resynchronizes this restored snapshot
            const events = page.events.filter((event) => event.cursor > value.cursor);
            value.cursor = Math.max(value.cursor, page.nextCursor);
            if (!value.response.write(`id: ${value.cursor}\nevent: workspace\ndata: ${JSON.stringify({ ...page, events, nextCursor: value.cursor })}\n\n`)) value.response.end();
          }
        } catch { for (const value of room.clients) value.response.end(); return; }
        if (room.clients.size) room.timer = setTimeout(() => void tick(), 1_000);
      };
      void tick();
    }
  });
  app.addHook("preClose", () => { for (const room of rooms.values()) { if (room.timer) clearTimeout(room.timer); for (const client of room.clients) client.response.end(); } rooms.clear(); return Promise.resolve(); });
}
