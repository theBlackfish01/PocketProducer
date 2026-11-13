import { expect, test } from "@playwright/test";

test("listening help stays in the toolbar and preserves the draft on desktop and phone", async ({ page }) => {
  await page.goto("/");
  await page.locator(".session-rail").getByRole("button", { name: "New session" }).click();
  const draft = page.getByRole("textbox", { name: "Describe your arrangement" });
  await draft.fill("A quiet piano phrase with a gentle ending");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const help = page.locator(".prompt-helper-actions").getByRole("button", { name: "How to listen" });
    await expect(help).toBeVisible();
    await page.screenshot({ path: `test-results/listening-help-${width}.png`, fullPage: true });
    await help.click();
    const dialog = page.getByRole("dialog", { name: "How to listen" });
    await expect(dialog).toContainText("Copy to Audiotool");
    await expect(dialog).toHaveCSS("opacity", "1");
    await page.screenshot({ path: `test-results/listening-help-dialog-${width}.png`, fullPage: true });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(draft).toHaveValue("A quiet piano phrase with a gentle ending");
  }
  await expect(page.locator(".producer-workspace-header")).toHaveCount(0);
});
