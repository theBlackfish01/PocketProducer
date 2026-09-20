# Live implementation status

Updated: 2026-09-20 22:56 Asia/Karachi  
Milestone: substantial local create/listen/revise/compare loop  
Branch: `main` (local repository; no remote configured)

## Implemented

- Pinned pnpm monorepo, strict TypeScript, lint, two ordered PostgreSQL migrations, Docker Compose, CI, project-local instructions and setup/architecture/design/music/testing docs.
- Listening Room UI on desktop and phone with owned shadcn/Base UI source, Tailwind tokens, Lucide, wavesurfer, upload/record/source audition, real player/seeking, direction entry, durable progress/cancel states, version comparison and explicit restore.
- Fastify API, loopback-only development auth, owner-scoped reads/mutations, private content-addressed local assets, rendered byte ranges and structured non-secret errors.
- PostgreSQL outbox queue with independent worker, leases, restart reclamation, fencing generation, safe cancellation, one transient retry, immutable revisions and expected-head compare-and-swap.
- OpenAI Deep Agent on LangGraph/PostgreSQL checkpoints with scoped runtime skills, read-only workspace, palette tool and Zod structured plan. Natural-language output feeds the real compiler/renderer.
- Canonical 960-PPQ composition, project-owned Sunroom palette and deterministic 48 kHz WAV renderer with preview, four stems, waveform peaks and measured audio facts.
- Protected revision: simplify Groove drums while preserving exact melody structure and stem artifact; immutable A/B and restore.
- Gemini real-audio adapter for source and preview purposes, JSON-schema critique, token usage, model-call/spend fences, persistent analysis records and one bounded deterministic repair. Missing-key state is explicit.
- Nexus 0.0.17 node probe and `nexus-stem-v1` four-part manifest with explicit fidelity and auth state.
- Self-contained six-module architecture course at `docs/pocket-producer-course/index.html`, covering the complete user flow, durable jobs, Deep Agent contract, canonical music/rendering, provider boundaries and debugging with exact source excerpts.

## Verified

- Typecheck, lint, unit, PostgreSQL integration, Playwright desktop/phone tests and production web build pass.
- Live `gpt-6-astra` Deep Agent access succeeded. The integrated job produced **Sunroom Haze** from the seeded owned WAV and rendered a 44.64-second playable instrumental.
- Combined recorded OpenAI spend: **US$0.22666** (US$0.10398 fenced failed graph attempt, US$0.06164 corrected smoke, US$0.06104 integrated generation). Gemini spend: US$0; no key, no call. This remains well below the authorized US$5 cap.
- Two immutable demo revisions exist. Revision 2 removes exactly six Groove hats; protected melody structure hash and melody-stem SHA-256 are unchanged. Preview hashes differ and both files are non-silent.
- Browser WAV playback changed Play → Pause and advanced the seek value. Range request returned HTTP 206. Explicit restore was exercised v2 → v1 → v2.
- Desktop and 390×844 screenshots inspected. axe WCAG A/AA: zero violations/incomplete checks. Keyboard sheet/dialog focus and return, A/B radios, named seek/volume controls, focused phone composer and reduced motion were verified.
- Nexus export contains four editable stems and truthfully reports `needs_auth`.
- Integration tests cover duplicate/idempotency conflict, worker lease recovery, failed/cancelled revisions and cross-owner denial.
- Architecture course browser QA: six modules and quizzes, exact code translations, working request-flow/chat interactions and glossary tooltips, no duplicate IDs or console warnings, and zero horizontal overflow at a 390×844 emulated viewport. This is an educational artifact check, not a new physical-device claim.

## Blocked or intentionally unavailable

- **Gemini live critique:** `GEMINI_API_KEY` or `GOOGLE_API_KEY` is absent. Optional for the core loop. Add one to root `.env` to enable real source/preview listening; the adapter will reserve US$0.05 per call against the configured cap pending usage reconciliation.
- **Audiotool live export:** no app registration/OAuth. Required variables are `AUDIOTOOL_CLIENT_ID`, exact registered callback `http://127.0.0.1:5173/auth/audiotool/callback`, and scopes derived/approved for the registered app. The exact live scope grant and remote mutation still need verification; no mock remote project is claimed.
- **Broad decoding:** FFmpeg is not installed. WAV upload/recording is fully working; MP3/M4A/FLAC remain disabled. Install FFmpeg and add/implement `FFMPEG_PATH` before enabling those formats.
- **Production:** real identity, object storage, managed PostgreSQL and public deployment are later milestones. The current API refuses non-local-auth mode and binds only to loopback.

## Evidence and commands

- Start: `pnpm db:up`, `pnpm db:migrate`, `pnpm generate:fixtures`, `pnpm seed:demo`, `pnpm dev`.
- Demo verification: `pnpm exec tsx scripts/verify-demo.ts`.
- Spend audit: `pnpm exec tsx scripts/audit-usage.ts`.
- Full local quality pass: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build`.
- Screenshots and exact test record: `docs/testing.md`.

## Next

1. Add a Gemini key and run one budgeted live audio critique/repair validation; record observed usage/pricing.
2. Register an Audiotool app, confirm exact scopes/callback, implement the browser OAuth exchange and verify the resulting remote project is meaningfully editable.
3. Add production identity/storage only when deployment becomes the active milestone.
