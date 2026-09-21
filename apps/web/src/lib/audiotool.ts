export interface AudiotoolOAuthConfig { clientId: string; redirectUrl: string; scope: string }
export type AudiotoolOAuthResult =
  | { status: "authenticated"; userName: string; exportTokens(): { accessToken: string; refreshToken: string; expiresAt: number } }
  | { status: "unauthenticated"; login(): void; error?: Error }
export type AudiotoolAuthenticator = (config: AudiotoolOAuthConfig) => Promise<AudiotoolOAuthResult>
type SessionPersister = (result: Extract<AudiotoolOAuthResult, { status: "authenticated" }>) => Promise<void>

const authenticateWithSdk: AudiotoolAuthenticator = async (config) => {
  const { audiotool } = await import("@audiotool/nexus")
  return await audiotool(config)
}

async function persistAuthenticated(result: Extract<AudiotoolOAuthResult, { status: "authenticated" }>): Promise<void> {
  const response = await fetch("/api/v1/integrations/audiotool/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userName: result.userName, tokens: result.exportTokens() })
  })
  if (!response.ok) throw new Error("Audiotool authorized the browser, but the private worker session could not be saved.")
}

export async function beginAudiotoolConnection(config: AudiotoolOAuthConfig, authenticate: AudiotoolAuthenticator = authenticateWithSdk, persist: SessionPersister = persistAuthenticated): Promise<"connected" | "redirecting"> {
  const result = await authenticate(config)
  if (result.status === "authenticated") { await persist(result); return "connected" }
  if (result.error) throw result.error
  result.login()
  return "redirecting"
}

export async function finishAudiotoolCallback(config: AudiotoolOAuthConfig, authenticate: AudiotoolAuthenticator = authenticateWithSdk, persist: SessionPersister = persistAuthenticated): Promise<void> {
  const result = await authenticate(config)
  if (result.status === "authenticated") { await persist(result); return }
  throw result.error ?? new Error("Audiotool returned without an authenticated session. Try connecting again.")
}
