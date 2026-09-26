import type { NativeDocument } from "./model.js";

type Role = NativeDocument["parts"][number]["role"];
const roles: Array<{ label: string; pattern: RegExp; matches: Role[] }> = [
  { label: "drums", pattern: /\b(?:drums?|percussion|beat)\b/gi, matches: ["percussion"] },
  { label: "bass", pattern: /\bbass\b/gi, matches: ["bass"] },
  { label: "harmony", pattern: /\b(?:harmony|chords?|pad)\b/gi, matches: ["harmony", "texture"] },
  { label: "lead or melody", pattern: /\b(?:lead|melody|melodic)\b/gi, matches: ["lead", "melody"] },
  { label: "transitions", pattern: /\b(?:transitions?|risers?|fills?)\b/gi, matches: ["fx"] }
];
type RoleRule = { label: string; matches: Role[] };
export interface NativeRequirement extends RoleRule {
  kind: "required" | "absent" | "preserve" | "change" | "ambiguous";
  section: string | null;
  changeMeasure?: "reduce-density";
  evidence: { start: number; end: number; text: string };
}
export interface NativeBriefIntent {
  totalBars: number | null;
  tempoBpm: number | null;
  meter: { numerator: number; denominator: 4 | 8 } | null;
  sectionLengths: Array<{ section: string; bars: number }>;
  sectionSpans: Array<{ section: string; startBar: number; endBar: number }>;
  chordProgressions: string[][];
  requirements: NativeRequirement[];
  requiredRoles: RoleRule[];
  excludedRoles: RoleRule[];
  sectionRequirements: Array<{ section: string } & RoleRule>;
  sectionExclusions: Array<{ section: string } & RoleRule>;
  preservedRoles: RoleRule[];
  sectionPreservations: Array<{ section: string } & RoleRule>;
  changeRoles: RoleRule[];
  changeRequirements: NativeRequirement[];
  constructionRequirements: Array<"shared-parallel-drums" | "sidechain" | "automation">;
  advisory: string[];
}

export interface ResolvedNativePreservation {
  namedParts: Array<{ id: string; name: string; evidence: string }>;
  theme: { familyId: string; motifIds: string[]; label: string; evidence: string } | null;
  unresolved: string[];
}

