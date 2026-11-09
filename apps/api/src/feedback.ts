import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getPool } from "@pocket/core/api";

const submission = z.object({ id: z.uuid(), message: z.string().trim().min(1).max(4000) }).strict();

export function registerFeedback(app: FastifyInstance) {
  app.post("/api/v1/feedback", { bodyLimit: 24_576 }, async (request, reply) => {
    const parsed = submission.safeParse(request.body);
    // Never include submitted text in validation errors or logs.
    if (!parsed.success) return reply.code(422).send({ message: "Enter feedback between 1 and 4,000 characters." });
    const { id, message } = parsed.data;
    const pool = getPool();
    const saved = await pool.query(
      `INSERT INTO app_feedback(id,owner_id,username,message)
       SELECT $1,id,NULLIF(display_name,''),$3 FROM app_user WHERE id=$2
       ON CONFLICT (id) DO NOTHING RETURNING id`, [id, request.ownerId, message]);
    if (saved.rowCount) return reply.code(201).send({ saved: true });
    // A lost acknowledgement can be retried without creating duplicate feedback.
    const existing = await pool.query("SELECT id FROM app_feedback WHERE id=$1 AND owner_id=$2 AND message=$3", [id, request.ownerId, message]);
    if (existing.rowCount) return { saved: true };
    return reply.code(409).send({ message: "This submission has changed. Close and reopen feedback to send a new message." });
  });
}
