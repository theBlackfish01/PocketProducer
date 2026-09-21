import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { z } from "zod";
import {
  audiotoolSessionStatus, cancelJob, createJob, createProject, decodeWav, deleteAudiotoolSession, devOwnerId, getConfig, getPool, getProjectSnapshot, getRevision,
  findCommandJob, insertAsset, jobSnapshot, listProjects, listRevisions, providerAvailability, requireProject, saveAudiotoolSession, selectRevision, storeImmutableAudio
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

app.get("/api/v1/status", async () => {
  const session = await audiotoolSessionStatus(ownerId);
  return {
    status: "ok",
    environment: config.APP_ENV,
    authMode: "loopback-development",
    providers: providerAvailability(config),
    capabilities: {
      producer: "openai-deep-agent-with-fixture-fallback",
      audioAnalysis: providerAvailability(config).gemini ? "configured" : "unavailable",
      audiotoolExport: !config.AUDIOTOOL_CLIENT_ID ? "unconfigured" : session.connected ? "authorized-not-live-verified" : "awaiting-user-authorization"
    },
    uploadFormats: ["audio/wav"],
    ffmpeg: false,
    renderer: "deterministic-wav-v1",
    nexus: {
      sdk: "0.0.17",
      liveExportVerified: false,
      connection: !config.AUDIOTOOL_CLIENT_ID ? "unconfigured" : session.connected ? "authorized" : "awaiting-authorization",
      oauth: config.AUDIOTOOL_CLIENT_ID ? { clientId: config.AUDIOTOOL_CLIENT_ID, redirectUrl: config.AUDIOTOOL_REDIRECT_URL, scope: config.AUDIOTOOL_SCOPES } : null,
      session
    }
  };
});

app.post("/api/v1/integrations/audiotool/session", async (request, reply) => {
  if (!config.AUDIOTOOL_CLIENT_ID) throw Object.assign(new Error("Audiotool app registration is not configured"), { statusCode: 409 });
  if (request.headers.origin !== config.APP_ORIGIN) throw Object.assign(new Error("Audiotool session handoff requires the configured loopback origin"), { statusCode: 403 });
  const body = z.object({
    userName: z.string().trim().min(1).max(160),
    tokens: z.object({ accessToken: z.string().min(16).max(16_384), refreshToken: z.string().min(16).max(16_384), expiresAt: z.number().int().positive() })
  }).parse(request.body);
  await saveAudiotoolSession(ownerId, body.userName, body.tokens);
  return reply.status(204).send();
});

app.delete("/api/v1/integrations/audiotool/session", async (request, reply) => {
  if (request.headers.origin !== config.APP_ORIGIN) throw Object.assign(new Error("Audiotool disconnect requires the configured loopback origin"), { statusCode: 403 });
  await deleteAudiotoolSession(ownerId);
  return reply.status(204).send();
});

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
  if (!new Set(["audio/wav", "audio/x-wav", "audio/wave"]).has(part.mimetype)) throw Object.assign(new Error("Only WAV uploads are supported in this milestone"), { statusCode: 415 });
  const buffer = await part.toBuffer();
  const decoded = decodeWav(buffer, { maxDurationSeconds: config.MAX_SOURCE_SECONDS });
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
  const body = z.object({
    direction: z.string().trim().min(3).max(1_000),
    baseRevisionId: idSchema,
    expectedHeadRevisionId: idSchema,
    protectedTrackIds: z.tuple([z.literal("melody")]).default(["melody"]),
    sectionId: z.literal("groove").default("groove")
  }).parse(request.body);
  if (!/drum/i.test(body.direction) || !/simpl|less|space|restrain/i.test(body.direction)) {
    throw Object.assign(new Error("This version supports only simplifying drums in Groove while protecting the melody"), { statusCode: 422 });
  }
  const idempotencyKey = z.string().min(8).max(160).parse(request.headers["idempotency-key"]);
  const job = await createJob({ ownerId, projectId, kind: "revision", idempotencyKey, request: body, baseRevisionId: body.baseRevisionId, expectedHeadRevisionId: body.expectedHeadRevisionId });
  return reply.status(202).send({ jobId: job.id, duplicate: job.duplicate });
});

app.get("/api/v1/jobs/:jobId", async (request) => {
  const { jobId } = z.object({ jobId: idSchema }).parse(request.params);
  return jobSnapshot(ownerId, jobId);
});

app.get("/api/v1/projects/:projectId/commands/:operation/:idempotencyKey", async (request) => {
  const params = z.object({
    projectId: idSchema,
    operation: z.enum(["generation", "revision", "export"]),
    idempotencyKey: z.string().min(8).max(160)
  }).parse(request.params);
  await requireProject(ownerId, params.projectId);
  return { job: await findCommandJob(ownerId, params.projectId, params.operation, params.idempotencyKey) };
});

app.post("/api/v1/jobs/:jobId/reconcile", async (request) => {
  const { jobId } = z.object({ jobId: idSchema }).parse(request.params);
  const job = await jobSnapshot(ownerId, jobId);
  const result = await getPool().query(
    "SELECT state,remote_url,error_message FROM project_export WHERE owner_id=$1 AND job_id=$2",
    [ownerId, jobId]
  );
  return { job, export: result.rows[0] ?? null };
});

app.post("/api/v1/jobs/:jobId/cancel", async (request, reply) => {
  const { jobId } = z.object({ jobId: idSchema }).parse(request.params);
  await cancelJob(ownerId, jobId);
  const snapshot = await jobSnapshot(ownerId, jobId);
  return reply.status(snapshot.state === "cancelled" ? 200 : 202).send({ jobId, state: snapshot.state });
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

if (config.APP_ENV === "test") {
  app.post("/api/v1/test/shutdown", async (_request, reply) => {
    await reply.status(202).send({ status: "stopping" });
    setImmediate(() => { void app.close().finally(() => process.exit(0)); });
  });
}

await app.listen({ host: "127.0.0.1", port: config.API_PORT });
