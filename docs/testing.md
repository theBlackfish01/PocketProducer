# Verification record

## Focused reliability repairs — October 7

Installed pinned binaries, isolated `_test` PostgreSQL, fixture/injected providers and tracing disabled; queue-sharing database/application/hosted suites ran serially. No live model, OAuth consent, Audiotool mutation or Railway change:

- `node node_modules/vitest/vitest.mjs run --config vitest.config.ts packages/core/src apps/web/src tests/unit tests/native-construction.test.ts --maxWorkers=1`: **241/241**, 41 files, 78.79s.
- `node node_modules/vitest/vitest.mjs run --config vitest.config.ts tests/integration --maxWorkers=1`: **163/163**, 13 files, 180.40s. Includes exact Saffron revision with real bass/chord/lead edits, immutable original version, pre-admission ambiguous-scope rejection, first-review feedback, one corrected fresh review, explicit best effort, restart/metadata invariants and neutral sync activity. Existing effect/review repair, ownership, cancellation, lock and accounting checks retained.
- After the final same-turn acknowledgement guard and empty-ending correction assertion: `node node_modules/vitest/vitest.mjs run --config vitest.config.ts packages/core/src/native/intent.test.ts packages/core/src/native/finishing.test.ts tests/integration/native-finishing-recovery.test.ts --maxWorkers=1`: **64/64**, 26.17s.
- `node node_modules/@playwright/test/cli.js test --config tests/visual.playwright.config.ts`: **28/28**, 2.3m. Delayed terminal verification, receipt restoration, navigation/new-head stale-read rejection, desktop/phone confirmed header and accurate owner-busy messaging without a second POST. Desktop/phone copy screenshots inspected.
- `node --import tsx scripts/prepare-e2e.ts`, then `node node_modules/@playwright/test/cli.js test --config tests/playwright.config.ts`: **18/18**, 1.7m. Real offline API create/protect/revise/compare/select/reload and phone/source/activity journeys.
- `node node_modules/@playwright/test/cli.js test --config tests/hosted.playwright.config.ts`: **2/2**, 29.8s. Injected public Audiotool identity isolation and invitation mode, not live identity-provider testing.
- `node node_modules/typescript/bin/tsc -b`, targeted `node node_modules/eslint/bin/eslint.js` across changed source/tests, `node node_modules/vite/bin/vite.js build` from `apps/web`, and `git diff --check`: pass. Build retains the pre-existing >500 kB bundle warning.

Initial failures were corrected, not waived: a key/meter prefix must not become an inherited exclusion scope; generation completion must inspect the constructed document rather than the initial seed; a resume fixture must create the real aggregate effect before testing restart; an optional test-fixture field must be absent rather than explicitly undefined under exact optional typing. Final reruns are reported above. Live speed, musical quality, browser-engine/physical-device behavior and paid recovery remain unverified by these offline checks. No source mapping, schema, accepted production version or provider liability was changed.

## Incremental UX and preservation — October 6

Final completed runs, using installed pinned binaries on Node 22.14.0 with the isolated `_test` database and fixture/injected providers:

- `vitest run --config vitest.config.ts packages/core/src apps/web/src tests/unit tests/native-construction.test.ts --maxWorkers=1`: **234/234**, 40 files, 91.97s.
- `vitest run --config vitest.config.ts tests/integration --maxWorkers=1`: **159/159**, 13 files, 282.90s.
- `playwright test --config tests/visual.playwright.config.ts`: **23/23**; subsequent focused account/sample runs also pass after improving screenshot targeting and the account selector.
- `node --import tsx scripts/prepare-e2e.ts`, then `playwright test --config tests/playwright.config.ts`: **18/18**, 1.9m. Exact coherence wording is checked by the real preservation-preview API at whole-piece and section scope, followed by a fixture-supported variation with that wording. Retired models are rejected for new create/revise requests; old browser drafts retain text and submit Luna.
- `playwright test --config tests/hosted.playwright.config.ts`: **2/2**, 37.8s, after rebuilding the web app. Covers invitation mode and injected Audiotool sign-in, separate owners, reload and sign-out; not live OAuth consent.
- `tsc -b`, targeted ESLint across changed runtime/test files, Vite production build in `apps/web`, and `git diff --check`: pass. Existing >500 kB bundle warning remains. Vitest excludes ignored `.local` imported source trees; default dependency exclusions are retained.

