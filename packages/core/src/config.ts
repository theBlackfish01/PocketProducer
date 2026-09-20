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
  OPENAI_MODEL: z.string().min(1).default("gpt-6-astra"),
  GEMINI_API_KEY: optionalSecret,
  GOOGLE_API_KEY: optionalSecret,
  GEMINI_MODEL: z.string().min(1).default("gemini-3-flash-preview"),
  AUDIOTOOL_CLIENT_ID: optionalSecret,
  AUDIOTOOL_REDIRECT_URL: z.url().default("http://127.0.0.1:5173/auth/audiotool/callback"),
  AUDIOTOOL_SCOPES: z.string().default(""),
  DEV_LOCAL_AUTH: booleanString.default(true),
  FIXTURE_MODE: booleanString.default(false),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  MAX_MODEL_CALLS_PER_JOB: z.coerce.number().int().min(1).max(12).default(4),
  MAX_RENDER_ATTEMPTS_PER_JOB: z.coerce.number().int().min(1).max(3).default(2),
  MAX_AUDIO_CRITIQUE_PASSES: z.coerce.number().int().min(0).max(2).default(1),
  MAX_JOB_SECONDS: z.coerce.number().int().min(10).max(900).default(300),
  MAX_UPLOAD_BYTES: z.coerce.number().int().min(1_024).max(104_857_600).default(20_971_520),
  INITIAL_BUILD_API_BUDGET_USD: z.coerce.number().min(0).max(5).default(5),
  MAX_JOB_COST_USD: z.coerce.number().min(0).max(1).default(0.25),
  GEMINI_ESTIMATED_CALL_COST_USD: z.coerce.number().min(0).max(0.25).default(0.05)
});

export type AppConfig = z.infer<typeof configSchema>;

let cachedConfig: AppConfig | undefined;

export function getConfig(): AppConfig {
  cachedConfig ??= configSchema.parse(process.env);
  if (cachedConfig.APP_ENV === "production" && cachedConfig.DEV_LOCAL_AUTH) {
    throw new Error("DEV_LOCAL_AUTH must be false in production");
  }
  return cachedConfig;
}

export function providerAvailability(config = getConfig()) {
  return {
    openai: Boolean(config.OPENAI_API_KEY),
    gemini: Boolean(config.GEMINI_API_KEY ?? config.GOOGLE_API_KEY),
    audiotool: Boolean(config.AUDIOTOOL_CLIENT_ID)
  } as const;
}
