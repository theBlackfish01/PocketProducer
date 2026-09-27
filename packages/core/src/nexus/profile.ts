import { getConfig, providerAvailability } from "../config.js";
import { audiotoolSessionStatus, createAudiotoolServerClient } from "./session.js";

export interface ConnectedProfile { userName: string; displayName: string; avatarUrl: string | null }
const cache = new Map<string, { until: number; value: ConnectedProfile }>();
export function safeAvatarUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port && (url.hostname === "audiotool.com" || url.hostname.endsWith(".audiotool.com")) ? url.href : null;
  } catch { return null; }
}
export function clearConnectedProfile(ownerId: string): void { cache.delete(ownerId); }
export async function connectedAudiotoolProfile(ownerId: string): Promise<ConnectedProfile | null> {
  const config = getConfig();
  if (!providerAvailability(config).audiotool || !config.AUDIOTOOL_CLIENT_ID) return null;
  const session = await audiotoolSessionStatus(ownerId);
  if (!session.connected || !session.userName) { cache.delete(ownerId); return null; }
  const prior = cache.get(ownerId);
  if (prior && prior.until > Date.now() && prior.value.userName === session.userName) return prior.value;
  const fallback = { userName: session.userName, displayName: session.userName.replace(/^users\//, ""), avatarUrl: null };
  try {
    const connection = await createAudiotoolServerClient(ownerId, config.AUDIOTOOL_CLIENT_ID);
    if (!connection) return null;
    let value: ConnectedProfile = fallback;
    try {
      const response = await connection.client.users.getUser({ name: session.userName.startsWith("users/") ? session.userName : `users/${session.userName}` }, { signal: AbortSignal.timeout(5000), logIfRetrying: false });
      if (!(response instanceof Error) && response.user) value = { userName: session.userName, displayName: response.user.displayName.slice(0, 160) || fallback.displayName, avatarUrl: safeAvatarUrl(response.user.avatarUrl) };
    } finally { await connection.awaitTokenPersistence(); }
    const latest = await audiotoolSessionStatus(ownerId);
    if (!latest.connected || latest.userName !== session.userName) return null;
    cache.set(ownerId, { until: Date.now() + 300_000, value });
    return value;
  } catch { return fallback; }
}
