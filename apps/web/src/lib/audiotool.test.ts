import { describe, expect, it, vi } from "vitest";
import { beginAudiotoolConnection, finishAudiotoolCallback, type AudiotoolOAuthConfig, type AudiotoolOAuthResult } from "./audiotool.js";

const config: AudiotoolOAuthConfig = { clientId: "public-client", redirectUrl: "http://127.0.0.1:5173/auth/audiotool/callback", scope: "project:write" };

describe("Audiotool browser OAuth boundary", () => {
  it("hands an authenticated SDK session to the private server persister", async () => {
    const result: AudiotoolOAuthResult = { status: "authenticated", userName: "tester", exportTokens: () => ({ accessToken: "access-token-value", refreshToken: "refresh-token-value", expiresAt: Date.now() + 60_000 }) };
    const persist = vi.fn(() => Promise.resolve());
    await expect(beginAudiotoolConnection(config, () => Promise.resolve(result), persist)).resolves.toBe("connected");
    expect(persist).toHaveBeenCalledOnce();
  });

  it("starts consent only for a clean unauthenticated state", async () => {
    const login = vi.fn();
    await expect(beginAudiotoolConnection(config, () => Promise.resolve({ status: "unauthenticated", login }))).resolves.toBe("redirecting");
    expect(login).toHaveBeenCalledOnce();
  });

  it("surfaces denial or invalid callback state without redirect loops", async () => {
    const login = vi.fn();
    const denied = new Error("OAuth state rejected");
    await expect(beginAudiotoolConnection(config, () => Promise.resolve({ status: "unauthenticated", login, error: denied }))).rejects.toThrow("state rejected");
    expect(login).not.toHaveBeenCalled();
    await expect(finishAudiotoolCallback(config, () => Promise.resolve({ status: "unauthenticated", login, error: denied }))).rejects.toThrow("state rejected");
    expect(login).not.toHaveBeenCalled();
  });
});
