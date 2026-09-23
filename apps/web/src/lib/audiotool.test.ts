import { afterEach, describe, expect, it, vi } from "vitest";
import { beginAudiotoolConnection, finishAudiotoolCallback, type AudiotoolOAuthConfig, type AudiotoolOAuthResult } from "./audiotool.js";

const config: AudiotoolOAuthConfig = { clientId: "public-client", redirectUrl: "http://127.0.0.1:5173/auth/audiotool/callback", scope: "project:write" };

afterEach(() => vi.unstubAllGlobals());

describe("Audiotool browser OAuth boundary", () => {
  it("hands an authenticated SDK session to the private server persister", async () => {
    const result: AudiotoolOAuthResult = { status: "authenticated", userName: "tester", exportTokens: () => ({ accessToken: "access-token-value", refreshToken: "refresh-token-value", expiresAt: Date.now() + 60_000 }) };
    const persist = vi.fn(() => Promise.resolve());
    await expect(beginAudiotoolConnection(config, () => Promise.resolve(result), persist)).resolves.toBe("connected");
    expect(persist).toHaveBeenCalledOnce();
  });

  it("normalizes the SDK's missing refresh token marker without exposing the access token", async () => {
    const result: AudiotoolOAuthResult = { status: "authenticated", userName: "tester", exportTokens: () => ({ accessToken: "access-token-value", refreshToken: "undefined", expiresAt: Date.now() + 300_000 }) };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    await expect(beginAudiotoolConnection(config, () => Promise.resolve(result))).resolves.toBe("connected");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).tokens.refreshToken).toBe("");
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
