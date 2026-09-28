import { afterEach, expect, it, vi } from "vitest";
afterEach(()=>{vi.unstubAllEnvs();vi.resetModules();});
async function production(overrides: Record<string,string>={}) {
  vi.resetModules();
  const values={ APP_ENV:"production",HOSTED_AUTH_MODE:"audiotool",AUDIOTOOL_SCOPES:"user:read project:write",DEV_LOCAL_AUTH:"false",SERVE_WEB:"true",APP_ORIGIN:"https://pocket.example",AUDIOTOOL_CLIENT_ID:"registered",AUDIOTOOL_REDIRECT_URL:"https://pocket.example/auth/audiotool/callback",AUDIOTOOL_SESSION_KEY:Buffer.alloc(32,3).toString("base64"),...overrides };
  for(const [key,value] of Object.entries(values)) vi.stubEnv(key,value);
  return (await import("./config.js")).getConfig;
}
it("accepts same-origin hosted config without changing local defaults",async()=>{
  const config=(await production())();expect(config.DEV_LOCAL_AUTH).toBe(false);expect(config.SERVE_WEB).toBe(true);
});
it.each([
  {DEV_LOCAL_AUTH:"true"}, {APP_ORIGIN:"http://pocket.example"}, {APP_ORIGIN:"https://pocket.example/"}, {AUDIOTOOL_SCOPES:"project:write"}, {AUDIOTOOL_CLIENT_ID:""},
  {AUDIOTOOL_SESSION_KEY:""}, {AUDIOTOOL_SESSION_KEY:"short"}, {SERVE_WEB:"false"}, {AUDIOTOOL_REDIRECT_URL:"http://127.0.0.1:5173/auth/audiotool/callback"}
])("fails closed for unsafe hosted settings %j",async(overrides)=>{expect(await production(overrides)).toThrow();});
