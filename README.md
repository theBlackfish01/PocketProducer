# Pocket Producer

Pocket Producer is a loopback-first Listening Room. Its current workflow constructs expressive, editable native music from a direction, protects and revises parts, compares immutable versions, and can explicitly synchronize a Nexus project. Native audio rendering/playback is deliberately deferred. There is one composition workspace; the prototype four-stem audio workflow has been removed. Own recordings can still be uploaded, recorded and auditioned under **Sounds**.

This first milestone is deliberately local. It does not deploy publicly and it does not represent Gemini or Audiotool as live-verified merely because credentials are configured.

## Run it

Prerequisites: Node 22.14+ (below 25), pnpm 11.19, and Docker Desktop. The repository uses PostgreSQL on `127.0.0.1:54329`, the API on `127.0.0.1:8787`, and Vite on `127.0.0.1:5173`.

```powershell
pnpm install --frozen-lockfile
pnpm db:up
pnpm db:migrate
pnpm generate:fixtures
pnpm seed:demo
pnpm dev
```

Open `http://127.0.0.1:5173`, create a session, and enter either a few words or a detailed production brief. Recordings are optional. Choose Standard or Extended depth, inspect the saved plan and confirmed structural draft while the job runs, then inspect sections, parts and native palette. A safely paused Standard draft can be explicitly extended and continued on the same job without resetting confirmed work or accounting. Protect a part, target another part or section, request a precise change, compare structural versions and restore explicitly. In fixture mode this is an audio-independent deterministic demonstration, not evidence of real-model artistry. Use **Versions** to compare, **Sounds** for optional sources, the session menu for usage, and **Copy/Open in Audiotool** for the explicit handoff.

The root `.env` is loaded only by server code and remains ignored. Do not add secrets under `VITE_*`. For a no-cost deterministic run, launch the services with `FIXTURE_MODE=true`; live OpenAI creation requires the existing `OPENAI_API_KEY` and is fenced by `INITIAL_BUILD_API_BUDGET_USD` and `MAX_JOB_COST_USD`.

The current journey is **Start → Producer workspace**: accepted requests have saved conversation/activity, a shareable local session URL, and a score/Producer split on wide screens (a view switch on phone/tablet). Sounds, versions, usage and Audiotool are secondary panels. See the [hands-on guide](docs/native-production-guide.md). Existing checkouts need additive migrations **015–016** via `pnpm db:migrate` before restarting API/worker; they preserve music, assets and spending and label older directions as historical. No tracing settings need changing: configured LangSmith remains private diagnostic telemetry, not the user-facing feed.

## Useful commands

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
pnpm budget:status
```

Ordinary tests clear provider credentials and tracing. No automatic model call or Audiotool write occurs when navigating, comparing, or choosing a saved version.

## What is implemented

- React/Vite Listening Room using owned shadcn source, Base UI, Tailwind, Lucide and one source-audition controller, plus native arrangement/part/protection/compare views.
- Native 960-PPQ schema v2 with reusable motifs, MIDI notes, Beatbox8 patterns, instrument/effect/automation state, source intervals and validated protected operations; immutable history and durable step replay.
- Pinned Nexus capability discovery and offline native mapping/readback; checkpointed isolated remote sync with a strict unverified-live status. Native audio/Gemini are deferred; owned-source upload/placement has offline contract evidence, not new live verification.
- Fastify API, PostgreSQL canonical state and outbox/lease/fencing queue, independent worker, cancellation, retry and owner checks.
- OpenAI Deep Agent on LangGraph with PostgreSQL checkpoints, scoped runtime skills, a durable staged native plan, captured Standard/Extended limits, and validated musical construction tools. The text-only quality benchmark still needs real-model evaluation.
- Private content-addressed WAV sources, validation, measurement and HTTP range seeking.
- Gemini adapter retained at the future listening/source-analysis boundary; no native full-mix playback or automatic critique loop.
- Native Nexus mapping/readback with encrypted owner-bound OAuth, fenced uploads and durable copy recovery. Prior score-specific live evidence is in docs/STATUS.md; it does not prove heard quality.

See [docs/STATUS.md](docs/STATUS.md), [docs/native-text-to-music.md](docs/native-text-to-music.md), [docs/architecture.md](docs/architecture.md), [docs/design-system.md](docs/design-system.md), and [docs/testing.md](docs/testing.md).

## Understand the architecture

The interactive [Pocket Producer architecture course](docs/pocket-producer-course/index.html) walks through the Listening Room, API and PostgreSQL job system, Deep Agent producer, canonical native score and musical tools, Gemini/Nexus boundaries, and the verification strategy. It is a static artifact that can be opened directly; rebuild it on Windows with:

```powershell
& .\docs\pocket-producer-course\build.ps1
```
