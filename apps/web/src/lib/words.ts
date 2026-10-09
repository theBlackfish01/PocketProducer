// Mirrors packages/core/src/domain/words.ts so the browser matches names exactly
// as the server does (compatibility forms and typographic apostrophes folded).
const segmenter = new Intl.Segmenter("en", { granularity: "word" })

/** Lower-case words of a label or message, by Unicode word segmentation, so
 * names compare as whole words without hand-written patterns. */
export function words(text: string): string[] {
  return [...segmenter.segment(text.normalize("NFKC").toLocaleLowerCase())].filter((item) => item.isWordLike).map((item) => item.segment.replaceAll("’", "'"))
}