Desktop account/composer and desktop/phone sample layouts were visually inspected. No provider credentials, paid generation, live tracing or real Audiotool mutation was used. The initial fixture/default-model and test-data failures are retained in [STATUS](STATUS.md); final passing reruns are not represented as first-pass results. Unknown liabilities, owner/version fences, cancellation, exact protection and historical profile accounting remain covered. Live musical quality and speed require a separately authorized test, not extrapolation from these fixtures.

## Input-pressure review follow-up — September 28

Both new regressions failed on the original code: complete critic envelope **229,091 > 128,000**, and final optional observation **128,362 > 128,000**. Production `focusedNativeReview` now passes a valid 96-bar, 12-section, 12-part score with 4,608 notes and four automation curves per part through the actual injected reviewer. The tighter 110k case retains a ~30k-character brief and previous findings, while selecting the explicitly bounded layout. Unit coverage checks lossless encoding, sloped/null automation boundaries, shared-curve omissions, preview counts and source immutability. A mandatory-input overflow creates no new effect and never invokes the reviewer; a pending tool exchange is never sacrificed to fit finishing context.

- Full unit command below: **216/216**, 38 files, 170.33s. Subsequent expanded evidence assertions plus convergence tests: **15/15**, 6.67s.
- Full lint and TypeScript pass. Production build passes (4.01s), with the existing >500KB chunk warning.
- First full integration run under concurrent unit/lint/type load: **142/143**, 335.86s. The activity worker assertion saw `running` rather than `succeeded` after 3.99s; test configuration has a three-second lease. No assertion/lease was weakened. Full integration rerun without concurrent heavy suites: **143/143**, 12 files, **166.81s**, including real-process restart/contention. The initial timing-sensitive failure remains recorded, not represented as a first-pass success.
- No paid/provider access, browser run, live Nexus mutation or new heard-quality evidence in this backend-only pass. Existing browser evidence below is historical, not rerun here.

## Luna goal final verification — September 28

Pinned local commands (repository root unless stated), fixture/scripted providers with tracing and provider credentials disabled:

| Command | Final result |
| --- | --- |
| `.\node_modules\.bin\vitest.cmd run --config vitest.config.ts --exclude "tests/integration/**" --exclude "tests/e2e/**" --exclude "tests/visual/**" --exclude "tests/hosted/**"` | **214/214**, 37 files, 74.12s |
| `.\node_modules\.bin\vitest.cmd run --config vitest.config.ts tests/integration` | **140/140**, 12 files, 163.85s |
| `node --import tsx scripts/prepare-e2e.ts`, then `.\node_modules\.bin\playwright.cmd test --config tests/playwright.config.ts` | **18/18**, 1.4m |
| `.\node_modules\.bin\playwright.cmd test --config tests/visual.playwright.config.ts` | **17/17**, 1.6m |
| `.\node_modules\.bin\eslint.cmd . --max-warnings=0` | Passed |
| `.\node_modules\.bin\tsc.cmd -b` | Passed |
| From `apps/web`: `.\node_modules\.bin\vite.cmd build` | Passed, 1.44s; existing >500KB chunk warning |

Earlier same-pass visual **17/17** (1.8m) and hosted **2/2** (31.3s) passed. New maintained tests inspect exact critic timing/coverage input and verify settled review replay after an evidence-format update without another model invocation or altered receipt. Unknown outcomes and changed review context fail closed. Full integration retains real child-process restart/contention and cancellation/ownership/accounting tests. Live Luna evidence, independent canonical inspections, phone/keyboard/reload checks and costs are separately recorded in the [completion audit](luna-goal-completion-2026-09-28.md); a scripted pass is not a paid quality evaluation.

