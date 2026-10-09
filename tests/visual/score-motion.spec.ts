import { expect, test, type Locator, type Page } from "@playwright/test"
import { mkdir, writeFile } from "node:fs/promises"
import { cpus, platform } from "node:os"
import { encodeWav, nativeFingerprint, type NativeDocument } from "@pocket/core"

const evidence = ".local/evidence"
const projectId = "visual-room"
async function expectReadableText(locator: Locator) {
  const ratio = await locator.evaluate((element) => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1
    const context = canvas.getContext("2d")!
    context.fillStyle = "white"; context.fillRect(0, 0, 1, 1)
    const ancestors: Element[] = []; for (let node: Element | null = element; node; node = node.parentElement) ancestors.unshift(node)
    for (const node of ancestors) { context.fillStyle = getComputedStyle(node).backgroundColor; context.fillRect(0, 0, 1, 1) }
    const background = context.getImageData(0, 0, 1, 1).data.slice(0, 3)
    context.fillStyle = getComputedStyle(element).color; context.fillRect(0, 0, 1, 1)
    const foreground = context.getImageData(0, 0, 1, 1).data.slice(0, 3)
    const luminance = (rgb: Uint8ClampedArray) => [...rgb].reduce((sum, channel, i) => { const value = channel / 255; return sum + (value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i]! }, 0)
    const light = Math.max(luminance(background), luminance(foreground)), dark = Math.min(luminance(background), luminance(foreground))
    return (light + .05) / (dark + .05)
  })
  expect(ratio, `text contrast for ${await locator.textContent()}`).toBeGreaterThanOrEqual(4.5)
}
function documentFixture(): NativeDocument {
  return {
    schemaVersion: 2, ppq: 960, title: "Night Drive", direction: "Warm, unhurried and spacious", currentObjective: "Let the theme breathe", assumptions: [], tempoBpm: 96, meter: { numerator: 4, denominator: 4 }, bars: 64,
    sections: ["Opening", "Bloom", "Suspension", "Ascent", "Release"].map((name, i) => ({ id: `section-${i}`, name, startBar: [0, 8, 24, 40, 56][i]!, endBar: [8, 24, 40, 56, 64][i]!, intent: "Space for the theme to develop" })),
    parts: ["Soft pulse", "Sub foundation", "Wide pad", "Glass keys", "Slow lead", "Counterphrase", "Air layer", "Transition accents"].map((name, i) => ({
      id: `part-${i}`, name, role: (["percussion", "bass", "harmony", "harmony", "melody", "lead", "texture", "fx"] as const)[i]!, device: { type: "heisenberg", parameters: {} }, gain: .7, pan: 0,
      notes: Array.from({ length: 64 }, (_, bar) => ({ id: `note-${bar}`, startTick: bar * 3840 + (i % 2) * 480, durationTicks: i === 0 ? 240 : 1440, pitch: 48 + i * 3 + bar % 4, velocity: .6 })), placements: [], sourceRegions: [], effects: [], automation: i === 2 ? [{ id: "swell", target: "gain", points: [{ tick: 0, value: .2, interpolation: "linear" }, { tick: 245760, value: .8 }] }] : []
    })), motifs: [], protectedPartIds: ["part-1"], protectedMotifIds: [], sourceAssetIds: [], audio: { state: "deferred", revisionId: null, assetHash: null }
  }
}

async function mockRoom(page: Page, options: { draft?: boolean; large?: boolean; short?: boolean; paused?: boolean; audiotool?: boolean; ownedSound?: boolean; verifiedMapping?: string } = {}) {
  const before = documentFixture()
  if (options.short) {
    // A 16-bar piece whose third section has a long agent-written name.
    before.bars = 16
    before.sections = ["Opening", "Bloom", "Middle — open the window and let the light in", "Release"].map((name, i) => ({ id: `section-${i}`, name, startBar: i * 4, endBar: (i + 1) * 4, intent: "Space for the theme to develop" }))
    for (const part of before.parts) { part.notes = part.notes.filter((note) => note.startTick < 16 * 3840); part.automation = [] }
  }
  const after = structuredClone(before)
  after.parts[0]!.notes[0]!.pitch += 12; after.parts[0]!.notes[0]!.startTick += 480; after.parts[0]!.notes[0]!.durationTicks += 240
  after.parts[0]!.notes.splice(1, 1)
  if (options.large) {
    before.bars = after.bars = 128; before.sections.at(-1)!.endBar = after.sections.at(-1)!.endBar = 128
    before.parts = [...before.parts, ...before.parts.map((part) => ({ ...part, id: `${part.id}-b`, name: `${part.name} II` })), ...before.parts.map((part) => ({ ...part, id: `${part.id}-c`, name: `${part.name} III` }))]
    after.parts = [...after.parts, ...before.parts.slice(8)]
  }
  let draft = before, step = 1, writes = 0, completed = false, abandoned = false
  let sampleFeedback: { sampleName: string; contentHash: string; rating: string; note: string; updatedAt: string } | null = null
  const sampleHash = "a".repeat(64), sampleName = "samples/fixture-short-hit"
  const job = () => ({ id: "visual-job", project_id: projectId, kind: "native-revision", state: abandoned ? "cancelled" : completed ? "succeeded" : options.paused ? "needs_attention" : "running", stage: "constructing", error_code: abandoned ? "NATIVE_ABANDONED" : options.paused ? "NATIVE_PARTIAL" : null })
  const version = (document: NativeDocument, ordinal: number) => ({ id: `version-${ordinal}`, parentRevisionId: ordinal === 2 ? "version-1" : null, ordinal, document, documentHash: `hash-${ordinal}`, changeSummary: "Shape the opening pulse", producer: {}, structuralDiff: { addedParts: [], changedParts: ["part-0"], changedSections: [], protectionChange: { added: [], removed: [] } }, createdAt: "2026-09-26T00:00:00Z", fingerprint: nativeFingerprint(document) })
  const versions = [version(after, 2), version(before, 1)]
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    let json: unknown
    if (path.endsWith("/auth/session")) json = { mode: "development", user: { ownerId: "fixture", displayName: "Fixture" } }
    else if (path.endsWith("/integrations/audiotool/profile")) json = { profile: { userName: "fixture", displayName: "Fixture musician", avatarUrl: null } }
    else if (path.endsWith("/producer-models")) json = { models: [{ id: "gpt-6-luna", label: "GPT-6 Luna", provider: "openai", available: true }] }
    else if (path.endsWith("/status")) json = { providers: { openai: false, gemini: false, audiotool: Boolean(options.audiotool) }, uploadFormats: ["audio/wav"], nexus: { sdk: "fixture", liveExportVerified: false, connection: options.audiotool ? "authorized" : "unconfigured", oauth: options.audiotool ? { clientId: "fixture", redirectUrl: "http://127.0.0.1:15174/auth/audiotool/callback", scope: "project:write" } : null, session: { connected: Boolean(options.audiotool), userName: options.audiotool ? "fixture" : null, expiresAt: null } } }
    else if (path.endsWith("/projects")) json = { projects: [{ id: projectId, title: "Night Drive", currentRevisionId: "version-2", version: 1, createdAt: "2026-09-26", workspaceStatus: "ready", fingerprint: nativeFingerprint(after) }] }
    else if (path.endsWith(`/projects/${projectId}`)) json = { project: { id: projectId, title: "Night Drive", currentRevisionId: null }, assets: options.ownedSound ? [{ id: "owned-fixture", name: "Own sound", audioUrl: "/api/v1/assets/fixture/audio", durationSeconds: 8, sampleRate: 8_000, channels: 2 }] : [], revisions: [], analyses: [], latestJob: null, currentRevision: null }
    else if (path.endsWith("/activity/stream")) { await route.abort(); return }
    else if (path.endsWith("/activity")) json = { events: [], cursor: 0, nextCursor: 0, hasOlder: false, job: options.draft ? job() : null, headId: completed ? "version-3" : "version-2", draft: options.draft ? { step, hash: `draft-${step}` } : null, actions: { canSubmit: abandoned || completed || !options.draft, canStop: Boolean(options.draft && !options.paused), canAbandon: options.paused && !abandoned, issue: options.paused && !abandoned ? "paused" : null }, allowance: { remainingUsd: 5, standardUsd: 5, extendedUsd: 5 } }
    else if (path.endsWith("/native")) json = { currentRevisionId: completed ? "version-3" : "version-2", headVersion: completed ? 3 : 2, current: completed ? version(after, 3) : versions[0], versions: completed ? [version(after, 3), ...versions] : versions, context: null, comparisons: {}, synchronization: options.verifiedMapping ? { state: "verified", mappingVersion: options.verifiedMapping, projectId: "projects/fixture", revisionId: "version-2", url: "https://offline.invalid/studio" } : { state: "local_only", projectId: null, revisionId: null, url: null }, playback: "deferred" }
    else if (path.endsWith("/interpretations")) json = { interpretationId: "00000000-0000-4000-8000-000000000b1e", provenance: "fixture", checks: [], keep: [], guidance: [], rejected: [] }
    else if (path.endsWith("/capabilities")) json = { matches: [], totalEntities: 0, version: "test" }
    else if (path.endsWith("/sound-recipes")) json = { version: "local-palette-v2", recipes: [{ id: "rubber-pulse", name: "Rubber pulse", character: "Short syncopated bass with upper harmonics", role: "bass", provenance: "Original parameter recipe; unheard", version: "local-palette-v2", configurationHash: "b".repeat(64), auditionStatus: "unheard", guidance: { register: "Low register", articulation: "Short syncopated notes", usefulMotion: "Open the filter", failureMode: "Too much low sustain" }, device: { type: "heisenberg", parameters: {} }, effects: [], heard: false }] }
    else if (path.endsWith("/library/samples")) json = { samples: [{ name: sampleName, displayName: "Short hit", ownerName: "Fixture artist", durationSeconds: 1, bpm: 120, sampleKind: "one-shot", tags: [] }], nextPageToken: "", provenance: "Fixture metadata" }
    else if (path.endsWith("/library/sample-analysis")) json = { sample: { name: sampleName, displayName: "Short hit" }, contentHash: sampleHash, measured: { durationSeconds: 4, leadingSilenceSeconds: 0, suggestedSlices: [{ startSeconds: 0, endSeconds: 0.25, reason: "Measured activity" }], limitations: "Energy-based candidate only." }, provenance: "Fixture decoded WAV" }
    else if (path.endsWith("/library/sample-audio")) { await route.fulfill({ contentType: "audio/wav", body: encodeWav(new Float32Array(32_000).fill(0.2), new Float32Array(32_000).fill(0.2), 8_000) }); return }
    else if (path.endsWith("/assets/fixture/audio")) { await route.fulfill({ contentType: "audio/wav", body: encodeWav(new Float32Array(64_000).fill(0.2), new Float32Array(64_000).fill(0.2), 8_000) }); return }
    else if (path.endsWith("/sound-feedback") && route.request().method() === "POST") { sampleFeedback = { ...(route.request().postDataJSON() as { sampleName: string; contentHash: string; rating: string; note: string }), updatedAt: "2026-09-27T00:00:00Z" }; json = { feedback: sampleFeedback }; writes++ }
    else if (path.endsWith("/sound-feedback")) json = { feedback: sampleFeedback ? [sampleFeedback] : [] }
    else if (path.endsWith("/jobs/visual-job")) json = { ...job(), events: [] }
    else if (path.endsWith("/abandon")) { abandoned = true; writes++; json = { jobId: "visual-job", abandoned: true } }
    else if (path.endsWith("/draft")) json = { jobId: "visual-job", state: "running", document: draft, documentHash: `draft-${step}`, selected: false, stepCount: step, baseRevisionId: "version-2", headMatches: true, canContinue: false, canExtend: false, continuationReason: null }
    else { writes++; await route.fulfill({ status: 400, json: { message: `Unexpected fixture request: ${path}` } }); return }
    await route.fulfill({ json })
  })
  if (options.draft) await page.addInitScript(({ projectId }) => localStorage.setItem(`pocket-producer:native-receipt:${projectId}`, JSON.stringify({ operation: "native-revision", key: "visual", jobId: "visual-job", signature: "visual" })), { projectId })
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto(`/sessions/${projectId}`)
  await expect(page.getByRole("heading", { name: "Night Drive", exact: true })).toBeVisible()
  return { before, after, setDraft: (value: NativeDocument, count: number) => { draft = value; step = count }, writes: () => writes, complete: () => { completed = true } }
}

