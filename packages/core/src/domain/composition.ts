import { createHash } from "node:crypto";
import { z } from "zod";

export const roleSchema = z.enum(["drums", "bass", "melody", "texture"]);

export const eventSchema = z.object({
  id: z.string().min(1).max(96),
  assetId: z.string().min(1).max(160),
  startTick: z.number().int().min(0),
  durationTicks: z.number().int().positive(),
  gainDb: z.number().min(-48).max(12).default(0)
});

export const trackSchema = z.object({
  id: z.string().min(1).max(64),
  role: roleSchema,
  gainDb: z.number().min(-48).max(6),
  pan: z.number().min(-1).max(1),
  events: z.array(eventSchema).max(2_048)
});

export const sectionSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  startTick: z.number().int().min(0),
  endTick: z.number().int().positive()
});

export const compositionSchema = z.object({
  schemaVersion: z.literal(1),
  ppq: z.literal(960),
  tempoBpm: z.number().int().min(70).max(140),
  timeSignature: z.object({ numerator: z.literal(4), denominator: z.literal(4) }),
  durationTicks: z.number().int().positive(),
  tailSeconds: z.number().min(0).max(4),
  seed: z.number().int().nonnegative(),
  palette: z.literal("sunroom"),
  sourceAssetIds: z.array(z.string()).max(12),
  sections: z.array(sectionSchema).min(1).max(8),
  tracks: z.array(trackSchema).min(1).max(4)
}).superRefine((composition, context) => {
  let previousEnd = 0;
  for (const section of composition.sections) {
    if (section.startTick !== previousEnd || section.endTick <= section.startTick || section.endTick > composition.durationTicks) {
      context.addIssue({ code: "custom", message: `Invalid section boundary for ${section.id}`, path: ["sections"] });
    }
    previousEnd = section.endTick;
  }
  if (previousEnd !== composition.durationTicks) {
    context.addIssue({ code: "custom", message: "Sections must cover the musical body", path: ["sections"] });
  }
  for (const track of composition.tracks) {
    for (const event of track.events) {
      if (event.startTick + event.durationTicks > composition.durationTicks) {
        context.addIssue({ code: "custom", message: `Event ${event.id} exceeds the musical body`, path: ["tracks"] });
      }
    }
  }
});

export type Composition = z.infer<typeof compositionSchema>;
export type Track = z.infer<typeof trackSchema>;

export const arrangementPlanSchema = z.object({
  title: z.string().min(1).max(80),
  tempoBpm: z.number().int().min(78).max(112),
  energy: z.number().min(0.15).max(0.9),
  drumDensity: z.number().min(0.2).max(1),
  bassMotion: z.number().min(0.1).max(1),
  melodyContour: z.enum(["falling", "rising", "wave"]),
  sourceRole: z.enum(["percussion", "texture", "none"]),
  rationale: z.string().min(1).max(400)
});

export type ArrangementPlan = z.infer<typeof arrangementPlanSchema>;

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sorted(item)]));
  }
  return value;
}

export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(sorted(value))).digest("hex");
}

export function protectedTrackHash(composition: Composition, trackId: string): string {
  const track = composition.tracks.find((item) => item.id === trackId);
  if (!track) throw new Error(`Unknown protected track: ${trackId}`);
  return canonicalHash(track);
}

export function validateComposition(value: unknown): Composition {
  return compositionSchema.parse(value);
}

