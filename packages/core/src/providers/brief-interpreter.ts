import OpenAI from "openai";
import { z } from "zod";
import { getConfig } from "../config.js";
import { JobControlError, requireProject, type JobRecord } from "../db/repository.js";
import { canonicalHash } from "../domain/hash.js";
import { issue } from "../errors.js";
import { attachNativeJobBrief, getNativeRevision } from "../native/repository.js";
import type { NativeDocument } from "../native/model.js";
import { captureNativeBrief, nativeBriefChecks, nativeBriefInstructions, nativeBriefJsonSchema, nativeBriefPreservation, type NativeBrief } from "../native/brief.js";
import { tokenCostMicrousd, type TokenUsage } from "./pricing.js";
import { responsesUsage, runJoblessProviderCall } from "./jobless-call.js";

// A small structured Luna reading of the direction at submit time. The reply is
// only a proposal: captureNativeBrief validates every quote, number and identity
// before anything becomes a hard check, and the capture is stored for the job.

const scopeId = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const nativeInterpretationSchema = z.object({
  direction: z.string().trim().min(3).max(32_768),
  expectedHeadId: z.uuid().nullable(),
  targetSectionId: scopeId.nullable().default(null),
  targetPartId: scopeId.nullable().default(null)
}).strict();
export type NativeInterpretationInput = z.input<typeof nativeInterpretationSchema>;
export type BriefGenerator = (context: string, outputTokens: number) => Promise<{ value: unknown; usage: TokenUsage | null; requestId?: string }>;

/** What the person sees before sending: hard checks in plain words, what their
 * words keep unchanged, softer guidance, and anything that could not be matched. */
export interface NativeInterpretation {
  interpretationId: string;
  provenance: NativeBrief["provenance"];
  checks: string[];
  keep: string[];
  guidance: Array<{ quote: string; reason: string }>;
  rejected: Array<{ quote: string; reason: string }>;
}

const model = "gpt-6-luna";
const version = "native-brief-v1";
const emptyProposal = { totalBars: null, tempoBpm: null, meter: null, sections: [], chordProgressions: [], roles: [], keep: [], construction: [], guidance: [] };
const plain = (message: string, statusCode = 409) => Object.assign(new Error(message), { statusCode });
const unavailable = () => issue("INTERPRETATION_UNAVAILABLE", "Your direction couldn't be checked right now. It can still guide the producer without enforced checks.", 503);

export async function interpretNativeDirection(ownerId: string, projectId: string, key: string, raw: unknown, scripted?: BriefGenerator): Promise<NativeInterpretation> {
  const { recordId, brief, document } = await captureDirectionBrief(ownerId, projectId, key, raw, scripted);
  return nativeInterpretationView(recordId, brief, document);
}

