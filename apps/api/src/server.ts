import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { z } from "zod";
import { registerAuth } from "./auth.js";
import { registerWeb } from "./web.js";
import { registerActivityRoutes } from "./activity-stream.js";
import { assistMusicalPrompt, byteRange, issue, clearConnectedProfile, connectedAudiotoolProfile, fundedProducerModels, selectableProducerModelSchema as producerModelSchema, type OAuthFetch } from "@pocket/core";
import {
  audiotoolSessionStatus, cancelJob, createAudiotoolServerClient, createNativeLibrary, createProject, decodeWav, encodeWav, deleteAudiotoolSession, getConfig, getPool, getProjectSnapshot,
  abandonNativePartialJob, createNativeJob, discoverNativeCapabilities, extendNativePartialJob, findCommandJob, getNativeRevision, insertAsset, inspectNativeCapability, jobSnapshot, listNativeSoundFeedback, listProjects, nativeDraftView, nativePresetRecipes, nativeSnapshot, providerAvailability, readNativeRecipe, requireProject, interpretNativeDirection, resumeNativePartialJob, safeStoragePath, saveAudiotoolSession, saveNativeSoundFeedback, selectNativeRevision, storeImmutableAudio
} from "@pocket/core";

export async function createApi(oauthTransport?: OAuthFetch) {
const config = getConfig();

const app = Fastify({ logger: { level: "info", redact: ["req.headers.authorization", "req.headers.cookie"], serializers: { req: (request: { method: string; url: string }) => ({ method: request.method, url: request.url.split("?")[0] ?? "" }) } }, bodyLimit: config.MAX_UPLOAD_BYTES + 1_024 });
await app.register(cors, { origin: config.APP_ORIGIN, credentials: true });
await app.register(multipart, { limits: { fileSize: config.MAX_UPLOAD_BYTES, files: 1 } });

const idSchema = z.uuid();
await registerAuth(app, oauthTransport);
registerActivityRoutes(app, config.APP_ORIGIN);

app.setErrorHandler((error: unknown, request, reply) => {
  const statusFromError = typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : undefined;
  const statusCode = statusFromError ?? (error instanceof z.ZodError ? 422 : 500);
  const name = error instanceof Error ? error.name : "UnknownError";
  const message = error instanceof Error ? error.message : "Unknown request failure";
  const code = statusCode !== 500 && typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : null;
  request.log.error({ err: { name, message }, requestId: request.id }, "request failed");
  void reply.status(statusCode).send({ code: statusCode === 500 ? "INTERNAL_ERROR" : code ?? "INVALID_REQUEST", message: statusCode === 500 ? "The request could not be completed." : message, requestId: request.id, retryable: statusCode >= 500 });
});

app.get("/api/v1/status", async (request) => {
  const session = await audiotoolSessionStatus(request.ownerId);
  return {
    status: "ok",
    environment: config.APP_ENV,
    authMode: config.DEV_LOCAL_AUTH ? "loopback-development" : `${config.HOSTED_AUTH_MODE}-session`,
    providers: providerAvailability(config),
    capabilities: {
      producer: "openai-deep-agent-with-fixture-fallback",
      nativeConstruction: "audio-independent-validated-native-v1",
      audioAnalysis: providerAvailability(config).gemini ? "configured" : "unavailable",
      audiotoolExport: !config.AUDIOTOOL_CLIENT_ID ? "unconfigured" : session.connected ? "authorized-not-live-verified" : "awaiting-user-authorization"
    },
    uploadFormats: ["audio/wav"],
    ffmpeg: false,
    nativePlayback: "deferred",
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
  if (!config.DEV_LOCAL_AUTH && config.HOSTED_AUTH_MODE === "audiotool") return reply.code(403).send({ message: "Reconnect using Sign in with Audiotool." });
  if (!config.AUDIOTOOL_CLIENT_ID) throw Object.assign(new Error("Audiotool app registration is not configured"), { statusCode: 409 });
  if (request.headers.origin !== config.APP_ORIGIN) throw Object.assign(new Error("Audiotool session handoff requires the configured application origin"), { statusCode: 403 });
  const body = z.object({
    userName: z.string().trim().min(1).max(160),
    tokens: z.object({ accessToken: z.string().min(16).max(16_384), refreshToken: z.string().max(16_384).refine((value) => value === "" || value.length >= 16), expiresAt: z.number().int().positive() })
  }).parse(request.body);
  await saveAudiotoolSession(request.ownerId, body.userName, body.tokens);
  clearConnectedProfile(request.ownerId);
  return reply.status(204).send();
});

app.delete("/api/v1/integrations/audiotool/session", async (request, reply) => {
  if (request.headers.origin !== config.APP_ORIGIN) throw Object.assign(new Error("Audiotool disconnect requires the configured application origin"), { statusCode: 403 });
  await deleteAudiotoolSession(request.ownerId);
  clearConnectedProfile(request.ownerId);
  return reply.status(204).send();
});

app.get("/api/v1/projects", async (request) => ({ projects: await listProjects(request.ownerId) }));
app.get("/api/v1/producer-models", (request) => fundedProducerModels(request.ownerId));
app.get("/api/v1/integrations/audiotool/profile", async (request) => ({ profile: await connectedAudiotoolProfile(request.ownerId) }));

app.post("/api/v1/projects/:projectId/prompt-assistance", async (request) => {
  if (request.headers.origin !== config.APP_ORIGIN) throw Object.assign(new Error("Prompt assistance requires the configured origin"), { statusCode: 403 });
  const { projectId } = z.object({ projectId: idSchema }).parse(request.params);
  const key = idSchema.parse(request.headers["idempotency-key"]);
  return assistMusicalPrompt(request.ownerId, projectId, key, request.body);
});

app.post("/api/v1/projects", async (request, reply) => {
  const body = z.object({ title: z.string().trim().min(1).max(120).default("Untitled session") }).parse(request.body ?? {});
  return reply.status(201).send({ project: await createProject(request.ownerId, body.title) });
});

app.get("/api/v1/projects/:projectId", async (request) => {
  const { projectId } = z.object({ projectId: idSchema }).parse(request.params);
  return getProjectSnapshot(request.ownerId, projectId);
});

app.get("/api/v1/native/capabilities", async (request) => {
  const { query, limit } = z.object({ query: z.string().max(80).default(""), limit: z.coerce.number().int().min(1).max(64).default(24) }).parse(request.query);
  return discoverNativeCapabilities(query, limit);
});

app.get("/api/v1/native/capability", async (request) => {
  const { path } = z.object({ path: z.string().max(160) }).parse(request.query);
  return inspectNativeCapability(path);
});

app.get("/api/v1/native/sound-recipes", () => ({ version: "local-palette-v2", recipes: nativePresetRecipes.map((recipe) => readNativeRecipe(recipe.id)) }));

app.get("/api/v1/native/library/samples", async (request) => {
  const { query, pageToken, kind, minBpm, maxBpm } = z.object({ query: z.string().trim().min(1).max(80), pageToken: z.string().max(500).optional(), kind: z.enum(["one-shot", "loop"]).optional(), minBpm: z.coerce.number().min(0).max(400).optional(), maxBpm: z.coerce.number().min(0).max(400).optional() }).parse(request.query);
  if (!providerAvailability(config).audiotool || !config.AUDIOTOOL_CLIENT_ID) throw Object.assign(new Error("Audiotool library is unavailable in this local mode"), { statusCode: 409 });
  const connection = await createAudiotoolServerClient(request.ownerId, config.AUDIOTOOL_CLIENT_ID);
  if (!connection) throw Object.assign(new Error("Connect Audiotool before searching its sound library"), { statusCode: 409 });
  try { return await createNativeLibrary(connection.client).searchSamples(query, pageToken, { kind, minBpm, maxBpm }); }
  finally { await connection.awaitTokenPersistence(); }
});

app.get("/api/v1/native/library/sample-analysis", async (request) => {
  const { name } = z.object({ name: z.string().regex(/^samples\/[a-zA-Z0-9-]{1,120}$/) }).parse(request.query);
  if (!providerAvailability(config).audiotool || !config.AUDIOTOOL_CLIENT_ID) throw Object.assign(new Error("Audiotool library is unavailable in this local mode"), { statusCode: 409 });
  const connection = await createAudiotoolServerClient(request.ownerId, config.AUDIOTOOL_CLIENT_ID);
  if (!connection) throw Object.assign(new Error("Connect Audiotool before inspecting sample audio"), { statusCode: 409 });
  try { return await createNativeLibrary(connection.client).inspectSampleAudio(name); }
  finally { await connection.awaitTokenPersistence(); }
});

app.get("/api/v1/native/library/sample-audio", async (request, reply) => {
  const { name, expectedHash } = z.object({ name: z.string().regex(/^samples\/[a-zA-Z0-9-]{1,120}$/), expectedHash: z.string().regex(/^[a-f0-9]{64}$/) }).parse(request.query);
  if (!providerAvailability(config).audiotool || !config.AUDIOTOOL_CLIENT_ID) throw Object.assign(new Error("Audiotool library is unavailable in this local mode"), { statusCode: 409 });
  const connection = await createAudiotoolServerClient(request.ownerId, config.AUDIOTOOL_CLIENT_ID);
  if (!connection) throw Object.assign(new Error("Connect Audiotool before auditioning a sample"), { statusCode: 409 });
  try {
    const selected = await createNativeLibrary(connection.client).readSampleAudio(name);
    if (selected.contentHash !== expectedHash) throw Object.assign(new Error("The sample changed since inspection. Inspect it again before listening."), { statusCode: 409 });
    const decoded = decodeWav(selected.bytes, { maxDurationSeconds: 30 });
    const left = decoded.channels[0]!;
    const playable = encodeWav(left, decoded.channels[1] ?? left, decoded.sampleRate);
    return await reply.header("Content-Type", "audio/wav").header("Content-Length", playable.length).header("Cache-Control", "private, no-store").header("X-Content-Type-Options", "nosniff").send(playable);
  } finally { await connection.awaitTokenPersistence(); }
});

app.get("/api/v1/projects/:projectId/native/sound-feedback", async (request) => {
  const { projectId } = z.object({ projectId: idSchema }).parse(request.params);
  await requireProject(request.ownerId, projectId);
  return { feedback: await listNativeSoundFeedback(request.ownerId, projectId) };
});

app.post("/api/v1/projects/:projectId/native/sound-feedback", async (request, reply) => {
  const { projectId } = z.object({ projectId: idSchema }).parse(request.params);
  return reply.status(201).send({ feedback: await saveNativeSoundFeedback(request.ownerId, projectId, request.body) });
});

app.get("/api/v1/native/library/presets", async (request) => {
  const { deviceType, query } = z.object({ deviceType: z.enum(["heisenberg", "pulverisateur", "gakki", "beatbox8"]), query: z.string().max(80).default("") }).parse(request.query);
  if (!providerAvailability(config).audiotool || !config.AUDIOTOOL_CLIENT_ID) throw Object.assign(new Error("Audiotool library is unavailable in this local mode"), { statusCode: 409 });
  const connection = await createAudiotoolServerClient(request.ownerId, config.AUDIOTOOL_CLIENT_ID);
  if (!connection) throw Object.assign(new Error("Connect Audiotool before searching its sound library"), { statusCode: 409 });
  try { return await createNativeLibrary(connection.client).searchPresets(deviceType, query); }
  finally { await connection.awaitTokenPersistence(); }
});

app.get("/api/v1/projects/:projectId/native", async (request) => {
  const { projectId } = z.object({ projectId: idSchema }).parse(request.params);
  return nativeSnapshot(request.ownerId, projectId);
});

// A small paid check at submit time: the direction's explicit requirements are
// read once, validated against the selected version and captured for the job.
app.post("/api/v1/projects/:projectId/native/interpretations", async (request) => {
  if (request.headers.origin !== config.APP_ORIGIN) throw Object.assign(new Error("Direction checks require the configured origin"), { statusCode: 403 });
  const { projectId } = z.object({ projectId: idSchema }).parse(request.params);
  const key = idSchema.parse(request.headers["idempotency-key"]);
  return interpretNativeDirection(request.ownerId, projectId, key, request.body);
});

app.get("/api/v1/projects/:projectId/native/requests/:jobId/draft", async (request) => {
  const { projectId, jobId } = z.object({ projectId: idSchema, jobId: idSchema }).parse(request.params);
  return nativeDraftView(request.ownerId, projectId, jobId);
});

app.post("/api/v1/projects/:projectId/native/constructions", async (request, reply) => {
  const { projectId } = z.object({ projectId: idSchema }).parse(request.params);
  const body = z.object({ direction: z.string().trim().min(3).max(32_768), model: producerModelSchema.optional(), profile: z.enum(["standard", "extended"]).default("standard"), sourceAssetIds: z.array(idSchema).max(24).default([]), expectedNativeHeadId: z.null(), interpretationId: idSchema.optional() }).parse(request.body);
  const idempotencyKey = z.string().min(8).max(160).parse(request.headers["idempotency-key"]);
  const job = await createNativeJob({ ownerId: request.ownerId, projectId, kind: "native-generation", idempotencyKey, request: body, expectedHeadId: null, defaultModel: "gpt-6-luna" });
  return reply.status(202).send({ jobId: job.id, duplicate: job.duplicate });
});

app.post("/api/v1/projects/:projectId/native/revisions", async (request, reply) => {
  const { projectId } = z.object({ projectId: idSchema }).parse(request.params);
  const partId = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
  const body = z.object({ direction: z.string().trim().min(3).max(32_768), model: producerModelSchema.optional(), profile: z.enum(["standard", "extended"]).default("standard"), baseNativeRevisionId: idSchema, expectedNativeHeadId: idSchema, targetPartId: partId.optional(), targetSectionId: partId.optional(), protectedPartIds: z.array(partId).max(24).optional(), protectionChange: z.object({ expectedPartIds: z.array(partId).max(24), desiredPartIds: z.array(partId).max(24) }).optional(), sourceAssetIds: z.array(idSchema).max(24).default([]), interpretationId: idSchema.optional() }).parse(request.body);
  if (body.baseNativeRevisionId !== body.expectedNativeHeadId) throw issue("HEAD_CHANGED", "Revise the currently selected native version; restore an older one first", 409);
  const idempotencyKey = z.string().min(8).max(160).parse(request.headers["idempotency-key"]);
  const job = await createNativeJob({ ownerId: request.ownerId, projectId, kind: "native-revision", idempotencyKey, request: body, expectedHeadId: body.expectedNativeHeadId, defaultModel: "gpt-6-luna" });
  return reply.status(202).send({ jobId: job.id, duplicate: job.duplicate });
});

app.post("/api/v1/projects/:projectId/native/requests/:jobId/abandon", async (request) => {
  const { projectId, jobId } = z.object({ projectId: idSchema, jobId: idSchema }).parse(request.params);
  await abandonNativePartialJob(request.ownerId, projectId, jobId);
  return { jobId, abandoned: true };
});

app.post("/api/v1/projects/:projectId/native/requests/:jobId/continue", async (request, reply) => {
  const { projectId, jobId } = z.object({ projectId: idSchema, jobId: idSchema }).parse(request.params);
  await resumeNativePartialJob(request.ownerId, projectId, jobId);
  return reply.status(202).send({ jobId });
});

app.post("/api/v1/projects/:projectId/native/requests/:jobId/extend", async (request) => {
  const { projectId, jobId } = z.object({ projectId: idSchema, jobId: idSchema }).parse(request.params);
  const limits = z.object({ maxCalls: z.number().int().min(1).optional(), maxInputTokens: z.number().int().min(1_000).optional(), maxOutputTokens: z.number().int().min(400).optional(), deadlineSeconds: z.number().int().min(10).optional(), maxJobCostUsd: z.number().min(0).optional() }).strict().parse(request.body ?? {});
  await extendNativePartialJob(request.ownerId, projectId, jobId, Object.keys(limits).length ? limits : undefined);
  return { jobId, extended: true };
});

app.post("/api/v1/projects/:projectId/native/select-version", async (request) => {
  const { projectId } = z.object({ projectId: idSchema }).parse(request.params);
  const body = z.object({ revisionId: idSchema, expectedNativeHeadId: idSchema }).parse(request.body);
  await selectNativeRevision(request.ownerId, projectId, body.revisionId, body.expectedNativeHeadId);
  return { selectedRevisionId: body.revisionId, synchronization: "local" };
});

app.post("/api/v1/projects/:projectId/native/synchronizations", async (request, reply) => {
  if (!providerAvailability(config).audiotool) throw Object.assign(new Error("Native synchronization is unavailable in fixture mode or without Audiotool configuration"), { statusCode: 409 });
  const { projectId } = z.object({ projectId: idSchema }).parse(request.params);
  const body = z.object({ baseNativeRevisionId: idSchema, expectedNativeHeadId: idSchema }).parse(request.body);
  if (body.baseNativeRevisionId !== body.expectedNativeHeadId) throw Object.assign(new Error("Synchronize the selected native version"), { statusCode: 409 });
  await getNativeRevision(request.ownerId, projectId, body.baseNativeRevisionId);
  const idempotencyKey = z.string().min(8).max(160).parse(request.headers["idempotency-key"]);
  const job = await createNativeJob({ ownerId: request.ownerId, projectId, kind: "native-sync", idempotencyKey, request: body, expectedHeadId: body.expectedNativeHeadId });
  return reply.status(202).send({ jobId: job.id, duplicate: job.duplicate });
});

app.post("/api/v1/projects/:projectId/assets", async (request, reply) => {
  const { projectId } = z.object({ projectId: idSchema }).parse(request.params);
  await requireProject(request.ownerId, projectId);
  const part = await request.file();
  if (!part) throw Object.assign(new Error("Attach one WAV file"), { statusCode: 422 });
  if (!new Set(["audio/wav", "audio/x-wav", "audio/wave"]).has(part.mimetype)) throw Object.assign(new Error("Only WAV uploads are supported in this milestone"), { statusCode: 415 });
  const buffer = await part.toBuffer();
  const decoded = decodeWav(buffer, { maxDurationSeconds: config.MAX_SOURCE_SECONDS });
  const stored = await storeImmutableAudio(request.ownerId, projectId, buffer);
  const id = await insertAsset({ ownerId: request.ownerId, projectId, name: part.filename.slice(0, 160), hash: stored.hash, path: stored.path, durationSeconds: decoded.durationSeconds, sampleRate: decoded.sampleRate, channels: decoded.channels.length, provenance: "User supplied in their private workspace" });
  return reply.status(201).send({ asset: { id, name: part.filename, durationSeconds: decoded.durationSeconds, sampleRate: decoded.sampleRate, channels: decoded.channels.length, readiness: "ready" } });
});

app.get("/api/v1/assets/:assetId/audio", async (request, reply) => {
  const { assetId } = z.object({ assetId: idSchema }).parse(request.params);
  const result = await getPool().query<{ object_path: string }>("SELECT a.object_path FROM asset a JOIN project p ON p.id=a.project_id WHERE a.id=$1 AND a.owner_id=$2 AND p.owner_id=$2 AND p.deleted_at IS NULL AND a.kind='source' AND a.readiness='ready'", [assetId, request.ownerId]);
  const storedPath = result.rows[0]?.object_path;
  if (!storedPath) throw Object.assign(new Error("Asset not found"), { statusCode: 404 });
  const path = safeStoragePath(storedPath);
  const file = await stat(path);
  // A shared browser must not replay a previous owner's audio from its HTTP
  // cache after sign-out/account switch. Development keeps its local cache.
  reply.header("Accept-Ranges", "bytes").header("Content-Type", "audio/wav").header("Cache-Control", config.DEV_LOCAL_AUTH ? "private, max-age=60" : "private, no-store");
  const range = byteRange(request.headers.range, file.size);
  if (range === "invalid") return reply.status(416).header("Content-Range", `bytes */${file.size}`).send();
  if (range) {
    reply.status(206).header("Content-Range", `bytes ${range.start}-${range.end}/${file.size}`).header("Content-Length", range.end - range.start + 1);
    return reply.send(createReadStream(path, range));
  }
  reply.header("Content-Length", file.size);
  return reply.send(createReadStream(path));
});

app.get("/api/v1/jobs/:jobId", async (request) => {
  const { jobId } = z.object({ jobId: idSchema }).parse(request.params);
  return jobSnapshot(request.ownerId, jobId);
});

app.get("/api/v1/projects/:projectId/commands/:operation/:idempotencyKey", async (request) => {
  const params = z.object({
    projectId: idSchema,
    operation: z.enum(["native-generation", "native-revision", "native-sync"]),
    idempotencyKey: z.string().min(8).max(160)
  }).parse(request.params);
  await requireProject(request.ownerId, params.projectId);
  return { job: await findCommandJob(request.ownerId, params.projectId, params.operation, params.idempotencyKey) };
});

app.post("/api/v1/jobs/:jobId/cancel", async (request, reply) => {
  const { jobId } = z.object({ jobId: idSchema }).parse(request.params);
  await cancelJob(request.ownerId, jobId);
  const snapshot = await jobSnapshot(request.ownerId, jobId);
  return reply.status(snapshot.state === "cancelled" ? 200 : 202).send({ jobId, state: snapshot.state });
});

if (config.APP_ENV === "test") {
  app.post("/api/v1/test/shutdown", async (_request, reply) => {
    await reply.status(202).send({ status: "stopping" });
    setImmediate(() => { void app.close().finally(() => process.exit(0)); });
  });
}

app.get("/healthz", async (_request, reply) => {
  try { await getPool().query("SELECT 1"); return { status: "ok" }; }
  catch { return reply.code(503).send({ status: "unavailable" }); }
});
if (config.SERVE_WEB) await registerWeb(app);
return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
const config = getConfig(), app = await createApi();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { void app.close().then(() => process.exit(0)); });
await app.listen({ host: config.APP_ENV === "production" ? "0.0.0.0" : "127.0.0.1", port: config.PORT ?? config.API_PORT });
}
