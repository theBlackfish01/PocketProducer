// Text comparisons by Unicode word segmentation rather than hand-written
// patterns. These compare what a person wrote; they never interpret it.
const segmenter = new Intl.Segmenter("en", { granularity: "word" });

/** Lower-case words of a text, with typographic apostrophes folded. */
export function words(text: string): string[] {
  return [...segmenter.segment(text.normalize("NFKC").toLocaleLowerCase())].filter((item) => item.isWordLike).map((item) => item.segment.replaceAll("’", "'"));
}

/** Whether `needle`'s words appear contiguously, in order, in `haystack`. */
export function containsWords(haystack: string, needle: string): boolean {
  const all = words(haystack), part = words(needle);
  if (!part.length) return false;
  for (let index = 0; index + part.length <= all.length; index++) if (part.every((word, offset) => all[index + offset] === word)) return true;
  return false;
}

const units: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const tens: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** Numbers written in a text, as digit runs or English number words up to 99. */
export function writtenNumbers(text: string): number[] {
  const values: number[] = [];
  let digits = "";
  for (const char of `${text} `) {
    if (char >= "0" && char <= "9") digits += char;
    else if (digits) { values.push(Number(digits)); digits = ""; }
  }
  const tokens = words(text);
  for (let index = 0; index < tokens.length; index++) {
    const ten = tens[tokens[index]!], unit = units[tokens[index]!];
    const next = units[tokens[index + 1] ?? ""];
    if (ten !== undefined && next !== undefined && next < 10) { values.push(ten + next); index++; }
    else if (ten !== undefined) values.push(ten);
    else if (unit !== undefined) values.push(unit);
  }
  return values;
}
