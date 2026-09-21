# Live implementation status

Updated: 2026-09-21 Asia/Karachi

Milestone: follow-up repair pass for the local create/listen/revise/compare loop
Baseline commit: `eaf47e3` (`main`, local only; no remote configured)

## Outcome

The loopback Listening Room is a real vertical slice: owned WAV source → durable generation job → typed producer plan → canonical arrangement → playable render → protected revision → A/B audition → explicit restore. PostgreSQL is the authority, audio is stored privately on disk, worker effects are fenced by attempt/lease/deadline, and ordinary tests cannot load configured provider credentials.

The supplied Gemini credential is detected. The requested live integrated verification did **not** execute: the host approval layer rejected transmission of the owned synthetic fixture and generated preview to Gemini/OpenAI as a separate external-data/spend action. No workaround was attempted and no Gemini spend was incurred. `pnpm test:live` is idempotently marked and ready for one run after that explicit approval.

Audiotool remains the only product-access prerequisite. `AUDIOTOOL_CLIENT_ID` is absent, so remote mutation was not attempted. All credential-independent Nexus work is implemented and mock/offline verified; exact registration steps are in `docs/USER-SETUP.md`.

## R1–R11 completion

| Requirement | State | Evidence / remaining issue |
| --- | --- | --- |
| R1 cancellation settles | Implemented, offline verified | Queued cancellation becomes terminal once; running cancellation is request → fenced settlement. Duplicate cancel and stale writes are integration-tested. |
| R2 leases/fencing | Implemented, offline verified | Periodic heartbeat, DB-time lease/deadline predicates, attempt UUID + generation, recovery claim and all consequential commits fenced. Current worker concurrency is honestly capped at 1. |
| R3 external-effect reuse | Implemented, offline verified | `reserved → dispatched → succeeded/failed/uncertain`; successful output reuses, ambiguous outcome never auto-replays. Gemini timeout test proves the fence. Audiotool checkpoints preserve project/upload identities. |
| R4 accounting | Implemented, offline verified | Transactional advisory budget lock, exact micro-USD columns, verified model price table, overall/job/call limits. Mock success, timeout and exhausted-budget paths pass. |
| R5 expected head | Implemented, offline verified | Head captured at acceptance; compare-and-swap selection; stale renders remain immutable but unselected; identical composition reuses the prior revision. |
| R6 ownership/contracts | Implemented, offline verified | Project-scoped idempotency, source/base ownership checks, melody/Groove lock validation, owner-safe DTOs without server paths. Cross-owner denial passes. |
| R7 playback identity | Implemented, browser verified | One `HTMLAudioElement` coordinates source/current/older-version identity, seeking, volume and wavesurfer. Source and A/B auditions explicitly return to accepted audio. |
| R8 request/UI reliability | Implemented, browser verified | Stale project requests ignored, drafts keyed by project, submission key survives interruption, bounded GET startup retry, polling failure surfaced, supported revision enforced client/server. |
| R9 recording/audio validation | Implemented, offline verified | Capture capped at 30 s / 5 MB before accumulation; stop/discard/setup cleanup tested. WAV chunks, encoding, alignment, sample finiteness, rate/channels/duration return typed 4xx errors. WAV only is advertised. |
| R10 Gemini integration | Implemented and mocked; live run awaiting explicit host approval | Real inline WAV, purpose-specific schemas, source descriptor → producer, exact preview hash, persisted usage/cost, bounded repair and honest uncritiqued final state. Mock success/cache, malformed, timeout, unavailable, budget and forced repair failure pass. Key/model are configured; no live Gemini call occurred in this pass. |
| R11 Nexus/Audiotool | Credential-independent work complete; live authorization blocked | Browser PKCE/callback, encrypted owner-bound token handoff, refresh persistence callback, server client, resumable four-stem upload/mapping and truthful states implemented. SDK mock and validated offline four-track document pass. Needs app client ID + consent for one real export. |

## Implemented behavior

