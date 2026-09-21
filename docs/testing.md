# Verification record

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
