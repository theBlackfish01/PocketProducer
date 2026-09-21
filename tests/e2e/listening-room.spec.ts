import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test.beforeAll(async () => { await mkdir(".local/evidence", { recursive: true }); });

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
  await page.goto("/");
  await expect(page.getByText("Pocket Producer").first()).toBeVisible();
  const demo = page.getByRole("button", { name: "Sunroom demo" });
  await expect(demo).toBeVisible();
  await demo.click();

  const deckColors = await page.locator(".session-deck").evaluate((element) => ({ foreground: getComputedStyle(element).color, background: getComputedStyle(document.body).backgroundColor }));
  const createColors = await page.getByRole("button", { name: "Create instrumental" }).evaluate((element) => ({ foreground: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }));
  expect(contrastRatio(deckColors.foreground, deckColors.background)).toBeGreaterThanOrEqual(4.5);
  expect(contrastRatio(createColors.foreground, createColors.background)).toBeGreaterThanOrEqual(4.5);

  await page.getByRole("button", { name: /Audition source/ }).click();
  await expect(page.getByRole("slider", { name: "Seek through the source" })).toBeVisible();

  const create = page.getByRole("button", { name: "Create instrumental" });
  if (await create.isVisible()) {
    await create.click();
    await expect(page.getByRole("button", { name: "Play current version" })).toBeVisible({ timeout: 35_000 });
  }

  await expect(page.getByRole("slider", { name: "Seek through the current version" })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Playback volume" })).toBeVisible();
  const play = page.getByRole("button", { name: "Play current version" });
  await play.click();
  await expect(page.getByRole("button", { name: "Pause current version" })).toBeVisible();
  await page.getByRole("button", { name: "Pause current version" }).click();

  const direction = page.getByRole("textbox", { name: "Direction for the producer" });
  await direction.fill("Make the bass louder everywhere");
  await page.getByRole("button", { name: "Request revision" }).click();
  await expect(page.getByRole("alert")).toContainText("supports one precise edit");
  await direction.fill("Simplify the drums in Groove; keep the melody.");
  await page.getByRole("button", { name: "Request revision" }).click();
  await expect(page.getByText("2 immutable versions.")).toBeVisible({ timeout: 35_000 });

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
  await page.waitForTimeout(250);
  await page.screenshot({ path: ".local/evidence/listening-room-desktop.png", fullPage: true });
});

test("phone layout keeps the focused direction control visible", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const demo = page.getByRole("button", { name: "Sunroom demo" });
  if (await demo.isVisible()) await demo.click();
  const direction = page.getByRole("textbox", { name: "Direction for the producer" });
  await direction.focus();
  const box = await direction.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.y ?? 1_000) + (box?.height ?? 1_000)).toBeLessThanOrEqual(844);
  await page.getByRole("button", { name: "Open sessions" }).click();
  await expect(page.getByRole("dialog", { name: "Pocket Producer" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open sessions" })).toBeFocused();
  await page.screenshot({ path: ".local/evidence/listening-room-mobile.png", fullPage: true });
});