September 28 finishing-repair checkpoint: `.\node_modules\.bin\vitest.cmd run --config vitest.config.ts tests/integration` passed **136/136 tests, 12 files (156.81 s)** against the isolated test database. Includes the new shared-processing critic-input and exhausted-review termination cases. No provider access. The fifth real Luna browser evaluation is separate evidence and was still running when this suite completed.

September 28 goal attempt-4 follow-up: full unit **212/212** (37 files, 53.73 s), focused convergence/review/worker **36/36** (15.20 s), provider wire **9/9** (1.37 s), then final finishing suite **21/21** (12.77 s). Added coverage for complete text-only reasoning compaction, exact shared-bus critic inputs, strict Responses review schema/unchanged length rejection, and early exhausted-review stop with retained draft. Types/targeted lint pass. Earlier this pass: full integration **134/134**, application Chromium **18/18**, hosted **2/2**, visual **17/17** (1.6 min), production build pass with existing large-chunk warning. Those broad browser runs precede the critic/context-only changes; scripted tests do not establish live completion.

## Goal-loop task-menu regression (2026-09-28)

On `c98eb41`, the same full unit command below passed **208/208 tests, 37 files (56.00 s)**; the full integration command passed **134/134, 12 files (156.10 s)**. Targeted `vitest run --config vitest.config.ts tests/integration/native-finishing-recovery.test.ts packages/core/src/native/construction-tools.test.ts packages/core/src/native/convergence.test.ts` passed **43/43 (17.08 s)**. `tsc -b` and targeted ESLint passed. The new production regression inspects the actual bound tool names and ledger envelope size, verifies retained opaque recent context, incremental scene notes, sound edits and replay, and continued access to the full operation menu. These are scripted/offline results; current real Luna attempt outcomes are separately recorded in STATUS.

## Complete-envelope and compound construction pass (2026-09-28)

Executed from the repository with pinned local binaries:

| Command | Result |
| --- | --- |
| `.\node_modules\.bin\vitest.cmd run --config vitest.config.ts --exclude tests/integration/** --exclude tests/e2e/** --exclude tests/visual/** --exclude tests/hosted/**` | 201 tests / 37 files; 87.39 s |
| `.\node_modules\.bin\vitest.cmd run --config vitest.config.ts tests/integration` | 130 tests / 12 files; 197.61 s |
| `.\node_modules\.bin\playwright.cmd test --config tests/playwright.config.ts` | 18/18 journeys; 2.2 min |
| `.\node_modules\.bin\playwright.cmd test --config tests/visual.playwright.config.ts` | 17/17 journeys; 2.5 min |
| `.\node_modules\.bin\playwright.cmd test --config tests/hosted.playwright.config.ts` | 2/2 journeys; 31.1 s |
| `.\node_modules\.bin\tsc.cmd -b` | Passed |
| `.\node_modules\.bin\eslint.cmd . --max-warnings=0` | Passed |
| From `apps/web`: `.\node_modules\.bin\vite.cmd build` | Passed; 2.67 s; existing chunk-size warning |

Database suites run serially after guarded `node --import tsx packages/core/src/db/prepare-test.ts`; browser data additionally uses `node --import tsx scripts/prepare-e2e.ts`. Never point these suites at the user database. Test setup clears provider keys and tracing; generation is scripted, not a live quality evaluation. `construction-tools.test.ts` checks exact ticks, offline Nexus validation, protected transformations, normalized automation/endpoints, controls, cache invalidation and capability search. `native-finishing-recovery.test.ts` checks actual production model envelopes and same-key compound receipts, including an inspection failure after commit. Existing full suites retain restart, contention, unknown charges and ownership fences. Screenshots inspected: `.local/evidence/welcome-desktop.png`, `polish-phone.png`; physical phone, other browser engines and live native audio remain unverified.