test.beforeAll(async () => { await mkdir(evidence, { recursive: true }) })

test("desktop session rail stays viewport-height while the room and recent sessions scroll independently", async ({ page }) => {
  await mockRoom(page, { large: true, audiotool: true })
  await page.route("**/api/v1/projects", route => route.fulfill({ json: { projects: Array.from({ length: 40 }, (_, i) => ({ id: i ? `room-${i}` : projectId, title: i ? `Session ${i}` : "Night Drive", currentRevisionId: null, version: 1, createdAt: "2026-09-26" })) } }))
  // Session navigation may arrive before the much larger arrangement response.
  await page.route(`**/api/v1/projects/${projectId}/native`, async route => {
    await new Promise(resolve => setTimeout(resolve, 500))
    await route.fallback()
  })
  await page.reload()
  await page.setViewportSize({ width: 1440, height: 800 })
  const rail = page.getByRole("complementary", { name: "Session navigation" })
  await expect(rail.getByRole("button", { name: "Session 39", exact: true })).toBeAttached()
  await expect(page.getByRole("heading", { name: "Your arrangement", exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)).toBeGreaterThan(100)
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100)
  await expect.poll(async () => (await rail.boundingBox())!.y).toBe(0)
  expect((await rail.boundingBox())!.height).toBe(800)
  await expect(rail.locator(".brand-lockup")).toBeInViewport()
  await expect(rail.locator(".account-row")).toBeInViewport()
  const pageY = await page.evaluate(() => window.scrollY)
  await rail.locator(".rail-list").evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect(rail.getByRole("button", { name: "Session 39", exact: true })).toBeInViewport()
  expect(await page.evaluate(() => window.scrollY)).toBe(pageY)
  await page.screenshot({ path: `${evidence}/sidebar-scrolled-desktop.png` })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => window.scrollTo(0, 0))
  await expect(rail).toBeHidden()
  const open = page.getByRole("button", { name: "Open sessions" })
  await open.click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.getByRole("dialog").getByRole("button", { name: "Session 39", exact: true }).scrollIntoViewIfNeeded()
  await expect(page.getByRole("dialog").getByRole("button", { name: "Session 39", exact: true })).toBeInViewport()
  await page.screenshot({ path: `${evidence}/sidebar-mobile-navigation.png` })
  await page.keyboard.press("Escape")
  await expect(open).toBeFocused()
})

