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
  constructionRequirements: Array<"shared-parallel-drums" | "sidechain" | "automation">;
  advisory: string[];
}

const scope = (text: string): string | null => {
  const found = /\b(?:in|during|throughout|for)\s+(?:the\s+)?([a-z][a-z0-9 -]{0,38}?)(?:\s+section)?(?=\s*(?:[,;.!?]|$|\band\b|\bbut\b|\bthen\b))/i.exec(text.trim());
  const name = found?.[1]?.trim().toLowerCase().replace(/^(?:for|in)\s+(?:the\s+)?/, "") ?? null;
  return name && !/^(?:a|an|the|one|total|overall)$/.test(name) && !/^(?:(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+bars?)$/.test(name) ? name : null;
};
const unique = <T extends RoleRule>(rules: T[]): T[] => rules.filter((rule, index) => rules.findIndex((other) => other.label === rule.label && ("section" in other ? other.section : null) === ("section" in rule ? rule.section : null)) === index);

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
    for (let index = 0; index < mentions.length; index++) {
      const mention = mentions[index]!;
      const previous = mentions[index - 1]?.end ?? 0;
      const next = mentions[index + 1]?.index ?? sentence.length;
      const before = sentence.slice(previous, mention.index);
      const after = sentence.slice(mention.end, next);
      const near = `${before}${sentence.slice(mention.index, mention.end)}${after}`;
      const preserving = /\b(?:without\s+(?:changing|altering|touching)|keep|preserve|leave)\b/i.test(before.slice(-65));
      const negated = /\b(?:no|without|omit|exclude|skip|remove|do not use|don't use)\s*(?:any\s+)?$/i.test(before.trimEnd());
      const optional = /\b(?:maybe|perhaps|optionally|optional|could|if useful)\b/i.test(before);
      const changing = /\b(?:change|alter|brighten|darken|simplify|develop|vary|make)\b/i.test(before.slice(-65));
      const section = scope(after) ?? scope(before);
      const kind: NativeRequirement["kind"] = preserving ? "preserve" : negated ? "absent" : optional ? "ambiguous" : changing ? "change" : "required";
      const start = (chunk.index ?? 0) + previous;
      requirements.push({ kind, section, label: mention.role.label, matches: mention.role.matches, evidence: { start, end: (chunk.index ?? 0) + next, text: near.trim().slice(0, 180) } });
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
    constructionRequirements,
    advisory
  };
}
