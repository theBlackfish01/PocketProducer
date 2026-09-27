import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const evidence = process.env.E2E_EVIDENCE_DIR ?? ".local/evidence";
test.beforeAll(async () => { await mkdir(evidence, { recursive: true }); });
const direction = (page: Page) => page.getByRole("textbox", { name: "Describe your arrangement" });

test("producer selection persists and reaches the real job without changing a running job", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.locator(".session-rail").getByRole("button", { name: "New session" }).click();
  const chooser = page.getByRole("combobox", { name: "Producer model" });
  await expect(chooser).toBeEnabled();
  await chooser.selectOption("gemini-3.7-flash");
  await direction(page).fill("A small warm melody over a soft pulse");
  await page.reload();
  await expect(chooser).toHaveValue("gemini-3.7-flash");
  await page.screenshot({ path: resolve(evidence, "model-picker-desktop.png"), fullPage: true });
  const sent = page.waitForRequest((r) => r.url().endsWith("/native/constructions") && r.method() === "POST");
  await page.getByRole("button", { name: "Create arrangement" }).click();
  expect((await sent).postDataJSON()).toMatchObject({ model: "gemini-3.7-flash" });
  await expect(page.locator(".producer-workspace-header")).toContainText("Version 1", { timeout: 90_000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(chooser).toBeVisible();
  await chooser.selectOption("deepseek/deepseek-v4-pro-0813");
  await page.screenshot({ path: resolve(evidence, "model-picker-phone.png"), fullPage: true });
});
async function producer(page: Page) { await expect(page.locator(".producer-workspace-header")).toBeVisible(); const tab = page.getByRole("button", { name: "Producer", exact: true }); if (await tab.isVisible()) await tab.click(); }
async function arrangement(page: Page) { const tab = page.getByRole("button", { name: "Arrangement", exact: true }); if (await tab.isVisible()) await tab.click(); }
async function create(page: Page, brief = "Build an evolving 64-bar ambient journey with a slow lead and spacious transitions") {
  await page.goto("/");
  await page.locator(".session-rail").getByRole("button", { name: "New session" }).click();
  await expect(page.getByRole("heading", { name: "What would you like to make?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Versions" })).toHaveCount(0);
  await direction(page).fill(brief);
  await page.getByRole("button", { name: "Create arrangement" }).click();
  await expect(page.locator(".producer-workspace-header")).toContainText("Version 1", { timeout: 90_000 });
  await expect(page).toHaveURL(/\/sessions\/[a-f0-9-]+$/);
  return new URL(page.url()).pathname.split("/")[2]!;
}
async function native(page: Page, id: string) { return (await (await page.request.get(`/api/v1/projects/${id}/native`)).json()) as { currentRevisionId: string; versions: unknown[]; current: { document: Record<string, unknown> } }; }
async function closeSheet(page: Page, name: string) { await page.getByRole("dialog", { name, exact: true }).getByRole("button", { name: "Close", exact: true }).last().click(); }

test("home, inspiration and rewrite use the real offline API without creating music until asked", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your next piece starts here" })).toBeVisible();
  await page.locator(".session-rail").getByRole("button", { name: "New session" }).click();
  await page.getByRole("button", { name: "Inspire me" }).click();
  await expect(direction(page)).not.toHaveValue("");
  await expect(page.getByRole("status").filter({ hasText: "Test suggestion" })).toBeVisible();
  const id = new URL(page.url()).pathname.split("/")[2]!;
  expect((await native(page, id)).versions).toHaveLength(0);
  await direction(page).fill("Warm keys and a gentle pulse. No vocals.");
  await page.getByRole("button", { name: "Rewrite prompt" }).click();
  await expect(direction(page)).toHaveValue(/No vocals\..*\n\nLet the central idea/);
  await page.getByRole("button", { name: "Undo rewrite" }).click();
  await expect(direction(page)).toHaveValue("Warm keys and a gentle pulse. No vocals.");
  await page.getByRole("link", { name: "Pocket Producer home" }).first().click();
  await expect(page.getByRole("heading", { name: "Your next piece starts here" })).toBeVisible();
  await page.goBack();
  await expect(direction(page)).toHaveValue("Warm keys and a gentle pulse. No vocals.");
  await page.getByRole("button", { name: "Create arrangement" }).click();
  await expect(page.locator(".producer-workspace-header")).toContainText("Version 1", { timeout: 90_000 });
});

