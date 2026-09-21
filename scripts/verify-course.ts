import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Page } from "@playwright/test";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function assertCourseStructure(page: Page): Promise<void> {
  assert(await page.locator(".module").count() === 6, "Expected six course modules");
  assert(await page.locator(".nav-dot").count() === 6, "Expected six module navigation controls");
  assert(await page.locator(".quiz-container").count() === 6, "Expected one quiz per module");
  assert(await page.locator(".quiz-question-block").count() === 18, "Expected three questions per module");
}

async function jumpTo(page: Page, selector: string): Promise<void> {
  await page.locator(selector).evaluate((element) => {
    document.documentElement.style.scrollBehavior = "auto";
    window.scrollTo(0, window.scrollY + element.getBoundingClientRect().top - 96);
  });
  await page.waitForTimeout(250);
}

const courseUrl = pathToFileURL(resolve("docs/pocket-producer-course/index.html")).href;
const evidenceDirectory = resolve(".local/evidence");
await mkdir(evidenceDirectory, { recursive: true });

const browser = await chromium.launch();
try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const desktopErrors: string[] = [];
  desktop.on("pageerror", (error) => desktopErrors.push(error.message));
  await desktop.goto(courseUrl, { waitUntil: "load" });
  await assertCourseStructure(desktop);

  const fifthModuleNav = desktop.getByRole("tab", { name: "Module 5: Gemini and Nexus Boundaries" });
  await fifthModuleNav.click();
  await jumpTo(desktop, "#module-5");
  const quiz = desktop.locator("#quiz-module5");
  for (const question of await quiz.locator(".quiz-question-block").all()) {
    const answer = await question.getAttribute("data-correct");
    assert(answer, "Quiz question is missing its correct-answer key");
    await question.locator(`.quiz-option[data-value="${answer}"]`).click();
  }
  await quiz.getByRole("button", { name: "Check Answers" }).click();
  assert(await quiz.locator(".quiz-feedback.success").count() === 3, "Module 5 quiz did not score all correct answers");
  await jumpTo(desktop, "#module-5");
  const desktopHeading = await desktop.locator("#module-5 .module-title").boundingBox();
  assert(desktopHeading && desktopHeading.y < 300, "Desktop capture did not reach the Gemini and Nexus module heading");
  await desktop.screenshot({ path: resolve(evidenceDirectory, "course-desktop.png") });
  assert(desktopErrors.length === 0, `Desktop course page errors: ${desktopErrors.join("; ")}`);
  await desktop.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  const mobileErrors: string[] = [];
  mobile.on("pageerror", (error) => mobileErrors.push(error.message));
  await mobile.goto(courseUrl, { waitUntil: "load" });
  await assertCourseStructure(mobile);
  await jumpTo(mobile, "#module-6");
  const mobileHeading = await mobile.locator("#module-6 .module-title").boundingBox();
  assert(mobileHeading && mobileHeading.y < 300, "Mobile capture did not reach the quality module heading");
  const dimensions = await mobile.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
  assert(dimensions.content <= dimensions.viewport, `Mobile course overflows horizontally (${dimensions.content}px > ${dimensions.viewport}px)`);
  await mobile.screenshot({ path: resolve(evidenceDirectory, "course-mobile.png") });
  assert(mobileErrors.length === 0, `Mobile course page errors: ${mobileErrors.join("; ")}`);
  await mobile.close();
} finally {
  await browser.close();
}

process.stdout.write("Course verification passed: 6 modules, 18 quiz questions, desktop interaction, and 390px mobile layout.\n");
