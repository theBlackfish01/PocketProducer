import type { NativeDocument } from "./model.js";

type Role = NativeDocument["parts"][number]["role"];
const roles: Array<{ label: string; pattern: RegExp; matches: Role[] }> = [
  { label: "drums", pattern: /\b(?:drums?|percussion|beat)\b/i, matches: ["percussion"] },
  { label: "bass", pattern: /\bbass\b/i, matches: ["bass"] },
  { label: "harmony", pattern: /\b(?:harmony|chords?|pad)\b/i, matches: ["harmony", "texture"] },
  { label: "lead or melody", pattern: /\b(?:lead|melody|melodic)\b/i, matches: ["lead", "melody"] },
  { label: "transitions", pattern: /\b(?:transitions?|risers?|fills?)\b/i, matches: ["fx"] }
];

export interface NativeBriefIntent {
  totalBars: number | null;
  requiredRoles: Array<{ label: string; matches: Role[] }>;
  excludedRoles: Array<{ label: string; matches: Role[] }>;
  sectionExclusions: Array<{ section: string; label: string; matches: Role[] }>;
  advisory: string[];
}

// This is intentionally a conservative extraction of hard, checkable claims.
// The model may plan richer music, but it cannot turn an ambiguous mention into
// a completion veto or reverse a user's explicit exclusion.
export function interpretNativeBrief(direction: string): NativeBriefIntent {
  const text = direction.toLowerCase();
  const durationMentions = [...text.matchAll(/\b(\d{1,3})\s*[- ]?bars?\b/g)];
  const explicitTotal = durationMentions.filter((mention, index) => /\b(?:in total|overall|altogether|entire piece)\b/.test(text.slice(mention.index + mention[0].length, Math.min(text.length, durationMentions[index + 1]?.index ?? text.length)).slice(0, 45))).at(-1);
  const totalBars = explicitTotal ? Number(explicitTotal[1]) : durationMentions.length === 1 && !/\b(?:intro|opening|verse|chorus|section|bridge|outro|break|ending)\b/.test(text.slice(Math.max(0, durationMentions[0]!.index - 12), durationMentions[0]!.index + durationMentions[0]![0].length + 18)) ? Number(durationMentions[0]![1]) : null;
  const clauses = text.split(/[.;!?\n]+|,(?=\s*(?:then|but|and then))/).map((value) => value.trim()).filter(Boolean);
  const optionalPattern = /\b(?:maybe|perhaps|optionally|optional|could|if useful)\b/;
  const exclusionPattern = /\b(?:no|without|omit|exclude|skip|do not use|don't use|remove)\b/;
  const sectionPattern = /\b(?:in|during|throughout|for|from)\s+(?:the\s+)?([a-z][a-z0-9 -]{0,40}?)\s*(?:section|part)?\s*$/;
  const requiredRoles: NativeBriefIntent["requiredRoles"] = [];
  const excludedRoles: NativeBriefIntent["excludedRoles"] = [];
  const sectionExclusions: NativeBriefIntent["sectionExclusions"] = [];
  for (const role of roles) {
    const mentions = clauses.flatMap((clause) => clause.split(/\b(?:but|then|instead|while|and then)\b/).flatMap((piece) => piece.split(/(?=\b(?:with\s+no|and\s+no|without|no|do not use|don't use|omit|exclude|skip|remove)\b)/)).map((piece) => piece.trim())).filter((clause) => role.pattern.test(clause));
    if (!mentions.length) continue;
    let positive = false;
    for (const clause of mentions) {
      const negative = exclusionPattern.test(clause);
      const scoped = negative ? sectionPattern.exec(clause) : null;
      if (negative && scoped) sectionExclusions.push({ section: scoped[1]!.trim(), label: role.label, matches: role.matches });
      else if (negative) excludedRoles.push({ label: role.label, matches: role.matches });
      else if (!optionalPattern.test(clause)) positive = true;
    }
    if (positive && !excludedRoles.some((item) => item.label === role.label)) requiredRoles.push({ label: role.label, matches: role.matches });
  }
  return { totalBars, requiredRoles, excludedRoles, sectionExclusions, advisory: durationMentions.length > 1 && !explicitTotal ? ["Several section lengths are mentioned; total duration is not a hard requirement"] : [] };
}
