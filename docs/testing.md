# Verification record

## Producer workspace and durable public activity (2026-09-26)

Implemented on `8ee9fcf`, preserving the concurrent course edits and LangSmith privacy defaults. Ordinary verification forces fixture/scripted providers and disables tracing; no OpenAI, Gemini, Audiotool or LangSmith request was made.

| Command | Result | Evidence |
| --- | --- | --- |
| `pnpm check` | Passed lint, strict types, **20 unit files / 119 tests**, production build | Includes bounded/deduplicated history, session routes and rejection of diagnostic-only public payloads. Existing large-chunk warning remains. |
| `pnpm test:integration` | **3 files / 60 tests passed**, final run 89.33 s | PostgreSQL commit ordering and rollback, concurrent same/different request keys, owner/deleted access, stale worker lease, restored cursor, real killed child process and two contending replacement workers. Scripted Deep Agent plan → steps → pause/restart → result projects one coherent feed. |
| `pnpm test:e2e` | **11 Chromium journeys passed**, 1.6 min | Actual isolated API/worker create/revise/compare/select/reload; phone/tablet, source audition and legacy playback; partial recovery, room switch/Back, synchronization separation, real SSE snapshot race/Last-Event-ID and lost acknowledgement without resubmission. |
| `pnpm test:visual` | **4 journeys passed**, final run 37.8 s | Preserved score motion and focus/reduced-motion/contrast checks; 128-bar/24-part view; pending direction survives completion and requires scope review; 201-event history mounts 30 rows, pages older history and never forces scroll. A near-limit HTML-shaped brief renders as text. |
| `pnpm db:migrate` | Applied **015_public_activity.sql** to development DB | Additive backfill of historical directions; accepted versions, assets, credentials and usage retained. |

A subsequent targeted `node node_modules/@playwright/test/cli.js test --config tests/playwright.config.ts tests/e2e/producer-stream.spec.ts` passed **2/2** (17.4 s), including a future/stale cursor while another client tails the room. That probe exposed and fixed per-client cursor reset at initial stream authorization; resetting only the shared minimum was insufficient. The cached environment's `pnpm exec playwright` wrapper could not resolve its executable, so this targeted check used the installed pinned CLI directly.

The browser CLI was unavailable, so maintained Playwright scripts supplied the browser evidence. Screenshots reviewed: `.local/evidence/workspace-start.png`, `workspace-desktop.png`, `workspace-mobile.png`, `workspace-comparison-mobile.png`, `workspace-long-feed.png`; additional comparison, usage and tablet captures are retained locally. These are ignored fixture evidence, not real-model creative or live Nexus/audio evidence. The final sampled 128-bar score had 394 SVG descendants at initial detail; two-frame section and comparison samples were 47.7 ms and 63.6 ms on Windows / Ryzen 7 7435HS, with tracing. These are individual observations, not latency guarantees. Earlier concurrent runs were slower (90.3 / 112 ms).

Initial verification exposed and fixed the new-session/audio-mode acknowledgement race, lost-ack test setup race, old-receipt initialization race and SSE shutdown cleanup. The activity clock audit also made multi-job expiry sweeps acquire clocks in consistent project order. The existing late-accounting integration fixture now isolates its intentionally uncertain room, since the new single-producer guard correctly prevents unrelated work there.

Limits: physical phones/real soft keyboards, screen readers, Firefox/WebKit and 64-stream slow-client load testing were not performed. SSE limits/backpressure are defensive code, not a capacity certification. Polling fallback reattempts SSE on remount/reload. No paid narrator or simulated thought stream was introduced; native rendering/playback and Gemini listening remain deferred. LangSmith configuration is preserved but live trace ingestion was not verified. **US$0 new provider spend**; no external writes or deployment. Use command-local `$env:pnpm_config_verify_deps_before_run='false'` with the existing pinned dependency installation if pnpm 11's automatic dependency verification attempts an unnecessary noninteractive reinstall; do not change global configuration.

