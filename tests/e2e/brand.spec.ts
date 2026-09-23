import { expect, test } from "@playwright/test"

test("Pocket Producer mark and wordmark render on desktop and phone", async ({ page }) => {
  await page.goto("/")
  await expect(page).toHaveTitle("Pocket Producer — Listening Room")
  const desktopBrand = page.locator(".session-rail .brand-lockup")
  await expect(desktopBrand).toBeVisible()
  await expect(desktopBrand).toContainText("Pocket Producer")
  await expect.poll(() => desktopBrand.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute("href", "/pocket-producer-mark.svg")

  await page.setViewportSize({ width: 390, height: 844 })
  const mobileBrand = page.locator(".mobile-topbar .brand-lockup")
  await expect(mobileBrand).toBeVisible()
  await expect(mobileBrand).toContainText("Pocket Producer")
  await expect.poll(() => mobileBrand.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
  await page.getByRole("button", { name: "Open sessions" }).click()
  await expect(page.getByRole("dialog").getByText("Pocket Producer")).toBeVisible()
})
