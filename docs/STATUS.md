# Live implementation status

Updated: 2026-09-21 Asia/Karachi
Milestone: second repair assignment, local create/listen/revise/compare/export-preparation slice
Baseline inspected: runtime `010969f`, course update `25913b9`; newer work preserved

## Outcome

Pocket Producer is a working loopback Listening Room: an owned WAV or direction enters a durable PostgreSQL job, a bounded producer creates a validated canonical composition, the server renders playable 48 kHz audio and stems, and the user can request the supported drum simplification, compare immutable versions, restore one explicitly, and prepare a validated Nexus four-stem handoff.

The repair pass added migration `005_repair_recovery.sql` for lifecycle/effect/analysis/export recovery and `006_transport_uncertainty.sql` for conservative post-dispatch Gemini transport accounting. Normal tests force fixture mode, blank provider credentials in child processes, poison outbound `fetch`, and use a dedicated `*_test` database and separate asset roots. They cannot call OpenAI, Gemini, or Audiotool.

## F1–F8 and A1–A6

| ID | State | Evidence |
| --- | --- | --- |
| F1 Nexus time | Fixed, offline verified | Canonical 960 PPQ converts at the adapter boundary to Nexus `Ticks.Beat=3840`; Config tempo/signature/duration, full audio body + one-second tail, four routes and two tempos are read back from a validated SDK document. `providers.test.ts`. |
| F2 export recovery | Fixed, offline verified; live remote unverified | Stable revision/mapping operation key, durable per-step states, typed mutation uncertainty, cancellation/deadline checks, completed replay with no new mutation, serialized token persistence. Repository and adapter tests cover concurrency, stale recovery, cancellation and timeouts. |
| F3 lifecycle | Fixed, verified | Queued and in-stage deadlines settle once; cancellation, lease loss and monitor failure are typed. Integration tests kill a real worker process, restart it, run two contenders and fence stale attempts. |
| F4 fixture isolation | Fixed, verified | Placeholder OpenAI/Gemini keys plus fixture mode yield deterministic fallback/unavailable analysis and zero transport calls in a subprocess whose `fetch` always throws. E2E child environments also blank keys and set a $0 budget. |
| F5 command replay | Fixed, verified | Existing owner/project/kind/key is resolved before changed-head preconditions. Completed replay, payload mismatch, restore-before-retry and unchanged effect count are integration-tested. Browser test loses a POST acknowledgement, reloads, resolves the durable command receipt and does not resubmit. |
| F6 project-safe UI | Fixed, browser verified | Playback has explicit clear semantics; requests, polling, uploads, recording, restore and export are guarded by active project identity. E2E proves an empty destination has no inherited player, drafts remain scoped, and a delayed old snapshot cannot navigate back. |
| F7 needs attention | Fixed, browser verified | Persistent terminal UI exposes the safe reason and a read-only `Check known outcome` action backed by `/jobs/:id/reconcile`; accepted audio/history remain intact. |
| F8 source truth | Fixed, verified | Attached, selected, referenced and audibly used are distinct. Domain tests cover none/percussion/texture and silent texture; UI/export/live assertions use compiled audible references rather than attachment alone. |
| A1 request bounds | Fixed, verified | OpenAI reservations derive from normalized actual messages, a conservative UTF-8/framing bound, configured input ceiling, 900-token output ceiling and explicit price table. SDK retries are disabled; oversize/unsupported requests fail before dispatch. |
| A2 finalization/recovery | Fixed, verified with explicit limit | Attempt-bound finalization is idempotent, charges only deltas, retains successful output, records late usage and holds ambiguous reservations. Persisted successful graph calls can be reused; dispatch-before-persistence remains explicitly uncertain because provider retrieval/idempotency is unavailable. |
| A3 analysis durability | Fixed, verified | Immutable analysis identity is separate from many-to-many revision associations. Commit writes required associations before terminal success; reused source analysis remains attached to both histories. |
| A4 limits | Fixed, verified | Zero critique means zero preview call. Supported maxima are one critique and two render attempts (original + one repair); higher values are rejected. Failed repairs count and preserve the valid earlier candidate. Total calls and deadline are enforced. |
| A5 live criteria | Fixed; successful Gemini capability remains unverified | Both live runners now require exact hashes, typed available analyses, associations, observed usage and actual same-command replay. The targeted run attempted exactly two Gemini steps but received no provider response metadata; both are fenced uncertain and were not retried. |
| A6 recorder | Fixed, verified | Permission-after-navigation, all partial setup failures, wall-clock/byte caps, stop/discard repetition and resource cleanup are covered by unit tests. WAV remains the only advertised format. |