## LangSmith observability (2026-09-26)

`pnpm check` passed lint, strict types, 18 unit files / 116 tests and production build; `pnpm test:integration` passed 2 files / 56 tests; `pnpm test:e2e` passed nine Chromium journeys with the API and worker as separate fixture child processes. The observability unit tests check that fixture mode disables tracing, that payload hiding is active, and that producer metadata omits directions, source names and owner/project identifiers. Existing scripted Deep Agent integration paths still pass with trace run config attached. No live LangSmith ingestion was attempted; fixture/test processes force `LANGSMITH_TRACING=false` and blank its key. No paid model or Audiotool effect occurred. The build retains the existing large-chunk warning.

## Focused score and motion polish (2026-09-26)

Provider-free verification after `7563021`:

| Command | Observed result | Scope |
| --- | --- | --- |
| `pnpm check` | Passed: lint, strict types, 17 unit files / 114 tests, production build | Includes pure confirmed-frame/delta logic, stable comparison coordinates, parent-group dependencies and honest control interpolation. Large production chunk warning remains. |
| `pnpm test:integration` | Passed: 2 files / 56 tests, 80.49 s | Isolated PostgreSQL; actual worker lifecycle/recovery/accounting and scripted producer paths, not real-provider creativity. Docker was initially unavailable; run completed after restart. |
| `pnpm test:e2e` | Passed: 9 Chromium journeys, 2.3 min | Full local API/worker create/revise/compare/restore, source audition, legacy playback, partial recovery, late room responses, sync-state isolation, tablet/phone. |
| `pnpm test:visual` | Passed: 3 Chromium journeys, final run 40.3 s | Vite-only UI network fixtures, no API/worker/database. Real SVG movement samples, added/removed/modified notes, clip/control updates, duplicate/late/reload, scope/focus/read-only comparison, reduced motion, computed text contrast and larger arrangements. |

The additional suite is maintained in `tests/visual/score-motion.spec.ts` and runs in CI. `tests/visual.playwright.config.ts` starts a dedicated loopback Vite server on 15174, blanks model keys and intercepts application API requests; unexpected routes fail rather than dispatching mutations. `scripts/visual-teardown.ts` shuts down that test-owned server. ESLint ignores generated `.local` evidence and test output, not application source. The recommended browser CLI was unavailable, so the existing Playwright stack supplies browser verification.

Screenshots under `.local/evidence/polish-{desktop,phone,inspector,compare-phone,motion-in-flight,confirmed-update,large-tablet}.png` were reviewed. A MutationObserver samples actual note bounding rectangles and transforms over animation frames, proving geometry changes rather than merely the presence of an animation attribute. Samples are saved in `polish-note-motion-samples.json`; video and Playwright traces are recorded in `score-visual-results/`. The review inspected still frames and measured motion, not a subjective full-video playback or usability study. New checks exposed and fixed both incorrect inspector return focus and initial autofocus scrolling into advanced details.

Performance captures use Windows, AMD Ryzen 7 7435HS / 16 logical CPUs, development mode, trace/video recording, and a sparse 128-bar/24-part fixture. Focused detail initially renders 394 SVG descendants; it expands 8→16→24 lanes on request. `polish-performance.json` records click-to-two-animation-frame durations; `polish-browser-performance-trace.json` retains the CDP trace. Early expanded-overview comparison took about 556 ms; stable score callbacks reduced a subsequent sample to about 196 ms. Section focus samples varied from roughly 34–184 ms with concurrent local checks. These are individual diagnostic observations, not a production latency distribution or proof of the initial ~100 ms target on every interaction/device. Dense-score rendering and real-device profiling remain useful follow-up work.

