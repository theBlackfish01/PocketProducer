import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { getPool, issueAccess, closePool } from "@pocket/core";

test("invite entry, real fixture construction, sign-out and separate phone account", async ({ page, browser }) => {
  await mkdir(".local/evidence", { recursive: true });
  await getPool().query("DELETE FROM hosted_login_window");
  const a=await issueAccess("Hosted browser A"), b=await issueAccess("Hosted browser B");
  // Unique test owners are retained in the isolated test DB for failed-run inspection.
  await page.goto("/");
  await expect(page.getByRole("heading",{name:"Make something yours."})).toBeVisible();
  await page.getByLabel("Access code").fill("invalid"); await page.getByRole("button",{name:"Enter listening room"}).click();
  await expect(page.getByRole("alert")).toContainText("invalid or expired");
  await page.getByLabel("Access code").fill(a.code);
  await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
  await expect(page.getByRole("heading",{name:"Make room for your next idea."})).toBeVisible();
  await page.getByRole("button",{name:"New session",exact:true}).last().click();
  await page.getByRole("textbox",{name:"Describe your arrangement"}).fill("A warm sparse melody with restrained drums and a contrasting middle section.");
  await page.getByRole("button",{name:"Create arrangement"}).click();
  await expect(page.getByRole("status").filter({hasText:"Version 1"})).toBeVisible({timeout:60_000});
  const showArrangement=page.getByRole("button",{name:"View arrangement",exact:true});
  if(await showArrangement.isVisible()) await showArrangement.click();
  await expect(page.getByText("Your arrangement",{exact:true})).toBeVisible({timeout:60_000});
  const privateUrl=page.url();
  await page.screenshot({path:".local/evidence/hosted-workspace-desktop.png",fullPage:true});
  const phone=await browser.newContext({viewport:{width:390,height:844},reducedMotion:"reduce"});
  try {
    const other=await phone.newPage(); await other.goto(privateUrl);
    await expect(other.getByLabel("Access code")).toBeVisible();
    await other.screenshot({path:".local/evidence/hosted-sign-in-mobile.png",fullPage:true});
    await other.getByLabel("Access code").fill(b.code); await other.getByRole("button",{name:"Enter listening room"}).click();
    await expect(other.getByRole("alert")).toBeVisible();
    expect((await other.request.get(`/api/v1/projects`)).ok()).toBe(true);
    expect((await (await other.request.get(`/api/v1/projects`)).json()).projects).toEqual([]);
    expect(await other.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  } finally { await phone.close(); }
  await page.getByRole("button",{name:"Sign out",exact:true}).click();
  await expect(page.getByLabel("Access code")).toBeVisible();
  expect((await page.request.get("/api/v1/projects")).status()).toBe(401);
  expect(await page.evaluate(()=>localStorage.getItem("pocket-hosted-owner"))).toBeNull();
  await closePool();
});
