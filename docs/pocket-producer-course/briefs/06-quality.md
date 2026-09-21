# Module 6: Safety, Testing, and Debugging

### Teaching Arc
- **Metaphor:** An aircraft preflight checklist: individual parts matter, but confidence comes from testing the journey and the failure cases together.
- **Opening hook:** A pretty Listening Room is not enough; the project proves real playback, durable failure behavior, access control, and protected audio.
- **Key insight:** Quality is layered—types/lint, domain tests, database integration, browser journeys, live provider proof, and explicit unverified items.
- **Why should I care?:** It gives a practical order for diagnosing failures and stops AI-generated “green” claims that were never run.

### Code Snippets (pre-extracted)

File: tests/integration/repository.test.ts (lines 48-57)
```ts
  it("reclaims an expired lease with a new fencing generation", async () => {
    await dispatchOutbox();
    const firstClaim = await claimNextJob("worker-before-restart");
    expect(firstClaim).not.toBeNull();
    await getPool().query("UPDATE job SET lease_until=now()-interval '1 second' WHERE id=$1", [firstClaim?.id]);
    const secondClaim = await claimNextJob("worker-after-restart");
    expect(secondClaim?.id).toBe(firstClaim?.id);
    expect(secondClaim?.leaseGeneration).toBe((firstClaim?.leaseGeneration ?? 0) + 1);
    if (secondClaim) await failJob(secondClaim, "TEST_COMPLETE", "Expected integration-test terminal state");
    expect((await jobSnapshot(ownerA, secondClaim?.id ?? "")).state).toBe("failed");
```

File: tests/e2e/listening-room.spec.ts (lines 16-27)
```ts
  await expect(page.getByRole("slider", { name: "Seek through the current version" })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Playback volume" })).toBeVisible();
  const play = page.getByRole("button", { name: "Play current version" });
  await play.click();
  await expect(page.getByRole("button", { name: "Pause current version" })).toBeVisible();
  await page.getByRole("button", { name: "Pause current version" }).click();

  const compare = page.getByRole("button", { name: "Compare" });
  await compare.click();
  await expect(page.getByRole("dialog", { name: "Compare versions" })).toBeVisible();
  await page.getByRole("button", { name: "Keep current" }).click();
  await expect(compare).toBeFocused();
```

### Interactive Elements
- [x] Code↔English translation of worker restart test.
- [x] Quiz: 3 debugging scenarios—UI stale, audio silent, and honest recovery from a terminal provider failure.
- [x] Testing pyramid cards with exact verified/unverified distinctions.
- [x] Visual troubleshooting decision path from browser → API → job events → worker/effects → revision/audio.

### Reference Files to Read
- `references/interactive-elements.md` → Code ↔ English Translation Blocks, Flow Diagrams, Pattern/Feature Cards, Multiple-Choice Quizzes, Glossary Tooltips
- `references/design-system.md` → Module Structure, Responsive Breakpoints
- `references/content-philosophy.md` → all content rules
- `references/gotchas.md` → full checklist

### Connections
- Previous: external boundaries reveal honest unavailable states.
- Next: final big-picture handoff with vocabulary and safe next changes.
- Tone/style: distinguish provider-proof fixture isolation, successful live OpenAI evidence, terminal/uncertain Gemini failure evidence, emulated mobile checks, and unverified physical-device/Audiotool paths. The maintained suite currently has 29 unit/domain tests, 17 PostgreSQL integration tests, two fresh-project browser journeys, and explicit service shutdown.
