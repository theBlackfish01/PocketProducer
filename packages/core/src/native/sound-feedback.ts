import { z } from "zod";
import { getPool } from "../db/pool.js";

export const nativeSoundFeedbackInput = z.object({ sampleName: z.string().regex(/^samples\/[a-zA-Z0-9-]{1,120}$/), contentHash: z.string().regex(/^[a-f0-9]{64}$/), rating: z.enum(["fits", "not-for-this"]), note: z.string().trim().max(240) });
export type NativeSoundFeedback = z.infer<typeof nativeSoundFeedbackInput> & { updatedAt: string };

export async function saveNativeSoundFeedback(ownerId: string, projectId: string, raw: unknown): Promise<NativeSoundFeedback> {
  const input = nativeSoundFeedbackInput.parse(raw);
  const result = await getPool().query<{ sample_name: string; content_hash: string; rating: "fits" | "not-for-this"; note: string; updated_at: Date }>(
    `INSERT INTO native_sound_feedback(owner_id,project_id,sample_name,content_hash,rating,note)
     SELECT $1,$2,$3,$4,$5,$6 FROM project WHERE id=$2 AND owner_id=$1 AND deleted_at IS NULL
     ON CONFLICT(owner_id,project_id,sample_name,content_hash) DO UPDATE SET rating=EXCLUDED.rating,note=EXCLUDED.note,updated_at=now()
     RETURNING sample_name,content_hash,rating,note,updated_at`,
    [ownerId, projectId, input.sampleName, input.contentHash, input.rating, input.note]
  );
  const row = result.rows[0];
  if (!row) throw Object.assign(new Error("Project not found"), { statusCode: 404 });
  return { sampleName: row.sample_name, contentHash: row.content_hash, rating: row.rating, note: row.note, updatedAt: row.updated_at.toISOString() };
}

export async function listNativeSoundFeedback(ownerId: string, projectId: string): Promise<NativeSoundFeedback[]> {
  const result = await getPool().query<{ sample_name: string; content_hash: string; rating: "fits" | "not-for-this"; note: string; updated_at: Date }>(
    "SELECT sample_name,content_hash,rating,note,updated_at FROM native_sound_feedback WHERE owner_id=$1 AND project_id=$2 ORDER BY updated_at DESC LIMIT 24", [ownerId, projectId]
  );
  return result.rows.map((row) => ({ sampleName: row.sample_name, contentHash: row.content_hash, rating: row.rating, note: row.note, updatedAt: row.updated_at.toISOString() }));
}
