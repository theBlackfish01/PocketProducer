# Verification record

Updated 2026-09-21. Windows, Node 22.14, pnpm 11.19, PostgreSQL 17.6 in Docker and Playwright Chromium.

## Isolation contract

Ordinary tests force `APP_ENV=test`, a database whose name ends in `_test`, `.local/test-audio`, `FIXTURE_MODE=true`, and empty OpenAI/Gemini environment values. Configuration refuses the normal development database/audio root or non-fixture test execution. Mock provider tests use the real transactional effect ledger but never construct a network client.

`pnpm test:e2e:prepare` truncates only the dedicated test database, then recreates the deterministic owned WAV/demo. It never touches the development database.

## Latest automated results

| Command | Result | Coverage highlights |
| --- | --- | --- |
| `pnpm lint` | pass | Strict typed ESLint, no warnings. |
| `pnpm typecheck` | pass | All TypeScript project references. |
| `pnpm test` | 5 files / 14 tests pass | Canonical arrangement, energy/export contract, deterministic render, malformed WAVs, bounded recorder cleanup, Gemini unavailable, forced repair success/failure, OAuth denial/state branches, refresh persistence failure and Nexus mapping/mock resume. |
| `pnpm test:integration` | 1 file / 8 tests pass | Owner/project idempotency, queued/running cancellation, lease recovery/fencing, DB-time stale commit rejection, expected-head race, identical composition reuse, encrypted Audiotool session, Gemini ledger/cache/malformed/timeout/budget. |
| `pnpm test:e2e` | 2 Chromium tests pass | Source audition, labeled seek/volume, real Play/Pause, unsupported revision rejection, real durable revision, A/B audition, Keep current, explicit restore, dialog/sheet focus return, phone focused composer, reduced motion. |
| `pnpm build` | pass | Production web bundle plus all TypeScript projects. Audiotool is lazy-loaded at connection time. |
| `pnpm verify:demo` | pass | Two immutable 44.636 s playable WAVs, distinct preview hashes, six scoped hat removals, byte-identical protected melody stems and four editable Nexus parts. |

Playwright’s Windows service teardown can leave the parent command waiting after both tests report `ok`; no service ports remain open. The tests themselves passed. This is tracked as harness cleanup, not a product failure.

## Required behavioral evidence

- Queued cancel is immediately terminal and emits one cancellation event. Running cancel settles through the current attempt; stale attempts cannot append progress or overwrite terminal state.
- Expired leases are reclaimed with a new generation/attempt. Old attempts fail writes.
- Successful Gemini mock output is cached and billed once. A timeout becomes `uncertain` and a second request is withheld. Malformed schema degrades to `failed`; a job at its cost ceiling never dispatches the mock.
- Source descriptors contain asset identity, measured facts, bounded observations and uncertainty; producer workspace text treats them as untrusted data.
- Preview critique is keyed to the exact WAV hash. A repaired candidate reruns deterministic signal/melody checks and is stored as `uncritiqued` when the one-pass Gemini budget is exhausted.
- A forced repair render failure returns the earlier composition/render unchanged.
- Four-stem offline Nexus validation creates four audio tracks and regions. Mock live adapter resumes the known drums sample, uploads three remaining stems, inserts all four and stops the synced document.
- Audio DTOs expose URLs/peaks and provenance, never server storage paths.

## Visual evidence

Playwright writes current representative images to ignored local evidence:

- `.local/evidence/listening-room-desktop.png`
- `.local/evidence/listening-room-mobile.png`

The final pass must inspect both files, not merely assert their existence. Desktop and 390×844 emulation are not substitutes for physical iOS/Android keyboard/safe-area verification.

Both final captures were visually inspected on 2026-09-21. The desktop image is free of transient dialog overlays; the mobile image preserves the selected ivory/forest/orange Listening Room hierarchy and keeps the core listen/revise/compare controls reachable.

The current revision audio is the ignored local artifact whose SHA-256 is `8db8389af5e66634ea8fec21b1a0fa275e4984eb82b9d9c74ab8346463641894`; decoded evidence is 44.636375 seconds, 48 kHz stereo, peak 0.452606 and RMS 0.057934. The original preview hash is `0a6e89a88036655f23b4574bcbba182147c377797ed20cc298d1311016ccbeeb`.

## Live-provider evidence

The configured models are `gpt-6-astra` and `gemini-3-flash-preview`. `pnpm budget:status` reports US$0.294040 recorded OpenAI actual cost and US$0 Gemini cost against a US$5 overall / US$0.25 job cap.

The integrated live runner dispatched once after explicit approval. It created one source-backed revision, spent US$0.067380 on successful OpenAI calls and proved reload did not create another effect. Both Gemini calls returned empty structured text and became terminal `failed` effects. The root cause was the former 512-token `maxOutputTokens`: Gemini 3 uses this ceiling for thinking plus answer tokens, so thinking can consume it before JSON output. The adapter now uses `minimal` thinking, a 2,048-token ceiling and accounts for thought tokens on both successful and invalid responses.

`pnpm test:gemini-live` is ready for a separately approved recovery proof. It:

1. reuses the existing owned source, generated preview and canonical revision;
2. makes only source-analysis and preview-critique Gemini calls under a new job/effect identity;
3. invokes neither OpenAI nor the renderer;
4. records typed analyses, exact hashes, thought-token usage and reconciled cost;
5. settles by reusing the existing immutable revision and will not automatically retry a terminal failure.

It will not retry a terminal failed/uncertain marked run automatically.

## Not yet verified

- Successful live Gemini source/preview responses after the bounded-thinking repair (new explicit approval pending).
- Live Audiotool OAuth, upload grant and Studio editability (registration/client ID and consent pending).
- Physical phone/notched-device behavior.
- Non-WAV decoding; intentionally unsupported.
