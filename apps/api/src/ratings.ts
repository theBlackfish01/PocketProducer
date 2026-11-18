import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getPool } from "@pocket/core/api";

const rating = z.object({ vote: z.enum(["up", "down"]).nullable(), reason: z.enum(["Direction", "Arrangement", "Sound choices", "Other"]).nullable(), comment: z.string().trim().max(600) }).strict();
const params = z.object({ projectId: z.uuid(), revisionId: z.uuid() });
const path = "/api/v1/projects/:projectId/native/versions/:revisionId/rating";
const owned = `SELECT r.id FROM native_revision r JOIN project p ON p.id=r.project_id
  WHERE r.id=$1 AND p.id=$2 AND r.owner_id=$3 AND p.owner_id=$3 AND p.deleted_at IS NULL`;

export function registerRatings(app: FastifyInstance) {
  app.get(path, async (request, reply) => {
    const { projectId, revisionId } = params.parse(request.params);
    const result = await getPool().query(`SELECT v.vote,v.reason,v.comment FROM (${owned}) r LEFT JOIN version_rating v ON v.revision_id=r.id`, [revisionId, projectId, request.ownerId]);
    if (!result.rowCount) return reply.code(404).send({ message: "Version unavailable." });
    return { rating: result.rows[0].vote ? result.rows[0] : null };
  });
  app.put(path, { bodyLimit: 4096 }, async (request, reply) => {
    const { projectId, revisionId } = params.parse(request.params);
    const parsed = rating.safeParse(request.body);
    if (!parsed.success) return reply.code(422).send({ message: "Choose a rating and keep your comment under 601 characters." });
    const values = [revisionId, projectId, request.ownerId];
    const { vote, reason, comment } = parsed.data;
    const result = vote
      ? await getPool().query(`INSERT INTO version_rating(revision_id,vote,reason,comment) SELECT id,$4,$5,$6 FROM (${owned}) r
          ON CONFLICT(revision_id) DO UPDATE SET vote=excluded.vote,reason=excluded.reason,comment=excluded.comment,updated_at=now() RETURNING revision_id`, [...values, vote, reason, comment])
      : await getPool().query(`WITH target AS (${owned}), cleared AS (DELETE FROM version_rating USING target WHERE revision_id=target.id) SELECT id FROM target`, values);
    if (!result.rowCount) return reply.code(404).send({ message: "Version unavailable." });
    return { rating: vote ? parsed.data : null };
  });
}
