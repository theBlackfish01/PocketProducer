import { z } from "zod";
import { canonicalHash } from "../domain/hash.js";
import { analyzeNativeSection, barTicks, materializedNotes, type NativeDocument } from "./model.js";
import type { NativePlan } from "./plan.js";
import { automationValueAt } from "./section.js";

// A ramp may cross an entire section without a control point inside it. Give
// the editor local boundary values and the enclosing keyframes, not unrelated
// whole-song endpoints. Sloped interpolation is reported, never approximated.
function sectionAutomation(curve: NativeDocument["parts"][number]["automation"][number], start: number, end: number) {
  if (!curve.points.some((point) => point.tick < end)) return null;
  const before = curve.points.findLast((point) => point.tick <= start);
  const after = curve.points.find((point) => point.tick >= end);
  const points = [...(before ? [before] : []), ...curve.points.filter((point) => point.tick > start && point.tick < end), ...(after ? [after] : [])];
  const value = (tick: number) => { try { return automationValueAt(curve.points, tick); } catch { return null; } };
  return { target: curve.target, first: value(start), last: value(end - 1), normalized: true,
    points: points.slice(0, 8), omittedPoints: Math.max(0, points.length - 8),
    exactBoundaryValues: !points.some((point) => point.interpolation === "sloped") };
}

export const nativeReviewSchema = z.object({
  documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  musicHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  verdict: z.string().min(3).max(360),
  findings: z.array(z.object({ priority: z.enum(["high", "medium", "low"]), sectionId: z.string().max(64).nullable(), partId: z.string().max(64).nullable(), observation: z.string().min(3).max(300), suggestedChange: z.string().min(3).max(300) })).max(4),
  noChangeReason: z.string().max(300).nullable(),
  modelUsed: z.boolean(),
  contextHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  diagnostic: z.object({ code: z.enum(["invalid_json", "invalid_schema", "invalid_reference", "truncated", "historical_unusable"]), paths: z.array(z.string().max(100)).max(8), finishReason: z.string().max(80).nullable() }).optional(),
  formatRecovery: z.boolean().optional()
});
export type NativeReview = z.infer<typeof nativeReviewSchema>;

