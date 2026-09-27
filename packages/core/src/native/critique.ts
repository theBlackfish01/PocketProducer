import { z } from "zod";
import { canonicalHash } from "../domain/hash.js";
import { analyzeNativeSection, type NativeDocument } from "./model.js";
import type { NativePlan } from "./plan.js";

export const nativeReviewSchema = z.object({
  documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  verdict: z.string().min(3).max(360),
  findings: z.array(z.object({ priority: z.enum(["high", "medium", "low"]), sectionId: z.string().max(64).nullable(), partId: z.string().max(64).nullable(), observation: z.string().min(3).max(300), suggestedChange: z.string().min(3).max(300) })).max(4),
  noChangeReason: z.string().max(300).nullable(),
  modelUsed: z.boolean()
});
export type NativeReview = z.infer<typeof nativeReviewSchema>;

export function nativePlanEvidenceIssues(plan: NativePlan | null, document: NativeDocument): string[] {
  if (!plan?.creativeState) return [];
  const partIds = new Set(document.parts.map((item) => item.id));
  const sectionIds = new Set(document.sections.map((item) => item.id));
  const motifIds = new Set(document.motifs.map((item) => item.id));
  const clipIds = new Set(document.parts.flatMap((item) => [...item.sourceRegions, ...(item.libraryRegions ?? [])].map((clip) => clip.id)));
  return plan.creativeState.evidenceLinks.flatMap((link, index) => {
    const problems: string[] = [];
    if (link.partId && !partIds.has(link.partId)) problems.push(`evidenceLinks[${index}] refers to missing part ${link.partId}`);
    if (link.sectionId && !sectionIds.has(link.sectionId)) problems.push(`evidenceLinks[${index}] refers to missing section ${link.sectionId}`);
    if (link.motifId && !motifIds.has(link.motifId)) problems.push(`evidenceLinks[${index}] refers to missing motif ${link.motifId}`);
    if (link.clipId && !clipIds.has(link.clipId)) problems.push(`evidenceLinks[${index}] refers to missing clip ${link.clipId}`);
    if (link.firstBar !== undefined && link.lastBar !== undefined && (link.lastBar <= link.firstBar || link.lastBar > document.bars)) problems.push(`evidenceLinks[${index}] has an invalid bar range`);
    return problems;
  });
}

export function symbolicNativeReview(document: NativeDocument, plan: NativePlan | null) {
  const sections = document.sections.map((section) => {
    const inspected = analyzeNativeSection(document, section.id);
    return { id: section.id, name: section.name, firstBar: section.startBar, lastBar: section.endBar,
      parts: inspected.parts.map((part) => ({ id: part.id, role: part.role, newOnsets: part.newOnsets, onsetsPerBar: part.onsetsPerBar, noteRange: part.noteRange, clips: part.sourceRegions.length + part.libraryRegions.length, automationTargets: part.automationTargets })) };
  });
  const emptySections = sections.filter((section) => section.parts.every((part) => part.newOnsets === 0 && part.clips === 0)).map((section) => section.id);
  const sameSectionSignatures = sections.length > 1 && new Set(sections.map((section) => canonicalHash(section.parts.map((part) => ({ role: part.role, newOnsets: part.newOnsets, noteRange: part.noteRange, clips: part.clips }))))).size === 1;
  return { documentHash: canonicalHash(document), title: document.title, tempoBpm: document.tempoBpm, bars: document.bars, sections,
    emptySections, sameSectionSignatures, plannedIdentity: plan?.creativeState?.identity ?? plan?.intent ?? "", unfinishedTasks: plan?.creativeState?.unfinishedTasks ?? plan?.developmentTasks ?? [], evidenceIssues: nativePlanEvidenceIssues(plan, document),
    limits: "Symbolic structure and metadata only; no audio was heard and repetition can be artistically intentional." };
}

export function validateNativeReview(raw: unknown, document: NativeDocument, modelUsed: boolean): NativeReview {
  const parsed = nativeReviewSchema.parse({ ...(raw as object), documentHash: canonicalHash(document), modelUsed });
  for (const finding of parsed.findings) {
    if (finding.sectionId && !document.sections.some((section) => section.id === finding.sectionId)) throw new Error(`Reviewer named nonexistent section ${finding.sectionId}`);
    if (finding.partId && !document.parts.some((part) => part.id === finding.partId)) throw new Error(`Reviewer named nonexistent part ${finding.partId}`);
  }
  return parsed;
}