async function captureDirectionBrief(ownerId: string, projectId: string, key: string, raw: unknown, scripted?: BriefGenerator): Promise<{ recordId: string; brief: NativeBrief; document: NativeDocument | null }> {
  const input = nativeInterpretationSchema.parse(raw);
  z.uuid().parse(key);
  const project = await requireProject(ownerId, projectId);
  if (project.currentRevisionId !== input.expectedHeadId) throw issue("HEAD_CHANGED", "The selected version changed. Review your direction before sending.", 409);
  const document = input.expectedHeadId ? (await getNativeRevision(ownerId, projectId, input.expectedHeadId)).document : null;
  const section = document?.sections.find((item) => item.id === input.targetSectionId);
  const part = document?.parts.find((item) => item.id === input.targetPartId);
  if (input.targetSectionId && !section || input.targetPartId && !part) throw plain("The change scope is no longer available.");
  const context = JSON.stringify({
    mode: document ? "revision" : "generation", direction: input.direction,
    scope: { section: section ? { id: section.id, name: section.name } : null, part: part ? { id: part.id, name: part.name } : null },
    document: document ? {
      sections: document.sections.map((item) => ({ id: item.id, name: item.name, bars: `${item.startBar + 1}-${item.endBar}` })),
      parts: document.parts.map((item) => ({ id: item.id, name: item.name, role: item.role })),
      phrases: document.motifs.map((item) => ({ id: item.id, name: item.name, partId: item.partId, familyId: item.familyId ?? item.id }))
    } : null
  });
  const config = getConfig();
  if (!config.FIXTURE_MODE && !config.OPENAI_API_KEY) throw unavailable();
  if (scripted && !config.FIXTURE_MODE) throw new Error("Scripted brief interpretation requires fixture mode");
  const outputTokens = Math.min(8_000, 1_200 + Buffer.byteLength(input.direction, "utf8"));
  // UTF-8 bytes conservatively bound tokens; include instructions, schema and framing.
  const prompt = Buffer.byteLength(context + nativeBriefInstructions + JSON.stringify(nativeBriefJsonSchema), "utf8") + 1024;
  const reservation = config.FIXTURE_MODE ? 0 : tokenCostMicrousd("openai", model, { inputTokens: prompt, outputTokens, cacheWriteTokens: prompt });
  const hash = canonicalHash({ projectId, input, context, model, version, outputTokens });
  const provenance: NativeBrief["provenance"] = scripted ? "scripted" : config.FIXTURE_MODE ? "fixture" : "luna";
  const { recordId, output } = await runJoblessProviderCall<NativeBrief>({
    ownerId, projectId, key, step: "native-brief", version, model, reservation, hash,
    request: { kind: "native-brief", ...input, model, version, outputTokens },
    errors: {
      reused: () => plain("This check was already used for a different direction."),
      unfinished: unavailable,
      pending: () => issue("INTERPRETATION_PENDING", "An earlier check of your direction is still settling. Try again in a moment.", 409),
      unavailable,
      failed: unavailable
    },
    dispatch: async () => {
      if (scripted) return scripted(context, outputTokens);
      if (config.FIXTURE_MODE) return { value: emptyProposal, usage: { inputTokens: 0, outputTokens: 0 } };
      const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY, maxRetries: 0, timeout: 60_000 });
      const response = await openai.responses.create({
        model, store: false, reasoning: { effort: "low" }, max_output_tokens: outputTokens, prompt_cache_key: "pocket-native-brief",
        instructions: nativeBriefInstructions, input: context,
        text: { format: { type: "json_schema", name: "native_brief", strict: true, schema: nativeBriefJsonSchema } }
      });
      return { value: response.output_text, usage: responsesUsage(response.usage), requestId: response.id };
    },
    accept: (value) => captureNativeBrief(typeof value === "string" ? JSON.parse(value) : value, { direction: input.direction, document, baseRevisionId: input.expectedHeadId, targetSectionId: input.targetSectionId, provenance })
  });
  return { recordId, brief: output, document };
}

/** A stable UUID for a job's own one-time direction check (replays, never repeats). */
const jobCheckKey = (jobId: string) => {
  const hex = canonicalHash({ v: 1, jobBrief: jobId });
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

/** Requests from before captured briefs have no `_brief` at all (newer ones record
 * a capture or an explicit "sent without checks"). Best effort: read the original
 * direction once and attach it, so continued work is checked against the user's
 * words; if the check is unavailable the request continues as guidance only. */
export async function captureMissingJobBrief(job: JobRecord): Promise<void> {
  if ("_brief" in job.request || typeof job.request.direction !== "string") return;
  const request = job.request;
  const scope = (value: unknown) => typeof value === "string" ? value : null;
  try {
    const { brief } = await captureDirectionBrief(job.ownerId, job.projectId, jobCheckKey(job.id), { direction: request.direction, expectedHeadId: scope(request.expectedNativeHeadId), targetSectionId: scope(request.targetSectionId), targetPartId: scope(request.targetPartId) });
    await attachNativeJobBrief(job, brief);
  } catch (error) {
    if (error instanceof JobControlError) throw error;
  }
}

export function nativeInterpretationView(interpretationId: string, brief: NativeBrief, document: NativeDocument | null): NativeInterpretation {
  const kept = document ? nativeBriefPreservation(brief, document, brief.targetSectionId) : null;
  return {
    interpretationId, provenance: brief.provenance, checks: nativeBriefChecks(brief, document),
    keep: kept ? [...kept.namedParts.map((item) => item.name), ...(kept.theme ? [`${kept.theme.label} theme phrase`] : [])] : [],
    guidance: brief.guidance, rejected: brief.rejected
  };
}