test("welcome explains the creative loop and compact session status stays accessible", async ({ page }) => {
  const room = await mockRoom(page)
  let creates = 0
  await page.route("**/api/v1/projects", async (route) => {
    if (route.request().method() === "POST") { creates++; await route.fulfill({ json: { project: { id: projectId } } }); return }
    await route.fulfill({ json: { projects: [
      { id: projectId, title: "Night Drive", workspaceStatus: "working" },
      { id: "paused-room", title: "A long and spacious unfinished arrangement", workspaceStatus: "attention" },
      { id: "ready-room", title: "Morning Light", workspaceStatus: "ready" },
    ] } })
  })
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Make room for your next idea." })).toBeVisible()
  await expect(page.locator(".welcome-features article")).toHaveCount(3)
  const main = page.getByRole("main")
  await expect(main).toHaveCSS("background-image", /url\(/)
  expect(await main.evaluate(node => node.getAnimations({ subtree: true }).length)).toBe(0)
  await page.emulateMedia({ forcedColors: "active" })
  await expect(main).toHaveCSS("background-image", "none")
  await expect(main.getByRole("button", { name: "New session" })).toBeEnabled()
  await page.emulateMedia({ forcedColors: "none" })
  await expect(page.locator(".welcome-room")).toContainText("to Audiotool to listen")
  await expectReadableText(page.locator(".welcome-deck"))
  await expectReadableText(page.locator(".welcome-kicker"))
  const rail = page.getByRole("complementary", { name: "Session navigation" })
  const working = rail.getByRole("button", { name: "Night Drive · Working", exact: true })
  await expect(working).toBeVisible()
  await expect(working.locator("small")).toHaveCount(0)
  const boxes = await working.evaluate((node) => {
    const title = node.querySelector(".rail-session-title")!.getBoundingClientRect()
    const icon = node.querySelector(".rail-session-status")!.getBoundingClientRect()
    return { separate: title.right < icon.left, sameRow: Math.abs((title.top + title.height / 2) - (icon.top + icon.height / 2)) < 2 }
  })
  expect(boxes).toEqual({ separate: true, sameRow: true })
  await expect(rail.getByRole("button", { name: /unfinished arrangement · Paused/ })).toBeVisible()
  await expect(rail.getByRole("button", { name: "Morning Light · Ready", exact: true })).toBeVisible()
  const github = rail.getByRole("link", { name: "GitHub (opens in a new tab)", exact: true })
  await expect(github).toHaveAttribute("href", "https://github.com/theBlackfish01/PocketProducer")
  expect(await github.getAttribute("title")).toBeNull()
  await expect(github).not.toContainText("private")
  await page.screenshot({ path: `${evidence}/welcome-desktop.png`, fullPage: true })
  await page.emulateMedia({ reducedMotion: "reduce" })
  expect(await working.locator(".rail-session-status").evaluate((node) => getComputedStyle(node).animationName)).toBe("none")
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(page.getByRole("main").getByRole("button", { name: "New session" })).toBeInViewport()
  await page.screenshot({ path: `${evidence}/welcome-phone.png`, fullPage: true })
  await page.setViewportSize({ width: 320, height: 740 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(main.getByRole("button", { name: "New session" })).toBeInViewport()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("button", { name: "Open sessions" }).click()
  const menu = page.getByRole("dialog")
  await expect(menu.getByRole("button", { name: "Night Drive · Working", exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("button", { name: "Open sessions" })).toBeFocused()
  const create = page.getByRole("main").getByRole("button", { name: "New session" })
  await create.focus(); await page.keyboard.press("Enter")
  await expect(page).toHaveURL(new RegExp(`/sessions/${projectId}`))
  await expect(page.getByRole("heading", { name: "Night Drive", exact: true })).toBeVisible()
  await expect(main).not.toHaveCSS("background-image", /url\(/)
  expect(creates).toBe(1)
  expect(room.writes()).toBe(0)
})

test("start controls form one footer and early creation focuses on the conversation", async ({ page }) => {
  const room = await mockRoom(page)
  let working = false
  await page.route(`**/projects/${projectId}/native`, (route) => route.fulfill({ json: { currentRevisionId: null, headVersion: 0, current: null, versions: [], synchronization: { state: "local_only" }, playback: "deferred" } }))
  await page.route(`**/projects/${projectId}/activity*`, async (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/stream")) { await route.abort(); return }
    await route.fulfill({ json: { events: working ? [{ cursor: 1, jobId: "visual-job", createdAt: "2026-09-27T12:00:00Z", payload: { version: 1, kind: "approach", text: "A warm melody over a soft pulse, opening into a spacious middle." } }] : [], cursor: working ? 1 : 0, nextCursor: working ? 1 : 0, job: working ? { id: "visual-job", project_id: projectId, kind: "native-generation", state: "running", stage: "planning" } : null, headId: null, draft: null, actions: { canSubmit: !working, canStop: working, issue: null } } })
  })
  await page.route("**/native/requests/visual-job/draft", (route) => route.fulfill({ json: { jobId: "visual-job", state: "running", document: null, documentHash: null, stepCount: 0, canContinue: false, canExtend: false } }))
  await page.reload()
  await expect(page.getByRole("heading", { name: "What would you like to make?" })).toBeVisible()
  // With nothing written there is no request to review, so no scope notice blocks the composer.
  await expect(page.getByRole("button", { name: "I reviewed the updated scope" })).toHaveCount(0)
  await page.getByRole("textbox", { name: "Describe your arrangement" }).fill("A warm melody over a soft pulse, with plenty of space.")
  const submit = page.getByRole("button", { name: "Create arrangement" })
  const rewrite = page.getByRole("button", { name: "Rewrite prompt" })
  expect(Math.abs((await submit.boundingBox())!.y - (await rewrite.boundingBox())!.y)).toBeLessThan(12)
  const options = page.getByRole("button", { name: "Options", exact: true })
  await options.click(); await expect(page.getByRole("dialog", { name: "Creation options" })).toBeVisible()
  await page.keyboard.press("Escape"); await expect(options).toBeFocused()
  await page.screenshot({ path: `${evidence}/clarity-start-desktop.png`, fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: "reduce" })
  expect((await submit.boundingBox())!.y).toBeGreaterThan((await rewrite.boundingBox())!.y)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  await page.screenshot({ path: `${evidence}/clarity-start-phone.png`, fullPage: true })
  working = true; await page.reload()
  await expect(page.locator(".producer-room")).toHaveClass(/is-early/)
  await expect(page.locator(".producer-canvas")).toBeHidden()
  await expect(page.getByRole("button", { name: /^(Draft|Edit) next change$/ })).toBeVisible()
  await expect(page.getByRole("textbox", { name: "Describe your arrangement" })).toBeHidden()
  await page.screenshot({ path: `${evidence}/clarity-creating-phone.png`, fullPage: true })
  expect(room.writes()).toBe(0)
})

test("conversation expansion is a small link with a touch-friendly mobile target", async ({ page, browser }) => {
  const direction = "Create a sparse, gently unfolding instrumental idea with a clear pulse implied by a few soft, widely spaced attacks rather than a busy beat. Let one warm synth tone carry a small, memorable motif; answer it with a thinner, slightly brighter tone that appears only in the gaps. Keep the low end restrained and leave generous space around each phrase. Develop the answer's timing and tone, then let the opening gesture stand alone."
  async function setup(target: Page) {
    await mockRoom(target)
    await target.route("**/api/v1/projects/visual-room/activity*", async (route) => {
      if (new URL(route.request().url()).pathname.endsWith("/stream")) { await route.abort(); return }
      await route.fulfill({ json: { events: [{ cursor: 1, jobId: "visual-job", createdAt: "2026-09-28T06:28:00Z", payload: { version: 1, kind: "request", text: direction } }], cursor: 1, nextCursor: 1, hasOlder: false, job: null, headId: "version-2", draft: null, actions: { canSubmit: true, canStop: false, issue: null } } })
    })
    await target.reload()
  }
  await setup(page)
  const message = page.locator(".producer-message-request")
  await expect(message.getByRole("button", { name: "Read more" })).toBeVisible()
  await page.screenshot({ path: `${evidence}/conversation-link-desktop.png`, fullPage: true })
  await message.getByRole("button", { name: "Read more" }).click()
  await expect(message.locator("p")).toHaveCount(1)
  await expect(message.locator("p")).toHaveText(direction)
  await message.getByRole("button", { name: "Show less" }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${evidence}/conversation-link-expanded.png`, fullPage: true })
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" })
  try {
    const mobile = await phone.newPage()
    await setup(mobile)
    await mobile.setViewportSize({ width: 390, height: 844 })
    await mobile.getByRole("button", { name: "Producer", exact: true }).click()
    const toggle = mobile.getByRole("button", { name: "Read more" })
    await expect(toggle).toBeVisible()
    expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await toggle.tap()
    await expect(mobile.getByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true")
    expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await mobile.screenshot({ path: `${evidence}/conversation-link-phone.png`, fullPage: true })
  } finally { await phone.close() }
})

test("full overview scrolls to its last bar and part, and the logo preserves an unsent direction", async ({ page }) => {
  const room = await mockRoom(page, { large: true })
  const scroll = page.getByRole("region", { name: "Saved arrangement overview" })
  const textbox = page.getByRole("textbox", { name: "Describe your arrangement" })
  await textbox.fill("Leave my next idea here")
  await scroll.focus()
  await page.keyboard.press("ArrowRight")
  await expect.poll(() => scroll.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0)
  await expect.poll(async () => {
    return scroll.evaluate((node) => { node.scrollTo({ left: node.scrollWidth, top: node.scrollHeight, behavior: "instant" }); return Math.abs(node.scrollWidth - node.clientWidth - node.scrollLeft) })
  }).toBeLessThan(2)
  const geometry = await scroll.evaluate((node) => ({ horizontal: node.scrollWidth > node.clientWidth, vertical: node.scrollHeight > node.clientHeight, atEnd: Math.abs(node.scrollWidth - node.clientWidth - node.scrollLeft) < 2, atBottom: Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop) < 2 }))
  expect(geometry).toEqual({ horizontal: true, vertical: true, atEnd: true, atBottom: true })
  await expect(page.getByRole("button", { name: /^Inspect Transition accents III,/ })).toBeInViewport()
  await page.screenshot({ path: `${evidence}/clarity-overview-desktop.png`, fullPage: true })
  await page.getByRole("link", { name: "Pocket Producer home" }).first().click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole("heading", { name: "Make room for your next idea." })).toBeVisible()
  await page.reload()
  await expect(page.getByRole("heading", { name: "Make room for your next idea." })).toBeVisible()
  await page.locator(".session-rail").getByRole("button", { name: "Night Drive" }).click()
  await expect(textbox).toHaveValue("Leave my next idea here")
  expect(room.writes()).toBe(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await expect(scroll).toBeVisible()
  await scroll.evaluate((node) => { node.scrollLeft = node.scrollWidth; node.scrollTop = node.scrollHeight })
  await scroll.scrollIntoViewIfNeeded()
  await expect(page.getByRole("button", { name: /^Inspect Transition accents III,/ })).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  await page.screenshot({ path: `${evidence}/clarity-overview-phone.png` })
})

test("rewrite is editable, undoable and never overwrites newer typing or submits music", async ({ page }) => {
  const room = await mockRoom(page)
  const box = page.getByRole("textbox", { name: "Describe your arrangement" })
  const original = "More space. Keep the bass."
  let hold = false, release!: () => void
  await page.route("**/prompt-assistance", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ mode: "rewrite", expectedHeadId: "version-2", protectedPartIds: ["part-1"] })
    if (hold) await new Promise<void>((resolve) => { release = resolve })
    await route.fulfill({ json: { prompt: `${original} Let the chords answer with longer rests.`, provenance: "fixture" } }).catch(() => undefined)
  })
  await box.fill(original)
  await page.getByRole("button", { name: "Rewrite prompt", exact: true }).click()
  await expect(box).toHaveValue(`${original} Let the chords answer with longer rests.`)
  await page.reload()
  await expect(box).toHaveValue(`${original} Let the chords answer with longer rests.`)
  await page.getByRole("button", { name: "Undo rewrite" }).click()
  await expect(box).toHaveValue(original)
  hold = true
  await page.getByRole("button", { name: "Rewrite prompt", exact: true }).click()
  await expect.poll(() => Boolean(release)).toBe(true)
  await expect(page.getByRole("button", { name: "Make this change", exact: true })).toBeDisabled()
  await box.fill("A newer idea that must stay")
  release()
  await expect(box).toHaveValue("A newer idea that must stay")
  expect(room.writes()).toBe(0)
  await expect(page.locator(".direction-section")).not.toContainText(/budget|allowance|successful change|Across the whole piece/i)
  await page.screenshot({ path: `${evidence}/clarity-composer-desktop.png`, fullPage: true })
})

test("creation availability fails closed and recovers without losing the direction", async ({ page }) => {
  const room = await mockRoom(page)
  let availability: "failed" | "missing" | "available" = "failed"
  await page.route("**/api/v1/producer-models", route => availability === "failed"
    ? route.fulfill({ status: 503, json: { message: "Offline fixture" } })
    : route.fulfill({ json: { models: availability === "missing" ? [] : [{ id: "gpt-6-luna", label: "GPT-6 Luna", provider: "openai", available: true }] } }))
  await page.reload()
  const input = page.getByRole("textbox", { name: "Describe your arrangement" })
  await input.fill("More movement, but keep it coherent.")
  const submit = page.getByRole("button", { name: "Make this change" })
  await expect(page.getByText("Could not check creation availability. Your words are unchanged.")).toBeVisible()
  await expect(submit).toBeDisabled()
  availability = "missing"
  await page.getByRole("button", { name: "Check again" }).click()
  await expect(page.getByRole("button", { name: "Check again" })).toBeVisible()
  await expect(submit).toBeDisabled()
  availability = "available"
  await page.getByRole("button", { name: "Check again" }).click()
  await expect(submit).toBeEnabled()
  await expect(input).toHaveValue("More movement, but keep it coherent.")
  await expect(page.getByRole("combobox", { name: "Producer model" })).toHaveCount(0)
  await expect(page.getByText("GPT-6 Luna", { exact: true })).toBeVisible()
  expect(room.writes()).toBe(0)
})

test("unmatched direction words ask before they are sent as guidance, never as a silent lock", async ({ page }) => {
  await mockRoom(page)
  const checked = "00000000-0000-4000-8000-000000000b2e"
  let check: { status: number; json: unknown } = { status: 200, json: { interpretationId: checked, provenance: "luna", checks: [], keep: [], guidance: [], rejected: [{ quote: "leave room for the pad", reason: "This arrangement has no single section by that name" }] } }
  const checks: string[] = [], sent: Array<Record<string, unknown>> = []
  await page.route("**/native/interpretations", async (route) => { checks.push(String(route.request().headers()["idempotency-key"])); await route.fulfill({ status: check.status, json: check.json }) })
  await page.route("**/native/revisions", async (route) => { sent.push(route.request().postDataJSON() as Record<string, unknown>); await route.fulfill({ status: 409, json: { code: "HEAD_CHANGED", message: "Native head changed; refresh before continuing" } }) })
  const input = page.getByRole("textbox", { name: "Describe your arrangement" })
  await input.fill("Add a soft answer and leave room for the pad")
  await page.getByRole("button", { name: "Make this change" }).click()
  const dialog = page.getByRole("dialog", { name: "Check these words" })
  await expect(dialog).toContainText("leave room for the pad")
  await expect(dialog).toContainText("no single section by that name")
  await page.screenshot({ path: `${evidence}/brief-check-desktop.png` })
  await dialog.getByRole("button", { name: "Edit direction" }).click()
  await expect(dialog).toBeHidden()
  await expect(input).toBeFocused()
  expect(sent).toHaveLength(0)
  await page.getByRole("button", { name: "Make this change" }).click()
  await page.getByRole("dialog", { name: "Check these words" }).getByRole("button", { name: "Send as guidance" }).click()
  await expect.poll(() => sent.length).toBe(1)
  expect(sent[0]).toMatchObject({ direction: "Add a soft answer and leave room for the pad", interpretationId: checked })
  // A stopped request maps its stable code to copy, shown beside the submit button.
  const issue = page.locator("#next-direction-form .direction-issue")
  await expect(issue).toContainText("This piece changed while you were working.")
  await expect(issue).toHaveAttribute("role", "alert")
  await page.getByRole("textbox", { name: "Describe your arrangement" }).press("End")
  await page.getByRole("textbox", { name: "Describe your arrangement" }).press("Space")
  await expect(issue).toHaveCount(0)
  check = { status: 503, json: { code: "INTERPRETATION_UNAVAILABLE", message: "Your direction couldn't be checked right now." } }
  await page.getByRole("button", { name: "Make this change" }).click()
  const unchecked = page.getByRole("dialog", { name: "Send without checks?" })
  await expect(unchecked).toContainText("nothing in it will be enforced")
  await unchecked.getByRole("button", { name: "Send as guidance" }).click()
  await expect.poll(() => sent.length).toBe(2)
  expect(sent[1]).not.toHaveProperty("interpretationId")
  // Resending an unchanged direction replays its paid check; a failed check is never replayed.
  expect(checks[1]).toBe(checks[0])
  await page.getByRole("button", { name: "Make this change" }).click()
  await expect(page.getByRole("dialog", { name: "Send without checks?" })).toBeVisible()
  expect(checks.at(-1)).not.toBe(checks.at(-2))
})

test("short pieces fit, phones choose sections from a strip and long pieces fade where more bars remain", async ({ page }) => {
  await mockRoom(page, { short: true })
  const scroll = page.locator(".score-scroll")
  await expect(scroll).toBeVisible()
  expect(await scroll.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  await expect(page.locator(".score-scroll-hint")).toHaveCount(0)
  const box = (await scroll.boundingBox())!, last = (await page.locator(".score-form-ruler .score-ruler-section").last().boundingBox())!
  expect(last.x + last.width).toBeLessThanOrEqual(box.x + box.width + 1)
  await expect(page.locator(".score-form-ruler").getByRole("button")).toHaveCount(4)
  await page.screenshot({ path: `${evidence}/score-short-desktop.png` })

  await page.setViewportSize({ width: 390, height: 844 })
  const strip = page.getByRole("group", { name: "Choose a section" })
  await expect(strip).toHaveCount(1)
  await expect(strip.getByRole("button", { name: "Whole piece" })).toHaveAttribute("aria-pressed", "true")
  await expect(page.locator(".score-form-ruler").getByRole("button")).toHaveCount(0)
  const long = strip.locator(".score-section-choice").nth(2)
  // The long name wraps to two lines instead of hiding behind an ellipsis.
  expect(await long.locator("strong").evaluate((element) => element.getClientRects().length && element.scrollHeight > parseFloat(getComputedStyle(element).lineHeight) * 1.5)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: `${evidence}/score-strip-phone.png`, fullPage: true })
  await long.click()
  await expect(page.locator(".score-detail")).toBeVisible()
  await expect(strip.locator(".score-section-choice").nth(2)).toHaveAttribute("aria-pressed", "true")

  await page.setViewportSize({ width: 1600, height: 1000 })
  await mockRoom(page)
  await page.reload()
  const frame = page.locator(".score-scroll-frame")
  await expect(page.locator(".score-scroll-hint")).toHaveText("Scroll sideways for all 64 bars.")
  await expect(frame).toHaveAttribute("data-more", "true")
  await page.locator(".score-scroll").evaluate((element) => { element.scrollLeft = element.scrollWidth })
  await expect(frame).not.toHaveAttribute("data-more", "true")

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("button", { name: "Versions", exact: true }).click()
  const rail = page.locator(".version-rail")
  await expect(rail).toBeVisible()
  expect(await rail.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(2)
  await page.screenshot({ path: `${evidence}/versions-phone-grid.png` })
})

test("connected identity is quiet, supports missing avatars and remains keyboard accessible", async ({ page }) => {
  await mockRoom(page, { audiotool: true })
  await page.route("**/api/v1/auth/session", route => route.fulfill({ json: { mode: "audiotool", user: { ownerId: "fixture", displayName: "Fixture musician" } } }))
  await page.reload()
  const account = page.getByRole("button", { name: "Audiotool account: Fixture musician" }).first()
  await expect(account).toBeVisible()
  await expect(account).toContainText("Connected")
  await expect(account).not.toContainText("Audiotool connected")
  const rail = page.locator(".session-rail")
  expect((await rail.textContent())!.match(/Fixture musician/g)).toHaveLength(1)
  const signOut = rail.getByRole("button", { name: "Sign out", exact: true })
  const accountBox = (await account.boundingBox())!, signOutBox = (await signOut.boundingBox())!
  expect(signOutBox.y - accountBox.y - accountBox.height).toBeGreaterThanOrEqual(8)
  await page.screenshot({ path: `${evidence}/incremental-account-desktop.png`, fullPage: true })
  await account.focus(); await page.keyboard.press("Enter")
  await expect(page.getByRole("menuitem", { name: "Disconnect Audiotool" })).toBeVisible()
  await page.keyboard.press("Escape"); await expect(account).toBeFocused()
  await expect(page.getByText("Your private music workspace")).toHaveCount(0)
})

test("sample actions align despite long titles and wrap without phone overflow", async ({ page }) => {
  await mockRoom(page, { audiotool: true })
  await page.route("**/library/samples?**", route => route.fulfill({ json: { samples: ["Glass", "A much longer glass title with a different owner and detail", "Glass two"].map((name, i) => ({ name: `samples/fixture-${i}`, displayName: name, ownerName: `Fixture artist ${i}`, durationSeconds: i + 0.4, bpm: 120, sampleKind: "one-shot", tags: [] })), nextPageToken: "", provenance: "Fixture" } }))
  await page.getByRole("button", { name: "Sounds", exact: true }).click()
  const sheet = page.getByRole("dialog", { name: "Sounds" })
  await sheet.getByLabel("Sound or mood").fill("glass")
  await sheet.getByRole("button", { name: "Search library" }).click()
  const actions = sheet.locator(".native-library-actions")
  await expect(actions).toHaveCount(3)
  const x = await actions.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().x))
  expect(Math.max(...x) - Math.min(...x)).toBeLessThan(1)
  const results = sheet.locator(".native-library-results").filter({ has: page.getByRole("button", { name: "Inspect slices" }) })
  await results.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${evidence}/incremental-library-desktop.png` })
  await page.setViewportSize({ width: 390, height: 844 })
  await results.scrollIntoViewIfNeeded()
  await expect(actions.first().getByRole("button", { name: "Inspect slices" })).toBeVisible()
  const firstRow = results.locator("li").first()
  const metadata = (await firstRow.locator(":scope > div").first().boundingBox())!, buttons = (await actions.first().boundingBox())!
  expect(buttons.y).toBeGreaterThanOrEqual(metadata.y + metadata.height)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  await page.screenshot({ path: `${evidence}/incremental-library-phone.png` })
})
test("sound ideas and an original sample audition lead to a saved listening note", async ({ page }) => {
  const room = await mockRoom(page, { audiotool: true, ownedSound: true })
  await page.getByRole("button", { name: "Sounds", exact: true }).click()
  const sheet = page.getByRole("dialog", { name: "Sounds" })
  await sheet.getByText("Explore our sound ideas").click()
  await expect(sheet.getByText("Rubber pulse")).toBeVisible()
  await sheet.getByLabel("Sound or mood").fill("hit")
  await sheet.getByRole("button", { name: "Search library" }).click()
  await sheet.getByRole("button", { name: "Inspect slices" }).click()
  const audition = sheet.getByRole("region", { name: "Original sample audition" })
  const original = audition.getByLabel("Listen to original sample Short hit")
  await expect(original).toBeVisible()
  await expect(audition.getByRole("button", { name: "Save listening note" })).toBeDisabled()
  await original.evaluate(async (element: HTMLAudioElement) => { await element.play() })
  await expect(audition.getByRole("button", { name: "Save listening note" })).toBeEnabled()
  await sheet.getByRole("button", { name: "Play sound Own sound" }).click()
  await expect.poll(() => original.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true)
  await original.evaluate(async (element: HTMLAudioElement) => { await element.play() })
  await expect(sheet.getByRole("button", { name: "Play source Own sound" })).toBeVisible()
  await audition.getByLabel("Not for this piece").check()
  await audition.getByLabel("What did you notice? (optional)").fill("Too bright for the opening")
  await audition.getByRole("button", { name: "Save listening note" }).click()
  await expect(audition.getByRole("status")).toContainText("Not for this piece")
  expect(room.writes()).toBe(1)
  await page.screenshot({ path: `${evidence}/sound-craft-desktop.png`, fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await page.screenshot({ path: `${evidence}/sound-craft-phone.png` })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  await page.keyboard.press("Escape")
  await expect(page.getByRole("button", { name: "Sounds", exact: true })).toBeFocused()
})
test("recovers a saved head after all five HTTP attempts fail, without erasing a pending direction", async ({ page }) => {
  const room = await mockRoom(page, { draft: true })
  await page.getByRole("button", { name: /^(Draft|Edit) next change$/ }).click()
  await page.getByRole("textbox", { name: "Describe your arrangement" }).fill("Keep my unsent idea")
  let failures = 0
  await page.route(`**/projects/${projectId}/native`, async (route) => {
    if (++failures <= 5) await route.fulfill({ status: 503, json: { message: "Transient snapshot read failure" } })
    else await route.fallback()
  })
  room.complete()
  await expect(page.locator(".producer-workspace-header")).toContainText("Version 3", { timeout: 25_000 })
  await expect(page.getByRole("textbox", { name: "Describe your arrangement" })).toHaveValue("Keep my unsent idea")
  expect(failures).toBeGreaterThan(5); expect(room.writes()).toBe(0)
  await page.screenshot({ path: `${evidence}/correctness-recovered-head.png`, fullPage: true })
})

test("bounds failed draft reconciliation and provides explicit read-only refresh", async ({ page }) => {
  const room = await mockRoom(page, { draft: true })
  let reads = 0, fail = true
  await page.route("**/native/requests/visual-job/draft", async (route) => { reads++; if (fail) await route.fulfill({ status: 503, json: { message: "Unavailable draft" } }); else await route.fallback() })
  room.setDraft(room.after, 2)
  await expect(page.getByRole("button", { name: "Refresh arrangement", exact: true })).toBeVisible({ timeout: 30_000 })
  expect(reads).toBe(15)
  fail = false
  await page.getByRole("button", { name: "Refresh arrangement", exact: true }).click()
  await page.getByRole("button", { name: "View work in progress" }).click()
  await expect(page.getByRole("region", { name: "Unfinished arrangement preview" })).toContainText("Your arrangement")
  expect(room.writes()).toBe(0)
})

test("leaving the room cancels exhausted-read recovery and ignores a late snapshot", async ({ page }) => {
  const room = await mockRoom(page, { draft: true })
  let reads = 0, release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route(`**/projects/${projectId}/native`, async (route) => {
    if (++reads <= 5) await route.fulfill({ status: 503, json: { message: "Temporary failure" } })
    else { await held; await route.fallback().catch(() => undefined) }
  })
  room.complete()
  await expect.poll(() => reads, { timeout: 20_000 }).toBe(6)
  // A now-unsupported route unmounts the room without a compatibility editor.
  await page.evaluate(() => { history.pushState({}, "", "/unavailable"); window.dispatchEvent(new PopStateEvent("popstate")) })
  release()
  await expect(page.locator(".producer-workspace-header")).toHaveCount(0)
  await expect(page.getByRole("alert")).toContainText("This page is no longer available")
  expect(room.writes()).toBe(0)
})

test("leaving a safe draft requires confirmation and unlocks a fresh direction", async ({ page }) => {
  const room = await mockRoom(page, { draft: true, paused: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("button", { name: "Producer", exact: true }).click()
  await page.getByRole("button", { name: /^(Draft|Edit) next change$/ }).click()
  await page.getByRole("textbox", { name: "Describe your arrangement" }).fill("A different idea")
  const leave = page.getByRole("button", { name: "End this attempt…", exact: true })
  await leave.click()
  await expect(page.getByRole("dialog", { name: "End this attempt?" })).toBeVisible()
  await page.keyboard.press("Escape"); await expect(leave).toBeFocused(); expect(room.writes()).toBe(0)
  await leave.click()
  await expect(page.getByRole("dialog", { name: "End this attempt?" })).toHaveCSS("opacity", "1")
  await page.screenshot({ path: `${evidence}/correctness-abandon-phone.png` })
  await page.getByRole("button", { name: "End attempt" }).click()
  await expect(page.getByRole("button", { name: "Make this change", exact: true })).toBeEnabled({ timeout: 20_000 })
  await expect(page.getByRole("textbox", { name: "Describe your arrangement" })).toHaveValue("A different idea")
  await expect(page.locator(".producer-workspace-header")).toContainText("Version 2")
  await expect(page.getByText("This request was stopped. Your saved versions are unchanged.")).toBeVisible()
  await expect(page.locator(".job-status").getByText("Details", { exact: true })).toHaveCount(0)
  expect(room.writes()).toBe(1)
})

test("desktop and phone keep inspection, scope and comparison distinct", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message))
  const room = await mockRoom(page)
  const part = page.getByRole("button", { name: /^Inspect Slow lead,/ })
  await part.focus(); await page.keyboard.press("Enter")
  await expect(page.getByRole("dialog", { name: "Slow lead" })).toContainText("Whole piece · inspecting only")
  await expect(page.getByRole("heading", { name: "Slow lead", exact: true })).toBeFocused()
  expect(await page.locator(".score-inspector-sheet .score-inspector").evaluate((element) => element.scrollTop)).toBe(0)
  await expectReadableText(page.locator(".score-inspector-sheet [data-slot='sheet-description']"))
  await page.screenshot({ path: `${evidence}/polish-inspector.png` })
  await page.keyboard.press("Escape"); await expect(part).toBeFocused()
  await part.click()
  await page.getByRole("dialog", { name: "Slow lead" }).getByRole("button", { name: "Change this part" }).click()
  await expect(page.getByRole("textbox", { name: "Describe your arrangement" })).toBeFocused()
  await page.locator(".score-section-choice").filter({ hasText: "Ascent" }).click()
  await expect(page.getByLabel("Change scope")).toHaveValue("")
  await page.getByRole("button", { name: "Change this section" }).click()
  await expect(page.getByRole("textbox", { name: "Describe your arrangement" })).toBeFocused()
  await expect(page.getByLabel("Change scope")).toHaveValue("section-3")
  await page.getByRole("textbox", { name: "Describe your arrangement" }).fill("More space, keep the bass")
  await expectReadableText(page.locator(".score-pitch-range").first())
  await expectReadableText(page.locator(".score-caption").last())
  await expectReadableText(page.getByRole("button", { name: "Make this change", exact: true }))
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `${evidence}/polish-desktop.png`, fullPage: true })
  await page.getByRole("button", { name: "Versions", exact: true }).click()
  await page.getByRole("button", { name: "Compare", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Before and after" })
  await dialog.getByRole("button", { name: "Opening", exact: true }).click()
  const range = await dialog.locator(".score-detail-lane").first().getAttribute("data-pitch-range")
  await dialog.getByRole("button", { name: "Before · v1", exact: true }).click()
  await expect(dialog.locator(".score-detail-lane").first()).toHaveAttribute("data-pitch-range", range!)
  await dialog.getByRole("button", { name: /^After · v2/ }).click()
  await expect(dialog.locator(".score-detail-lane").first()).toHaveAttribute("data-pitch-range", range!)
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: "reduce" })
  await dialog.getByRole("button", { name: "Changes", exact: true }).click()
  await dialog.getByRole("button", { name: "Show the change" }).click()
  await expect(dialog.locator("[data-motion-note]")).toHaveCount(0)
  const footer = await dialog.locator(".comparison-actions").boundingBox(); expect(footer!.y + footer!.height).toBeLessThanOrEqual(844)
  await dialog.screenshot({ path: `${evidence}/polish-compare-phone.png` })
  await page.keyboard.press("Escape")
  await expect(page.getByRole("button", { name: "Compare", exact: true })).toBeFocused()
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Producer", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "Describe your arrangement" })).toHaveValue("More space, keep the bass")
  await page.getByRole("textbox", { name: "Describe your arrangement" }).focus()
  await page.setViewportSize({ width: 390, height: 480 })
  await expect(page.getByRole("textbox", { name: "Describe your arrangement" })).toBeFocused()
  await expect(page.locator(".mobile-change-dock")).toBeHidden()
  await page.getByRole("textbox", { name: "Describe your arrangement" }).press("Tab")
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole("button", { name: "Arrangement", exact: true }).click()
  await page.locator(".score-section-choice").first().focus()
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `${evidence}/polish-phone.png`, fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  expect(errors).toEqual([]); expect(room.writes()).toBe(0)
})

test("confirmed same-density edits animate once; late/repeated receipts and reload do not replay", async ({ page }) => {
  const room = await mockRoom(page, { draft: true })
  await page.getByRole("button", { name: "View work in progress" }).click()
  const draft = page.getByRole("region", { name: "Unfinished arrangement preview" })
  await expect(draft).toBeVisible()
  await draft.locator(".score-section-choice").first().click()
  await draft.locator(".score-detail").scrollIntoViewIfNeeded()
  const next = structuredClone(room.before)
  next.parts[0]!.notes[0]!.pitch += 12; next.parts[0]!.notes[0]!.startTick += 480
  await page.evaluate(() => {
    type Sample = { time: number; x: number; y: number; transform: string }
    const holder = window as typeof window & { scoreMotion?: Promise<Sample[]> }
    holder.scoreMotion = new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        const note = document.querySelector("[data-motion-note=modified]")
        if (!note) return
        observer.disconnect()
        const samples: Sample[] = [], start = performance.now()
        const sample = () => {
          const box = note.getBoundingClientRect()
          samples.push({ time: performance.now() - start, x: box.x, y: box.y, transform: getComputedStyle(note).transform })
          if (performance.now() - start < 450) requestAnimationFrame(sample)
          else resolve(samples)
        }
        sample()
      })
      observer.observe(document.body, { childList: true, subtree: true })
    })
  })
  room.setDraft(next, 2)
  await expect(draft.locator("[data-motion-note=modified]")).toHaveCount(1)
  await page.screenshot({ path: `${evidence}/polish-motion-in-flight.png`, animations: "allow" })
  const movement = await page.evaluate(() => (window as typeof window & { scoreMotion: Promise<Array<{ time: number; x: number; y: number; transform: string }>> }).scoreMotion)
  await writeFile(`${evidence}/polish-note-motion-samples.json`, JSON.stringify(movement, null, 2))
  expect(new Set(movement.map((sample) => sample.y)).size).toBeGreaterThan(1)
  await expect(draft.getByRole("status")).toContainText("Soft pulse (notes / phrases)")
  await expect(draft.locator("[data-motion-note]")).toHaveCount(0)
  await page.screenshot({ path: `${evidence}/polish-confirmed-update.png`, fullPage: true })
  room.setDraft(room.before, 1)
  await expect(draft.getByRole("status")).toContainText("Soft pulse (notes / phrases)")
  await page.waitForTimeout(2000) // one poll, to prove late receipt cannot replace confirmed geometry
  expect(await draft.locator(".score-detail-note title").first().textContent()).toContain("C4")
  expect(await draft.locator("[data-motion-note]").count()).toBe(0)
  const withClip = structuredClone(next)
  withClip.parts[0]!.libraryRegions = [{ id: "clip", sampleName: "samples/visual", displayName: "Owned fixture sound", ownerName: "Test", durationSeconds: 2, bpm: 96, provenance: "audiotool-library", startTick: 0, durationTicks: 3840, sourceStartSeconds: 0, sourceDurationSeconds: 2, gain: .5, playbackMode: "once" }]
  withClip.parts[0]!.automation = [{ id: "fade", target: "gain", points: [{ tick: 0, value: .1, interpolation: "linear" }, { tick: 245760, value: .8 }] }]
  room.setDraft(withClip, 5)
  await expect(draft.locator("[data-motion-clip]")).toHaveCount(1)
  await expect(draft.getByRole("status")).toContainText("clips, sound / controls")
  await expect(draft.locator(".score-control-update")).toContainText("Level")
  await expect(draft.locator("[data-motion-clip]")).toHaveCount(0)
  const replaced = structuredClone(withClip)
  replaced.parts[0]!.notes.splice(1, 1)
  replaced.parts[0]!.notes.push({ id: "new-response", startTick: 3840, durationTicks: 720, pitch: 69, velocity: .7 })
  room.setDraft(replaced, 6)
  await expect(draft.locator("[data-motion-note=added]")).toHaveCount(1)
  await expect(draft.locator(".score-note-removed")).toHaveCount(1)
  await expect(draft.locator("[data-motion-note]")).toHaveCount(0)
  await page.emulateMedia({ reducedMotion: "reduce" })
  const reduced = structuredClone(replaced); reduced.parts[0]!.notes[0]!.pitch++
  room.setDraft(reduced, 7)
  await expect(draft.locator(".living-score")).toHaveAttribute("data-score-identity", /draft-7/)
  await expect(draft.locator("[data-motion-note], [data-motion-clip]")).toHaveCount(0)
  room.setDraft(next, 2); await page.reload()
  await page.getByRole("button", { name: "View work in progress" }).click()
  await expect(draft).toBeVisible(); await expect(draft.locator(".score-activity")).toHaveCount(0)
  expect(room.writes()).toBe(0)
})

