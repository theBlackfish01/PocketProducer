import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { z } from "zod";
import {
  cancelJob, createJob, createProject, decodeWav, devOwnerId, getConfig, getPool, getProjectSnapshot, getRevision,
  insertAsset, jobSnapshot, listProjects, listRevisions, providerAvailability, requireProject, selectRevision, storeImmutableAudio
} from "@pocket/core";

const config = getConfig();
if (!config.DEV_LOCAL_AUTH) throw new Error("This milestone implements loopback development auth only. Set DEV_LOCAL_AUTH=true locally; production startup is intentionally blocked.");
const app = Fastify({ logger: { level: "info", redact: ["req.headers.authorization", "req.headers.cookie"] }, bodyLimit: config.MAX_UPLOAD_BYTES + 1_024 });
await app.register(cors, { origin: config.APP_ORIGIN, credentials: true });
await app.register(multipart, { limits: { fileSize: config.MAX_UPLOAD_BYTES, files: 1 } });

const idSchema = z.uuid();
const ownerId = await devOwnerId();

app.setErrorHandler((error: unknown, request, reply) => {
  const statusFromError = typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : undefined;
  const statusCode = statusFromError ?? (error instanceof z.ZodError ? 422 : 500);
  const name = error instanceof Error ? error.name : "UnknownError";
  const message = error instanceof Error ? error.message : "Unknown request failure";
  request.log.error({ err: { name, message }, requestId: request.id }, "request failed");
  void reply.status(statusCode).send({ code: statusCode === 500 ? "INTERNAL_ERROR" : "INVALID_REQUEST", message: statusCode === 500 ? "The request could not be completed." : message, requestId: request.id, retryable: statusCode >= 500 });
});

app.get("/api/v1/status", () => ({
  status: "ok",
  environment: config.APP_ENV,
  authMode: "loopback-development",
  providers: providerAvailability(config),
  uploadFormats: ["audio/wav"],
  ffmpeg: false,
  renderer: "deterministic-wav-v1",
  nexus: { sdk: "0.0.17", liveExport: Boolean(config.AUDIOTOOL_CLIENT_ID) }
}));

app.get("/api/v1/projects", async () => ({ projects: await listProjects(ownerId) }));

app.post("/api/v1/projects", async (request, reply) => {
  const body = z.object({ title: z.string().trim().min(1).max(120).default("Untitled session") }).parse(request.body ?? {});
  return reply.status(201).send({ project: await createProject(ownerId, body.title) });
});

app.get("/api/v1/projects/:projectId", async (request) => {
  const { projectId } = z.object({ projectId: idSchema }).parse(request.params);
  return getProjectSnapshot(ownerId, projectId);
});

app.post("/api/v1/projects/:projectId/assets", async (request, reply) => {
  const { projectId } = z.object({ projectId: idSchema }).parse(request.params);
  await requireProject(ownerId, projectId);
  const part = await request.file();
  if (!part) throw Object.assign(new Error("Attach one WAV file"), { statusCode: 422 });
  const buffer = await part.toBuffer();
  const decoded = decodeWav(buffer);
  const stored = await storeImmutableAudio(ownerId, projectId, buffer);
  const id = await insertAsset({ ownerId, projectId, name: part.filename.slice(0, 160), hash: stored.hash, path: stored.path, durationSeconds: decoded.durationSeconds, sampleRate: decoded.sampleRate, channels: decoded.channels.length, provenance: "User supplied in the loopback development session" });
  return reply.status(201).send({ asset: { id, name: part.filename, durationSeconds: decoded.durationSeconds, sampleRate: decoded.sampleRate, channels: decoded.channels.length, readiness: "ready" } });
});

app.get("/api/v1/assets/:assetId/audio", async (request, reply) => {
  const { assetId } = z.object({ assetId: idSchema }).parse(request.params);
  const result = await getPool().query<{ object_path: string }>("SELECT object_path FROM asset WHERE id=$1 AND owner_id=$2 AND readiness='ready'", [assetId, ownerId]);
  const path = result.rows[0]?.object_path;
  if (!path) throw Object.assign(new Error("Asset not found"), { statusCode: 404 });
  const file = await stat(path);
  reply.header("Accept-Ranges", "bytes").header("Content-Type", "audio/wav").header("Content-Length", file.size).header("Cache-Control", "private, max-age=60");
  return reply.send(createReadStream(path));
});

