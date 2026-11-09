import { expect, test } from "@playwright/test";

test("feedback stays quiet, preserves failed submissions and works on desktop and phone", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".session-rail").getByRole("button", { name: "Send feedback" })).toHaveCount(0);
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const button = page.getByRole("button", { name: "Send feedback" }).filter({ visible: true });
    await expect(button).toHaveCount(1);
    const box = (await button.boundingBox())!;
    const main = (await page.locator(".main-inner").boundingBox())!;
    expect(box.x).toBeGreaterThan(main.x + main.width / 2);
    expect(box.x + box.width).toBeLessThanOrEqual(main.x + main.width + 1);
    expect(box.y).toBeLessThan(100);
    await page.screenshot({ path: `test-results/feedback-welcome-${width}.png`, fullPage: false });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator(".desktop-feedback").getByRole("button", { name: "Send feedback" }).click();
  const dialog = page.getByRole("dialog", { name: "Share your feedback" });
  await expect(dialog.getByRole("button", { name: "Send feedback" })).toBeDisabled();
  await dialog.getByLabel("Your feedback").fill("Fixture feedback: easier section navigation, please.");
  const ids: string[] = [];
  await page.route("**/api/v1/feedback", async (route) => {
    ids.push(route.request().postDataJSON().id as string);
    if (ids.length === 1) return route.fulfill({ status: 503, json: { message: "Fixture outage" } });
    return route.continue();
  });
  await dialog.getByRole("button", { name: "Send feedback" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Your message is still here");
  await expect(dialog.getByLabel("Your feedback")).toHaveValue("Fixture feedback: easier section navigation, please.");
  await page.screenshot({ path: "test-results/feedback-desktop.png", fullPage: true });
  await dialog.getByRole("button", { name: "Send feedback" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Thanks—your feedback was saved.");
  expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".mobile-topbar").getByRole("button", { name: "Send feedback" }).click();
  await expect(dialog.getByLabel("Your feedback")).toHaveValue("");
  await expect(dialog.getByLabel("Your feedback")).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/feedback-mobile.png", fullPage: true });
});
