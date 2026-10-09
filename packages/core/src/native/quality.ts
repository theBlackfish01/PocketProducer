import { canonicalHash } from "../domain/hash.js";
import { nativeDocumentSchema, type NativeDocument } from "./model.js";
import { nativeCompletionIssues } from "./producer.js";
import { symbolicNativeReview } from "./critique.js";
import type { NativePlan } from "./plan.js";
import { emptyNativeBrief, type NativeBrief } from "./brief.js";

export const nativeQualityCases = [
  { id: "sparse-baseline", category: "sparse", brief: "A sparse rhythm with a memorable melody." },
  { id: "synth-disco", category: "vague-with-arc", brief: "Something synth and disco, something like Daft Punk, and in the middle there should be a very prominent upswing that's exciting somehow." },
  { id: "sample-led", category: "sample-led", brief: "Build a warm, syncopated groove from one permitted short library percussion sample. Chop two contrasting hits, alternate them across sections, add an original bass response, then leave space for a different final turn." },
  { id: "detailed-development", category: "detailed", brief: "Write an original 64-bar instrumental at 112 BPM in 4/4. Begin with a sparse two-note motif, develop it into a contrasting answer by bar 17, introduce a related bass counterline by bar 25, build intensity through rhythmic variation and a rising synth color around bars 33–48, then return to the opening motif in a thinner final section. Use editable notes, purposeful automation and at least one shared processing path. Keep the theme recognizable without copying every phrase verbatim." },
  { id: "protected-revision", category: "revision", brief: "In the middle section, thin the percussion and shorten the ambience, but keep the named melody and bass unchanged and leave all other sections intact." },
  { id: "synthesis-only", category: "resource-constraint", brief: "Make a restrained eight-bar synth study with a distinctive call and response. Use synthesis only: no uploaded or library samples. Keep the second phrase quieter and lower." },
  { id: "library-unavailable", category: "resource-fallback", brief: "Create a spacious 16-bar pulse with an original melody. A library texture would be welcome if available, but complete a coherent synthesis-only arrangement if the library cannot be reached." }
] as const;
export type NativeQualityCaseId = typeof nativeQualityCases[number]["id"];

export function evaluateNativeQuality(input: { caseId: NativeQualityCaseId; document: unknown; direction: string; brief?: NativeBrief; plan?: NativePlan | null; base?: NativeDocument; targetSectionId?: string | null; selectedSourceIds?: string[] }): {
  caseId: NativeQualityCaseId; caseMatch: boolean; documentHash: string; symbolic: ReturnType<typeof symbolicNativeReview>;
  structuralIssues: string[]; structure: { bars: number; sections: number; parts: number; notes: number; motifs: number; clips: number; controls: number; groups: number };
  humanReview: { identity: null; development: null; soundSelection: null; memorableMoments: null; heardQuality: null };
} {
  const testCase = nativeQualityCases.find((item) => item.id === input.caseId)!;
  const document = nativeDocumentSchema.parse(input.document);
  const symbolic = symbolicNativeReview(document, input.plan ?? null);
  return {
    caseId: input.caseId,
    caseMatch: input.direction.trim() === testCase.brief,
    documentHash: canonicalHash(document),
    symbolic,
    structuralIssues: nativeCompletionIssues(document, input.brief ?? emptyNativeBrief({ provenance: "none", direction: input.direction, baseRevisionId: null, targetSectionId: input.targetSectionId ?? null }), testCase.category === "revision" ? "revision" : "generation", input.selectedSourceIds ?? [], input.base, input.targetSectionId),
    structure: { bars: document.bars, sections: document.sections.length, parts: document.parts.length,
      notes: document.parts.reduce((sum, part) => sum + part.notes.length, 0) + document.motifs.reduce((sum, motif) => sum + motif.notes.length, 0),
      motifs: document.motifs.length, clips: document.parts.reduce((sum, part) => sum + part.sourceRegions.length + (part.libraryRegions?.length ?? 0), 0),
      controls: document.parts.reduce((sum, part) => sum + part.automation.length + part.effects.length + (part.parallel?.effects.length ?? 0), 0), groups: document.groups?.length ?? 0 },
    humanReview: { identity: null, development: null, soundSelection: null, memorableMoments: null, heardQuality: null }
  };
}
