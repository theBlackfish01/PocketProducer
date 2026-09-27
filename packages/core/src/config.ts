import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotEnv({ path: resolve(REPOSITORY_ROOT, ".env"), quiet: true });

const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");
const optionalSecret = z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional());

const configSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ORIGIN: z.url().default("http://127.0.0.1:5173"),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  DATABASE_URL: z.string().min(1).default("postgresql://pocket:pocket_local_only@127.0.0.1:54329/pocket_producer"),
  OBJECT_STORAGE_LOCAL_ROOT: z.string().default(".local/audio"),
  OPENAI_API_KEY: optionalSecret,
  AI_GATEWAY_API_KEY: optionalSecret,
  VERCEL_AI_GATEWAY_API_KEY: optionalSecret,
  OPENAI_POOL_BUDGET_USD: z.coerce.number().min(0).max(100).optional(),
  GEMINI_POOL_BUDGET_USD: z.coerce.number().min(0).max(100).default(5),
  GATEWAY_POOL_BUDGET_USD: z.coerce.number().min(0).max(100).default(10),
  DEFAULT_USER_BUDGET_USD: z.coerce.number().min(0).max(100).default(13),
  OPENAI_MODEL: z.string().min(1).default("gpt-6-sol"),
  LANGSMITH_API_KEY: optionalSecret,
  LANGSMITH_TRACING: booleanString.default(false),
  LANGSMITH_HIDE_INPUTS: booleanString.default(true),
  LANGSMITH_HIDE_OUTPUTS: booleanString.default(true),
  GEMINI_API_KEY: optionalSecret,
  GOOGLE_API_KEY: optionalSecret,
  GEMINI_MODEL: z.string().min(1).default("gemini-3-flash-preview"),
  AUDIOTOOL_CLIENT_ID: optionalSecret,
  AUDIOTOOL_REDIRECT_URL: z.url().default("http://127.0.0.1:5173/auth/audiotool/callback"),
  AUDIOTOOL_SCOPES: z.preprocess((value) => value === "" ? undefined : value, z.string().default("project:write")),
  DEV_LOCAL_AUTH: booleanString.default(true),
  FIXTURE_MODE: booleanString.default(false),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(1).default(1),
  JOB_LEASE_SECONDS: z.coerce.number().int().min(3).max(300).default(45),
  MAX_MODEL_CALLS_PER_JOB: z.coerce.number().int().min(0).max(300).default(80),
  MAX_OPENAI_INPUT_TOKENS: z.coerce.number().int().min(1_000).max(256_000).default(96_000),
  NATIVE_MODEL_OUTPUT_TOKENS: z.coerce.number().int().min(400).max(65_536).default(32_768),
  NATIVE_REASONING_EFFORT: z.enum(["low", "medium", "high"]).default("medium"),
  MAX_JOB_SECONDS: z.coerce.number().int().min(10).max(21_600).default(3_600),
  MAX_UPLOAD_BYTES: z.coerce.number().int().min(1_024).max(104_857_600).default(20_971_520),
  MAX_SOURCE_SECONDS: z.coerce.number().int().min(1).max(300).default(300),
  INITIAL_BUILD_API_BUDGET_USD: z.coerce.number().min(0).max(100).default(5),
  MAX_JOB_COST_USD: z.coerce.number().min(0).max(100).default(5),
  GEMINI_ESTIMATED_CALL_COST_USD: z.coerce.number().min(0).max(0.25).default(0.05)
});

export type AppConfig = z.infer<typeof configSchema>;

let cachedConfig: AppConfig | undefined;

export function getConfig(): AppConfig {
  cachedConfig ??= configSchema.parse(process.env);
  // LangChain reads these flags directly. Keep fixture tests offline even when
  // the developer's ignored .env enables tracing, and hide owned material by
  // default while retaining timing, run structure and safe metadata.
  process.env.LANGSMITH_TRACING = String(cachedConfig.LANGSMITH_TRACING && !cachedConfig.FIXTURE_MODE);
  process.env.LANGSMITH_HIDE_INPUTS = String(cachedConfig.LANGSMITH_HIDE_INPUTS);
  process.env.LANGSMITH_HIDE_OUTPUTS = String(cachedConfig.LANGSMITH_HIDE_OUTPUTS);
  process.env.LANGCHAIN_CALLBACKS_BACKGROUND ??= "true";
  if (cachedConfig.LANGSMITH_TRACING && !cachedConfig.FIXTURE_MODE && !cachedConfig.LANGSMITH_API_KEY) {
    throw new Error("LANGSMITH_TRACING=true requires LANGSMITH_API_KEY");
  }
  if (cachedConfig.APP_ENV === "production" && cachedConfig.DEV_LOCAL_AUTH) {
    throw new Error("DEV_LOCAL_AUTH must be false in production");
  }
  if (cachedConfig.APP_ENV === "test") {
    const databaseName = new URL(cachedConfig.DATABASE_URL).pathname.slice(1);
    if (!databaseName.endsWith("_test")) throw new Error("APP_ENV=test requires a dedicated *_test database");
    const normalAssetRoot = resolve(REPOSITORY_ROOT, ".local/audio");
    const selectedAssetRoot = resolve(REPOSITORY_ROOT, cachedConfig.OBJECT_STORAGE_LOCAL_ROOT);
    if (selectedAssetRoot === normalAssetRoot) throw new Error("APP_ENV=test refuses the normal development asset root");
    if (!cachedConfig.FIXTURE_MODE) throw new Error("APP_ENV=test requires FIXTURE_MODE=true so ordinary tests cannot call providers");
  }
  return cachedConfig;
}

export function providerAvailability(config = getConfig()) {
  const externalProvidersEnabled = !config.FIXTURE_MODE;
  return {
    openai: externalProvidersEnabled && Boolean(config.OPENAI_API_KEY),
    gemini: externalProvidersEnabled && Boolean(config.GEMINI_API_KEY ?? config.GOOGLE_API_KEY),
    audiotool: externalProvidersEnabled && Boolean(config.AUDIOTOOL_CLIENT_ID)
  } as const;
}