## Focused finishing recovery (2026-09-27)

New `packages/core/src/native/review-model.test.ts` covers JSON fences, malformed/schema-invalid responses, missing no-change reasons, invented musical IDs, truncation and semantic versus bookkeeping plan hashes. `convergence.test.ts` covers bounded complete-group compaction, exact brief/current plan/latest error/pending-call preservation and opaque message metadata. `tests/integration/native-finishing-recovery.test.ts` drives real producer tools/worker/ledger through bounded critic repair, reuse, changed-plan invalidation, late stale review rejection, input-stop continuation at unchanged caps, exhausted-review blocking, varied-inspection stagnation and interruption after settled recovery before plan attachment. That last boundary is simulated in durable state, not a separately killed process.

Executed with pinned local binaries: full `vitest` unit run **33 files / 174 tests** (156.59 s), full `tests/integration` **9 files / 91 tests** (263.60 s), expanded convergence/review/native/finishing subset **4 files / 63 tests** (112.80 s), and full `playwright test --config tests/playwright.config.ts` **16 Chromium journeys** (1.9 min). Final repair-edge assertions were added afterward; their targeted results are in STATUS. `tsc -b`, `eslint . --max-warnings=0` and Vite build passed (3.23 s; existing chunk warning). No provider network generation or live Audiotool mutation was used. Database integration and E2E suites ran serially. Broader tests retain actual worker restart/contention, cancellation/unknown effects/ownership, protected immutable history and phone/reduced-motion behavior.

## Model selection and shared usage

`packages/core/src/providers/models.test.ts` checks fixed routes, captured models/prices, protocol/tool-context round trips and missing Gateway billing without generation replay. `tests/integration/model-selection.test.ts` drives scripted wire responses through the real worker and tools into saved canonical notes; it also covers changed-model idempotency conflicts, owner quotas, competing owners against a shared provider cap, and unknown billing holds. No test claims real-model musical quality. The normal Chromium suite verifies selection persistence and request capture on desktop/phone alongside existing create/revise/compare/restore. API/worker test fixtures clear Gateway keys in addition to OpenAI/Gemini; provider generation is blocked in fixture mode unless a scripted transport is explicitly injected.

## Clarity refinement and finishing (2026-09-27)

Executed from the repository with pinned local binaries (PowerShell `pnpm` is not on PATH):

| Command/check | Actual result |
| --- | --- |
| `.\node_modules\.bin\tsc.cmd -b` and `.\node_modules\.bin\eslint.cmd . --max-warnings=0` | Passed |
| `.\node_modules\.bin\vitest.cmd run --config vitest.config.ts --exclude tests/integration/** --exclude tests/e2e/** --exclude tests/visual/**` | 31 files / 165 tests; 158.29 s |
| `.\node_modules\.bin\vitest.cmd run --config vitest.config.ts tests/integration` | 7 files / 80 tests; 178.27 s |
| Final `vitest` subset `packages/core/src/native/convergence.test.ts tests/integration/native.test.ts` | 2 files / 53 tests; 106.51 s, after input-pressure safeguard |
| `.\node_modules\.bin\playwright.cmd test --config tests/playwright.config.ts` | 15 Chromium journeys; final full rerun 2.6 min |
| `.\node_modules\.bin\playwright.cmd test --config tests/visual.playwright.config.ts` | 15 fixture UI tests; 2.4 min; start/paused-recovery final subset 2/2 |
| From `apps/web`: `.\node_modules\.bin\vite.cmd build` | Passed; 4.90 s; existing >500 kB bundle warning |

New regression evidence includes 53 progressing production model turns, same-job repeated-loop pause and checkpoint guidance recovery, input-pressure eviction of optional recall only, unchanged critic limits, explicit 40→80 extension with no fresh job/copy, in-place long-message expansion, compact dialogs/focus return, aligned desktop footer, phone/reduced-motion layout and retained pending direction. Existing process restart/contending-worker, accounting/ownership/protection and microphone-cleanup checks remain in the full suites. Ordinary tests isolate the `_test` database and disable providers; the website continuation described in STATUS was separately authorized and paid. It **did not complete**; do not describe offline success as real-model convergence or listening evidence.