export function resolveNativePreservation(direction: string, document: NativeDocument, sectionId?: string | null): ResolvedNativePreservation {
  const brief = interpretNativeBrief(direction);
  const namedParts = document.parts.filter((part) => brief.preservedRoles.some((rule) => rule.matches.includes(part.role)))
    .map((part) => ({ id: part.id, name: part.name, evidence: brief.requirements.find((rule) => rule.kind === "preserve" && rule.matches.includes(part.role))?.evidence.text ?? "Named in the request" }));
  const themePhrase = /\b(?:keep|preserve|leave|do not change|don't change|without changing)\b[^.!?;]{0,100}\b(?:the\s+)?(?:theme|motif|hook)\b/i.exec(direction)?.[0] ?? null;
  if (!themePhrase) return { namedParts, theme: null, unresolved: [] };
  const section = document.sections.find((value) => value.id === sectionId);
  const start = section ? section.startBar * document.meter.numerator * 960 * 4 / document.meter.denominator : 0;
  const end = section ? section.endBar * document.meter.numerator * 960 * 4 / document.meter.denominator : Infinity;
  const families = new Map<string, typeof document.motifs>();
  for (const motif of document.motifs) {
    const part = document.parts.find((value) => value.id === motif.partId);
    if (!part || !["lead", "melody"].includes(part.role) || !part.placements.some((placement) => placement.motifId === motif.id && placement.startTick < end && placement.startTick + placement.repeats * motif.lengthTicks > start)) continue;
    const familyId = motif.familyId ?? (motif.derivedFromMotifId ? null : motif.id);
    if (!familyId) continue;
    families.set(familyId, [...(families.get(familyId) ?? []), motif]);
  }
  if (families.size === 1) {
    const [familyId, motifs] = [...families][0]!;
    return { namedParts, theme: { familyId, motifIds: motifs.map((motif) => motif.id), label: motifs.find((motif) => motif.id === familyId)?.name ?? motifs[0]!.name, evidence: themePhrase }, unresolved: [] };
  }
  if (families.size === 0) {
    const melodyParts = document.parts.filter((part) => ["lead", "melody"].includes(part.role));
    if (melodyParts.length === 1) return { namedParts: [...namedParts, { id: melodyParts[0]!.id, name: melodyParts[0]!.name, evidence: `${themePhrase} (one melodic part; no linked phrase)` }], theme: null, unresolved: [] };
  }
  return { namedParts, theme: null, unresolved: [families.size > 1 ? "Several distinct melodic phrase families could be the theme; name the part or phrase to keep" : "No uniquely identifiable melodic theme is present; name the part to keep"] };
}

const scope = (text: string): string | null => {
  const found = /\b(?:in|during|throughout|for)\s+(?:the\s+)?([a-z][a-z0-9 -]{0,38}?)(?:\s+section)?(?=\s*(?:[,;.!?]|$|\band\b|\bbut\b|\bthen\b))/i.exec(text.trim());
  const name = found?.[1]?.trim().toLowerCase().replace(/^(?:for|in)\s+(?:the\s+)?/, "") ?? null;
  // "Bring in chords" names material, not a section. A false section here
  // makes an otherwise valid construction impossible to complete.
  return name && !/^(?:a|an|the|one|total|overall|chords?|harmony|bass|drums?|percussion|beats?|pads?|lead|melody|motif|theme|notes?|samples?|sounds?)$/.test(name) && !/^(?:(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+bars?)$/.test(name) ? name : null;
};
const unique = <T extends RoleRule>(rules: T[]): T[] => rules.filter((rule, index) => rules.findIndex((other) => other.label === rule.label && ("section" in other ? other.section : null) === ("section" in rule ? rule.section : null)) === index);
const directivePattern = /\b(?:do\s+not\s+(?:change|alter|touch|use)|don't\s+(?:change|alter|touch|use)|without\s+(?:changing|altering|touching)|keep|preserve|leave|no|without|omit|exclude|skip|remove|avoid|thin|simplify|reduce|brighten|darken|shorten|change|alter|develop|vary|make|include|add|bring|create|write|use|introduce|maybe|perhaps|optionally|optional|could)\b/gi;
function directiveKind(cue: string): NativeRequirement["kind"] {
  if (/^(?:do not (?:change|alter|touch)|don't (?:change|alter|touch)|without (?:changing|altering|touching)|keep|preserve|leave)/i.test(cue)) return "preserve";
  if (/^(?:do not use|don't use|no|without|omit|exclude|skip|remove|avoid)/i.test(cue)) return "absent";
  if (/^(?:maybe|perhaps|optionally|optional|could)/i.test(cue)) return "ambiguous";
  if (/^(?:thin|simplify|reduce|brighten|darken|shorten|change|alter|develop|vary|make)/i.test(cue)) return "change";
  return "required";
}

// Hard authority belongs to a role mention's own clause, never to all roles
// in a sentence. Conflicting global instructions become advisory, not a veto.
export function interpretNativeBrief(direction: string): NativeBriefIntent {
  const text = direction.toLowerCase();
  const tempoMention = [...text.matchAll(/\b(\d{2,3})\s*bpm\b/g)].at(-1);
  const tempoBpm = tempoMention && Number(tempoMention[1]) >= 40 && Number(tempoMention[1]) <= 220 ? Number(tempoMention[1]) : null;
  const meterMention = [...text.matchAll(/\b(\d{1,2})\s*[/⁄]\s*([48])\b/g)].at(-1);
  const meter = meterMention && Number(meterMention[1]) >= 2 && Number(meterMention[1]) <= 12 ? { numerator: Number(meterMention[1]), denominator: Number(meterMention[2]) as 4 | 8 } : null;
  const sectionLabel = "intro|opening|groove|first main|second main|main|breakdown|peak|outro|verse|chorus|bridge|release|ascent|bloom|suspension|ending|middle|body|return";
  const sectionSpans = [...text.matchAll(new RegExp(`\\b(${sectionLabel})\\s*(?:section)?\\s*(?:bars?)?\\s*(\\d{1,3})\\s*[-–—]\\s*(\\d{1,3})\\b`, "g"))].map((match) => ({ section: match[1]!, startBar: Number(match[2]), endBar: Number(match[3]) })).filter((value) => value.startBar >= 1 && value.endBar >= value.startBar && value.endBar <= 128);
  const sectionLengths = [
    ...[...text.matchAll(new RegExp(`\\b(\\d{1,3})[- ]bar\\s+(${sectionLabel})\\b`, "g"))].map((match) => ({ section: match[2]!, bars: Number(match[1]) })),
    ...[...text.matchAll(new RegExp(`\\b(${sectionLabel})\\s+(?:section\\s+)?(?:of|for|is|:)\\s*(\\d{1,3})\\s*bars?\\b`, "g"))].map((match) => ({ section: match[1]!, bars: Number(match[2]) }))
  ].filter((value) => value.bars >= 1 && value.bars <= 128);
  // Only an explicit sequence is promoted to an objective chord obligation.
  // Isolated chord names may be references or alternatives, not a progression.
  const chordToken = String.raw`[A-G](?:#|b)?(?:maj9|maj7|add9|m9|m7|m|7\(b9\)|7)`;
  const chordProgressions = [...direction.matchAll(new RegExp(`${chordToken}(?:\\s*(?:→|->|[-–—])\\s*${chordToken}){2,}`, "g"))]
    .map((match) => [...match[0].matchAll(new RegExp(chordToken, "g"))].map((item) => item[0]));
  const durationMentions = [...text.matchAll(/\b(\d{1,3})\s*[- ]?bars?\b/g)];
  const explicitTotal = durationMentions.filter((mention, index) => /\b(?:in total|overall|altogether|entire piece)\b/.test(text.slice(mention.index + mention[0].length, Math.min(text.length, durationMentions[index + 1]?.index ?? text.length)).slice(0, 45))).at(-1);
  const totalBars = explicitTotal ? Number(explicitTotal[1]) : durationMentions.length === 1 && !/\b(?:intro|opening|verse|chorus|section|bridge|outro|break|ending)\b/.test(text.slice(Math.max(0, durationMentions[0]!.index - 12), durationMentions[0]!.index + durationMentions[0]![0].length + 18)) ? Number(durationMentions[0]![1]) : null;
  const requirements: NativeRequirement[] = [];
  const chunks = [...direction.matchAll(/[^;.!?\n]+/g)];
  for (const chunk of chunks) {
    const sentence = chunk[0];
    const mentions = roles.flatMap((role) => [...sentence.matchAll(role.pattern)].map((match) => ({ role, index: match.index, end: match.index + match[0].length }))).sort((a, b) => a.index - b.index);
    const directives = [...sentence.matchAll(directivePattern)].map((match) => ({ cue: match[0], start: match.index, end: match.index + match[0].length }));
    for (const mention of mentions) {
      const cueIndex = directives.findLastIndex((candidate) => candidate.start < mention.index);
      const cue = directives[cueIndex];
      const nextCue = directives[cueIndex + 1];
      const phraseStart = cue?.start ?? 0;
      const phraseEnd = nextCue?.start ?? sentence.length;
      const phrase = sentence.slice(phraseStart, phraseEnd);
      const rawKind = cue ? directiveKind(cue.cue) : /\bunchanged\b/i.test(phrase) ? "preserve" : "required";
      const kind = (["required", "change"].includes(rawKind) && (cueIndex > 0 && directiveKind(directives[cueIndex - 1]!.cue) === "ambiguous" || /\bif useful\b/i.test(phrase))) ? "ambiguous" : rawKind;
      const section = scope(phrase) ?? (cue ? scope(sentence.slice(0, cue.start)) : null);
      const changeMeasure = kind === "change" && mention.role.label === "drums" && (/^(?:thin|simplify|reduce)$/i.test(cue?.cue ?? "") || /\b(?:sparser|fewer hits|less busy)\b/i.test(phrase)) ? "reduce-density" as const : undefined;
      requirements.push({ kind, section, label: mention.role.label, matches: mention.role.matches, ...(changeMeasure ? { changeMeasure } : {}), evidence: { start: (chunk.index ?? 0) + phraseStart, end: (chunk.index ?? 0) + phraseEnd, text: phrase.trim().slice(0, 180) } });
    }
  }
  const deduped = new Map<string, NativeRequirement>();
  for (const rule of requirements) deduped.set(`${rule.kind}:${rule.section ?? "global"}:${rule.label}`, rule);
  const boundedRequirements = [...deduped.values()];
  const advisory = durationMentions.length > 1 && !explicitTotal ? ["Several section lengths are mentioned; total duration is not a hard requirement"] : [];
  const constructionRequirements: NativeBriefIntent["constructionRequirements"] = [];
  if (/\b(?:shared|group|drum bus)[^.!?;]{0,60}\bparallel\b|\bparallel[^.!?;]{0,60}\b(?:shared|group|drum bus)\b/i.test(direction)) constructionRequirements.push("shared-parallel-drums");
  if (/\bsidechain(?:ed|ing)?\b/i.test(direction) && !/\b(?:no|without|avoid)\s+sidechain/i.test(direction)) constructionRequirements.push("sidechain");
  if (/\bautomat(?:e|ed|ion)\b/i.test(direction) && !/\b(?:no|without|avoid)\s+automat/i.test(direction)) constructionRequirements.push("automation");
  const global = boundedRequirements.filter((rule) => !rule.section);
  for (const role of roles) if (global.some((rule) => rule.label === role.label && rule.kind === "absent") && global.some((rule) => rule.label === role.label && ["required", "change"].includes(rule.kind))) advisory.push(`Conflicting global ${role.label} instructions need a stated interpretation`);
  const conflicted = new Set(advisory.filter((item) => item.startsWith("Conflicting global")).map((item) => item.split(" ")[2]));
  return {
    totalBars, tempoBpm, meter, sectionLengths, sectionSpans, chordProgressions, requirements: boundedRequirements,
    requiredRoles: unique(boundedRequirements.filter((rule) => !rule.section && ["required", "change"].includes(rule.kind) && !conflicted.has(rule.label)).map(({ label, matches }) => ({ label, matches }))),
    excludedRoles: unique(boundedRequirements.filter((rule) => !rule.section && rule.kind === "absent" && !conflicted.has(rule.label)).map(({ label, matches }) => ({ label, matches }))),
    sectionRequirements: unique(boundedRequirements.filter((rule) => rule.section && ["required", "change"].includes(rule.kind)).map(({ section, label, matches }) => ({ section: section!, label, matches }))),
    sectionExclusions: unique(boundedRequirements.filter((rule) => rule.section && rule.kind === "absent").map(({ section, label, matches }) => ({ section: section!, label, matches }))),
    preservedRoles: unique(boundedRequirements.filter((rule) => rule.kind === "preserve" && !rule.section).map(({ label, matches }) => ({ label, matches }))),
    sectionPreservations: unique(boundedRequirements.filter((rule) => rule.kind === "preserve" && rule.section).map(({ section, label, matches }) => ({ section: section!, label, matches }))),
    changeRoles: unique(boundedRequirements.filter((rule) => rule.kind === "change").map(({ label, matches }) => ({ label, matches }))),
    changeRequirements: unique(boundedRequirements.filter((rule) => rule.kind === "change")),
    constructionRequirements,
    advisory
  };
}
