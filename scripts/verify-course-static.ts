import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const courseDirectory = resolve("docs/pocket-producer-course");
const moduleDirectory = join(courseDirectory, "modules");
const modules = (await readdir(moduleDirectory)).filter((file) => file.endsWith(".html")).sort();
assert(modules.length === 8, "Expected eight source chapters");
const source = [join(courseDirectory, "_base.html"), ...modules.map((file) => join(moduleDirectory, file)), join(courseDirectory, "_footer.html")];
const expected = (await Promise.all(source.map((file) => readFile(file, "utf8")))).join("");
const generated = await readFile(join(courseDirectory, "index.html"), "utf8");
assert(generated === expected, "Generated course is stale; rerun build.ps1 or build.sh");

const matches = (pattern: RegExp): string[] => [...generated.matchAll(pattern)].map((match) => match[1] ?? match[0]);
assert(matches(/<section class="module"/g).length === 8, "Expected eight generated chapters");
assert(matches(/<div class="interactive" data-tabs>/g).length === 5, "Expected five explanatory tab groups");
assert(matches(/<div class="interactive" data-stepper>/g).length === 3, "Expected three process steppers");
assert(!generated.includes("quiz-container"), "Old required quiz markup remains");
assert(!generated.includes("https://"), "Course should not require external assets");

const ids = matches(/\bid="([^"]+)"/g);
assert(new Set(ids).size === ids.length, "Course contains duplicate element IDs");
const tabs = [...generated.matchAll(/<button id="([^"]+)" role="tab" aria-controls="([^"]+)"/g)];
assert(tabs.length >= 12, "Expected substantive explanatory tab controls");
for (const [, id, panel] of tabs) {
  assert(generated.includes(`id="${panel}" role="tabpanel" aria-labelledby="${id}"`), `Tab ${id} has no matching panel`);
}
for (const href of matches(/<a\b[^>]*\bhref="([^"]+)"/g)) {
  if (href.startsWith("#")) {
    assert(ids.includes(href.slice(1)), `Broken internal anchor: ${href}`);
    continue;
  }
  const target = resolve(dirname(join(courseDirectory, "index.html")), href);
  await stat(target).catch(() => { throw new Error(`Broken local link: ${href}`); });
}
for (const topic of ["native v2", "SKIP LOCKED", "apply_native_batch", "nexus-native-v7", "Gemini", "unknown liability", "not a recording"]) {
  assert(generated.toLowerCase().includes(topic.toLowerCase()), `Missing key subject: ${topic}`);
}
assert(!generated.includes('id="mode-legacy"'), "Retired product mode returned to the course");
assert(generated.includes('id="mode-source"'), "Source-audition explanation is missing");
assert(!generated.includes("nexus-native-v6"), "Stale mapper version in the current course");
const walkthroughPath = resolve("docs/PROJECT-WALKTHROUGH.md");
const walkthrough = await readFile(walkthroughPath, "utf8");
for (const [, href] of walkthrough.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
  assert(href, "Walkthrough link has no target");
  if (/^(?:https?:|#)/.test(href)) continue;
  await stat(resolve(dirname(walkthroughPath), href)).catch(() => { throw new Error(`Broken walkthrough link: ${href}`); });
}
await stat(join(courseDirectory, "course.css"));
await stat(join(courseDirectory, "course.js"));
process.stdout.write("Static course verification passed: generated source, eight chapters, local links, unique IDs, tab relationships, and evidence labels.\n");
