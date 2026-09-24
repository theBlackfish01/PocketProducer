# Verification record

## Post-`cb64447` native construction pass (2026-09-24)

`pnpm check` passed lint, strict typecheck, 13 unit files / 59 tests and production Vite build (existing large lazy SDK chunk warning). `pnpm test:integration` passed 2 files / 36 tests on the isolated PostgreSQL database with migration 012 applied. `pnpm test:e2e` passed six Chromium journeys in the final 1.0-minute run. No ordinary test can access provider credentials. No live OpenAI/Gemini/Audiotool request was dispatched for this pass.

The new integration assertions inspect actual successive Deep Agent model messages, preserve discovery/errors after a mutation, interrupt an unfinished 48-bar ensemble and continue known steps under one job. Actual offline SDK tests assert source channel/FX/automation fields, group/send pointers, preset override order, sample interval placement, curated instrument parameters and automation target/shape. The browser journeys retain a typed pending native draft across mode/project/reload, show partial-state continuation and large-arrangement disclosure, and preserve legacy playback. Captures `.local/evidence/native-desktop.png`, `native-mobile.png`, `native-tablet-large.png` were visually inspected; they are fixture screens. This does not verify a real model's artistic decisions, real Audiotool resource permissions/readback, native audio, physical phone or non-Chromium browsers. The detailed current matrix is [here](native-construction-completion.md).

## Guided Listening Room redesign (2026-09-24)

`pnpm check` passed: lint, strict typecheck, 12 unit files / 47 tests, and production build (only the existing large lazy SDK chunk warning). `pnpm test:integration` passed: 2 files / 32 tests. Final `pnpm test:e2e` passed: 5 Chromium journeys in 1.3 min after the copy/touch-target polish. All ordinary tests remain isolated fixture mode with zero provider access. The copy tests verify human progress/recovery labels and fact-derived arrangement summaries rather than exposing SDK prose.

The browser journey now uploads and auditions a real owned WAV in Arrange, confirms the source seek control, switches to empty Playable audio without carrying source playback, protects a part, opens/closes its details with focus return, targets a different part and section, revises, compares/restores and reloads. The playable-audio journey still uploads, plays, seeks, revises, A/B compares, restores and exercises durable receipt and needs-attention recovery. Desktop and 390 px mobile captures under `.local/evidence/` were inspected after the hero-overlap correction. Both phone journeys assert no horizontal document overflow; the direction field, compare-dialog focus return, navigation sheet and reduced-motion emulation are checked. This does not establish physical keyboard/microphone behavior or Firefox/WebKit compatibility. Native arrangement playback/share and live Audiotool synchronization are not claimed by these screenshots or tests.

## Creative construction follow-up (2026-09-24)

Final run: `pnpm check` passed (11 unit files / 44 tests, lint, strict types, build), `pnpm test:integration` passed (2 files / 32 tests) and `pnpm test:e2e` passed (5 Chromium journeys, 56.0 s). Ordinary tests have zero provider access. The contract double drives the real worker orchestration and validated offline Nexus document, not live Audiotool. Native desktop and 390 px screenshots under `.local/evidence/native-*.png` were inspected after the composer/palette/title changes. A native browser assertion was updated from the old protection string to the new pairwise comparison and then all five journeys passed. Physical-phone/non-Chromium verification remains open.

Scripted-model tests use the production Deep Agent/tools/accounting path for three different briefs, plus a targeted shared-motif revision. Fixture mode remains a separate deterministic path. Neither proves subjective sound quality or real provider creative behavior. Semantic SDK tests vary region, gain/pan, effect and automation; source tests check an initially silent WAV, nonzero intervals, durable upload identities and v2 readback. No native renderer or Gemini listening test ran in this follow-up. See [finding and example evidence](native-construction-pass.md).

## Prior native-construction verification (2026-09-23)

Normal tests remain offline (`APP_ENV=test`, `FIXTURE_MODE=true`, keys blanked in child processes, dedicated `*_test` database). `vitest` files and Playwright workers run serially because their repository tests share one queue identity; concurrent files were observed to steal each other's jobs before this harness correction.

- `pnpm check`: lint, strict typecheck, 8 unit files / 36 tests, and production build passed after native changes (Vite reports only its existing large lazy SDK chunk warning). The added music-hash test distinguishes motif-only edits from objective-text changes; the commit rejects objective-only revisions. Another test rejects unmapped device/effect knob values.
- `pnpm test:integration`: 2 files / 23 tests passed. Native additions exercise durable tool-step replay after worker requeue, competing claim, immutable protected revision, explicit restore/head CAS, cancellation/failure/ownership, objective-only commit rejection, and a remote-create checkpoint surviving worker restart without a duplicate dispatch.
- `pnpm test:e2e`: 4 Chromium tests passed in 51.1 s on the final run. The new journey constructs 64 bars and eight parts, protects a lead, varies a selected rhythm in a later section, compares/restores, reloads persisted state, searches Nexus capabilities, refuses native synchronization in fixture mode, and checks 390 px reduced-motion dialog focus return. The preserved legacy journey still uploads, plays, revises, compares and prepares a disabled offline handoff. E2E uses zero provider access. Physical phone and non-Chromium verification are not claimed.
- Pinned Nexus offline validation reads back native synth/drum counts, note/region/pattern/effect/automation entities, routing and converted timing. No native audio is produced or measured by these tests.
- A separate, explicit OpenAI foreground verification (not part of ordinary tests) succeeded in a new local room: two model calls, one `construct_native_blueprint` tool call expanding into 72 validated operations, 32 bars, eight native parts, immutable revision and offline SDK evidence. Observed cost for that successful job was US$0.124680. Before it, one sandboxed connection attempt failed with zero observed usage, and two foreground attempts exposed and corrected tool-turn budgeting/recursion issues; those two cost US$0.180250 combined. No Audiotool, Gemini or render call occurred in this assignment.