- Listening Room desktop/phone UI with owned shadcn/Base UI components, Tailwind theme, Lucide icons, explicit empty/error/job/export states, keyboard-safe dialogs/sheets and reduced-motion rules.
- Fastify loopback API with private byte-range audio, bounded multipart input, owner checks and non-secret errors.
- PostgreSQL migrations `001`–`004`, outbox, durable jobs, event sequence allocator, cancellation, retry, effect ledger, immutable revisions, scoped analyses, Audiotool session/export state.
- OpenAI Deep Agent on LangGraph/PostgreSQL checkpoints with read-only runtime workspace/skills, one validated palette tool and Zod arrangement-plan output. It cannot write the canonical composition directly.
- Separate Gemini adapter for source analysis and preview critique; measured facts remain separate from model opinion.
- Canonical 960-PPQ, 16-bar Sunroom composition and deterministic 48 kHz renderer. The stable export contract is drums/bass/melody/texture; the texture stem is explicitly silent when a source is not actually used.
- Protected revision removes Groove hi-hats only, checks the exact melody structure and reuses the prior melody stem artifact.
- Nexus 0.0.17 `nexus-stem-v2` manifest records tempo, PPQ, duration, channel/rate facts and one full-timeline editable audio region per stem. “Editable” means audio clips/stems, not MIDI notes.

## Verification completed in this pass

- `pnpm lint`: pass.
- `pnpm typecheck`: pass.
- Vitest unit: **5 files / 14 tests pass**.
- PostgreSQL integration: **1 file / 8 tests pass**.
- Playwright Chromium: **2 tests pass**, including source audition, real playback state, unsupported edit rejection, real revision, A/B Keep current, explicit restore, dialog/sheet focus return and 390×844 reduced-motion emulation.
- Vite/TypeScript production build: pass (the Audiotool SDK is lazy-loaded only when connection is requested).
- PostgreSQL dev/test schemas migrated through `004_audiotool_session.sql`.
- Nexus offline validation produced four `audioTrack` and four `audioRegion` entities. Mock export resumed one prior upload, uploaded the remaining three, inserted all four and closed the synced document.
- `pnpm verify:demo`: pass. It proved two immutable 44.636 s WAVs with distinct SHA-256 hashes, six Groove hats removed, byte-identical protected melody stems and four editable Nexus parts.
- Representative desktop/mobile screenshots were visually inspected after the final browser run and are written to `.local/evidence/`; the desktop capture is dialog-free and the 390×844 layout keeps the focused composer in view. They remain intentionally uncommitted. Physical-phone behavior is still unverified.

## API usage

`pnpm budget:status` on 2026-09-21 reported:

- Overall cap: **US$5.00**; per-job cap: **US$0.25**; model calls/job: **4**.
- Recorded OpenAI actual cost: **US$0.226660** total — failed effects US$0.103980, successful effects US$0.122680. These are pre-existing live results preserved in the ledger.
- Recorded Gemini actual cost: **US$0.000000**.
- The rejected live-run attempt created no new provider job/effect and spent nothing.

## Exact blockers

1. **Integrated Gemini live proof:** execution requires explicit approval to transmit the deterministic 0.75-second owned fixture, the resulting generated preview, and bounded prompts to the configured Gemini/OpenAI APIs, with provider billing constrained by the existing US$5 overall and US$0.25 job caps. The host rejected the first execution request before dispatch.
2. **Audiotool live export:** register the app and set `AUDIOTOOL_CLIENT_ID` as described in `docs/USER-SETUP.md`, then authorize once in the Listening Room. No access/refresh token should be pasted into chat or `.env`.
3. **Physical phone:** safe-area and keyboard behavior passed Chromium emulation only.

FFmpeg is not required for this milestone. It is only needed if MP3/M4A/FLAC support is added later; the current product intentionally accepts WAV.

## Commands

```powershell
pnpm install --frozen-lockfile
pnpm db:up
pnpm db:migrate
pnpm generate:fixtures
pnpm seed:demo
pnpm dev
```

Quality and evidence:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
pnpm verify:demo
pnpm budget:status
pnpm test:live   # opt-in external provider transmission/spend
```

## Next

1. Receive the explicit live-provider transmission/spend approval and run `pnpm test:live` exactly once; record hashes, typed statuses, observed usage/cost and whether critique naturally requested repair.
2. Receive Audiotool app registration/client ID, complete browser consent, then perform one explicit export to a private test project and verify Studio editability.
3. Keep production identity, managed storage, deployment and submission outside this milestone.
