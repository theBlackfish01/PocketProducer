import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

test("one workspace retains upload, audition and seeking without retired endpoints", async ({ page }) => {
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      (window as unknown as { lastPreview: HTMLMediaElement }).lastPreview = this;
      return play.call(this);
    };
  });
  await page.goto("/");
  await page.locator(".session-rail").getByRole("button", { name: "New session" }).click();
  await expect(page.getByRole("heading", { name: "What would you like to make?" })).toBeVisible();
  const id = new URL(page.url()).pathname.split("/")[2]!;
  await expect(page.getByRole("button", { name: "Playable audio", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Add sound", exact: true }).click();
  const sounds = page.getByRole("dialog", { name: "Sounds", exact: true });
  await sounds.getByLabel("Upload a WAV source").setInputFiles(resolve(".local/fixtures/owned-percussion.wav"));
  await sounds.getByRole("button", { name: "Play sound owned-percussion.wav" }).click();
  const seek = sounds.getByRole("slider", { name: "Seek through source owned-percussion.wav" });
  await expect(seek).toBeVisible();
  await seek.focus(); await page.keyboard.press("ArrowRight");
  await expect(sounds.getByRole("button", { name: "Pause source owned-percussion.wav" })).toBeVisible();
  const snapshot = await (await page.request.get(`/api/v1/projects/${id}`)).json() as { assets: Array<{ audioUrl: string }> };
  const url = snapshot.assets[0]!.audioUrl;
  const range = await page.request.get(url, { headers: { Range: "bytes=0-43" } });
  expect(range.status()).toBe(206); expect((await range.body()).length).toBe(44);
  expect((await page.request.get(url, { headers: { Range: "bytes=-20" } })).status()).toBe(206);
  expect((await page.request.get(url, { headers: { Range: "bytes=99-1" } })).status()).toBe(416);
  expect((await page.request.get("/api/v1/assets/00000000-0000-4000-8000-000000000001/audio")).status()).toBe(404);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Add sound", exact: true })).toBeFocused();
  await expect(seek).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { lastPreview: HTMLMediaElement }).lastPreview.paused)).toBe(true);
  expect((await page.request.get(`/api/v1/projects/${id}/versions`)).status()).toBe(404);
  for (const endpoint of ["generations", "revisions", "versions", "select-version"]) {
    expect((await page.request.post(`/api/v1/projects/${id}/${endpoint}`, { data: {} })).status()).toBe(404);
  }
  await page.goto(`/sessions/${id}/audio`);
  await expect(page.getByRole("alert")).toContainText("This page is no longer available");
  await expect(page.getByRole("slider")).toHaveCount(0);
});

test("late project responses cannot replace the selected room or its direction", async ({ page }) => {
  const a = (await (await page.request.post("/api/v1/projects", { data: { title: "Slow response room" } })).json()).project.id as string;
  const b = (await (await page.request.post("/api/v1/projects", { data: { title: "Current room" } })).json()).project.id as string;
  await page.goto(`/sessions/${b}/start`);
  const direction = page.getByRole("textbox", { name: "Describe your arrangement" });
  await direction.fill("Only for the current room");
  let release!: () => void, started!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const seen = new Promise<void>((resolve) => { started = resolve; });
  await page.route(`**/api/v1/projects/${a}`, async (route) => { started(); await hold; await route.continue(); });
  await page.locator(`.session-rail [data-project-id="${a}"]`).click();
  await seen;
  await page.locator(`.session-rail [data-project-id="${b}"]`).click(); release();
  await expect(direction).toHaveValue("Only for the current room");
  await expect(page.locator(`.session-rail [data-project-id="${b}"]`)).toHaveAttribute("aria-current", "page");
});

test("closing Sounds cancels delayed microphone permission and stops the resulting tracks", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { releaseMicrophone: () => void; stoppedTracks: number };
    state.stoppedTracks = 0;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: () => new Promise((resolve) => {
      state.releaseMicrophone = () => resolve({ getTracks: () => [{ stop: () => { state.stoppedTracks++; } }] });
    }) });
  });
  await page.goto("/");
  await page.locator(".session-rail").getByRole("button", { name: "New session" }).click();
  await page.getByRole("button", { name: "Add sound", exact: true }).click();
  await page.getByRole("button", { name: "Record a sound", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Allow microphone" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { releaseMicrophone: () => void }).releaseMicrophone());
  await expect.poll(() => page.evaluate(() => (window as unknown as { stoppedTracks: number }).stoppedTracks)).toBe(1);
  await expect(page.getByRole("heading", { name: "What would you like to make?" })).toBeVisible();
});
