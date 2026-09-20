# Initial build milestone — a working local creative product

This is the scope for the first substantial implementation assignment, not merely a repository bootstrap. It spans the meaningful local portions of roadmap Phases 0–5 and the accessible portion of Phase 6. Production deployment, broad musical expansion and full release hardening remain later work.

**Target:** open the local web app, add/record a sound, give a direction, obtain an actual OpenAI-led instrumental rendered on the server, play it, request a drum revision while preserving melody, and compare/restore versions. Job state and assets survive a refresh/process restart. Run Gemini critique and real Audiotool export when their access is available. Keep exact external blockers visible and keep independent implementation moving.

No application-code percentage is promised; the outcome is observable behavior. Do not stop after a plan, mock screens, empty packages, schema files or a successful provider hello-world.

## First orientation and access check

1. Inspect the attached project directory, instructions, git state and environment. It is the intended application workspace unless evidence says otherwise; don't ask for a path already supplied by the session. Preserve existing code and user changes.
2. Locate the attached package and copy/extract into `docs/handoff/` only if needed. Preserve the selected image and relative links. Read [the UI component-system plan](15-UI-library-and-component-system.md) alongside the selected UX. Reconcile the local AGENTS/CLAUDE templates and initialize concise live status.
3. Load the existing OpenAI key server-side without printing env contents. Check variable names/presence safely and identify the configured model. Use the proposed candidate if no model is selected and access permits.
4. Check Node/package-manager, PostgreSQL, FFmpeg and browser-test availability. Prefer existing runtimes; install ordinary project dependencies locally. If Docker/WSL/system permissions or an executable is missing, describe exactly what is needed rather than repeatedly retrying the same unavailable route.
5. Report only actionable missing credentials/prerequisites. Ask for Gemini configuration and Audiotool registration/authorization when absent. LangSmith is optional; no cloud storage/hosting key is required for the local milestone.
6. Write a short implementation plan and immediately execute it. Save any awaiting-user dependency in `docs/STATUS.md`; don't let it stop all work.

## Work order and evidence

| ID | Deliverable | Acceptance evidence |
| --- | --- | --- |
| I1 | Reproducible app foundation | Pinned compatible versions, lockfile, real setup/scripts, strict types, env validation, local instructions, CI and clean build |
| I2 | Durable backend and worker | Real Postgres migrations, owner-scoped projects/assets/revisions/jobs, queue/outbox, cancellation, bounded retries, leases and event snapshots |
| I3 | Canonical music and real audio | Runtime IR schemas, source lineage, owned palette, event scheduling, part renders, non-silent playable preview and measured timing |
| I4 | Listening Room on desktop/phone | Custom-themed shadcn/Base UI components, real upload/record workflow, source audition, player/seek, sections, composer, progress, failure/retry and version UI; inspected at representative sizes with keyboard/focus checks |
| I5 | Real OpenAI Deep Agents producer | Existing key used through tested adapter; relevant runtime skills/workspace; intent → valid arrangement → actual renderer; fixed fixtures only in explicitly named test mode |
| I6 | Protected revision and A/B | One real drum simplification, unchanged protected melody artifact/structure, previous result still playable, compare and explicit restore |
| I7 | Gemini analyst and feedback boundary | Typed adapter/cache/error states and deterministic tests always; actual audio request and bounded critique repair if key supplied; clear unavailable mode otherwise |
| I8 | Nexus integration | Adapter, config/auth flow, IR mapping and contract tests always; real editable project/export retry evidence when access permits |
| I9 | Verified local handover | Appropriate tests/build pass, sanitized UI/audio evidence, exact launch commands, actual costs, known blockers and next milestone |

Use one musically coherent 30–60 second instrumental palette with up to four parts. A shorter fixture is fine for fast regression, but the product flow must actually create an arrangement from intent. Keep the palette narrow enough to make renders and exports predictable. Changes to the brief should cause meaningful validated differences rather than simply renaming one hardcoded track.

## Recommended execution order

**A. Prove and scaffold together:** bounded audio/SDK/provider spikes plus minimal executable repository. Create a deterministic fixture that renders and plays first. Do not spend the entire assignment searching for an undocumented Audiotool headless engine; select the supported fallback and record the limitation.

**B. Build persistence and the real UI:** establish shadcn/Base UI, Tailwind and Lucide with Listening Room tokens; inspect a small themed button/dialog/slider set. Connect upload/asset processing, job snapshots and player to actual storage/database. Compose the core responsive layout around the selected mockup rather than a stock dashboard template. Use clearly separated UI fixtures only for isolated component work, and preserve a working equivalent foundation if already present.

