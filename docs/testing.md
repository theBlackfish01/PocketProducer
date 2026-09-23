# Verification record

## Native-construction verification (2026-09-23)

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
