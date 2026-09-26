import { z } from "zod";

export const nativeCreativeStateSchema = z.object({
  identity: z.string().max(300).default(""),
  densityIntent: z.string().max(240).default(""),
  palette: z.array(z.object({ role: z.string().max(80), resourceKind: z.enum(["local-recipe", "owned-source", "audiotool-preset", "audiotool-sample", "synthesis"]), resourceId: z.string().max(160), reason: z.string().max(240) })).max(24).default([]),
  guidanceRefs: z.array(z.string().max(120)).max(12).default([]),
  decisions: z.array(z.string().max(240)).max(20).default([]),
  definiteFailures: z.array(z.string().max(240)).max(12).default([]),
  unfinishedTasks: z.array(z.string().max(240)).max(20).default([]),
  evidenceLinks: z.array(z.object({ promise: z.string().max(240), sectionId: z.string().max(64).optional(), partId: z.string().max(64).optional(), motifId: z.string().max(64).optional(), clipId: z.string().max(64).optional(), firstBar: z.number().int().min(0).optional(), lastBar: z.number().int().min(1).optional() })).max(24).default([])
});
export type NativeCreativeState = z.infer<typeof nativeCreativeStateSchema>;

export const nativePlanSchema = z.object({
  intent: z.string().min(3).max(500),
  sections: z.array(z.object({ name: z.string().min(1).max(80), purpose: z.string().min(3).max(240) })).min(1).max(24),
  soundGoals: z.array(z.string().min(3).max(240)).min(1).max(24),
  hardConstraints: z.array(z.string().min(3).max(240)).max(24),
  developmentTasks: z.array(z.string().min(3).max(240)).min(1).max(24),
  creativeState: nativeCreativeStateSchema.optional()
});
export type NativePlan = z.infer<typeof nativePlanSchema>;
export const nativeStageSchema = z.enum(["planned", "building", "refining", "reviewed"]);
export type NativeStage = z.infer<typeof nativeStageSchema>;