Visually inspected `.local/evidence/clarity-start-desktop.png`, `clarity-start-phone.png`, `clarity-creating-phone.png` and `clarity-audiotool-dialog.png`. These are deterministic network-fixture screenshots, not proof of a completed live composition. Physical phones, screen readers, non-Chromium, live copy and native audio remain unverified in this pass.

## Single-workspace retirement (2026-09-27)

Provider-free final verification:

| Check | Result | Maintained evidence |
| --- | --- | --- |
| `pnpm check` | Lint/types/build passed; **26 files / 141 unit tests**, unit duration 42.78 s | Shared canonical hash and runtime extraction, native fixtures, WAV codec/signal checks, seven byte-range cases, retired worker-kind rejection. Existing large-chunk warning remains. |
| `pnpm test:integration` | **4 files / 68 tests**, 99.65 s | Native worker processes are actually killed/restarted and contested; cancelled jobs cannot publish; native protections/replay/recovery and late/unknown accounting remain covered. Exact-ID test cleanup retains provider ledger/identities and rejects native or active projects. Stale legacy outbox/jobs cannot dispatch or claim. |
| `pnpm test:e2e` | **14 Chromium journeys**, 1.8 min | Real isolated API/worker native create → protect → revise → compare → select/reload; source upload, range seek, paused playback after close, retired API/page unavailable, late room responses and microphone permission cleanup. Usage/connection dialogs return focus to Session options. Final source/native subset **3/3**, 15.4 s, after the last two assertions. |
| `pnpm test:visual` | **8/8**, 1.5 min | Read-only comparison, confirmed-only motion, reduced motion/keyboard focus, phone/tablet, 128 bars/24 parts, partial recovery, bounded long feed and pending direction preservation. Network-fixture UI evidence only. |

The isolated integration and E2E processes share the configured `_test` database; run these suites **serially**, or supply different isolated database URLs. An accidental concurrent invocation allowed the E2E worker to claim an integration fixture's job. The final serial runs above passed; this was test orchestration interference, not evidence of a production recovery failure. Old four-stem-only tests were removed with that product; process/recovery/access/accounting coverage was moved to native production paths rather than skipped.

Reviewed screenshots: ignored `.local/evidence/workspace-desktop.png`, `workspace-mobile.png`, plus comparison/tablet captures. No physical-phone, screen-reader, Firefox/WebKit or human audio-quality test is claimed. Source playback tests inspect a real browser media element, not whether the native score sounds good. No provider call, LangSmith upload, new live Nexus validation, render probe or remote mutation occurred. Existing local environment and provider ledger were preserved. Historical sections below document the behavior at their dates and do not imply continued support for the retired audio product.

## Reliable creative-production pass (2026-09-27)

`pnpm check` passed lint, strict types, **26 unit files / 139 tests**, and production Vite/TypeScript build (the existing large lazy-chunk warning remains). `pnpm test:integration` passed **4 files / 71 tests** after the review fixes. New worker-path regressions cover a budget pause with a saved plan but zero musical steps, simulated old failed-aggregate repair and same-job continuation without duplicate first-call accounting, retained creative context in actual model input, separate focused review → score edit → second review, a measured, hash-pinned Audiotool sample sequence through offline Nexus validation, idempotent shortlisted Gemini analysis, an unknown Gemini outcome that cannot accept a score, and an atomic two-distinct-analysis cap under contention. Unit tests cover beat-tick residue versus genuinely off-grid values, cache-read/write pricing, per-authenticated-client metadata cache isolation, changed sample bytes, example validity, fixed-case evaluator objectivity, and rejected invented score evidence.