export function nativeArcEvidence(document: NativeDocument) {
  if (document.sections.length < 3) return { middleSectionId: null, openingToMiddle: [] as string[], middleToArrival: [] as string[], symbolicArcEvidenced: false };
  const facts = document.sections.map((section) => {
    const start = section.startBar * barTicks(document), end = section.endBar * barTicks(document);
    const events = document.parts.flatMap((part) => materializedNotes(document, part.id).filter((note) => note.startTick >= start && note.startTick < end).map((note) => ({ partId: part.id, role: part.role, pitch: note.pitch, beat: (note.startTick - start) / 960 })));
    const activeRoles = [...new Set(events.map((event) => event.role))].sort();
    const controlSpans = document.parts.flatMap((part) => part.automation.map((curve) => curve.points.filter((point) => point.tick >= start && point.tick <= end).map((point) => point.value)).filter((values) => values.length > 1).map((values) => Math.max(...values) - Math.min(...values)));
    return { section, events, activeRoles, highestPitch: events.length ? Math.max(...events.map((event) => event.pitch)) : null,
      onsetsPerBar: events.length / (section.endBar - section.startBar), phraseHash: canonicalHash(events.slice(0, 64).map((event) => [event.partId, event.pitch, event.beat])),
      controlSpan: controlSpans.length ? Math.max(...controlSpans) : 0 };
  });
  const opening = facts[0]!, middle = facts[Math.floor(facts.length / 2)]!, arrival = facts.at(-1)!;
  const openingToMiddle: string[] = [];
  if (middle.phraseHash !== opening.phraseHash) openingToMiddle.push("changed note timing or contour");
  if (middle.highestPitch !== null && opening.highestPitch !== null && middle.highestPitch >= opening.highestPitch + 4) openingToMiddle.push("higher register");
  if (middle.onsetsPerBar >= opening.onsetsPerBar * 1.25 && middle.onsetsPerBar >= opening.onsetsPerBar + 0.5) openingToMiddle.push("more note onsets per bar");
  if (middle.activeRoles.some((role) => !opening.activeRoles.includes(role))) openingToMiddle.push("new active role");
  if (middle.controlSpan >= 0.2) openingToMiddle.push("moving control values");
  const middleToArrival: string[] = [];
  if (arrival.phraseHash !== middle.phraseHash) middleToArrival.push("different arrival phrase");
  if (arrival.activeRoles.join("|") !== middle.activeRoles.join("|")) middleToArrival.push("different active roles");
  if (arrival.highestPitch !== middle.highestPitch) middleToArrival.push("different register peak");
  return { middleSectionId: middle.section.id, openingToMiddle, middleToArrival, symbolicArcEvidenced: openingToMiddle.length >= 2 && middleToArrival.length >= 1 };
}

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
  const soundEvidence = document.parts.map((part) => ({
    id: part.id, role: part.role, device: part.device.type,
    presetHash: part.device.preset?.contentHash ?? null,
    patchParameters: Object.fromEntries(Object.entries(part.device.parameters).sort(([a], [b]) => a.localeCompare(b))),
    channelGain: part.gain, groupId: part.groupId ?? null,
    sends: (part.sends ?? []).map((send) => ({ busId: send.busId, gain: send.gain })),
    effects: part.effects.map((effect) => ({ type: effect.type, parameters: effect.parameters })),
    parallel: part.parallel ? { wetMix: part.parallel.wetMix, effects: part.parallel.effects.map((effect) => ({ type: effect.type, parameters: effect.parameters })) } : null
  }));
  const soundWarnings: string[] = [];
  for (const part of soundEvidence.filter((part) => ["heisenberg", "pulverisateur"].includes(part.device) && !part.presetHash && !Object.keys(part.patchParameters).length)) {
    soundWarnings.push(`No explicit patch or pinned preset on ${part.id}; its name alone does not establish the intended timbre. Defaults may be intentional; this is a suggestion, not a completion blocker.`);
  }
  const bareGakki = soundEvidence.filter((part) => part.device === "gakki" && !part.presetHash);
  if (bareGakki.length) soundWarnings.push(`Unresolved Gakki instrument/kit identity on ${bareGakki.map((part) => part.id).join(", ")}; note pitches do not establish a sound.`);
  const skeletons = new Map<string, string[]>();
  for (const part of soundEvidence.filter((item) => item.device === "heisenberg" && !item.presetHash)) {
    const tonal = Object.fromEntries(Object.entries(part.patchParameters).filter(([key]) => key.startsWith("operator") || key.startsWith("envelopeMain")).sort(([a], [b]) => a.localeCompare(b)));
    const key = canonicalHash(tonal);
    skeletons.set(key, [...(skeletons.get(key) ?? []), part.id]);
  }
  for (const ids of skeletons.values()) if (ids.length >= 3) soundWarnings.push(`The Heisenberg tonal core is identical or left at defaults on ${ids.join(", ")}; filter changes alone may not create distinct instrument identities.`);
  const sections = document.sections.map((section) => {
    const inspected = analyzeNativeSection(document, section.id);
    const start = section.startBar * barTicks(document), end = section.endBar * barTicks(document);
    const partFacts = inspected.parts.map((part) => {
      const source = document.parts.find((item) => item.id === part.id)!;
      const onsets = materializedNotes(document, part.id).filter((note) => note.startTick >= start && note.startTick < end);
      const noteFact = (note: (typeof onsets)[number]) => [note.startTick - start, note.pitch, Number(note.velocity.toFixed(2)), note.durationTicks];
      const rhythmEnd = Math.min(end, start + 2 * barTicks(document));
      const rhythm = part.role === "percussion" ? onsets.filter(note => note.startTick < rhythmEnd) : [];
      const activeCurves = source.automation.map((curve) => sectionAutomation(curve, start, end)).filter((curve) => curve !== null);
      const clipIntervals = [...source.sourceRegions.map(clip => ({ ...clip, kind: "owned" })), ...(source.libraryRegions ?? []).map(clip => ({ ...clip, kind: "library" }))]
        .filter(clip => clip.startTick < end && clip.startTick + clip.durationTicks > start)
        .map(clip => ({ id: clip.id, kind: clip.kind, startTick: clip.startTick - start, endTick: clip.startTick + clip.durationTicks - start,
          sourceStartSeconds: clip.sourceStartSeconds, sourceDurationSeconds: clip.sourceDurationSeconds, playbackMode: clip.playbackMode ?? "once", gain: clip.gain }));
      return { id: part.id, role: part.role, device: source.device.type, preset: source.device.preset ? { name: source.device.preset.name, hash: source.device.preset.contentHash ?? null } : null,
        newOnsets: part.newOnsets, onsetsPerBar: part.onsetsPerBar, noteRange: part.noteRange, clips: part.sourceRegions.length + part.libraryRegions.length,
        soundingNotes: part.soundingNotes, clipIntervals: clipIntervals.slice(0, 8), omittedClipIntervals: Math.max(0, clipIntervals.length - 8),
        // Relative rhythm, pitches and velocities distinguish genuine thematic
        // development from identical density/range in every section.
        onsetPreview: onsets.slice(0, 8).map(noteFact),
        omittedPreviewOnsets: Math.max(0, onsets.length - 8),
        finalOnsets: onsets.length > 8 ? onsets.slice(-4).map(noteFact) : [],
        ...(part.role === "percussion" ? { rhythmWindow: { startTick: 0, endTick: rhythmEnd - start, totalOnsets: rhythm.length,
          notes: rhythm.slice(0, 32).map(noteFact), omittedOnsets: Math.max(0, rhythm.length - 32) } } : {}),
        motifIds: [...new Set(part.placements.map((placement) => placement.motifId))].slice(0, 8),
        automation: activeCurves.slice(0, 4), omittedAutomation: Math.max(0, activeCurves.length - 4) };
    });
    return { id: section.id, name: section.name, firstBar: section.startBar, lastBar: section.endBar,
      intent: section.intent, totalOnsets: partFacts.reduce((sum, part) => sum + part.newOnsets, 0),
      parts: partFacts.filter((part) => part.soundingNotes || part.clips || part.automation.length).slice(0, 12),
      additionalActiveParts: Math.max(0, partFacts.filter((part) => part.soundingNotes || part.clips || part.automation.length).length - 12) };
  });
  const emptySections = sections.filter((section) => section.parts.every((part) => part.soundingNotes === 0 && part.clips === 0)).map((section) => section.id);
  const sameSectionSignatures = sections.length > 1 && new Set(sections.map((section) => canonicalHash(section.parts.map((part) => ({ role: part.role, onsetsPerBar: part.onsetsPerBar, noteRange: part.noteRange, clips: part.clips, onsetPreview: part.onsetPreview.map(([tick, pitch, velocity]) => [Number(tick) / (section.lastBar - section.firstBar), pitch, velocity]), motifIds: part.motifIds }))))).size === 1;
  return { documentHash: canonicalHash(document), title: document.title, tempoBpm: document.tempoBpm, bars: document.bars,
    timing: { meter: document.meter, ticksPerQuarter: document.ppq, ticksPerBar: barTicks(document), sectionBars: "zero-based, lastBar exclusive",
      noteTuple: "[section-relative startTick, MIDI pitch, velocity, durationTicks]", clipTiming: "clipIntervals are section-relative; negative starts and ends beyond the section indicate crossing clips. Clips need no MIDI onsets. soundingNotes includes notes sustained into this section. Automation alone does not establish note or clip activity. Placement is structural evidence, not proof of heard audio.", previewCoverage: "onsetPreview is only the first eight events; finalOnsets is an overlapping tail, not additional notes. Missing preview events do not imply silence. rhythmWindow describes only its stated interval." },
    soundEvidence, soundWarnings, sections,
    // Sends alone do not describe the shared processing. Keep the actual
    // bounded canonical settings so a reviewer does not mistake an omitted
    // bus/group for missing musical work and ask for redundant edits.
    sharedProcessing: { reverbBus: document.reverbBus ?? null, delayBus: document.delayBus ?? null, groups: document.groups ?? [], master: document.master ?? null },
    emptySections, sameSectionSignatures, arcEvidence: nativeArcEvidence(document), plannedIdentity: plan?.creativeState?.identity ?? plan?.intent ?? "", unfinishedTasks: plan?.creativeState?.unfinishedTasks ?? plan?.developmentTasks ?? [], evidenceIssues: nativePlanEvidenceIssues(plan, document),
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
