# Phases, work items and exit gates

Execute in vertical slices. Keep a small live backlog with the IDs below; adapt granularity to actual findings. Estimated blocks are planning aids, not commitments: access, audio quality and SDK uncertainty dominate. September 28 was the previously observed hackathon date; exact cutoff and submission rules require rechecking. Do not promise the entire roadmap fits the remaining days.

**First assignment:** complete the [substantial initial build milestone](14-Initial-build-milestone.md), spanning the local core of Phases 0–5 plus accessible Phase 6 work. Phase 0/1 completion alone is not a sufficient stopping point. The existing OpenAI key should be used for bounded live producer verification; missing Gemini/Audiotool access should block only the corresponding live proof.

## Phase 0 — prove the technical core and select the path

**Outcome:** no foundational assumption about rendering or editability remains hidden.

- P0.1 Inspect workspace, repository instructions, available tools, runtime and existing work. Establish the separate application repo and concise status. Keep unrelated vault content out.
- P0.2 Pin a candidate environment; write small SDK scripts and inspect installed types. Record current official references, OAuth details, tick conversion and sample readiness.
- P0.3 Perform the owned-sample/native-pattern/audio-region tests in the feasibility document when the user connection is available.
- P0.4 Prove an independent server preview, through a supported official route or the bounded deterministic fallback. Verify actual audio properties, not just process success.
- P0.5 Export multiple meaningful parts and inspect/play them in Audiotool. Record fidelity and any unsupported transformations.
- P0.6 Decide audio/auth/IR architecture in short ADRs and list explicit blockers. Confirm release scope that this evidence supports.
- P0.7 Load the supplied OpenAI environment configuration without displaying secrets, compile a minimal Deep Agents integration against pinned JS packages, and verify a real typed tool/structured-output round trip within the initial API-test cap.
- P0.8 Check Gemini and optional tooling access. If Gemini is available, prove that actual audio reaches it and its structured observations can guide a validated producer patch. Otherwise prepare the adapter and exact key request while continuing the local build.

**Tests/evidence:** one known waveform/source, known four/eight-bar schedule, actual preview file, timing measurements, remote project structure and manual audition notes. Closing the browser does not stop a server render. The adapter compiles against a pinned version.

**Exit:** audio path and export strategy established with evidence. If account access is pending, mark the native portion pending and continue offline components; it is not a passed gate. Stop looking for speculative headless APIs after the bounded spike and make an explicit fallback decision.

## Phase 1 — repository and durable foundation

**Outcome:** a clean clone can start the app, run checks, and persist a job safely.

- P1.1 Create workspace scripts, strict TS settings, formatter/linter, dependency lockfile, env validation, local instructions and setup guide. Pin runtime/package manager and provide Windows-compatible commands; containers are optional but document required Docker/WSL assumptions.
- P1.1a Establish the [UI foundation](15-UI-library-and-component-system.md): shadcn/Base UI, Tailwind and Lucide; compatible pinned versions, project config, theme aliases and an initial themed button/dialog/slider preview. Inspect an existing foundation before deciding whether any migration is justified.
- P1.2 Add Postgres migrations for users/projects/assets/revisions/jobs/effects/events/outbox and indexes. Implement owner-scoped repositories and transactional command handling.
- P1.3 Implement app sessions around verified Audiotool identity, secure token storage/refresh, logout and route authorization. If live authorization is pending, implement an explicit loopback-only development session with production startup safeguards; keep it separate from mocked provider fixtures.
- P1.4 Add local/private object-storage adapter, upload intents, readiness/probe lifecycle, signed playback access and cleanup policy.
- P1.5 Add queue dispatcher/worker, leasing, cancellation, bounded retries, effects ledger, snapshots and progress events.
- P1.6 Add CI with lint/types/unit/contracts/build; infrastructure-backed checks as soon as their first slice exists. Add structured log IDs and readiness endpoints.

**Tests:** two users cannot access each other's IDs; duplicate command returns one job; crash between outbox publish/marking does not duplicate work; secret config is absent from frontend bundle; clean migrations run on an empty DB.

**Exit:** minimal authenticated/fixture session creates a durable no-op/test job that survives process restart. All advertised setup commands execute. No simulated worker is labeled production-ready.

## Phase 2 — real audio vertical slice without an LLM

**Outcome:** a canonical fixture renders correctly and plays in the browser, with export mapping proven.