## Earlier R1–R11 reconciliation

- R1/R2: cancellation, expiry, heartbeat, restart and fencing are verified, including real subprocess contention.
- R3/R4: effect reuse and shared accounting are verified; unknown Gemini liabilities remain explicit.
- R5/R6: head selection, ownership, immutable history, analysis associations and replay ordering are verified.
- R7/R8/R9: coordinated playback, project-safe UI/receipts and recording cleanup are verified in unit/browser tests.
- R10: Gemini adapter, persistence and failure criteria are implemented; a successful live response is still unverified.
- R11: Nexus mapping/recovery is verified against SDK 0.0.17 offline; OAuth and a real Studio project still require app registration and consent.

## Verification

| Command | Result |
| --- | --- |
| `pnpm lint` | pass, zero warnings |
| `pnpm typecheck` | pass |
| `pnpm test` | 7 files / 29 tests pass |
| `pnpm test:integration` | 1 file / 17 tests pass against disposable PostgreSQL |
| `pnpm test:e2e` | 2 Chromium tests pass; command exits cleanly in 40.0 s |
| `pnpm build` | production Vite bundle and TypeScript build pass; large lazy SDK chunk warning only |
| `pnpm test:course` | pass: 6 modules, 18 quizzes, desktop interaction and 390 px mobile layout |

The browser test creates its own empty project and owned source, loses a generation acknowledgement, reloads/reconciles it, plays the real WAV, rejects an unsupported revision, completes the protected revision, A/B compares, restores, prepares the honest disabled export, displays needs-attention recovery, and checks stale navigation/drafts. The 390×844 test checks focused composer visibility, reduced motion and sheet focus return. Physical phone and non-Chromium browsers are not claimed.

Ignored evidence is under `.local/evidence/repair-20260921-1500/`, including completed/empty desktop and mobile captures. Fresh E2E previews are real 48 kHz stereo WAV artifacts under the isolated E2E asset root; the final 8,570,228-byte preview has SHA-256 `9DBFB282FA254B379DDF3EDD9ADA8F0E23B7DE4CFCA718C738D257C01EEB64D8`. No fixture screen substitutes for the render. The completed-state screenshot also verifies that a long deterministic title is shortened at a word boundary rather than cut mid-word.

## Provider usage and live status

After migrations `005`–`006`, `pnpm budget:status` reports:

- overall cap US$5; per-job cap US$0.25; maximum four model calls/job;
- recorded OpenAI actual cost US$0.294040 (US$0.190060 successful, US$0.103980 failed);
- zero observed Gemini cost, but exact remaining budget is **not known**;
- four historical/current Gemini effects have unknown usage liability, holding US$0.028895 of reservations;
- known spent-or-reserved total US$0.313556; remaining upper bound US$4.686444.

The authorized targeted runner attempted one source-analysis and one preview-critique step on retained audio. Both ended after dispatch with `TypeError`, zero provider telemetry and no request ID. They are now `uncertain`/unknown-cost, the job is terminal, and the runner refuses automatic replay. No OpenAI call or new render occurred. This does not verify successful Gemini analysis and it does not prove the provider billed zero.

`AUDIOTOOL_CLIENT_ID` remains absent. Offline implementation is complete; no live Audiotool mutation was attempted. Nexus 0.0.17 exposes `unlisted`, not a private upload visibility option, so the first authorized test must confirm the account/privacy behavior as well as scope and editability.

## Run and demonstrate

```powershell
pnpm install --frozen-lockfile
pnpm db:up
pnpm db:migrate
pnpm generate:fixtures
pnpm seed:demo
pnpm dev
```

Open `http://127.0.0.1:5173`, create a room, upload an owned WAV, enter a direction, wait for the durable render, play it, enter `Simplify the drums in Groove; keep the melody.`, compare A/B, restore either version, then choose **Prepare Nexus handoff**. With no Audiotool registration, the app produces and validates the local four-stem manifest and truthfully reports `disabled`.

Supported envelope: one 16-bar Sunroom instrumental, WAV input, drums/bass/melody/texture stems, one precise Groove drum simplification with melody protection, stem-level (not note-level) export editability.

## Genuine remaining user actions

1. Register the Audiotool development app, add only `AUDIOTOOL_CLIENT_ID`, and complete browser consent before one explicitly authorized remote export; see `docs/USER-SETUP.md`.
2. If desired, diagnose provider/network access before authorizing a new Gemini identity. The current terminal uncertain verifier must not be silently replayed.
3. Perform a physical iOS/Android keyboard, microphone and safe-area check. Public deployment and submission remain later work.