test("native construct, protect, revise, compare and restore survives direct reload", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const projectId = await create(page);
  const first = await native(page, projectId);
  const options = page.getByRole("button", { name: "Session options" });
  await options.click();
  await expect(page.getByRole("menuitem", { name: "Usage", exact: true })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Audiotool connection" }).click();
  await expect(page.getByRole("dialog", { name: "Your Audiotool copy" })).toBeVisible();
  await page.keyboard.press("Escape"); await expect(options).toBeFocused();
  await expect(page.getByRole("button", { name: "Playable audio", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Play current version" })).toHaveCount(0);
  expect((await page.request.post(`/api/v1/projects/${projectId}/native/synchronizations`, { headers: { "Idempotency-Key": crypto.randomUUID() }, data: { baseNativeRevisionId: first.currentRevisionId, expectedNativeHeadId: first.currentRevisionId } })).status()).toBe(409);
  const part = page.getByRole("button", { name: /^Inspect Slow lead,/ });
  await part.click();
  await expect(page.getByRole("dialog", { name: "Slow lead" })).toContainText("Whole piece · inspecting only");
  await page.keyboard.press("Escape"); await expect(part).toBeFocused();
  await page.getByRole("button", { name: "Sounds", exact: true }).click();
  await page.getByLabel("Upload a WAV source").setInputFiles(resolve(".local/fixtures/owned-percussion.wav"));
  await expect(page.getByRole("button", { name: "Play sound owned-percussion.wav" })).toBeVisible();
  await closeSheet(page, "Sounds");
  await page.getByRole("button", { name: "Sounds", exact: true }).click();
  await page.locator(".workspace-side").getByRole("button", { name: "Play sound owned-percussion.wav" }).click();
  await expect(page.getByRole("slider", { name: "Seek through source owned-percussion.wav" })).toBeVisible();
  await closeSheet(page, "Sounds");
  await expect(page.getByRole("slider", { name: "Seek through source owned-percussion.wav" })).toHaveCount(0);
  await page.getByRole("button", { name: "Manage parts" }).click();
  await page.getByRole("button", { name: "Keep unchanged Slow lead for the next change" }).click();
  await expect(page.getByRole("button", { name: "Change Slow lead", exact: true })).toBeDisabled();
  const leadCard = page.locator(".native-part-card").filter({ has: page.getByRole("heading", { name: "Slow lead", exact: true }) });
  await leadCard.getByRole("button", { name: "Details" }).click();
  await expect(page.getByRole("dialog", { name: "Slow lead", exact: true })).toContainText("This is not an audio preview");
  await page.keyboard.press("Escape"); await expect(leadCard.getByRole("button", { name: "Details" })).toBeFocused();
  await closeSheet(page, "Parts & instruments");
  await page.locator(".score-section-choice").filter({ hasText: "Ascent" }).click();
  await page.getByRole("button", { name: "Change this section" }).click();
  const pending = "Simplify the percussion in Ascent; keep the lead unchanged.";
  await direction(page).fill(pending);
  await page.getByRole("button", { name: "Rewrite prompt" }).click();
  await expect(direction(page)).toHaveValue(/keep the lead unchanged\..*\n\nLet the central idea/);
  await page.getByRole("button", { name: "Undo rewrite" }).click();
  await page.reload();
  await expect(direction(page)).toHaveValue(pending);
  await expect(page.getByRole("combobox", { name: "Change scope" }).locator("option:checked")).toHaveText("Ascent");
  await page.getByRole("button", { name: "Make this change" }).click();
  const compare = page.getByRole("dialog", { name: "Before and after" });
  await expect(compare).toBeVisible({ timeout: 90_000 });
  await expect(compare.getByText(/Verified unchanged here:/)).toBeVisible();
  const second = await native(page, projectId);
  expect(second.currentRevisionId).not.toBe(first.currentRevisionId);
  await compare.getByRole("button", { name: "Before · v1", exact: true }).click();
  expect((await native(page, projectId)).currentRevisionId).toBe(second.currentRevisionId);
  await compare.screenshot({ path: `${evidence}/workspace-comparison.png` });
  await compare.getByRole("button", { name: /Use Before · v1/ }).click();
  await expect(compare).toBeHidden();
  expect((await native(page, projectId)).currentRevisionId).toBe(first.currentRevisionId);
  await page.getByRole("button", { name: "Manage parts" }).click();
  await expect(page.getByRole("button", { name: "Keep unchanged Slow lead for the next change" })).toHaveAttribute("aria-pressed", "false");
  await closeSheet(page, "Parts & instruments");
  await page.getByRole("button", { name: "Versions" }).click();
  await page.locator(".version-quick-list button").filter({ hasText: "Version 2" }).click();
  await compare.getByRole("button", { name: /Use After · v2/ }).click();
  await closeSheet(page, "Version history");
  await page.reload();
  await expect(page.locator(".producer-workspace-header")).toContainText("Version 2");
  await expect(compare).toBeHidden();
  await expect(page.locator(".producer-feed")).toContainText("Saved Version 2");
  await page.screenshot({ path: `${evidence}/workspace-desktop.png`, fullPage: true });
});

test("phone switches between score and Producer without losing text or comparison focus", async ({ page }) => {
  await create(page, "A quiet 32-bar instrumental sketch for mobile review");
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: "reduce" });
  await producer(page);
  await direction(page).fill("Simplify the drums, keep the lead.");
  await page.setViewportSize({ width: 390, height: 480 });
  await direction(page).focus();
  expect((await direction(page).boundingBox())!.width).toBeLessThan(390);
  await direction(page).press("Tab");
  await page.getByRole("button", { name: "Make this change" }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.setViewportSize({ width: 390, height: 844 });
  await arrangement(page);
  await page.locator(".score-section-choice").first().focus(); await page.keyboard.press("Enter");
  await expect(page.locator(".score-detail")).toBeVisible();
  await page.getByRole("button", { name: "Change this section" }).click();
  await expect(direction(page)).toBeFocused(); await expect(direction(page)).toHaveValue("Simplify the drums, keep the lead.");
  await page.getByRole("button", { name: "Make this change" }).click();
  const compare = page.getByRole("dialog", { name: "Before and after" });
  await expect(compare).toBeVisible({ timeout: 90_000 });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Versions" }).click();
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await compare.screenshot({ path: `${evidence}/workspace-comparison-mobile.png` });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Compare", exact: true })).toBeFocused();
  await closeSheet(page, "Version history");
  await producer(page); await direction(page).fill("Keep this next idea unsent.");
  await arrangement(page); await producer(page);
  await expect(direction(page)).toHaveValue("Keep this next idea unsent.");
  await page.screenshot({ path: `${evidence}/workspace-mobile.png`, fullPage: true });
});

test("a late preservation response cannot submit or alter another room", async ({ page }) => {
  const id = await create(page, "A gentle 16-bar theme with bass and melody");
  await producer(page);
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  let previews = 0, revisions = 0;
  await page.route(`**/api/v1/projects/${id}/native/preservation-preview`, async (route) => { previews++; await gate; await route.continue(); });
  await page.route(`**/api/v1/projects/${id}/native/revisions`, async (route) => { revisions++; await route.continue(); });
  await direction(page).fill("Change the bass, but keep the melody");
  await page.getByRole("button", { name: "Make this change" }).click();
  await expect.poll(() => previews).toBeGreaterThan(0);
  await page.locator(".session-rail").getByRole("button", { name: "New session" }).click();
  await expect(page.getByRole("heading", { name: "What would you like to make?" })).toBeVisible();
  release();
  await expect(direction(page)).toHaveValue("");
  expect(revisions).toBe(0); expect((await native(page, id)).versions).toHaveLength(1);
  await page.goBack(); await producer(page);
  await expect(direction(page)).toHaveValue("Change the bass, but keep the melody");
});

test("partial work keeps recovery available without financial UI or automatic continuation", async ({ page }) => {
  const id = await create(page, "A sparse 12-bar theme for a structural draft review");
  const selected = await native(page, id), jobId = crypto.randomUUID();
  const job = { id: jobId, project_id: id, kind: "native-revision", state: "needs_attention", stage: null, error_code: "NATIVE_PARTIAL", error_message: null, result_revision_id: null };
  let extensions = 0, continuations = 0;
  await page.route(`**/api/v1/projects/${id}/activity/stream*`, (route) => route.abort());
  await page.route(`**/api/v1/projects/${id}/activity*`, async (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/stream")) { await route.abort(); return; }
    await route.fulfill({ json: { events: [], cursor: 0, nextCursor: 0, job, headId: selected.currentRevisionId, draft: { step: 2, hash: "partial" }, actions: { canSubmit: false, canStop: false, issue: "paused" }, allowance: { remainingUsd: 4.49, standardUsd: 4.49, extendedUsd: 4.49 } } });
  });
  await page.route(`**/api/v1/jobs/${jobId}`, (route) => route.fulfill({ json: job }));
  await page.route(`**/api/v1/projects/${id}/native/requests/${jobId}/draft`, (route) => route.fulfill({ json: { jobId, state: job.state, selected: false, baseRevisionId: selected.currentRevisionId, headMatches: true, stepCount: 2, document: { ...selected.current.document, title: "Unselected draft" }, documentHash: "partial", canContinue: extensions > 0, canExtend: true, runLimits: { profile: "standard", maxCalls: extensions ? 60 : 40, maxInputTokens: 64000, maxOutputTokens: 16384, deadlineSeconds: 1800, maxJobCostUsd: 5 }, extensionCeiling: { maxCalls: 300, maxInputTokens: 256000, maxOutputTokens: 65536, deadlineSeconds: 21600, maxJobCostUsd: 100 }, budget: { spentUsd: 0.51, reservedUsd: 0, unknownUsd: 0, siteRemainingUsd: 4.49, minimumNextCallUsd: 0.42, modelCalls: 3 }, continuationReason: extensions ? null : "This request has used its configured model-call allowance." } }));
  await page.reload();
  await page.getByRole("button", { name: "View work in progress" }).click();
  await expect(page.getByRole("region", { name: "Unfinished arrangement preview" })).toContainText("Your arrangement");
  await expect(page.locator(".living-score")).toHaveCount(1);
  await producer(page);
  await expect(page.locator(".producer-panel")).not.toContainText(/allowance|\$0.51|model-call/);
  await expect(page.getByText("The producer reached this request’s step limit.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue arrangement" })).toHaveCount(0);

  await page.route(`**/api/v1/projects/${id}/native/requests/${jobId}/continue`, async (route) => { continuations++; await route.fulfill({ status: 202, json: { jobId } }); });
  await expect(page.getByRole("button", { name: "Increase request limits" })).toHaveCount(0);
  expect(continuations).toBe(0);
  // Simulate an operator resolving the gate; the UI still requires explicit continuation.
  extensions = 1; await page.reload(); await producer(page);
  await page.getByRole("button", { name: "Continue arrangement" }).click();
  await expect.poll(() => continuations).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: `${evidence}/workspace-recovery-mobile.png`, fullPage: true });
  expect((await native(page, id)).currentRevisionId).toBe(selected.currentRevisionId);
});

