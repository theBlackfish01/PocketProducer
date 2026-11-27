import { expect, test } from "@playwright/test";
import { arrangementTemplates } from "@pocket/core/templates";

test("the public preview files support playback and seeking from the production web server", async ({ request }) => {
  for (const template of arrangementTemplates) {
    const url = "/templates/" + template.id + ".mp3";
    const head = await request.head(url);
    expect(head.status()).toBe(200);
    expect(head.headers()["content-type"]).toBe("audio/mpeg");
    const size = Number(head.headers()["content-length"]);
    expect(size).toBeGreaterThan(100_000);
    const start = await request.get(url, { headers: { Range: "bytes=0-7" } });
    expect(start.status()).toBe(206);
    expect(start.headers()["content-range"]).toBe("bytes 0-7/" + String(size));
    expect((await start.body()).subarray(0, 3).toString()).toBe("ID3");
    const tail = await request.get(url, { headers: { Range: "bytes=-4" } });
    expect(tail.status()).toBe(206);
    expect(await tail.body()).toHaveLength(4);
    expect((await request.get(url, { headers: { Range: "bytes=" + String(size) + "-" } })).status()).toBe(416);
  }
  expect((await request.get("/templates/missing.mp3")).status()).toBe(404);
});
