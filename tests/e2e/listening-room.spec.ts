import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const evidenceDirectory = process.env.E2E_EVIDENCE_DIR ?? ".local/evidence";
test.beforeAll(async () => { await mkdir(evidenceDirectory, { recursive: true }); });

function relativeLuminance(cssRgb: string): number {
  const values = cssRgb.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
  const linear = values.map((value) => { const channel = value / 255; return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4; });
  return (linear[0] ?? 0) * 0.2126 + (linear[1] ?? 0) * 0.7152 + (linear[2] ?? 0) * 0.0722;
}

function contrastRatio(foreground: string, background: string): number {
  const [light, dark] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

test("create/listen controls and accessible version flow", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/");
  await expect(page.getByText("Pocket Producer").first()).toBeVisible();
  await page.locator(".session-rail").getByRole("button", { name: "New session" }).click();
  await page.getByRole("button", { name: "Legacy audio" }).click();
  await expect(page.getByRole("heading", { name: "Untitled listening room" })).toBeVisible();
  await page.getByLabel("Upload a WAV source").setInputFiles(resolve(".local/fixtures/owned-percussion.wav"));
  await expect(page.getByRole("dialog", { name: "Source tray" }).getByRole("button", { name: "owned-percussion.wav" })).toBeVisible();
  await page.getByRole("dialog", { name: "Source tray" }).getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("button", { name: /Audition source owned-percussion\.wav/ })).toBeVisible();

  const deckColors = await page.locator(".session-deck").evaluate((element) => ({ foreground: getComputedStyle(element).color, background: getComputedStyle(document.body).backgroundColor }));
  const createColors = await page.getByRole("button", { name: "Create instrumental" }).evaluate((element) => ({ foreground: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }));
  expect(contrastRatio(deckColors.foreground, deckColors.background)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(createColors.foreground, createColors.background)).toBeGreaterThanOrEqual(4.5);

  await page.getByRole("button", { name: /Audition source/ }).click();
  await expect(page.getByRole("slider", { name: "Seek through the source" })).toBeVisible();

  const direction = page.getByRole("textbox", { name: "Direction for the producer" });
  const generationDirection = "Make a warm, restrained instrumental around this sound with a gently rising lift and a deliberately spacious ending.";
  await direction.fill(generationDirection);
  const acceptedContext = await page.evaluate(async () => {
    const listed = await (await fetch("/api/v1/projects")).json() as { projects: Array<{ id: string }> };
    const projectId = listed.projects[0]?.id;
    if (!projectId) throw new Error("Expected active project");
    const snapshot = await (await fetch(`/api/v1/projects/${projectId}`)).json() as { assets: Array<{ id: string }> };
    const sourceAssetId = snapshot.assets[0]?.id;
    if (!sourceAssetId) throw new Error("Expected uploaded source");
    return { projectId, sourceAssetId, key: crypto.randomUUID() };
  });
  const commandIdentity = `${acceptedContext.projectId}:new:${acceptedContext.sourceAssetId}:${generationDirection}`;
  await page.evaluate(({ storageKey, key }) => localStorage.setItem(storageKey, key), { storageKey: `pocket-producer:submission:${commandIdentity}`, key: acceptedContext.key });
  const acceptedCommand = await page.request.post(`/api/v1/projects/${acceptedContext.projectId}/generations`, {
    headers: { "Idempotency-Key": acceptedContext.key },
    data: { direction: generationDirection, sourceAssetId: acceptedContext.sourceAssetId }
  });
  expect(acceptedCommand.status()).toBe(202);
  const acceptedJob = await acceptedCommand.json() as { jobId: string };
  const commandLookup = await page.request.get(`/api/v1/projects/${acceptedContext.projectId}/commands/generation/${acceptedContext.key}`);
  expect(commandLookup.status()).toBe(200);
  expect((await commandLookup.json() as { job: { id: string } }).job.id).toBe(acceptedJob.jobId);
  let lostResponseInjected = false;
  await page.route("**/api/v1/projects/*/generations", async (route) => {
    if (!lostResponseInjected && route.request().method() === "POST") {
      lostResponseInjected = true;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Injected acknowledgement loss" }) });
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Create instrumental" }).click();
  await expect(page.getByText("Submission receipt retained")).toBeVisible();
  expect(await page.evaluate((context) => Array.from({ length: localStorage.length }, (_item, index) => localStorage.getItem(localStorage.key(index) ?? "") ?? "").some((value) => value.includes(context.key)), acceptedContext)).toBe(true);
  await page.unroute("**/api/v1/projects/*/generations");
  await page.reload();
  await page.getByRole("button", { name: "Legacy audio" }).click();
  await expect(page.getByRole("button", { name: "Play current version" })).toBeVisible({ timeout: 75_000 });
  expect(await page.evaluate(() => Array.from({ length: localStorage.length }, (_item, index) => localStorage.getItem(localStorage.key(index) ?? "") ?? "").some((value) => value.includes('"jobId"')))).toBe(true);

  await expect(page.getByRole("slider", { name: "Seek through the current version" })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Playback volume" })).toBeVisible();
  const play = page.getByRole("button", { name: "Play current version" });
  await play.click();
  await expect(page.getByRole("button", { name: "Pause current version" })).toBeVisible();
  await page.getByRole("button", { name: "Pause current version" }).click();

  await direction.fill("Make the bass louder everywhere");
  await page.getByRole("button", { name: "Request revision" }).click();
  await expect(page.getByRole("alert")).toContainText("supports one precise edit");
  await direction.fill("Simplify the drums in Groove; keep the melody.");
  await page.getByRole("button", { name: "Request revision" }).click();
  await expect(page.getByText("2 immutable versions.")).toBeVisible({ timeout: 75_000 });

  const compare = page.getByRole("button", { name: "Compare" });
  await compare.click();
  await expect(page.getByRole("dialog", { name: "Compare versions" })).toBeVisible();
  await page.getByRole("radio", { name: "Version 1" }).click();
  await expect(page.getByText("Version 1 · audition")).toBeVisible();
  await page.getByRole("button", { name: "Keep current" }).click();
  await expect(compare).toBeFocused();
  await expect(page.getByText("Version 2 · current")).toBeVisible();

  await compare.click();
  await page.getByRole("radio", { name: "Version 1" }).click();
  await page.getByRole("button", { name: "Use this version" }).click();
  await expect(page.getByRole("dialog", { name: "Compare versions" })).toBeHidden();
  await expect(page.getByText("Version 1 · current")).toBeVisible();

  const projects = await page.evaluate(async () => (await fetch("/api/v1/projects")).json() as Promise<{ projects: Array<{ id: string }> }>);
  const activeProjectId = projects.projects[0]?.id;
  if (!activeProjectId) throw new Error("Expected a generated browser-test project");
  // Registration exists in the ignored .env, so the UI correctly asks for
  // consent rather than showing the old unconfigured export button. Exercise
  // the offline export-preparation route directly; fixture mode cannot call Audiotool.
  const selectedSnapshot = await (await page.request.get(`/api/v1/projects/${activeProjectId}`)).json() as { project: { currentRevisionId: string } };
  const exportAccepted = await page.request.post(`/api/v1/revisions/${selectedSnapshot.project.currentRevisionId}/exports`, { headers: { "Idempotency-Key": crypto.randomUUID() }, data: {} });
  expect(exportAccepted.status()).toBe(202);
  const exportJob = await exportAccepted.json() as { jobId: string };
  await expect.poll(async () => (await (await page.request.get(`/api/v1/jobs/${exportJob.jobId}`)).json() as { state: string }).state, { timeout: 75_000 }).toBe("succeeded");
  await page.reload();
  await page.getByRole("button", { name: "Legacy audio" }).click();
  await expect(page.getByText(/Audiotool handoff: disabled/i)).toBeVisible({ timeout: 75_000 });
  await page.screenshot({ path: `${evidenceDirectory}/listening-room-completed.png`, fullPage: true });
  const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? "postgresql://pocket:pocket_local_only@127.0.0.1:54329/pocket_producer_test";
  if (!testDatabaseUrl || !new URL(testDatabaseUrl).pathname.slice(1).endsWith("_test")) throw new Error("Needs-attention browser probe requires TEST_DATABASE_URL for a dedicated *_test database");
  Object.assign(process.env, { APP_ENV: "test", DATABASE_URL: testDatabaseUrl, OBJECT_STORAGE_LOCAL_ROOT: process.env.TEST_OBJECT_STORAGE_LOCAL_ROOT ?? ".local/test-audio", FIXTURE_MODE: "true", DEV_LOCAL_AUTH: "true", OPENAI_API_KEY: "", GEMINI_API_KEY: "", GOOGLE_API_KEY: "" });
  const { getPool, closePool } = await import("@pocket/core");
  await getPool().query("UPDATE job SET state='needs_attention',error_code='TEST_RECONCILE',error_message='Existing remote outcome must be checked without starting new work.' WHERE project_id=$1 AND kind='export'", [activeProjectId]);
  await closePool();
  await page.evaluate(({ projectId, jobId, revisionId }) => localStorage.setItem(`pocket-producer:receipt:${projectId}`, JSON.stringify({ key: crypto.randomUUID(), projectId, operation: "export", baseRevisionId: revisionId, jobId })), { projectId: activeProjectId, jobId: exportJob.jobId, revisionId: selectedSnapshot.project.currentRevisionId });
  await page.reload();
  await page.getByRole("button", { name: "Legacy audio" }).click();
  await expect(page.getByRole("alert")).toContainText("Existing remote outcome must be checked");
  await page.getByRole("button", { name: "Check known outcome" }).click();
  await expect(page.getByRole("alert")).toContainText("Existing remote outcome must be checked");

  await direction.fill("Draft retained only in the completed room");
  await page.locator(".session-rail").getByRole("button", { name: "New session" }).click();
  await expect(page.getByRole("button", { name: "Play current version" })).toHaveCount(0);
  await expect(page.getByRole("slider", { name: "Seek through the current version" })).toHaveCount(0);
  await direction.fill("Draft retained only in the empty room");
  const currentProjects = await page.evaluate(async () => (await fetch("/api/v1/projects")).json() as Promise<{ projects: Array<{ id: string }> }>);
  const emptyProjectId = currentProjects.projects[0]?.id;
  const completedProjectId = currentProjects.projects[1]?.id;
  if (!emptyProjectId || !completedProjectId) throw new Error("Expected two browser-test projects");
  let releaseOldSnapshot: (() => void) | undefined;
  let oldSnapshotStarted: (() => void) | undefined;
  const oldSnapshotSeen = new Promise<void>((resolveSeen) => { oldSnapshotStarted = resolveSeen; });
  const oldSnapshotGate = new Promise<void>((resolveGate) => { releaseOldSnapshot = resolveGate; });
  await page.route(`**/api/v1/projects/${completedProjectId}`, async (route) => { oldSnapshotStarted?.(); await oldSnapshotGate; await route.continue(); });
  const sessions = page.locator(".session-rail .rail-session");
  await sessions.nth(1).click();
  await oldSnapshotSeen;
  await sessions.nth(0).click();
  releaseOldSnapshot?.();
  await expect(sessions.nth(0)).toHaveAttribute("aria-current", "page");
  await expect(direction).toHaveValue("Draft retained only in the empty room");
  await expect(page.getByRole("button", { name: "Play current version" })).toHaveCount(0);
  await page.unroute(`**/api/v1/projects/${completedProjectId}`);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${evidenceDirectory}/listening-room-desktop.png`, fullPage: true });
});

test("phone layout keeps the focused direction control visible", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Legacy audio" }).click();
  const direction = page.getByRole("textbox", { name: "Direction for the producer" });
  await direction.focus();
  const box = await direction.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.y ?? 1_000) + (box?.height ?? 1_000)).toBeLessThanOrEqual(844);
  await page.getByRole("button", { name: "Open sessions" }).click();
  await expect(page.getByRole("dialog", { name: "Pocket Producer" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open sessions" })).toBeFocused();
  await page.screenshot({ path: `${evidenceDirectory}/listening-room-mobile.png`, fullPage: true });
});