test("128-bar 24-part score has bounded nodes and measured interaction frames", async ({ page }) => {
  await mockRoom(page, { large: true })
  await page.setViewportSize({ width: 820, height: 1180 })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Tracing.start", { categories: "devtools.timeline,blink.user_timing,toplevel", transferMode: "ReturnAsStream" })
  const milliseconds = await page.locator(".score-section-choice").first().evaluate(async (button) => {
    const start = performance.now(); (button as HTMLButtonElement).click()
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return performance.now() - start
  })
  await expect(page.locator(".score-detail-lane")).toHaveCount(8)
  const nodes = await page.locator(".living-score svg *").count()
  expect(nodes).toBeLessThan(10_000)
  await page.getByRole("button", { name: /Show more score parts/ }).click()
  await page.getByRole("button", { name: /Show more score parts/ }).click()
  await expect(page.locator(".score-detail-lane")).toHaveCount(24)
  await page.getByRole("button", { name: "Show whole-piece overview" }).click()
  await page.getByRole("group", { name: "Visible role lanes" }).getByRole("button", { name: /Drums/ }).click()
  await expect(page.locator(".score-lane")).toHaveCount(21)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(820)
  await page.getByRole("button", { name: "Versions", exact: true }).click()
  const comparisonMilliseconds = await page.getByRole("button", { name: "Compare", exact: true }).evaluate(async (button) => {
    const start = performance.now(); (button as HTMLButtonElement).click()
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return performance.now() - start
  })
  await expect(page.getByRole("dialog", { name: "Before and after" })).toBeVisible()
  await page.keyboard.press("Escape")
  const complete = new Promise<string>((resolve, reject) => cdp.once("Tracing.tracingComplete", (event) => event.stream ? resolve(event.stream) : reject(new Error("Missing performance trace stream"))))
  await cdp.send("Tracing.end")
  const stream = await complete; let trace = ""
  for (;;) { const chunk = await cdp.send("IO.read", { handle: stream }) as { data: string; eof: boolean }; trace += chunk.data; if (chunk.eof) break }
  await cdp.send("IO.close", { handle: stream }); await cdp.detach()
  await writeFile(`${evidence}/polish-browser-performance-trace.json`, trace)
  await writeFile(`${evidence}/polish-performance.json`, JSON.stringify({ millisecondsToTwoFrames: milliseconds, comparisonMillisecondsToTwoFrames: comparisonMilliseconds, svgNodes: nodes, platform: platform(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, evidence: "Scripted UI fixture; not model or renderer evidence" }, null, 2))
  await page.screenshot({ path: `${evidence}/polish-large-tablet.png`, fullPage: true })
})

test("a next direction survives completion, while long activity stays bounded and does not steal scroll", async ({ page }) => {
  const room = await mockRoom(page, { draft: true })
  const input = page.getByRole("textbox", { name: "Describe your arrangement" })
  await page.getByRole("button", { name: /Draft next change|Edit next change/ }).click()
  await input.fill("Keep this next direction unsent; preserve the bass.")
  await expect(page.getByRole("button", { name: "Not sent yet" })).toHaveCount(0)
  await expect(page.locator(".direction-submit")).toHaveCount(0)
  room.complete()
  await expect(page.locator(".producer-workspace-header")).toContainText("Version 3")
  await expect(input).toHaveValue("Keep this next direction unsent; preserve the bass.")
  await expect(page.getByRole("dialog", { name: "Before and after" })).toBeHidden()
  await expect(page.getByRole("button", { name: "Make this change" })).toBeDisabled()
  await page.getByRole("button", { name: "I reviewed the updated scope" }).click()
  await expect(page.getByRole("button", { name: "Make this change" })).toBeEnabled()
  let count = 200
  await page.route("**/api/v1/projects/visual-room/activity*", async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith("/stream")) { await route.abort(); return }
    const afterCursor = url.searchParams.has("after") ? Number(url.searchParams.get("after")) : null
    const beforeCursor = Number(url.searchParams.get("before") ?? count + 1)
    const all = Array.from({ length: count }, (_, i) => ({ cursor: i + 1, jobId: "visual-job", createdAt: "2026-09-26T12:00:00Z", payload: { version: 1, kind: i === 195 ? "request" : "music", text: i === 195 ? "<img src=x onerror=alert(1)> A careful musical brief. ".repeat(600) : `Confirmed musical update ${i + 1}` } }))
    const events = afterCursor === null ? all.filter((event) => event.cursor < beforeCursor).slice(-30) : all.filter((event) => event.cursor > afterCursor).slice(0, 100)
    await route.fulfill({ json: { events, cursor: count, nextCursor: afterCursor === null ? count : events.at(-1)?.cursor ?? afterCursor, job: null, headId: "version-3", draft: null, actions: { canSubmit: true, canStop: false, issue: null }, allowance: { remainingUsd: 5, standardUsd: 5, extendedUsd: 5 } } })
  })
  await expect(page.locator(".producer-feed")).toContainText("Confirmed musical update 200", { timeout: 15_000 })
  await expect(page.locator(".producer-message")).toHaveCount(30)
  await expect(page.locator(".producer-feed img")).toHaveCount(0)
  const requestMessage = page.locator(".producer-message-request")
  await expect(requestMessage.locator("p")).toHaveCount(1)
  const readMore = requestMessage.getByRole("button", { name: "Read more" })
  await expect(readMore).toHaveAttribute("aria-expanded", "false")
  expect(await readMore.evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeLessThanOrEqual(13)
  expect((await readMore.boundingBox())!.height).toBeLessThanOrEqual(32)
  await readMore.focus(); await page.keyboard.press("Enter")
  await expect(requestMessage.locator("p")).toHaveCount(1)
  await expect(requestMessage.locator(".message-preview")).toHaveCount(0)
  await expect(requestMessage.getByRole("button", { name: "Show less" })).toBeFocused()
  await expect(requestMessage.getByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true")
  await page.screenshot({ path: `${evidence}/conversation-expanded.png`, fullPage: true })
  await page.keyboard.press("Enter")
  await expect(requestMessage.locator(".message-preview")).toHaveCount(1)
  const feed = page.locator(".producer-feed")
  await feed.evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event("scroll")) })
  count++
  await expect(page.getByRole("button", { name: "New updates" })).toBeVisible()
  expect(await feed.evaluate((element) => element.scrollTop)).toBe(0)
  // At the end of the feed the bar follows the last message instead of covering it.
  await feed.evaluate((element) => { element.scrollTop = element.scrollHeight })
  const lastMessage = (await page.locator(".producer-message").last().boundingBox())!
  expect(lastMessage.y + lastMessage.height).toBeLessThanOrEqual((await page.locator(".producer-new-updates").boundingBox())!.y + 1)
  await page.getByRole("button", { name: "Earlier activity" }).click()
  await expect(page.getByRole("button", { name: "Return to latest" })).toBeVisible()
  await expect(page.locator(".producer-message")).toHaveCount(30)
  await page.getByRole("button", { name: "Return to latest" }).click()
  await page.screenshot({ path: `${evidence}/workspace-long-feed.png`, fullPage: true })
  expect(room.writes()).toBe(0)
})