Keyboard Enter/Escape/focus return, title-first inspector focus, direction transfer, 390 px overflow, 480 px emulated keyboard-height layout, fixed compare actions, 4.5:1 sampled text contrast and reduced-motion final state are asserted. These checks are not an exhaustive accessibility audit and do not simulate a real OS keyboard or notch. Physical-phone/screen-reader/non-Chromium checks remain unverified. Native rendering/playback, Gemini listening, real-model creative evaluation and live Nexus fidelity were not exercised. No paid provider call or remote effect occurred; new spend is US$0.

Final recorded performance sample: 111.8 ms to two frames after section focus, 173.6 ms after opening comparison from the expanded large score, 394 initial detail SVG descendants. The same development/recording caveats apply. This is an improvement over the diagnosed extra rerender, not a claim that all interactions meet 100 ms.

## Historical: living arrangement and scoped revision (2026-09-26)

`pnpm check` passed lint, strict types, 17 unit files / 108 tests and production build; Vite retains its large-chunk warning. `pnpm test:integration` passed 2 files / 56 tests on isolated `_test` PostgreSQL. Full `pnpm test:e2e` passed 9 Chromium journeys (1.2 minutes); a strengthened 128-bar/24-part tablet test passed again in isolation after the full run. No ordinary test contacts OpenAI, Gemini or Audiotool.

New unit coverage compares independently expected note positions and transposition, provenance of a single changed motif instance, same-ID pitch changes, reidentified/split loop clips, local automation versus unchanged earlier sections, unverified easing/loop/timing, and bounded 128-bar/24-part projection. Intent tests cover ordinary negation/conjunction, named preservation, wrong bass and unchanged drums, and “bring in chords” not being mistaken for a section. The production scripted Deep Agent integration first proposes a valid-but-wrong bass edit, receives the completion issue, repairs by thinning the scoped drums, and commits a version with preserved named material. These are scripted-model results, not paid creative evaluation.

Browser checks cover create → section/part/keep → revision → automatic new-head selection → read-only Before/After/Changes → explicit version switch → reload; they query the native API to confirm comparison navigation does not change the head. A delayed preservation preview released after leaving the room cannot submit a revision or alter the new room. The phone journey emulates 390 px and reduced motion, keyboard-selects a section, and checks dialog focus return. Desktop, comparison dialog, phone and tablet captures were inspected under ignored `.local/evidence/native-*.png`; the first desktop comparison capture revealed an undersized modal and was corrected before final inspection. The 128-bar/24-part tablet fixture met a 10-second local load assertion, expanded 8→16→24 cards and had no horizontal document overflow. These are fixture/emulated checks, not physical-phone, non-Chromium or heard-audio evidence.

## Sustained native construction expansion (2026-09-26)

All ordinary tests use isolated `_test` PostgreSQL, scripted/fixture model transport and blank provider keys. Final command results are recorded in `STATUS.md`; the latest integrated reruns passed 15 unit files / 93 tests and 2 integration files / 55 tests. The production Vite build retains its existing large lazy SDK chunk warning. Browser verification covers eight Chromium journeys, including the partial-mobile no-overflow assertion. `git diff --check` is recorded at closeout.

Maintained production-path evidence includes 48 model turns through the worker; an intentionally low graph-step cap pausing after a confirmed batch and resuming the same job on a fresh attempt; a known financial pause, explicit bounded extension and worker restart with no duplicate accounting; a 32,001-character brief through inspect/mutate/next model input; durable future-plan text visible after compaction/restart and fulfilled by a later batch; and a real worker revision brightening melody settings while preserving the existing bass. Separate integration tests retain uncertain outcome, head, cancellation, lease, concurrency and historical replay fences. The graph cap override is injection-only with a scripted model; production uses the captured call envelope to size its graph bound.

Domain/SDK checks cover explicit BPM/meter/section spans, note/role/section exclusions and preservation, an explicit chord chain's ordered pitch classes, crossing notes, shared motif instances, once/loop clip phase splits, one-clip versus all-clip gain, contained moves, crossing-clip local shifts with preserved outside source time, and stepped/linear automation with exact outside preservation. A worker-level regression starts with a wrong major-nine pitch, receives the objective issue on the next model turn and corrects the saved draft before commit. New group add/replace/move/remove, serial/parallel dry/wet paths, protected group dependencies, FM frequency/modulation and effect automation use the actual pinned SDK document; negative tests reject dangling targets and unsupported splits. Provider-reported cached input gets the captured cached rate; no cache saving is inferred when telemetry is absent.

