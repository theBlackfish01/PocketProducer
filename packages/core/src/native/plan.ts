import { z } from "zod";

export const nativePlanSchema = z.object({
  intent: z.string().min(3).max(500),
  sections: z.array(z.object({ name: z.string().min(1).max(80), purpose: z.string().min(3).max(240) })).min(1).max(24),
  soundGoals: z.array(z.string().min(3).max(240)).min(1).max(24),
  hardConstraints: z.array(z.string().min(3).max(240)).max(24),
  developmentTasks: z.array(z.string().min(3).max(240)).min(1).max(24)
});
export type NativePlan = z.infer<typeof nativePlanSchema>;
export const nativeStageSchema = z.enum(["planned", "building", "refining", "reviewed"]);
export type NativeStage = z.infer<typeof nativeStageSchema>;
