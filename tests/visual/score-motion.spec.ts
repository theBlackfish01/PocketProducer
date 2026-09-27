import { expect, test, type Locator, type Page } from "@playwright/test"
import { mkdir, writeFile } from "node:fs/promises"
import { cpus, platform } from "node:os"
import type { NativeDocument } from "@pocket/core"

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

async function mockRoom(page: Page, options: { draft?: boolean; large?: boolean; paused?: boolean } = {}) {
  const before = documentFixture(), after = structuredClone(before)
  after.parts[0]!.notes[0]!.pitch += 12; after.parts[0]!.notes[0]!.startTick += 480; after.parts[0]!.notes[0]!.durationTicks += 240
  after.parts[0]!.notes.splice(1, 1)
  if (options.large) {
    before.bars = after.bars = 128; before.sections.at(-1)!.endBar = after.sections.at(-1)!.endBar = 128
    before.parts = [...before.parts, ...before.parts.map((part) => ({ ...part, id: `${part.id}-b`, name: `${part.name} II` })), ...before.parts.map((part) => ({ ...part, id: `${part.id}-c`, name: `${part.name} III` }))]
    after.parts = [...after.parts, ...before.parts.slice(8)]
  }
  let draft = before, step = 1, writes = 0, completed = false, abandoned = false
  const job = () => ({ id: "visual-job", project_id: projectId, kind: "native-revision", state: abandoned ? "cancelled" : completed ? "succeeded" : options.paused ? "needs_attention" : "running", stage: "constructing", error_code: abandoned ? "NATIVE_ABANDONED" : options.paused ? "NATIVE_PARTIAL" : null })
  const version = (document: NativeDocument, ordinal: number) => ({ id: `version-${ordinal}`, parentRevisionId: ordinal === 2 ? "version-1" : null, ordinal, document, documentHash: `hash-${ordinal}`, changeSummary: "Shape the opening pulse", producer: {}, structuralDiff: { addedParts: [], changedParts: ["part-0"], changedSections: [], protectionChange: { added: [], removed: [] } }, createdAt: "2026-09-26T00:00:00Z" })
  const versions = [version(after, 2), version(before, 1)]
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    let json: unknown
    if (path.endsWith("/status")) json = { providers: { openai: false, gemini: false, audiotool: false }, uploadFormats: ["audio/wav"], nexus: { sdk: "fixture", liveExportVerified: false, connection: "unconfigured", oauth: null, session: { connected: false, userName: null, expiresAt: null } } }
    else if (path.endsWith("/projects")) json = { projects: [{ id: projectId, title: "Night Drive", currentRevisionId: null, version: 1, createdAt: "2026-09-26" }] }
    else if (path.endsWith(`/projects/${projectId}`)) json = { project: { id: projectId, title: "Night Drive", currentRevisionId: null }, assets: [], revisions: [], analyses: [], latestJob: null, currentRevision: null }
    else if (path.endsWith("/activity/stream")) { await route.abort(); return }
    else if (path.endsWith("/activity")) json = { events: [], cursor: 0, nextCursor: 0, hasOlder: false, job: options.draft ? job() : null, headId: completed ? "version-3" : "version-2", draft: options.draft ? { step, hash: `draft-${step}` } : null, actions: { canSubmit: abandoned || completed || !options.draft, canStop: Boolean(options.draft && !options.paused), canAbandon: options.paused && !abandoned, issue: options.paused && !abandoned ? "paused" : null }, allowance: { remainingUsd: 5, standardUsd: 5, extendedUsd: 5 } }
    else if (path.endsWith("/native")) json = { currentRevisionId: completed ? "version-3" : "version-2", headVersion: completed ? 3 : 2, current: completed ? version(after, 3) : versions[0], versions: completed ? [version(after, 3), ...versions] : versions, context: null, comparisons: {}, synchronization: { state: "local_only", projectId: null, revisionId: null, url: null }, playback: "deferred" }
    else if (path.endsWith("/preservation-preview")) json = { revisionId: "version-2", sectionId: null, namedParts: [], theme: null, unresolved: [] }
    else if (path.endsWith("/capabilities")) json = { matches: [], totalEntities: 0, version: "test" }
    else if (path.endsWith("/jobs/visual-job")) json = { ...job(), events: [] }
    else if (path.endsWith("/abandon")) { abandoned = true; writes++; json = { jobId: "visual-job", abandoned: true } }
    else if (path.endsWith("/draft")) json = { jobId: "visual-job", state: "running", document: draft, documentHash: `draft-${step}`, selected: false, stepCount: step, baseRevisionId: "version-2", headMatches: true, canContinue: false, canExtend: false, continuationReason: null }
    else { writes++; await route.fulfill({ status: 400, json: { message: `Unexpected fixture request: ${path}` } }); return }
    await route.fulfill({ json })
  })
  if (options.draft) await page.addInitScript(({ projectId }) => localStorage.setItem(`pocket-producer:native-receipt:${projectId}`, JSON.stringify({ operation: "native-revision", key: "visual", jobId: "visual-job", signature: "visual" })), { projectId })
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Night Drive", exact: true })).toBeVisible()
  return { before, after, setDraft: (value: NativeDocument, count: number) => { draft = value; step = count }, writes: () => writes, complete: () => { completed = true } }
}