for (const mappingVersion of ["nexus-native-v7", "nexus-native-v8", "nexus-native-v9"]) {
  test(`verified ${mappingVersion} copy remains openable without a new export`, async ({ page }) => {
    const room = await mockRoom(page, { audiotool: true, verifiedMapping: mappingVersion })
    await expect(page.getByRole("button", { name: "Open in Audiotool", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "Copy to Audiotool", exact: true })).toHaveCount(0)
    await page.getByRole("button", { name: "Session options" }).click()
    await page.getByRole("menuitem", { name: "Audiotool connection" }).click()
    await expect(page.getByRole("button", { name: "Recheck Audiotool copy", exact: true })).toBeVisible()
    await page.keyboard.press("Escape")
    if (mappingVersion === "nexus-native-v9") await page.screenshot({ path: `${evidence}/v9-copy-confirmed.png` })
    expect(room.writes()).toBe(0)
  })
}

test("delayed terminal copy readback updates the header without reload or duplicate submission", async ({ page }) => {
  await mockRoom(page, { audiotool: true })
  let posts = 0, polls = 0, terminalReadStarted = false
  let releaseRead!: () => void
  const delayed = new Promise<void>(resolve => { releaseRead = resolve })
  await page.route("**/native/synchronizations", async route => { posts++; await route.fulfill({ json: { jobId: "sync-test" } }) })
  await page.route("**/jobs/sync-test", route => route.fulfill({ json: { id: "sync-test", project_id: projectId, kind: "native-sync", state: ++polls > 1 ? "succeeded" : "running", stage: "validating", error_code: null, error_message: null } }))
  const document = documentFixture()
  await page.route(`**/projects/${projectId}/native`, async route => {
    terminalReadStarted = true
    await delayed
    await route.fulfill({ json: { currentRevisionId: "version-2", headVersion: 2, current: { id: "version-2", ordinal: 2, document }, versions: [], synchronization: { state: "verified", mappingVersion: "nexus-native-v9", revisionId: "version-2", projectId: "projects/fixture", url: "https://offline.invalid/studio" }, playback: "deferred" } })
  })
  await page.getByRole("button", { name: "Copy to Audiotool", exact: true }).click()
  await expect.poll(() => terminalReadStarted).toBe(true)
  await expect(page.getByRole("button", { name: "Open in Audiotool", exact: true })).toHaveCount(0)
  releaseRead()
  await expect(page.getByRole("button", { name: "Open in Audiotool", exact: true })).toBeVisible()
  expect(posts).toBe(1)
  await page.screenshot({ path: `${evidence}/copy-confirmed-desktop.png` })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole("button", { name: "Open in Audiotool", exact: true })).toBeVisible()
  await page.screenshot({ path: `${evidence}/copy-confirmed-phone.png` })
})