Ignored screenshots: `.local/evidence/native-desktop.png` and `.local/evidence/native-mobile.png`, visually inspected for the Listening Room palette, arrangement/part hierarchy, mobile stacking, safe-area flow and no horizontal overflow. The title generator was changed to truncate at a word boundary after the first capture. Native screenshots represent fixture-mode structure, not heard audio or live Audiotool synchronization.

## Earlier legacy audio/repair verification

Updated 2026-09-21. Windows, Node 22.14, pnpm 11.19, PostgreSQL 17.6 in Docker, Playwright Chromium.

## Isolation contract

Normal tests set `APP_ENV=test`, require a database name ending in `_test`, refuse the normal development asset root, require `FIXTURE_MODE=true`, blank all provider keys in child services, and set provider budgets to zero for browser runs. `tests/fixtures/fixture-provider-guard.ts` starts with nonsecret placeholder keys and replaces global `fetch` with a transport that throws; OpenAI must choose the labeled deterministic fallback, Gemini must return unavailable, and dispatch count must remain zero.

Integration and browser preparation delete only `dev-loopback` resources in the caller-supplied disposable database and test asset directories. They do not truncate the development database or seed the demo as a substitute for a required journey. Browser services own explicit ports, refuse existing listeners and terminate through test-only loopback shutdown endpoints.

## Current results

| Command | Result | Main evidence |
| --- | --- | --- |
| `pnpm lint` | pass | Strict ESLint, no warnings. |
| `pnpm typecheck` | pass | All TypeScript project references. |
| `pnpm test` | 7 files / 28 tests pass | Fixture isolation, composition/source lineage, renderer/WAV validation, recorder lifecycle, OpenAI bounds, Gemini failure/accounting, Nexus timing/recovery/token persistence. |
| `pnpm test:integration` | 1 file / 17 tests pass | Expiry/retry/cancel/lease fencing, actual process kill/restart, two contenders, command replay, ownership, analysis history, effect concurrency/finalization, export uncertainty and populated migration upgrade. |
| `pnpm test:e2e` | 2 tests pass in 27 s | Fresh project/upload/generation, lost acknowledgement and reload, actual playback, supported/unsupported revision, compare/focus/restore, disabled export, needs-attention, project scoping, 390×844 reduced motion. |
| `pnpm build` | pass | Production Vite bundle and strict TypeScript. |

## Maintained high-risk probes

- Database time settles queued and running deadline expiry once; stale generation/attempt writes cannot change a newer owner.
- A real worker child is killed. A restarted worker recovers its lease, two real contenders race, only one owns the job, and cancellation/death produces no revision.
- Same-key terminal replay resolves the original command after restore and leaves provider effect count unchanged; payload mismatch remains a conflict.
- Provider finalization is idempotent. Concurrent reservations share one lock, cached success does not dispatch, late observed usage updates the ledger without allowing stale application commits, and TypeError/fetch failures remain uncertain.
- Source attachment is not audible use. `none`, percussion, texture and silent texture paths are checked from compiled references.
- Analysis results are keyed by hash/purpose/model/prompt/interval and associated immutably with more than one revision.
- Nexus readback verifies 88/108 BPM Config, 960→3840 tick conversion, 245,760 ticks for a 16-bar body, the render tail, routing and four enabled tracks. Resume/cancel/timeout/token-rotation tests use installed SDK-backed shapes.
- Recorder tests cover late permission, construction/source/processor/connect/resume failures, automatic wall-clock and byte caps, repeated stop/discard and cleanup.

## Visual and audio evidence

The final browser run writes ignored evidence under `.local/evidence/repair-20260921-1500/`:

- `listening-room-completed.png` — current rendered version, arrangement sections and disabled local Nexus handoff;
- `listening-room-desktop.png` — empty destination/draft isolation after switching rooms;
- `listening-room-mobile.png` — 390×844 empty state and composer.

Desktop and mobile captures were visually inspected. The mobile capture preserves the ivory/forest/burnt-orange hierarchy, fits long title/status content without horizontal overflow, keeps the composer visible, and returns focus from the session sheet. This is emulation, not a physical-device microphone/keyboard claim.

Fresh previews and stems are decoded during unit/integration/E2E tests; tests assert real signal, 48 kHz stereo preview output, distinct revision hashes and byte-identical protected melody stems. Exact local evidence hashes are run-specific and are not treated as a public fixture identity.

## Live providers

Normal CI does not run live scripts. The integrated retained evidence includes successful OpenAI production and US$0.294040 recorded OpenAI actual cost. The latest targeted Gemini command attempted exactly two analysis steps and produced no response/request telemetry; both effects are terminal uncertain with unknown cost and cannot replay automatically. Successful live Gemini source/preview analysis therefore remains unverified.

Live Audiotool OAuth/export, physical phones, Firefox/WebKit and non-WAV decoding remain unverified. See `docs/STATUS.md` for the exact ledger and blockers.