The initial full Chromium E2E run found a stale assertion that still expected “used” after the UI changed to “observed”; its targeted rerun passed. The latest complete run passed **13/13**, including sample search/inspection with network fixtures. Desktop arrangement, phone usage sheet and sample inspection screenshots under ignored `.local/evidence/workspace-*.png` were inspected. They show fixture/scaffold state, not live Audiotool resources. UI checks retain keyboard/focus, reduced-motion, comparison and phone viewport coverage; physical hardware and non-Chromium remain untested. No ordinary test dispatched a provider request. `pnpm db:migrate` applied additive migration 017 to development data without reset.

`pnpm eval:native --case synth-disco --job d6921ce1-7e49-463a-bad5-1210eb4a6ed9` made only database reads. It reported the exact fixed brief, saved plan, zero confirmed steps, ten observed model effects, 209,421 input tokens (180,596 reported cache-read tokens), 8,818 output tokens, US$0.909746 observed job cost, and no accepted score or human rating. The seven-case harness preserves a separate null human rubric. Real-model quality, live library rights/fidelity and hearing still require separately authorized work.

The focused reviewer initially inherited the enclosing graph callback and created an extra model effect. The production-path test detected this; passing an explicit empty callback list to the reviewer removed the duplicate. The maintained assertion now requires exactly one producer effect per producer turn and one review effect per focused review. This was tested with scripted models, not real provider telemetry. No new known provider spending occurred.

## Focused correctness pass (2026-09-26)

Portable regressions replace the external review probes: `packages/core/src/native/correctness.test.ts`, `apps/web/src/features/native/score.test.ts`, `reconcile-read.test.ts`, `tests/integration/native.test.ts` and `tests/visual/score-motion.spec.ts`. They cover safe/uncertain abandonment, lock races, stale heads, retained costs/drafts, actual names and ambiguity, full theme events, scoped sidechain dependencies, connected ambience and exhausted snapshot/draft reads. Existing production scripted-worker candidate repair and real process restart/contending-worker tests remain in the full integration suite.

Browser additions are explicit **network-fixture UI evidence**, not a live provider: phone abandonment confirmation/Escape/focus; five failed saved-head HTTP reads then recovery with unchanged activity; all 15 draft attempts exhausted then explicit refresh; held old response after unmount; zero creative writes during read recovery. Database abandonment evidence separately exercises the real repository/worker on isolated `_test` PostgreSQL. The existing API/worker create → protect → revise → compare → restore journey is retained. Final counts are in `STATUS.md`.

Representative inspected screenshots: ignored `.local/evidence/correctness-recovered-head.png` (desktop version 3 plus unsent direction) and `correctness-abandon-phone.png` (390px confirmation). Capture waits for dialog opacity 1 to avoid presenting an in-flight fade as final appearance. No provider, tracing or Audiotool request occurred. The separate course refresh remains outside these product commits.

## Producer workspace and durable public activity (2026-09-26)

Implemented on `8ee9fcf`, preserving the concurrent course edits and LangSmith privacy defaults. Ordinary verification forces fixture/scripted providers and disables tracing; no OpenAI, Gemini, Audiotool or LangSmith request was made.

| Command | Result | Evidence |
| --- | --- | --- |
| `pnpm check` | Passed lint, strict types, **20 unit files / 119 tests**, production build | Includes bounded/deduplicated history, session routes and rejection of diagnostic-only public payloads. Existing large-chunk warning remains. |
| `pnpm test:integration` | **3 files / 61 tests passed**, final run 83.49 s | PostgreSQL commit ordering and rollback, concurrent same/different request keys, owner/deleted access, stale worker lease, restored cursor, real killed child process and two contending replacement workers. Scripted Deep Agent plan → steps → pause/restart → result projects one coherent feed. Includes overlapping project/clock locks during selection and publication. |
| `pnpm test:e2e` | **11 Chromium journeys passed**, 1.6 min | Actual isolated API/worker create/revise/compare/select/reload; phone/tablet, source audition and legacy playback; partial recovery, room switch/Back, synchronization separation, real SSE snapshot race/Last-Event-ID and lost acknowledgement without resubmission. |
| `pnpm test:visual` | **4 journeys passed**, final run 37.8 s | Preserved score motion and focus/reduced-motion/contrast checks; 128-bar/24-part view; pending direction survives completion and requires scope review; 201-event history mounts 30 rows, pages older history and never forces scroll. A near-limit HTML-shaped brief renders as text. |
| `pnpm db:migrate` | Applied additive migrations **015–016** to development DB | Historical directions plus safe clock-based FK cascade; accepted versions, assets, credentials and usage retained. |

