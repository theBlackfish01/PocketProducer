import { z } from "zod";
import { getConfig } from "../config.js";

// Keep historical job models readable; only current choices enter through the public API.
export const producerModelSchema = z.enum(["gpt-6-sol", "gpt-6-luna", "gemini-3.7-flash", "deepseek/deepseek-v4-pro-0813"]);
export const selectableProducerModelSchema = z.enum(["gpt-6-luna"]);
export type ModelProvider = "openai" | "gemini" | "gateway";
export function modelProvider(model: string): ModelProvider {
  if (model.startsWith("gpt-")) return "openai";
  if (model === "gemini-3.7-flash") return "gemini";
  if (model === "deepseek/deepseek-v4-pro-0813") return "gateway";
  throw new Error("Unsupported producer model");
}
export function modelCredentials(model: string) {
  const config = getConfig(), provider = modelProvider(model);
  return provider === "openai" ? { provider, apiKey: config.OPENAI_API_KEY, baseURL: "https://api.openai.com/v1" }
    : provider === "gemini" ? { provider, apiKey: config.GEMINI_API_KEY ?? config.GOOGLE_API_KEY, baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/" }
    : { provider, apiKey: config.AI_GATEWAY_API_KEY ?? config.VERCEL_AI_GATEWAY_API_KEY, baseURL: "https://ai-gateway.vercel.sh/v1" };
}
export function producerModels() {
  return selectableProducerModelSchema.options.map((id) => ({ id,
    label: "GPT-6 Luna",
    provider: modelProvider(id), available: getConfig().FIXTURE_MODE || Boolean(modelCredentials(id).apiKey),
  }));
}