test("copy owner-busy response is explained without retrying the POST", async ({ page }) => {
  await mockRoom(page, { audiotool: true })
  let posts = 0
  await page.route("**/native/synchronizations", async route => { posts++; await route.fulfill({ status: 429, json: { code: "ACTIVE_REQUEST_LIMIT", message: "An arrangement or Audiotool copy is already running in one of your sessions. Let it finish before starting another request." } }) })
  await page.getByRole("button", { name: "Copy to Audiotool", exact: true }).click()
  await expect(page.getByText(/already running in one of your sessions/)).toBeVisible()
  expect(posts).toBe(1)
  await expect(page.getByRole("button", { name: "Open in Audiotool", exact: true })).toHaveCount(0)
})

test("restores a terminal copy receipt with delayed canonical verification and no new copy", async ({ page }) => {
  const options: { audiotool: boolean; verifiedMapping?: string } = { audiotool: true }
  const room = await mockRoom(page, options)
  let reads = 0, release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route("**/jobs/restored-copy", route => route.fulfill({ json: { id: "restored-copy", project_id: projectId, kind: "native-sync", state: "succeeded", stage: "validating" } }))
  await page.route(`**/projects/${projectId}/native`, async route => {
    if (++reads > 1) await held
    await route.fallback()
  })
  await page.evaluate(id => localStorage.setItem(`pocket-producer:native-receipt:${id}`, JSON.stringify({ operation: "native-sync", key: "recovered", jobId: "restored-copy", signature: "version-2" })), projectId)
  await page.reload()
  await expect.poll(() => reads).toBe(2)
  options.verifiedMapping = "nexus-native-v9"
  release()
  await expect(page.getByRole("button", { name: "Open in Audiotool", exact: true })).toBeVisible()
  expect(await page.evaluate(id => localStorage.getItem(`pocket-producer:native-receipt:${id}`), projectId)).toBeNull()
  expect(room.writes()).toBe(0)
})

