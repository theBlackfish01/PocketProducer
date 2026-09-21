# Pocket Producer

Pocket Producer is a loopback-first Listening Room for turning a source sound or written direction into a short instrumental, listening to real rendered audio, asking for a protected revision, comparing immutable versions, and preparing an editable-stem Nexus handoff.

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

Open `http://127.0.0.1:5173`. Select **Sunroom demo**, audition the owned source, type a direction, and create. Then enter `Simplify the drums in Groove and keep the melody exactly.`, compare versions, audition A/B, and use the explicit restore action.

The root `.env` is loaded only by server code and remains ignored. Do not add secrets under `VITE_*`. For a no-cost deterministic run, launch the services with `FIXTURE_MODE=true`; live OpenAI creation requires the existing `OPENAI_API_KEY` and is fenced by `INITIAL_BUILD_API_BUDGET_USD` and `MAX_JOB_COST_USD`.

## Useful commands

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
pnpm test:live
pnpm test:gemini-live
pnpm verify:demo
pnpm budget:status
```

`pnpm test:live` is the opt-in integrated source-Gemini → OpenAI Deep Agent → render → preview-Gemini verification. It sends an owned synthetic WAV and generated preview to external providers and can incur bounded usage; run it only with explicit approval. The ordinary suite clears provider keys and is fully offline.

`pnpm test:gemini-live` is a separately authorized, two-call diagnostic. The retained 2026-09-21 identity is terminal after both transports failed without provider telemetry and is deliberately not replayable. Diagnose connectivity and use a genuinely new authorized identity before any future run; it does not invoke OpenAI or render again.

## What is implemented

- React/Vite Listening Room using owned shadcn source, Base UI, Tailwind, Lucide and one wavesurfer-backed playback controller.
- Fastify API, PostgreSQL canonical state and outbox/lease/fencing queue, independent worker, cancellation, retry and owner checks.
- OpenAI Deep Agent on LangGraph with PostgreSQL checkpoints, scoped runtime skills and a validated arrangement plan.
- Canonical tick composition, 48 kHz deterministic WAV renderer, per-part stems, measured audio facts and private content-addressed storage.
- Protected drum simplification, canonical melody and artifact checks, immutable history, A/B audition and explicit restore.
- Gemini source/preview adapter with structured critique, usage capture, one-repair ceiling and an honest unavailable state.
- Nexus v3 four-track mapping with explicit 960→3840 PPQ conversion, browser PKCE/callback, encrypted owner-bound worker sessions, and durable per-step recovery. Live mutation remains blocked on app registration/OAuth; see [docs/USER-SETUP.md](docs/USER-SETUP.md).

See [docs/STATUS.md](docs/STATUS.md), [docs/architecture.md](docs/architecture.md), [docs/design-system.md](docs/design-system.md), and [docs/testing.md](docs/testing.md).

## Understand the architecture

The interactive [Pocket Producer architecture course](docs/pocket-producer-course/index.html) walks through the Listening Room, API and PostgreSQL job system, Deep Agent producer, canonical compiler and renderer, Gemini/Nexus boundaries, and the verification strategy. It is a static artifact that can be opened directly; rebuild it on Windows with:

```powershell
& .\docs\pocket-producer-course\build.ps1
```
