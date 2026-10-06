import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

test("captures the README Listening Room using isolated fixture data", async ({ page }) => {
  const evidence = process.env.E2E_EVIDENCE_DIR ?? ".local/evidence";
  await mkdir(evidence, { recursive: true });
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto("/");
  await page.locator(".session-rail").getByRole("button", { name: "New session" }).click();
  await page.getByRole("textbox", { name: "Describe your arrangement" }).fill("Night Drive");
  await expect(page.getByText("GPT-6 Luna", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create arrangement" }).click();
  await expect(page.locator(".producer-workspace-header")).toContainText("Version 1", { timeout: 90_000 });
  await expect(page.getByRole("heading", { name: "Night Drive", exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(evidence, "readme-listening-room.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Arrangement", exact: true }).click();
  await page.screenshot({ path: resolve(evidence, "readme-listening-room-phone.png"), fullPage: true });
});