for (const change of ["navigation", "head"] as const) test(`a delayed copy snapshot cannot overwrite a newer ${change}`, async ({ page }) => {
  const room = await mockRoom(page, { audiotool: true })
  let polls = 0, reads = 0, release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route("**/native/synchronizations", route => route.fulfill({ json: { jobId: "sync-late" } }))
  await page.route("**/jobs/sync-late", route => route.fulfill({ json: { id: "sync-late", project_id: projectId, kind: "native-sync", state: ++polls > 1 ? "succeeded" : "running", stage: "validating" } }))
  await page.route(`**/projects/${projectId}/native`, async route => {
    if (++reads > 1) { await route.fallback(); return }
    await held
    await route.fulfill({ json: { currentRevisionId: "version-2", headVersion: 2, current: { id: "version-2", ordinal: 2, document: room.before }, versions: [], synchronization: { state: "verified", mappingVersion: "nexus-native-v9", revisionId: "version-2", projectId: "projects/fixture", url: "https://offline.invalid/stale-copy" }, playback: "deferred" } }).catch(() => undefined)
  })
  await page.getByRole("button", { name: "Copy to Audiotool", exact: true }).click()
  await expect.poll(() => reads).toBe(1)
  if (change === "navigation") {
    await page.evaluate(() => { history.pushState({}, "", "/unavailable"); window.dispatchEvent(new PopStateEvent("popstate")) })
    await expect(page.locator(".producer-workspace-header")).toHaveCount(0)
  } else {
    room.complete()
    await expect(page.locator(".producer-workspace-header")).toContainText("Version 3", { timeout: 15_000 })
  }
  release()
  await expect(page.getByRole("button", { name: "Open in Audiotool", exact: true })).toHaveCount(0)
  if (change === "head") await expect(page.locator(".producer-workspace-header")).toContainText("Version 3")
})

test("history and Audiotool use compact dialogs with focus return and no implicit copy", async ({ page }) => {
  const room = await mockRoom(page, { audiotool: true })
  const copy = page.getByRole("button", { name: "Copy to Audiotool", exact: true })
  await expect(copy).toBeVisible()
  const versions = page.getByRole("button", { name: "Versions", exact: true })
  await versions.click()
  const history = page.getByRole("dialog", { name: "Version history" })
  await expect(history).toBeVisible()
  expect((await history.boundingBox())!.width).toBeLessThanOrEqual(600)
  await expect(history.getByText("Current", { exact: true })).toHaveCount(1)
  await page.keyboard.press("Escape"); await expect(versions).toBeFocused()
  await page.getByRole("button", { name: "Session options" }).click()
  await page.getByRole("menuitem", { name: "Audiotool connection" }).click()
  const connection = page.getByRole("dialog", { name: "Your Audiotool copy" })
  await expect(connection).toBeVisible()
  expect((await connection.boundingBox())!.height).toBeLessThan(650)
  await page.screenshot({ path: `${evidence}/clarity-audiotool-dialog.png` })
  await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: "Session options" })).toBeFocused()
  expect(room.writes()).toBe(0)
})

test("step-limit recovery requires explicit extension and resumes the same request without copying", async ({ page }) => {
  const room = await mockRoom(page, { draft: true, paused: true, audiotool: true })
  await page.route("**/native/requests/visual-job/draft", async (route) => {
    await route.fulfill({ json: { jobId: "visual-job", state: "needs_attention", document: room.after, documentHash: "draft-1", stepCount: 1, selected: false, headMatches: true, canContinue: false, stopCode: "CALL_LIMIT", stopReason: "MODEL_CALL_LIMIT_EXCEEDED", canExtend: true, runLimits: { maxCalls: 40 }, extensionCeiling: { maxCalls: 120 } } })
  })
  const actions: string[] = []
  await page.route("**/native/requests/visual-job/extend", async (route) => { actions.push("extend"); expect(route.request().postDataJSON()).toEqual({ maxCalls: 80 }); await route.fulfill({ json: { extended: true } }) })
  await page.route("**/native/requests/visual-job/continue", async (route) => { actions.push("continue"); await route.fulfill({ json: { jobId: "visual-job", state: "queued" } }) })
  await page.reload()
  const resume = page.getByRole("button", { name: "Continue arrangement" })
  await resume.click()
  await expect(page.getByRole("dialog", { name: "Continue this arrangement?" })).toBeVisible()
  expect(actions).toEqual([])
  await page.keyboard.press("Escape"); await expect(resume).toBeFocused()
  await resume.click(); await page.getByRole("button", { name: "Extend and continue" }).click()
  await expect.poll(() => actions).toEqual(["extend", "continue"])
  expect(room.writes()).toBe(0)
})

test("wayfinding header, section ruler, note contours, fingerprints and version rail", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message))
  const room = await mockRoom(page, { audiotool: true })
  const header = page.locator(".producer-workspace-header")
  const copy = header.getByRole("button", { name: "Copy to Audiotool", exact: true })
  await expect(copy).toBeVisible()
  await expect(header.getByRole("navigation", { name: "Session tools" }).getByRole("button", { name: "Sounds", exact: true })).toBeVisible()
  await expect(header.getByRole("navigation", { name: "Session tools" }).getByRole("button", { name: "Versions", exact: true })).toBeVisible()
  expect(await copy.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgb(37, 72, 59)")
  await expectReadableText(copy)
  // Sections live in the ruler; there is no separate chip row above the overview.
  const ruler = page.locator(".score-heading-row").getByRole("group", { name: "Choose a section" })
  await expect(ruler.locator(".score-section-choice")).toHaveCount(5)
  await expect(page.locator(".score-form-strip")).toHaveCount(0)
  await expectReadableText(ruler.locator(".score-section-choice strong").first())
  await expect(page.locator(".score-lane .score-contour")).toHaveCount(8)
  await expect(page.locator(".score-lane .score-density")).toHaveCount(0)
  await expect(page.getByRole("complementary", { name: "Session navigation" }).locator(".rail-thumb path")).not.toHaveCount(0)
  await page.screenshot({ path: `${evidence}/wayfinding-desktop.png` })
  await ruler.locator(".score-section-choice").filter({ hasText: "Ascent" }).click()
  const strip = page.locator(".score-form-strip")
  await expect(strip.locator(".score-section-choice[aria-pressed=true]")).toContainText("Ascent")
  await page.getByRole("button", { name: "Show whole-piece overview" }).click()
  await expect(page.locator(".score-heading-row .score-ruler-section[data-active]")).toContainText("Ascent")
  await expect(page.locator(".score-heading-row button")).toHaveCount(0)
  await strip.getByRole("button", { name: "Whole piece", exact: true }).click()
  await expect(strip).toHaveCount(0)
  const versions = page.getByRole("button", { name: "Versions", exact: true })
  await versions.click()
  const history = page.getByRole("dialog", { name: "Version history" })
  const cards = history.locator(".version-rail button")
  await expect(cards).toHaveCount(2)
  await expect(cards.first()).toContainText("Version 1")
  await expect(cards.locator(".version-thumb path")).not.toHaveCount(0)
  await history.screenshot({ path: `${evidence}/wayfinding-version-rail.png` })
  await cards.filter({ hasText: "Version 1" }).click()
  await expect(page.getByRole("dialog", { name: "Before and after" })).toContainText("Version 1 → 2")
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape")
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  expect((await copy.boundingBox())!.width).toBeGreaterThan(300)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `${evidence}/wayfinding-phone.png`, fullPage: true })
  expect(errors).toEqual([]); expect(room.writes()).toBe(0)
})

