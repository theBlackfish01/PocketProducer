import { expect, test } from "@playwright/test"

test("private monthly report follows its filters, explains missing history and returns home", async ({page}) => {
  await page.route("**/api/v1/auth/session", route=>route.fulfill({json:{mode:"development",user:{ownerId:"fixture",displayName:"Listener"}}}))
  await page.route("**/api/v1/insights?**", route=>{
    const query=new URL(route.request().url()).searchParams
    return route.fulfill({json:{metrics:{active_accounts:query.get("cohort")==="all"?9:4,saved_generations:7},
      month:query.get("month"),visitorCoverage:null,releases:["abc1234"],ratings:[],feedback:[],issues:[]}})
  })
  await page.goto("/insights")
  await expect(page.getByRole("heading",{name:"Project insights"})).toBeVisible()
  await expect(page.locator("dt",{hasText:/^Active accounts$/}).locator("+ dd")).toHaveText("4")
  await page.getByRole("combobox",{name:"Accounts",exact:true}).selectOption("all")
  await expect(page.locator("dt",{hasText:/^Active accounts$/}).locator("+ dd")).toHaveText("9")
  await page.getByRole("combobox",{name:"Release",exact:true}).selectOption("abc1234")
  await expect(page.getByRole("link",{name:"Download monthly CSV"})).toHaveAttribute("href",/cohort=all&release=abc1234&format=csv/)
  await expect(page.getByText(/No visitor measurements/)).toBeVisible()
  await page.setViewportSize({width:390,height:844})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:".local/evidence/monthly-insights-phone.png"})
  await page.getByRole("link",{name:"Pocket Producer home"}).click()
  await expect(page).toHaveURL(/\/$/)
})
