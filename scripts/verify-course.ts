import { mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, type Page } from "@playwright/test";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const courseUrl = pathToFileURL(resolve("docs/pocket-producer-course/index.html")).href;
const evidenceDirectory = resolve(".local/evidence");
await mkdir(evidenceDirectory, { recursive: true });

async function assertStructure(page: Page): Promise<void> {
  assert(await page.locator(".module").count() === 8, "Expected eight course chapters");
  assert(await page.locator(".chapter-nav a").count() === 8, "Expected eight chapter links");
  assert(await page.locator("[data-tabs]").count() === 5, "Expected five explanatory tab groups");
  assert(await page.locator("[data-stepper]").count() === 3, "Expected three process steppers");
  assert(await page.locator(".quiz-container").count() === 0, "Old required quizzes remain");
  const text = await page.locator("main").textContent() ?? "";
  for (const topic of ["native v2", "SKIP LOCKED", "apply_native_batch", "Gemini", "nexus-native-v7", "not a recording", "immutable", "unknown liability"]) {
    assert(text.toLowerCase().includes(topic.toLowerCase()), `Course is missing ${topic}`);
  }
  for (const href of await page.locator('a[href]:not([href^="#"])').evaluateAll((anchors) => anchors.map((anchor) => anchor.getAttribute("href")))) {
    assert(href, "Course link has no href");
    const target = fileURLToPath(new URL(href, courseUrl));
    await stat(target).catch(() => { throw new Error(`Broken local course link: ${href}`); });
  }
}

async function jumpTo(page: Page, selector: string): Promise<void> {
  await page.locator(selector).evaluate((element) => {
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo(0, window.scrollY + element.getBoundingClientRect().top - 115);
  });
  await page.waitForTimeout(100);
}

const browser = await chromium.launch();
try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const desktopErrors: string[] = [];
  desktop.on("pageerror", (error) => desktopErrors.push(error.message));
  await desktop.goto(courseUrl, { waitUntil: "load" });
  await assertStructure(desktop);
  await desktop.locator("#mode-source").click();
  assert(await desktop.locator("#mode-source-panel").isVisible(), "Product lens did not switch to source sounds");
  assert(await desktop.locator("#mode-native-panel").isHidden(), "Native panel remained visible");
  await desktop.locator("#mode-source").press("ArrowLeft");
  assert(await desktop.locator("#mode-native-panel").isVisible(), "Keyboard tab navigation failed");
  assert(await desktop.locator("#mode-native").getAttribute("aria-selected") === "true", "Keyboard tab state was not exposed");

  const jobStepper = desktop.locator("#module-2 [data-stepper]");
  await jobStepper.locator(".step-dot").last().click();
  assert(await jobStepper.locator(".step-panel").last().isVisible(), "Job stepper did not jump to the final step");
  assert(await jobStepper.locator(".step-next").isDisabled(), "Final step did not disable Next");
  await jobStepper.locator(".step-prev").click();
  assert(await jobStepper.locator(".step-count").innerText() === "05 / 06", "Stepper previous state failed");

  await desktop.locator('.chapter-nav a[href="#module-7"]').click();
  assert(new URL(desktop.url()).hash === "#module-7", "Chapter navigation did not update the location");
  await jumpTo(desktop, "#module-7");
  await desktop.screenshot({ path: resolve(evidenceDirectory, "course-desktop.png") });
  assert(desktopErrors.length === 0, `Desktop page errors: ${desktopErrors.join("; ")}`);
  await desktop.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  const mobileErrors: string[] = [];
  mobile.on("pageerror", (error) => mobileErrors.push(error.message));
  await mobile.goto(courseUrl, { waitUntil: "load" });
  await assertStructure(mobile);
  await mobile.locator("#room-compare").click();
  assert(await mobile.locator("#room-compare-panel").isVisible(), "Mobile comparison explanation did not open");
  await jumpTo(mobile, "#module-6");
  const dimensions = await mobile.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
  assert(dimensions.content <= dimensions.viewport, `Phone page overflows horizontally (${dimensions.content}px > ${dimensions.viewport}px)`);
  await mobile.screenshot({ path: resolve(evidenceDirectory, "course-mobile.png") });
  assert(mobileErrors.length === 0, `Mobile page errors: ${mobileErrors.join("; ")}`);
  await mobile.close();
} finally {
  await browser.close();
}

process.stdout.write("Course verification passed: eight chapters, local links, explanatory tabs/steppers, keyboard navigation, desktop and 390px phone layout.\n");
