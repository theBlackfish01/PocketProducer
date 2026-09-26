import { expect, test } from "@playwright/test";

test("public event stream tails a committed request, resumes by Last-Event-ID and denies unknown rooms", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const created = await (await fetch("/api/v1/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Isolated stream journey" }) })).json() as { project: { id: string } };
    const base = `/api/v1/projects/${created.project.id}`;
    const snapshot = await (await fetch(`${base}/activity`)).json() as { cursor: number };
    const key = crypto.randomUUID();
    const body = JSON.stringify({ direction: "A warm 16-bar instrumental for durable updates", sourceAssetIds: [], expectedNativeHeadId: null });
    const command = await (await fetch(`${base}/native/constructions`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body })).json() as { jobId: string };
    const duplicate = await (await fetch(`${base}/native/constructions`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body })).json() as { jobId: string };
    const read = async (cursor: number, lastEventId?: number) => {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 20_000);
      try {
        const response = await fetch(`${base}/activity/stream?after=${cursor}`, { signal: controller.signal, headers: lastEventId === undefined ? {} : { "Last-Event-ID": String(lastEventId) } });
        const reader = response.body!.getReader(); const decoder = new TextDecoder(); let buffer = "";
        const all: Array<{ cursor: number; payload: { kind: string } }> = [];
        for (;;) {
          const chunk = await reader.read(); if (chunk.done) throw new Error("Stream ended before saved result");
          buffer += decoder.decode(chunk.value, { stream: true });
          const blocks = buffer.split("\n\n"); buffer = blocks.pop()!;
          for (const block of blocks) {
            const line = block.split("\n").find((value) => value.startsWith("data: ")); if (!line) continue;
            const data = JSON.parse(line.slice(6)) as { events: typeof all; job: { state: string } };
            all.push(...data.events);
            if (data.job.state === "succeeded") { await reader.cancel(); return all; }
          }
        }
      } finally { clearTimeout(timer); controller.abort(); }
    };
    const events = await read(snapshot.cursor);
    const requestCursor = events.find((event) => event.payload.kind === "request")!.cursor;
    const resumed = await read(0, requestCursor);
    const reset = await read(1_000_000);
    const missing = await fetch(`/api/v1/projects/${crypto.randomUUID()}/activity/stream`);
    return { command, duplicate, events, resumed, reset, missing: missing.status };
  });
  expect(result.command.jobId).toBe(result.duplicate.jobId);
  expect(result.events.filter((event) => event.payload.kind === "request")).toHaveLength(1);
  expect(result.events.filter((event) => event.payload.kind === "saved")).toHaveLength(1);
  expect(result.resumed.some((event) => event.payload.kind === "request")).toBe(false);
  expect(result.resumed.some((event) => event.payload.kind === "saved")).toBe(true);
  expect(result.reset.some((event) => event.payload.kind === "request")).toBe(true);
  expect(new Set(result.events.map((event) => event.cursor)).size).toBe(result.events.length);
  expect(result.missing).toBe(404);
});

test("lost acknowledgement and delayed activity keep the next direction without resubmission", async ({ page }) => {
  await page.goto("/");
  await page.locator(".session-rail").getByRole("button", { name: "New session" }).click();
  await expect(page).toHaveURL(/\/sessions\/[^/]+\/start$/);
  await expect(page.getByRole("button", { name: "Create arrangement" })).toBeVisible();
  await page.screenshot({ path: ".local/evidence/workspace-start.png", fullPage: true });
  const id = new URL(page.url()).pathname.split("/")[2]!;
  let submitted = 0;
  await page.route(`**/api/v1/projects/${id}/native/constructions`, async (route) => {
    submitted++;
    await route.fetch(); // server accepts, browser loses just the acknowledgement
    await route.fulfill({ status: 503, json: { message: "Acknowledgement interrupted" } });
  });
  const input = page.getByRole("textbox", { name: "Describe your arrangement" });
  await input.fill("A spacious text-only arrangement with a quiet theme");
  await page.getByRole("button", { name: "Create arrangement" }).click();
  await expect(page.locator(".producer-workspace-header")).toContainText("Version 1", { timeout: 90_000 });
  const producer = page.getByRole("button", { name: "Producer", exact: true }); if (await producer.isVisible()) await producer.click();
  await input.fill("Keep this next idea unsent until I choose to send it.");
  await page.reload(); await expect(page.locator(".producer-workspace-header")).toBeVisible(); if (await producer.isVisible()) await producer.click();
  await expect(input).toHaveValue("Keep this next idea unsent until I choose to send it.");
  await expect(page.getByRole("dialog", { name: "Before and after" })).toBeHidden();
  expect(submitted).toBe(1);
  const activity = await (await page.request.get(`/api/v1/projects/${id}/activity`)).json() as { events: Array<{ payload: { kind: string } }> };
  expect(activity.events.filter((event) => event.payload.kind === "request")).toHaveLength(1);
});
