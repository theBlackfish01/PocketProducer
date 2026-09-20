import { expect, test } from "@playwright/test";

test("create/listen controls and accessible version flow", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Pocket Producer").first()).toBeVisible();
  const demo = page.getByRole("button", { name: "Sunroom demo" });
  await expect(demo).toBeVisible();
  await demo.click();

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

  const compare = page.getByRole("button", { name: "Compare" });
  await compare.click();
  await expect(page.getByRole("dialog", { name: "Compare versions" })).toBeVisible();
  await page.getByRole("button", { name: "Keep current" }).click();
  await expect(compare).toBeFocused();
});

test("phone layout keeps the focused direction control visible", async ({ page }) => {
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
});