- P2.1 Implement composition schemas, deterministic tick/sample conversion, source lineage and render hashes.
- P2.2 Add bounded decoding, trimming, event scheduling, per-part mixing, fades, preview encoding and waveform peaks.
- P2.3 Render a curated eight-bar fixture, with obvious source reuse and an intentional ending. Save stems, preview and QA report.
- P2.4 Build a minimal real player with seek/range, auth-aware media URL refresh and actual error handling.
- P2.5 Integrate the established Nexus clip/native mapping behind one adapter; keep a real remote export as an opt-in test fixture if credentials permit.
- P2.6 Measure render duration, peak, memory and timing on the target environment. Record limits that follow from measurements.

**Tests:** event timing at several tempos, one-shot overlap, source offsets, known channel mix, invalid audio, silence/clipping, process timeout, output hash/cache invalidation, eight-bar duration within an explicit rounding tolerance. Check audio by listening as well as metrics.

**Exit:** input sample → stored valid IR → server audio → browser playback → meaningful Audiotool representation. This is the first genuine product backbone.

## Phase 3 — polished Listening Room and source capture

**Outcome:** both phone and desktop can complete input and listening with the selected design.

- P3.1 Compose the app shell, session rail/menu, editorial header, cover, real player and section strip using the themed UI foundation. Keep the selected Listening Room typography/layout; do not adopt a generic dashboard block. Use the component map for library reuse versus custom music behavior.
- P3.2 Implement new session flow, upload/record review, individual source audition, trim/role controls, source strip and expanded detail.
- P3.3 Implement direction composer, text drafts, scope/protection chips, microphone distinction and dictation adapter if available.
- P3.4 Implement state-specific presentation: empty, uploading, generating, ready, failed, offline, reconnect and export. Connect to real job snapshots; fixture data remains explicitly separate.
- P3.5 Integrate library sheets/dialogs and selection controls with correct labels, focus restoration, keyboard behavior, reduced motion, touch targets and safe-area keyboard handling. Avoid hidden duplicate overlays at responsive breakpoints and test Base UI composition APIs against installed versions.
- P3.6 Visually inspect screenshots at the required widths and correct layout/typography against the selected mockup. Test overflow with long titles and many sources.

**Tests:** browser journeys for upload/play/record-permission denial, mobile composer focus, sheet keyboard trapping and dismissal, automated accessibility plus manual checks, no overlapping audio sources.

**Exit:** representative users can provide a sound and operate the listening flow on small/large screens. Ready, empty and failure states all look intentional; this is not just a desktop screenshot.

## Phase 4 — constrained autonomous creation

**Outcome:** natural language drives a real supported musical composition.

- P4.1 Define separate OpenAI producer, Gemini audio-analysis and transcription adapters with fixture providers for deterministic CI. Use the already supplied OpenAI key securely; request only missing credentials. Add validated cost limits without committing secrets.
- P4.2 Implement source analysis and structured brief schema, palette selection, rhythm/harmony/arrangement primitives and deterministic expansion.
- P4.3 Implement the bounded Deep Agents production loop: interpret → plan → compile → validate → render → measure/critique → constrained repair if useful → commit. Add persistent checkpoints/effects, scoped workspace, versioned runtime skills and a strict critique/render cap.
- P4.4 Handle unsupported requests, uncertain analysis and material ambiguities honestly. Defaults do not overwrite explicit constraints.
- P4.5 Generate concise summaries from actual plans/diffs. Add provenance display and renderer capability checks before spend.
- P4.6 Run a small fixed creation benchmark with multiple seeds, owned sources and varied directions. Improve prompts/primitives based on repeated failure patterns, not a single cherry-picked demo.
- P4.7 Compare direct generation against Gemini-assisted source analysis and one preview-critique pass, using protected-part correctness, listening preference, latency and spend. Keep optional interpreter/media/evaluation integrations only when their trial demonstrates value.

**Tests:** malformed model JSON, invalid musical ranges, injection text in source metadata, unsupported palette, zero budget, rate limits, model timeout, bounded repair, successful resume and real live outputs under a configured budget.

**Exit:** at least several distinct supported briefs produce usable and recognizably different arrangements, with actual source use and no fabricated claims. Musical quality has listening evidence; a green schema test alone does not pass this phase.

## Phase 5 — controlled revisions and version comparison

**Outcome:** “change this, keep that” is a verifiable capability.

- P5.1 Add semantic patch operations, base-hash validation, protected hashes, allowed section ranges and meaningful diffs.
- P5.2 Implement a drum-density revision, a track-balance revision and a section-specific change, each with protected content.
- P5.3 Reuse unchanged artifacts, render candidates, preserve accepted playback while work runs, and commit under concurrency checks.
- P5.4 Add version list, A/B at appropriate playhead position, explicit use/restore and branch-conflict UI.
- P5.5 Handle lock/tempo/key conflicts with one concrete choice. Check cancellation immediately before commit.