A subsequent targeted `node node_modules/@playwright/test/cli.js test --config tests/playwright.config.ts tests/e2e/producer-stream.spec.ts` passed **2/2** (17.4 s), including a future/stale cursor while another client tails the room. That probe exposed and fixed per-client cursor reset at initial stream authorization; resetting only the shared minimum was insufficient. The cached environment's `pnpm exec playwright` wrapper could not resolve its executable, so this targeted check used the installed pinned CLI directly.

The browser CLI was unavailable, so maintained Playwright scripts supplied the browser evidence. Screenshots reviewed: `.local/evidence/workspace-start.png`, `workspace-desktop.png`, `workspace-mobile.png`, `workspace-comparison-mobile.png`, `workspace-long-feed.png`; additional comparison, usage and tablet captures are retained locally. These are ignored fixture evidence, not real-model creative or live Nexus/audio evidence. The final sampled 128-bar score had 394 SVG descendants at initial detail; two-frame section and comparison samples were 47.7 ms and 63.6 ms on Windows / Ryzen 7 7435HS, with tracing. These are individual observations, not latency guarantees. Earlier concurrent runs were slower (90.3 / 112 ms).

Initial verification exposed and fixed the new-session/audio-mode acknowledgement race, lost-ack test setup race, old-receipt initialization race and SSE shutdown cleanup. The activity clock audit also made multi-job expiry sweeps acquire clocks in consistent project order. The existing late-accounting integration fixture now isolates its intentionally uncertain room, since the new single-producer guard correctly prevents unrelated work there.

Post-commit lock review identified an implicit lock not visible in application queries: the activity table's direct project FK could acquire project key-share after the clock. Migration 016 references the clock instead (retaining project deletion cascade), and the maintained two-client regression now exercises a selection-style project lock overlapping a publisher's clock lock. The complete integration suite passed after applying 016 to both local databases. No data reset was used.

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
## Hosted deployment checks — 2026-09-28

Build before integration: the hosted-access suite exercises the actual production static server. `pnpm test:hosted` builds the frontend and starts the real supervised API/worker against isolated PostgreSQL with all provider keys/tracing cleared. It exercises personal sign-in, a fixture construction, protected cross-user access, logout, keyboard navigation and phone/reduced-motion layout. It is not a live provider/OAuth/copy test. The separate production-mode HTTP suite checks Secure cookie attributes, CSRF, authenticated asset ranges, SSE logout, revocation, throttle, and real API process restart. Run DB/integration/browser suites serially; the visual fixture suite uses no database. Unit globs exclude `tests/hosted/**` (Playwright owns it).

Public OAuth coverage: `tests/integration/audiotool-auth.test.ts` exercises PKCE/state/browser binding, expiry/replay/contending callbacks, provider failures, strict GetWhoami identity, unique owner admission, prebinding, unchanged owner cap, wrong-account reconnect, request/queue throttles, production cookies, cross-owner activity and logout. `tests/hosted/audiotool.spec.ts` uses the production `createApi` with only its OAuth HTTP transport injected, plus browser interception of the consent screen. It traverses real start/callback/cookies/DB, refresh, project creation, second-account denial, sign-out and re-login. This is scripted contract evidence, not a real Audiotool login. Ordinary fixture mode refuses external OAuth dispatch. No environment variable enables a mock identity or alternate auth endpoint. Existing invitation/browser construction coverage remains as an optional-mode regression.