**C. Connect Deep Agents:** implement allowed domain tools, scoped virtual workspace, versioned runtime skills and the OpenAI adapter. Demonstrate a real producer request compiling to the same tested renderer. Persist the request, constraints, outputs and effect identities.

**D. Implement revision early:** add protected-track enforcement and one useful scoped revision, then A/B and restore. This is essential first-milestone behavior, not an indefinite future feature.

**E. Add audio intelligence/export:** integrate Gemini when available and exercise one bounded critique pass. Build the Nexus flow and verify live export when the user authorizes it. Continue tests/docs/UX around any pending credentials.

**F. Verify from fresh local state:** run setup/migrations, required checks and the whole user journey. Restart the worker; reload the page; retry a failed request; inspect both small and large screens. Record exactly what remains untested.

## Keeping progress real when access is missing

- No Gemini key: real OpenAI creation, signal measurements and revisions still work. Show audio critique as unavailable; mocked Gemini responses appear only in tests.
- No Audiotool authorization: use an explicitly enabled loopback-only development session to own real local projects. Implement production auth/export adapters but label live login/export pending. Refuse startup with development auth in production.
- No cloud storage: use the local object-store adapter and real files, preserving the storage contract.
- No optional LangSmith/interpreter/media library: keep structured local traces, normal typed tools and standard browser capture. Optional tooling cannot block the product.
- Invalid OpenAI key or inaccessible model: explain the specific safe error and required configuration. Complete renderer/domain/UI/revision tests while waiting, but do not report live creation as verified.

Do not substitute an in-memory array for required durable backend state and then call persistence done. If PostgreSQL or another essential local prerequisite is truly unavailable, isolate the blocked checks and continue useful work; identify the installation/access needed.

## Candidate tools during this assignment

Read [the tooling register](13-Deep-Agents-models-and-candidate-tools.md). Adopt Tonal/wavesurfer where they materially reduce implementation work, evaluate Mediabunny only for a specific capture need, and keep interpreter/Essentia/hosted evaluation adoption proportional. Record benefits, package versions, credentials and fallback. Do not turn a technology survey into the primary deliverable.

## Initial quality gates

- Valid source input produces real decodable, non-silent audio with expected duration and actual source lineage.
- The OpenAI producer makes a meaningful structured choice; a canned arrangement alone cannot pass live creation.
- Protected content remains unchanged through a real revision; a text claim is insufficient.
- Duplicate submission, cancellation race, worker restart and stale base version have tested outcomes.
- Backend denies cross-user asset/job/revision access, including event and playback routes.
- Refresh/disconnect does not lose accepted audio, request status or current version.
- Desktop/mobile UI, recording permission denial, empty state and recoverable failure are exercised. Library integration checks cover overlay focus/dismissal, labeled seeking, A/B selection, touch targets, actual theme contrast and mobile keyboard/safe areas.
- Gemini analysis references the actual current render, respects the loop cap and cannot bypass validation; missing-provider state is honest.
- Nexus export is either live-verified with stated fidelity or explicitly pending external access. No fake success link.
- Setup, build, lint/types and relevant unit/integration/browser tests actually run. CI doesn't require paid keys for deterministic tests.

Use meaningful tests from [the quality plan](08-Testing-and-quality.md); do not write large quantities of superficial tests to inflate completion. Full production load/security/backup exercises remain release work, but architecture must leave a clear path to them.

## What the agent delivers when this milestone is complete

1. Runnable code with exact local startup commands and a clear way to open the app.
2. A short real demo path and owned sample/fixture; link representative generated artifacts where appropriate.
3. Feature truth table: implemented and live-verified / deterministic-test verified / waiting on access / later scope.
4. Actual commands/results, representative desktop/mobile screenshots, audio measurements and listening limits.
5. Safe credential/prerequisite checklist naming remaining env variables and user actions; no secret values.
6. Current `docs/STATUS.md`, architecture decisions, tooling choices, setup and API notes.
7. Recorded application API spend/limits and a prioritized next milestone, without invented percent-complete claims.

Stop only when these local outcomes are met or genuinely blocked after completing independent work. Do not request permission at the end of every phase to continue already authorized implementation. Do not publish, purchase infrastructure or submit the hackathon as part of this initial local assignment unless separately authorized.