app.post("/api/v1/projects/:projectId/generations", async (request, reply) => {
  const { projectId } = z.object({ projectId: idSchema }).parse(request.params);
  await requireProject(ownerId, projectId);
  const body = z.object({ direction: z.string().trim().min(3).max(1_000), sourceAssetId: idSchema.optional() }).parse(request.body);
  const idempotencyKey = z.string().min(8).max(160).parse(request.headers["idempotency-key"]);
  const job = await createJob({ ownerId, projectId, kind: "generation", idempotencyKey, request: body });
  return reply.status(202).send({ jobId: job.id, duplicate: job.duplicate });
});

app.post("/api/v1/projects/:projectId/revisions", async (request, reply) => {
  const { projectId } = z.object({ projectId: idSchema }).parse(request.params);
  const project = await requireProject(ownerId, projectId);
  const body = z.object({ direction: z.string().trim().min(3).max(1_000), baseRevisionId: idSchema, expectedHeadRevisionId: idSchema, protectedTrackIds: z.array(z.string()).default(["melody"]) }).parse(request.body);
  if (project.currentRevisionId !== body.expectedHeadRevisionId) throw Object.assign(new Error("Current version changed; refresh before revising"), { statusCode: 409 });
  const idempotencyKey = z.string().min(8).max(160).parse(request.headers["idempotency-key"]);
  const job = await createJob({ ownerId, projectId, kind: "revision", idempotencyKey, request: body, baseRevisionId: body.baseRevisionId, expectedHeadRevisionId: body.expectedHeadRevisionId });
  return reply.status(202).send({ jobId: job.id, duplicate: job.duplicate });
});

app.get("/api/v1/jobs/:jobId", async (request) => {
  const { jobId } = z.object({ jobId: idSchema }).parse(request.params);
  return jobSnapshot(ownerId, jobId);
});

app.post("/api/v1/jobs/:jobId/cancel", async (request, reply) => {
  const { jobId } = z.object({ jobId: idSchema }).parse(request.params);
  await cancelJob(ownerId, jobId);
  return reply.status(202).send({ jobId, cancellationRequested: true });
});

app.get("/api/v1/projects/:projectId/versions", async (request) => {
  const { projectId } = z.object({ projectId: idSchema }).parse(request.params);
  await requireProject(ownerId, projectId);
  return { versions: await listRevisions(ownerId, projectId) };
});

app.post("/api/v1/projects/:projectId/select-version", async (request) => {
  const { projectId } = z.object({ projectId: idSchema }).parse(request.params);
  const body = z.object({ revisionId: idSchema, expectedHeadRevisionId: idSchema.nullable() }).parse(request.body);
  await selectRevision(ownerId, projectId, body.revisionId, body.expectedHeadRevisionId);
  return { selectedRevisionId: body.revisionId };
});

app.get("/api/v1/revisions/:revisionId/audio", async (request, reply) => {
  const { revisionId } = z.object({ revisionId: idSchema }).parse(request.params);
  const revision = await getRevision(ownerId, revisionId);
  const path = String(revision.preview_path);
  const file = await stat(path);
  const range = request.headers.range;
  reply.header("Accept-Ranges", "bytes").header("Content-Type", "audio/wav").header("Cache-Control", "private, max-age=60");
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match) return reply.status(416).send();
    const start = Number(match[1]);
    const end = match[2] ? Math.min(Number(match[2]), file.size - 1) : file.size - 1;
    if (start > end || start >= file.size) return reply.status(416).send();
    reply.status(206).header("Content-Range", `bytes ${start}-${end}/${file.size}`).header("Content-Length", end - start + 1);
    return reply.send(createReadStream(path, { start, end }));
  }
  reply.header("Content-Length", file.size);
  return reply.send(createReadStream(path));
});

app.post("/api/v1/revisions/:revisionId/exports", async (request, reply) => {
  const { revisionId } = z.object({ revisionId: idSchema }).parse(request.params);
  const revision = await getRevision(ownerId, revisionId);
  const idempotencyKey = z.string().min(8).max(160).parse(request.headers["idempotency-key"]);
  const job = await createJob({ ownerId, projectId: String(revision.project_id), kind: "export", idempotencyKey, request: { revisionId }, baseRevisionId: revisionId, expectedHeadRevisionId: revisionId });
  return reply.status(202).send({ jobId: job.id, duplicate: job.duplicate });
});

app.get("/api/v1/exports/:revisionId", async (request) => {
  const { revisionId } = z.object({ revisionId: idSchema }).parse(request.params);
  await getRevision(ownerId, revisionId);
  const result = await getPool().query("SELECT id,state,fidelity,remote_url,error_message,updated_at FROM project_export WHERE owner_id=$1 AND revision_id=$2", [ownerId, revisionId]);
  return { export: result.rows[0] ?? null };
});

await app.listen({ host: "127.0.0.1", port: config.API_PORT });
