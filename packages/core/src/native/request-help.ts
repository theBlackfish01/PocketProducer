/** Deliberately recognizes only complete playback-help questions, never a mixed edit. */
export function isPlaybackHelp(direction: string): boolean {
  return /^(?:please\s+)?(?:how (?:can|do) i (?:hear|listen to|play|open) (?:it|this|the (?:song|music|arrangement|project))|where (?:can|do) i (?:hear|play|listen to) (?:it|this)|how do i open (?:it in )?audiotool)[?!.\s]*$/i.test(direction.trim());
}

export const playbackHelp = "To listen, finish the arrangement, then use Copy to Audiotool. When the copy is confirmed, choose Open in Audiotool and press Play there. Pocket Producer previews individual source sounds, not the whole arrangement.";

export function requireMusicalDirection(direction: unknown): void {
  if (typeof direction === "string" && isPlaybackHelp(direction)) throw Object.assign(new Error(playbackHelp), { statusCode: 422, code: "PLAYBACK_HELP" });
}

/** Identity is qualitative; explicit exact preservation still takes precedence. */
export function qualitativeIdentity(quote: string): boolean {
  return /\b(?:recogniz(?:able|ably)|identifiable|(?:melodic|musical|thematic) identity)\b/i.test(quote)
    && !/\b(?:unchanged|exactly|identical|untouched|unaltered|as written|same notes|(?:do not|don't|without) (?:chang(?:e|ing)|modify(?:ing)?|alter(?:ing)?))\b/i.test(quote);
}