test.beforeAll(async () => { await mkdir(evidence, { recursive: true }) })
test("recovers a saved head after all five HTTP attempts fail, without erasing a pending direction", async ({ page }) => {
  const room = await mockRoom(page, { draft: true })
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
  await expect(page.getByRole("region", { name: "Unfinished arrangement preview" })).toContainText("2 confirmed changes")
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
  await page.getByRole("textbox", { name: "Describe your arrangement" }).fill("A different idea")
  const leave = page.getByRole("button", { name: "Leave this draft", exact: true })
  await leave.click()
  await expect(page.getByRole("dialog", { name: "Leave this unfinished draft?" })).toBeVisible()
  await page.keyboard.press("Escape"); await expect(leave).toBeFocused(); expect(room.writes()).toBe(0)
  await leave.click()
  await expect(page.getByRole("dialog", { name: "Leave this unfinished draft?" })).toHaveCSS("opacity", "1")
  await page.screenshot({ path: `${evidence}/correctness-abandon-phone.png` })
  await page.getByRole("button", { name: "Leave draft and start fresh" }).click()
  await expect(page.getByRole("button", { name: "Make this change", exact: true })).toBeEnabled({ timeout: 20_000 })
  await expect(page.getByRole("textbox", { name: "Describe your arrangement" })).toHaveValue("A different idea")
  await expect(page.locator(".producer-workspace-header")).toContainText("Version 2")
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
  await expect(page.locator(".direction-section")).toContainText("Across the whole piece")
  await page.getByRole("button", { name: "Change this section" }).click()
  await expect(page.getByRole("textbox", { name: "Describe your arrangement" })).toBeFocused()
  await expect(page.locator(".direction-section")).toContainText("In Ascent")
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
  await input.fill("Keep this next direction unsent; preserve the bass.")
  await expect(page.getByRole("button", { name: "Not sent yet" })).toBeDisabled()
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
  const feed = page.locator(".producer-feed")
  await feed.evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event("scroll")) })
  count++
  await expect(page.getByRole("button", { name: "New updates" })).toBeVisible()
  expect(await feed.evaluate((element) => element.scrollTop)).toBe(0)
  await page.getByRole("button", { name: "Earlier activity" }).click()
  await expect(page.getByRole("button", { name: "Return to latest" })).toBeVisible()
  await expect(page.locator(".producer-message")).toHaveCount(30)
  await page.getByRole("button", { name: "Return to latest" }).click()
  await page.screenshot({ path: `${evidence}/workspace-long-feed.png`, fullPage: true })
  expect(room.writes()).toBe(0)
})
