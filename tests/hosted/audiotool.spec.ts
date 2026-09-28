import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { getConfig, getPool, closePool, type OAuthFetch } from "@pocket/core";
import { createApi } from "../../apps/api/src/server.js";

test("public Audiotool sign-in, persistent identity, private projects, mobile and sign-out", async ({ page, browser }) => {
  const config=getConfig(), saved={...config}, origin="http://127.0.0.1:19282", suffix=randomUUID();
  Object.assign(config,{HOSTED_AUTH_MODE:"audiotool",APP_ORIGIN:origin,AUDIOTOOL_CLIENT_ID:"browser-fixture",AUDIOTOOL_SCOPES:"user:read project:write",AUDIOTOOL_REDIRECT_URL:`${origin}/auth/audiotool/callback`});
  const transport: OAuthFetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if(url==="https://oauth.audiotool.com/oauth2/token") {
      const code=(init?.body as URLSearchParams).get("code");
      return Promise.resolve(Response.json({access_token:`fixture-browser-access-${code}`,expires_in:3600}));
    }
    expect(url).toBe("https://rpc.audiotool.com/audiotool.auth.v1.AuthService/GetWhoami");
    const token=(init?.headers as Record<string,string>).Authorization!;
    return Promise.resolve(Response.json({whoami:{userName:`users/browser-${token.endsWith("other")?"other":"main"}-${suffix}`}}));
  };
  await getPool().query("DELETE FROM hosted_login_window");
  const server=await createApi(transport); await server.listen({host:"127.0.0.1",port:19282});
  const configure = async (target: Page, code: string) => {
    // Only the external consent screen is replaced. Real HTTP start, cookies,
    // callback, GetWhoami adapter, database sessions and every API route run.
    await target.route("https://oauth.audiotool.com/oauth2/auth?*", async route => {
      const request=new URL(route.request().url());
      expect(request.searchParams.get("code_challenge_method")).toBe("S256");
      await route.fulfill({status:302,headers:{location:`${origin}/auth/audiotool/callback?state=${request.searchParams.get("state")}&code=${code}`},body:""});
    });
  };
  const phone=await browser.newContext({viewport:{width:390,height:844},reducedMotion:"reduce"});
  try {
    await mkdir(".local/evidence",{recursive:true}); await configure(page,"normal");
    await page.goto(origin); await expect(page.getByRole("button",{name:"Sign in with Audiotool"})).toBeVisible();
    await page.screenshot({path:".local/evidence/audiotool-sign-in-desktop.png",fullPage:true});
    await page.getByRole("button",{name:"Sign in with Audiotool"}).focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("heading",{name:"Make room for your next idea."})).toBeVisible();
    const first=await (await page.request.get(`${origin}/api/v1/auth/session`)).json();
    await page.getByRole("button",{name:"New session",exact:true}).last().click();
    await expect(page.getByRole("textbox",{name:"Describe your arrangement"})).toBeVisible();
    const privateUrl=page.url();
    await page.reload(); await expect(page.getByRole("textbox",{name:"Describe your arrangement"})).toBeVisible();
    expect(await page.evaluate(()=>Object.keys(localStorage).some(key=>/oidc_|access_token|refresh_token/.test(key)))).toBe(false);
    const other=await phone.newPage(); await configure(other,"other"); await other.goto(privateUrl);
    await expect(other.getByRole("button",{name:"Sign in with Audiotool"})).toBeVisible();
    await other.screenshot({path:".local/evidence/audiotool-sign-in-mobile.png",fullPage:true});
    expect(await other.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await other.getByRole("button",{name:"Sign in with Audiotool"}).click(); await expect(other.getByRole("alert")).toBeVisible();
    expect((await (await other.request.get(`${origin}/api/v1/projects`)).json()).projects).toEqual([]);
    await page.getByRole("button",{name:"Sign out",exact:true}).click();
    await expect(page.getByRole("button",{name:"Sign in with Audiotool"})).toBeVisible();
    expect((await page.request.get(`${origin}/api/v1/projects`)).status()).toBe(401);
    await page.getByRole("button",{name:"Sign in with Audiotool"}).click();
    await expect(page.getByRole("heading",{name:"Make room for your next idea."})).toBeVisible();
    expect((await (await page.request.get(`${origin}/api/v1/auth/session`)).json()).user.ownerId).toBe(first.user.ownerId);
    expect((await (await page.request.get(`${origin}/api/v1/projects`)).json()).projects).toHaveLength(1);
  } finally { await phone.close(); await server.close(); Object.assign(config,saved); await closePool(); }
});
