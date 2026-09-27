import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { analyzePreview, boundOpenAiRequest, createAudiotoolTokenRefreshHandler, encodeWav } from "@pocket/core";

describe("optional provider boundaries", () => {
  it("returns an honest unavailable Gemini result without a key", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pocket-provider-"));
    const path = join(directory, "silence.wav");
    await writeFile(path, encodeWav(new Float32Array(4_800), new Float32Array(4_800), 48_000));
    const result = await analyzePreview({ path, hash: "fixture-hash", durationSeconds: 0.1, peak: 0, rms: 0, nonSilentRatio: 0 });
    expect(result.status).toBe("unavailable");
    expect(result.observations).toEqual([]);
    expect(result.measured.durationSeconds).toBe(0.1);
  });

  it("waits for refresh-token persistence and surfaces a failed rotation write", async () => {
    const tokens = { accessToken: "access-token-value", refreshToken: "refresh-token-value", expiresAt: Date.now() + 60_000 };
    const successful = createAudiotoolTokenRefreshHandler("owner", "tester", () => Promise.resolve());
    successful.onTokenRefresh(tokens);
    await expect(successful.awaitPersistence()).resolves.toBeUndefined();

    const failed = createAudiotoolTokenRefreshHandler("owner", "tester", () => Promise.reject(new Error("rotation persistence failed")));
    failed.onTokenRefresh(tokens);
    await expect(failed.awaitPersistence()).rejects.toThrow("rotation persistence failed");

    const order: number[] = [];
    let releaseFirst: (() => void) | undefined;
    const serialized = createAudiotoolTokenRefreshHandler("owner", "tester", async (_owner, _user, rotated) => {
      order.push((rotated as { expiresAt: number }).expiresAt);
      if (order.length === 1) await new Promise<void>((resolve) => { releaseFirst = resolve; });
    });
    const firstExpiry = Date.now() + 120_000;
    const secondExpiry = firstExpiry + 60_000;
    serialized.onTokenRefresh({ ...tokens, expiresAt: firstExpiry });
    serialized.onTokenRefresh({ ...tokens, expiresAt: firstExpiry - 1 });
    serialized.onTokenRefresh({ ...tokens, expiresAt: secondExpiry });
    await vi.waitFor(() => expect(order).toEqual([firstExpiry]));
    if (!releaseFirst) throw new Error("Expected first persistence barrier");
    releaseFirst();
    await serialized.awaitPersistence();
    expect(order).toEqual([firstExpiry, secondExpiry]);
  });

  it("bounds OpenAI reservations from the normalized request and rejects oversized context", () => {
    const message = (content: string) => ({ getType: () => "human", content, name: undefined, additional_kwargs: {} });
    const short = boundOpenAiRequest([[message("keep the melody") as never]]);
    const longer = boundOpenAiRequest([[message("keep the melody and simplify the drums ".repeat(40)) as never]]);
    expect(short.outputTokenBound).toBe(900);
    expect(longer.inputTokenBound).toBeGreaterThan(short.inputTokenBound);
    expect(() => boundOpenAiRequest([[message("x".repeat(20_000)) as never]], 900, 16_000)).toThrow("OPENAI_INPUT_LIMIT_EXCEEDED");
  });


});