Browser checks cover text-only creation, source audition, protect/revise/compare/restore, reload, dialog focus return, 390 px phone and tablet layout, large-arrangement disclosure, and explicit partial-limit increase **without automatic continuation**. Screenshots under ignored `.local/evidence/native-*.png` are fixture views. Physical phone, non-Chromium, real-model creative quality, expanded live Audiotool fidelity and heard native audio are not verified by these tests.

## Text-to-native-music extension (2026-09-25)

`pnpm check` passed lint, strict types, 14 unit files / 79 tests and the production build; the only build warning is the existing lazy SDK chunk size. `pnpm test:integration` passed 2 files / 48 tests against the isolated PostgreSQL test database, including a 32,000-character source-free brief, eight scripted Deep Agent responses, four durable mutation batches, a captured-profile retry fence and explicit same-job extension. `pnpm test:e2e` passed eight Chromium journeys, including queued/running/completed sync without erroneous construction-draft polling or loss of pending direction. Desktop and 390 px phone fixture screenshots under `.local/evidence/native-*.png` were visually inspected. `pnpm db:migrate` applied additive migrations 013–014 to the existing development database without rewriting revisions. No ordinary test has provider access.

The new domain/SDK checks cover negated and section-local role requirements, long motif/placement identities after section development, generated chord voicings and timed MIDI hits, FM modulation and tube/chorus/pitch-delay fields, and per-part dry/wet splitter/merger routing with semantic offline readback. The production-path scripted model saves a plan, composes a form, develops two sections, inspects current symbolic material and commits. The paused-run integration test extends Standard to Extended under the same job/effect identity; the browser test drives the explicit extension-and-continuation control. These checks prove executable structure and durable plumbing, not the creative quality of a real model or sound of an unrendered native document. Live Nexus and native audio remain unverified/deferred respectively. Physical phone and non-Chromium browsers were not tested.

## Historical: post-`69baa7a` native reliability follow-up (2026-09-24)

Ordinary checks use fixture/scripted providers and the dedicated `_test` database with credentials excluded. Final runs passed `pnpm check` (lint, types, 14 unit files / 72 tests, build), `pnpm test:integration` (2 files / 44 tests), and `pnpm test:e2e` (seven Chromium journeys, rerun after partial-card polish; desktop/tablet/phone/partial-draft captures). No provider request was dispatched. `pnpm budget:status` read the existing ledger without spending.

New production-path tests emit concurrent mutations and mixed tool calls through the actual Deep Agent wrapper, inspect the next model input, commit/restart/replay, exercise cancellation and corrupt a disposable historical step to confirm fail-closed detection. Other tests run a library-only job through the worker, drift a real SDK preset payload under unchanged metadata before synchronization, and compare independent SDK pointers/values for sidechain, master, shared delay/send automation and Beatbox8 voice shaping. Unit tests cover negative/optional role language, sectional-versus-total duration, and section edits that preserve crossing/outside material. Browser captures are emulated viewports and do not prove real-device input, native audio or live Audiotool.

## Post-`cb64447` native construction pass (2026-09-24)

`pnpm check` passed lint, strict typecheck, 13 unit files / 61 tests and production Vite build (existing large lazy SDK chunk warning). `pnpm test:integration` passed 2 files / 37 tests on the isolated PostgreSQL database with migration 012 applied, including expired optional Audiotool-library handling. `pnpm test:e2e` passed six Chromium journeys in the final 1.1-minute run. No ordinary test can access provider credentials. No live OpenAI/Gemini/Audiotool request was dispatched for this pass.

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

## Earlier legacy results

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