test("zero-step pause labels the retained approach without inventing a musical draft", async ({ page }) => {
  const id = await create(page, "A spare melody with a slow answer");
  const selected = await native(page, id), jobId = crypto.randomUUID();
  const job = { id: jobId, project_id: id, kind: "native-revision", state: "needs_attention", stage: null, error_code: "NATIVE_PARTIAL", error_message: "MODEL_BUDGET_EXCEEDED:SITE", result_revision_id: null };
  await page.route(`**/api/v1/projects/${id}/activity/stream*`, (route) => route.abort());
  await page.route(`**/api/v1/projects/${id}/activity*`, async (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/stream")) { await route.abort(); return; }
    await route.fulfill({ json: { events: [], cursor: 0, nextCursor: 0, job, headId: selected.currentRevisionId, draft: { step: 0, hash: null }, actions: { canSubmit: false, canStop: false, issue: "paused" }, allowance: { remainingUsd: 0.1, standardUsd: 0.1, extendedUsd: 0.1 } } });
  });
  await page.route(`**/api/v1/jobs/${jobId}`, (route) => route.fulfill({ json: job }));
  await page.route(`**/api/v1/projects/${id}/native/requests/${jobId}/draft`, (route) => route.fulfill({ json: { jobId, state: job.state, selected: false, baseRevisionId: selected.currentRevisionId, headMatches: true, stepCount: 0, document: null, documentHash: null, plan: { plan: { intent: "A quiet question and answer", sections: [{ name: "Whole", purpose: "Leave room for a reply" }], soundGoals: ["Soft lead"], hardConstraints: [], developmentTasks: ["Write the reply"], creativeState: { identity: "Intimate and restrained", densityIntent: "Spacious", palette: [], unfinishedTasks: ["Write the reply"], definiteFailures: [] } }, stage: "planned", inspectedDocumentHash: null, review: null }, canContinue: false, canExtend: false, continuationReason: "The overall allowance cannot reserve another call.", budget: { spentUsd: 0.51, reservedUsd: 0, unknownUsd: 0, siteRemainingUsd: 0.1, minimumNextCallUsd: 0.42, modelCalls: 2 } } }));
  await page.reload(); await producer(page);
  await expect(page.locator(".producer-panel")).toContainText("Paused");
  await expect(page.locator(".producer-panel")).toContainText("The authorized spending allowance cannot cover another step.");
  await expect(page.getByRole("button", { name: "View work in progress" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue arrangement" })).toHaveCount(0);
  await page.getByText("Musical approach", { exact: true }).click();
  await expect(page.getByText("Intimate and restrained")).toBeVisible();
  expect((await native(page, id)).currentRevisionId).toBe(selected.currentRevisionId);
});

test("sample search exposes measured slice candidates only on request", async ({ page }) => {
  const id = await create(page, "A four-bar texture study");
  await page.route("**/api/v1/status", async (route) => {
    const response = await route.fetch();
    const status = await response.json() as { nexus: { session: { connected: boolean; userName: string | null; expiresAt: string | null } } };
    status.nexus.session = { connected: true, userName: "Fixture user", expiresAt: null };
    await route.fulfill({ response, json: status });
  });
  let searches = 0, inspections = 0;
  await page.route("**/api/v1/native/library/samples?*", async (route) => {
    const query = new URL(route.request().url()).searchParams;
    expect(query.get("kind")).toBe("one-shot");
    expect(query.get("minBpm")).toBe("78");
    expect(query.get("maxBpm")).toBe("102");
    searches++;
    await route.fulfill({ json: { samples: [{ name: "samples/fixture-hit", displayName: "Short texture", ownerName: "users/fixture", durationSeconds: 1, bpm: 90, sampleKind: "one-shot", tags: ["texture"] }], nextPageToken: "", provenance: "Fixture metadata; no license inferred" } });
  });
  await page.route("**/api/v1/native/library/sample-analysis?*", async (route) => {
    inspections++;
    await route.fulfill({ json: { sample: { name: "samples/fixture-hit", displayName: "Short texture" }, contentHash: "a".repeat(64), measured: { durationSeconds: 1, leadingSilenceSeconds: 0.125, suggestedSlices: [{ startSeconds: 0.125, endSeconds: 0.5, reason: "Measured activity" }], limitations: "Energy only; no instrument identity or rights inference." }, provenance: "Decoded fixture WAV" } });
  });
  await page.reload();
  await page.getByRole("button", { name: "Sounds" }).click();
  const sheet = page.getByRole("dialog", { name: "Sounds" });
  await sheet.getByLabel("Sound or mood").fill("texture");
  await sheet.getByLabel("Sample type").selectOption("one-shot");
  await sheet.getByLabel("Near this tempo (optional)").fill("90");
  expect(searches).toBe(0); expect(inspections).toBe(0);
  await sheet.getByRole("button", { name: "Search library" }).click();
  await expect(sheet.getByText("Short texture")).toBeVisible();
  expect(searches).toBe(1); expect(inspections).toBe(0);
  await sheet.getByRole("button", { name: "Inspect slices" }).click();
  await expect(sheet.getByText(/0.125–0.5s/)).toBeVisible();
  expect(inspections).toBe(1);
  await sheet.getByRole("region", { name: "Original sample audition" }).scrollIntoViewIfNeeded();
  await sheet.screenshot({ path: `${evidence}/workspace-sample-inspection.png` });
  await sheet.getByRole("button", { name: "Ask to use" }).click();
  await expect(direction(page)).toContainText("samples/fixture-hit");
  await expect(direction(page)).toContainText("0.125–0.5 seconds");
  expect((await native(page, id)).versions).toHaveLength(1);
});

test("sync is separate and never reads a construction draft or erases an unsent brief", async ({ page }) => {
  const id = await create(page, "An eight-bar opening with a warm motif");
  await producer(page);
  const pending = "Make the chorus warmer with more chord movement. ".repeat(65);
  await direction(page).fill(pending);
  await page.getByText("Options", { exact: true }).click(); await page.getByLabel("Depth").selectOption("extended");
  const jobId = crypto.randomUUID(); let jobReads = 0, draftReads = 0;
  await page.route(`**/api/v1/jobs/${jobId}`, async (route) => { const state = ++jobReads < 3 ? "running" : "succeeded"; await route.fulfill({ json: { id: jobId, project_id: id, kind: "native-sync", state, stage: "synchronizing", error_code: null, events: [] } }); });
  await page.route(`**/api/v1/projects/${id}/native/requests/${jobId}/draft`, async (route) => { draftReads++; await route.fulfill({ status: 404 }); });
  await page.evaluate(({ id, jobId }) => localStorage.setItem(`pocket-producer:native-receipt:${id}`, JSON.stringify({ operation: "native-sync", key: crypto.randomUUID(), jobId, signature: "sync" })), { id, jobId });
  await page.reload(); await producer(page);
  await expect.poll(() => jobReads).toBeGreaterThanOrEqual(3);
  await expect(direction(page)).toHaveValue(pending);
  await page.getByText("Options", { exact: true }).click(); await expect(page.getByLabel("Depth")).toHaveValue("extended");
  expect(draftReads).toBe(0);
});

test("tablet keeps 128-bar, 24-part inspection and disclosure without horizontal overflow", async ({ page }) => {
  await create(page);
  await page.route("**/api/v1/projects/*/native", async (route) => {
    const response = await route.fetch();
    const snapshot = await response.json() as { current: { document: { bars: number; sections: Array<{ endBar: number }>; parts: Array<{ id: string; name: string }> } } };
    const doc = snapshot.current.document; doc.bars = 128; doc.sections.at(-1)!.endBar = 128;
    const parts = doc.parts; doc.parts = [...parts, ...parts.map((part) => ({ ...part, id: part.id + "-2", name: part.name + " second voice" })), ...parts.map((part) => ({ ...part, id: part.id + "-3", name: part.name + " third voice" }))];
    await route.fulfill({ response, json: snapshot });
  });
  await page.setViewportSize({ width: 820, height: 1180 }); await page.reload();
  await page.getByRole("button", { name: "Manage parts" }).click();
  await expect(page.locator(".native-part-card")).toHaveCount(8);
  await page.getByRole("button", { name: /Show more parts/ }).click(); await expect(page.locator(".native-part-card")).toHaveCount(16);
  await page.getByRole("button", { name: /Show more parts/ }).click(); await expect(page.locator(".native-part-card")).toHaveCount(24);
  await page.getByRole("group", { name: "Filter parts by role" }).getByRole("button", { name: /percussion/i }).click();
  await expect(page.locator(".native-part-card")).toHaveCount(3);
  await closeSheet(page, "Parts & instruments");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(820);
  await page.screenshot({ path: `${evidence}/workspace-tablet.png`, fullPage: true });
});
