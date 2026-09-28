import type { FastifyInstance, FastifyRequest } from "fastify";
import { devOwnerId, getConfig, hostedIdentity, endHostedSession, startHostedSession, sessionSeconds, beginAudiotoolSignIn, finishAudiotoolSignIn, throttleHostedWrite, type OAuthFetch } from "@pocket/core";
import { z } from "zod";

declare module "fastify" { interface FastifyRequest { ownerId: string } }
const cookieName = () => getConfig().APP_ENV === "production" ? "__Host-pocket-session" : "pocket-session";
function token(request: FastifyRequest, name = cookieName()) {
  const matches = (request.headers.cookie ?? "").split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  return matches.length === 1 ? matches[0]!.slice(name.length + 1) : undefined;
}
function cookie(value: string, seconds: number, name = cookieName()) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${getConfig().APP_ENV === "production" ? "; Secure" : ""}`;
}
export async function stillAuthenticated(request: FastifyRequest) {
  return getConfig().DEV_LOCAL_AUTH || (await hostedIdentity(token(request)))?.ownerId === request.ownerId;
}
export async function registerAuth(app: FastifyInstance, oauthTransport?: OAuthFetch) {
  const config = getConfig();
  const localOwner = config.DEV_LOCAL_AUTH ? await devOwnerId() : null;
  const oauth = !localOwner && config.HOSTED_AUTH_MODE === "audiotool";
  const oauthCookie = `${cookieName()}-oauth`;
  app.decorateRequest("ownerId", "");
  app.addHook("onRequest", async (request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff").header("Referrer-Policy", "no-referrer").header("X-Frame-Options", "DENY");
    if (config.APP_ENV === "production") reply.header("Strict-Transport-Security", "max-age=31536000");
    const path = request.url.split("?")[0]!;
    if (path === "/auth/audiotool/callback") reply.header("Cache-Control", "no-store");
    if (!path.startsWith("/api/")) return;
    if (config.APP_ENV === "test" && path === "/api/v1/test/shutdown") return;
    reply.header("Cache-Control", "no-store");
    if (!localOwner && !["GET", "HEAD", "OPTIONS"].includes(request.method) && request.headers.origin !== config.APP_ORIGIN) {
      return reply.code(403).send({ message: "This action must come from Pocket Producer." });
    }
    if (["/api/v1/auth/session", "/api/v1/auth/login", "/api/v1/auth/logout", "/api/v1/auth/audiotool/start"].includes(path)) return;
    const identity = localOwner ? { ownerId: localOwner } : await hostedIdentity(token(request));
    if (!identity) return reply.code(401).send({ message: "Sign in to continue." });
    request.ownerId = identity.ownerId;
    // Admission throttling must never prevent stopping spend. Ownership and
    // same-origin checks still apply to these existing safety actions.
    const stopping = request.method === "POST" && (/^\/api\/v1\/jobs\/[a-f0-9-]{36}\/cancel$/.test(path)
      || /^\/api\/v1\/projects\/[a-f0-9-]{36}\/native\/requests\/[a-f0-9-]{36}\/abandon$/.test(path));
    if (!localOwner && !stopping && !["GET", "HEAD", "OPTIONS"].includes(request.method)) await throttleHostedWrite(identity.ownerId);
  });
  app.get("/api/v1/auth/session", async (request) => ({
    mode: localOwner ? "development" : config.HOSTED_AUTH_MODE,
    user: localOwner ? { ownerId: localOwner, displayName: "Local listener" } : await hostedIdentity(token(request))
  }));
  app.post("/api/v1/auth/login", { bodyLimit: 1024 }, async (request, reply) => {
    if (oauth) return reply.code(404).send({ message: "Use Sign in with Audiotool." });
    if (localOwner) return reply.code(409).send({ message: "Local development does not require sign-in." });
    const { code } = z.object({ code: z.string().trim().max(128) }).parse(request.body);
    const session = await startHostedSession(code);
    if (!session) return reply.code(401).send({ message: "That access code is invalid or expired." });
    return reply.header("Set-Cookie", cookie(session.token, sessionSeconds)).send({ signedIn: true });
  });
  app.post("/api/v1/auth/logout", async (request, reply) => {
    await endHostedSession(token(request));
    return reply.header("Set-Cookie", [cookie("", 0), cookie("", 0, oauthCookie)]).send({ signedOut: true });
  });
  app.post("/api/v1/auth/audiotool/start", { bodyLimit: 1024 }, async (request, reply) => {
    if (!oauth) return reply.code(404).send({ message: "Audiotool sign-in is not enabled." });
    const identity = await hostedIdentity(token(request));
    const { returnPath } = z.object({ returnPath: z.string().max(200).optional() }).parse(request.body ?? {});
    const start = await beginAudiotoolSignIn(returnPath, identity?.ownerId);
    return reply.header("Set-Cookie", cookie(start.verifier, 600, oauthCookie)).send({ url: start.url });
  });
  if (oauth) app.get("/auth/audiotool/callback", async (request, reply) => {
    try {
      const session = await finishAudiotoolSignIn(request.query, token(request, oauthCookie), oauthTransport);
      await endHostedSession(token(request));
      return await reply.header("Set-Cookie", [cookie(session.token, sessionSeconds), cookie("", 0, oauthCookie)]).redirect(session.returnPath);
    } catch {
      // Fixed error code, no provider payloads or callback secrets in logs/URL.
      return reply.header("Set-Cookie", cookie("", 0, oauthCookie)).redirect("/?signin=failed");
    }
  });
}
