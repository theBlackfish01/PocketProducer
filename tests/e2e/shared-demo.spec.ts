import { expect, test } from "@playwright/test";

test("shows quiet Luna availability and exhausted states without hiding saved sessions", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  let exhausted = false;
  await page.route("**/api/v1/producer-models", (route) => route.fulfill({ json: {
    models: [
      { id: "gpt-6-luna", label: "GPT-6 Luna", provider: "openai", available: !exhausted, reason: exhausted ? "model" : null },
    ], fallbackModel: null, repository: { url: "https://github.com/theBlackfish01/PocketProducer", public: false },
  } }));
  await page.goto("/");
  await page.locator(".session-rail").getByRole("button", { name: "New session" }).click();
  await page.getByLabel("Describe your arrangement").fill("A warm sparse melody with a gentle pulse");
  await expect(page.getByText("GPT-6 Luna", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Producer model" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create arrangement", exact: true })).toBeEnabled();
  await expect(page.locator(".session-rail").getByRole("link", { name: /GitHub/ })).toHaveAttribute("href", "https://github.com/theBlackfish01/PocketProducer");
  await expect(page.locator(".demo-availability")).toHaveCount(0);
  await page.screenshot({ path: "test-results/shared-demo-desktop.png", fullPage: true });
  exhausted = true; await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("The shared demo allowance is unavailable. Your saved arrangements are still available.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create arrangement", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Rewrite prompt" })).toHaveCount(0);
  await expect(page.getByLabel("Describe your arrangement")).toHaveValue("A warm sparse melody with a gentle pulse");
  await expect(page.locator(".demo-availability").getByRole("link", { name: /GitHub/ })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByLabel("Describe your arrangement").focus(); await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/shared-demo-mobile.png", fullPage: true });
  // Availability recovery never resurrects the retired model choices.
  exhausted = false; await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("button", { name: "Create arrangement", exact: true })).toBeEnabled();
  let submitted: unknown;
  await page.route("**/native/constructions", (route) => { submitted = route.request().postDataJSON(); return route.fulfill({ status: 409, json: { message: "Offline submission inspected" } }); });
  await page.getByRole("button", { name: "Create arrangement", exact: true }).click();
  await expect.poll(() => submitted).toMatchObject({ model: "gpt-6-luna" });
  expect(errors).toEqual([]);
});