**Tests:** locked part hash/stem unchanged; outside-scope events untouched; stale-base conflict; second-device restore; cancellation race; A/B gain/playhead behavior; failed revision leaves previous version playable.

**Exit:** the core demonstration revision is audible, structurally correct, reversible and understandable without a DAW.

## Phase 6 — dependable Audiotool handoff

**Outcome:** the current revision reliably becomes an honestly labeled editable project.

- P6.1 Complete scoped authorization, readiness polling, remote project/entity mapping and export effect reconciliation.
- P6.2 Export supported clips/notes/stems, routing, tempo and arrangement. Bake unsupported processing only with explicit part-level fidelity labels.
- P6.3 Add export retry/reconnect UI, current-version identity and remote-open action. Do not silently reuse the wrong version's project.
- P6.4 Verify upload completion, remote timing, source offsets, new-project ownership and no unintended modifications to other user projects.
- P6.5 Record real export listening/editing evidence and a documented SDK-upgrade check. Test at least one retry after an interrupted operation.

**Tests:** duplicate export command, token expiry, upload not ready, missing scope, remote create timeout with uncertain result, source-reference mismatch, native tick conversion, stale revision export, meaningful edit in the Studio.

**Exit:** a fresh authorized user can open and edit the exported result. If the implementation uses stems, the UI and demo say so. A downloadable mix is not sufficient.

## Phase 7 — release hardening and musical polish

**Outcome:** core flows withstand realistic failures and feel finished.

- P7.1 Run the full test matrix, fault injection and representative musical evaluation. Fix critical/high issues before optional features.
- P7.2 Test browser engines, real phone behavior where accessible, touch/keyboard, accessibility, slow network, audio interruptions and recording formats.
- P7.3 Measure bundle/startup/job latency/memory/cost, tune bounded concurrency, and validate rate limits. Avoid optimization that changes preserved musical output without versioning.
- P7.4 Complete source/asset license inventory, dependency review, deletion/retention behavior, redacted logs and secret scan.
- P7.5 Exercise backup/restore, deploy/rollback and worker drain on staging. Run clean-clone setup instructions as written.
- P7.6 Refine mix quality, predictable transitions, error copy, visual spacing and compare behavior using actual testing.

**Exit:** release checks pass with recorded evidence; untested physical-device conditions and known limitations remain visible. No unsupported claims are hidden by a polished demo.

## Phase 8 — deployment, demonstration and handover

**Outcome:** a reviewable release, then a hosted verified product once authorized.

- P8.1 Prepare environment matrix, hosting recommendation with costs/limits, HTTPS URLs, OAuth callbacks, health checks and release candidate. Ask for needed resource/publishing authorization only after this is concrete.
- P8.2 Deploy approved infrastructure and immutable release; run production smoke checks with an owned test project and verify logs contain no secrets. Avoid publishing personal credentials or private sample material.
- P8.3 Prepare README, architecture diagram, feature truth table, limitations, local setup, demo script and short demonstration video if tools permit. Show real core flows and clearly identify any precomputed example.
- P8.4 Recheck hackathon requirements/cutoff, source-access rules and current submission form. User registration/submission is separate from preparing the materials; obtain appropriate authorization before submitting.
- P8.5 Provide final status: release URL/version, actual checks, operational costs/caps, recovery instructions, known issues and prioritized next work.

**Exit:** clean setup and hosted smoke test pass; handover is sufficient for another agent. If accounts/approval are unavailable, deliver the tested local release plus exact deployment steps and identify what remains blocked; do not claim a deployed result.

## Critical path and optional work

Audio feasibility → domain/render slice → creation → precise revision → verified Nexus handoff is the technical critical path. UI scaffolding, test harness and docs can advance while external credentials are pending. Keep one coherent release branch; no need to introduce multiple agents or simultaneous risky edits.

The smallest credible submission keeps one strong palette, one source workflow, one protected revision, comparison, responsive polish and meaningful export. First cut additional palettes, elaborate source analysis, native instrument mappings beyond the proven one, generated cover art and secondary screens. Do not cut real audio, honest export fidelity, authorization, preservation or recovery and still claim the same product.

Stop expanding functionality before the final available work block; reserve that block for fresh-session testing, production smoke, documentation and demonstration. The builder should adjust the calendar once actual available hours and submission cutoff are known.