test("producer messages point at stored parts and sections without changing scope", async ({ page }) => {
  const room = await mockRoom(page)
  const events = [
    { cursor: 1, jobId: "old-job", createdAt: "2026-09-26T12:00:00Z", payload: { version: 1, kind: "request", text: "Give the lead more air in Ascent", scope: "Ascent · Slow lead", sectionId: "section-3", partId: "part-4" } },
    { cursor: 2, jobId: "old-job", createdAt: "2026-09-26T12:01:00Z", payload: { version: 1, kind: "music", text: "Updated Slow lead.", partIds: ["part-4"], sectionIds: ["section-3"] } },
    { cursor: 3, jobId: "old-job", createdAt: "2026-09-26T12:02:00Z", payload: { version: 1, kind: "music", text: "Updated Wide pad and Glass keys." } },
    { cursor: 4, jobId: "old-job", createdAt: "2026-09-26T12:03:00Z", payload: { version: 1, kind: "approach", text: "A slow lift with the lead answering the pad." } },
  ]
  await page.route("**/api/v1/projects/visual-room/activity*", async (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/stream")) { await route.abort(); return }
    await route.fulfill({ json: { events, cursor: 4, nextCursor: 4, hasOlder: false, job: null, headId: "version-2", draft: null, actions: { canSubmit: true, canStop: false, issue: null }, allowance: { remainingUsd: 5, standardUsd: 5, extendedUsd: 5 } } })
  })
  await page.reload()
  const messages = page.locator(".producer-message")
  await expect(messages).toHaveCount(4)
  await expect(messages.nth(3).getByRole("button", { name: "Show in score" })).toHaveCount(0)
  // Content arriving under a resting pointer is not a hover preview.
  await messages.nth(2).dispatchEvent("pointermove", { pointerType: "mouse", movementX: 0, movementY: 0 })
  await expect(page.locator(".score-lane[data-highlighted]")).toHaveCount(0)
  await messages.nth(2).hover()
  await expect(page.locator('.score-lane[data-part-id="part-2"]')).toHaveAttribute("data-highlighted", "true")
  await expect(page.locator('.score-lane[data-part-id="part-3"]')).toHaveAttribute("data-highlighted", "true")
  await expect(page.locator('.score-lane[data-part-id="part-4"]')).not.toHaveAttribute("data-highlighted", "true")
  await page.mouse.move(5, 5)
  await expect(page.locator(".score-lane[data-highlighted]")).toHaveCount(0)
  await messages.nth(1).getByRole("button", { name: "Show in score" }).click()
  await expect(page.locator(".score-detail-lane[data-part-id='part-4']")).toHaveAttribute("data-highlighted", "true")
  await expect(page.locator(".score-form-strip .score-section-choice[aria-pressed=true]")).toContainText("Ascent")
  await expect(page.locator(".score-detail .score-lane-flash")).toHaveCount(1)
  await page.screenshot({ path: `${evidence}/wayfinding-feed-pointer.png` })
  await expect(page.getByLabel("Change scope")).toHaveValue("")
  await expect(page.locator(".score-detail-lane[data-highlighted]")).toHaveCount(0, { timeout: 5_000 })
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: "reduce" })
  await page.getByRole("button", { name: "Producer", exact: true }).click()
  const view = page.getByRole("button", { name: "View arrangement" })
  const viewBox = (await view.boundingBox())!, heading = (await page.locator(".producer-heading").boundingBox())!
  expect(heading.x + heading.width - (viewBox.x + viewBox.width)).toBeGreaterThanOrEqual(8)
  expect(Math.abs((viewBox.y + viewBox.height / 2) - (heading.y + heading.height / 2))).toBeLessThan(4)
  const request = page.locator(".producer-message-request")
  await request.getByRole("button", { name: "Show in score" }).click()
  await expect(page.getByRole("button", { name: "Arrangement", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.locator(".score-detail-lane[data-part-id='part-4']")).toHaveAttribute("data-highlighted", "true")
  expect(await page.locator(".score-lane-flash").first().evaluate((node) => getComputedStyle(node).animationName)).toBe("none")
  expect(room.writes()).toBe(0)
})

test("construction progress shows the recorded stage and keeps planned sections outlined", async ({ page }) => {
  const room = await mockRoom(page, { draft: true })
  const plan = (stage: string) => ({ plan: { intent: "A slow lift", sections: [{ name: "Opening", purpose: "State the pulse" }, { name: "Bloom", purpose: "Let the theme open" }, { name: "Coda", purpose: "A quiet farewell" }], soundGoals: ["Warm pad"], hardConstraints: [], developmentTasks: ["Write the coda"] }, stage, inspectedDocumentHash: null, review: null })
  let stage = "planned", document: NativeDocument | null = null
  await page.route("**/native/requests/visual-job/draft", (route) => route.fulfill({ json: { jobId: "visual-job", state: "running", document, documentHash: document ? "draft-2" : "draft-1", selected: false, stepCount: document ? 2 : 1, baseRevisionId: "version-2", headMatches: true, canContinue: false, canExtend: false, continuationReason: null, plan: plan(stage) } }))
  await page.reload()
  const progress = page.getByRole("region", { name: "Construction progress" })
  await expect(progress.locator("[aria-current=step]")).toContainText("Build")
  // Each step's dot is centred over its label, so the tracker is symmetric.
  const offsets = await progress.locator(".stage-tracker li").evaluateAll((items) => items.map((item) => { const box = item.getBoundingClientRect(), dot = item.querySelector(".stage-dot")!.getBoundingClientRect(); return Math.abs((box.left + box.right) / 2 - (dot.left + dot.right) / 2) }))
  expect(Math.max(...offsets)).toBeLessThan(1)
  await expect(progress.locator(".ghost-section.is-planned")).toHaveCount(3)
  await expect(progress).toContainText("not music")
  stage = "refining"; document = structuredClone(room.before)
  room.setDraft(room.before, 2)
  await expect(progress.locator("[aria-current=step]")).toContainText("Refine", { timeout: 10_000 })
  await expect(progress.locator(".ghost-section.is-has-music")).toHaveCount(2)
  await expect(progress.locator(".ghost-section.is-planned")).toContainText("Coda")
  await expectReadableText(progress.locator(".ghost-section.is-has-music strong").first())
  await progress.screenshot({ path: `${evidence}/wayfinding-construction-progress.png` })
  expect(room.writes()).toBe(0)
})

test("pinned notes stay local until added to an editable, scoped direction", async ({ page }) => {
  const room = await mockRoom(page)
  const lane = page.locator('.score-lane[data-part-id="part-4"] .score-lane-picture')
  const box = (await lane.boundingBox())!
  const bar = box.width / 64
  await page.mouse.move(box.x + bar * 0.5, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + bar * 2.5, box.y + box.height / 2, { steps: 4 })
  await expect(lane.locator(".score-pin-selection")).toHaveCount(1)
  await page.mouse.up()
  const dialog = page.getByRole("dialog", { name: "Pin a note" })
  await expect(dialog).toContainText("Slow lead · bars 1–3")
  await expect(dialog.getByRole("textbox", { name: "What should change here?" })).toBeFocused()
  await expect(dialog.getByRole("button", { name: "Pin note" })).toBeDisabled()
  await dialog.getByRole("textbox", { name: "What should change here?" }).fill("Too busy, leave more space")
  await dialog.getByRole("button", { name: "Pin note" }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole("button", { name: /^Inspect Slow lead,/ })).toBeFocused()
  await expect(lane.locator(".score-pin")).toHaveCount(1)
  // Keyboard path: a protected part's note is kept visible but not sent as a change request.
  const kept = page.getByRole("button", { name: /^Inspect Sub foundation,/ })
  await kept.focus(); await page.keyboard.press("Enter")
  await page.getByRole("dialog", { name: "Sub foundation" }).getByRole("button", { name: "Pin a note" }).click()
  const keyboardDialog = page.getByRole("dialog", { name: "Pin a note" })
  await expect(keyboardDialog).toContainText("Sub foundation · bars 1–64")
  await keyboardDialog.getByLabel("To bar").fill("4")
  await keyboardDialog.getByRole("textbox", { name: "What should change here?" }).fill("Warmer")
  await keyboardDialog.getByRole("button", { name: "Pin note" }).click()
  const tray = page.getByRole("region", { name: /Pinned notes · 2/ })
  await expect(tray).toContainText("Kept unchanged")
  await page.reload()
  await expect(tray).toBeVisible()
  await tray.screenshot({ path: `${evidence}/wayfinding-pin-tray.png` })
  await page.screenshot({ path: `${evidence}/wayfinding-pins-desktop.png` })
  await tray.getByRole("button", { name: "Add 1 note to direction" }).click()
  await expect(page.getByRole("textbox", { name: "Describe your arrangement" })).toHaveValue("In Opening, Slow lead (bars 1–3): Too busy, leave more space.")
  await expect(page.getByRole("textbox", { name: "Describe your arrangement" })).toBeFocused()
  await expect(page.getByLabel("Change scope")).toHaveValue("section-0")
  await expect(page.locator(".producer-panel")).toContainText("Slow lead ×")
  await expect(page.getByRole("region", { name: /Pinned notes · 1/ })).toContainText("Sub foundation")
  expect(room.writes()).toBe(0)
})
