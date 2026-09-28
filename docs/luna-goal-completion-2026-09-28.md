# Luna reliability loop: completion evidence

September 28, 2026. Scope: real Luna xhigh construction through the local website, trace-led repairs, two fresh completions, then a protected revision/history journey. Native listening and remote Audiotool copying were not part of this evaluation.

## Acceptance audit

| Requirement | Observed evidence | Disposition |
| --- | --- | --- |
| Exact Amber benchmark through the website | Attempt 5: accepted 24 bars, 104 BPM, four built-in parts, five sections; 57 producer + 3 critic calls, no Continue | Passed; 50-turn efficiency target missed |
| Consecutive contrasting fresh run | Attempt 6, Paper Lanterns: accepted 16 bars, 78 BPM, 3/4, three synth parts, no drums; 38 producer + 3 critic calls, no Continue | Passed |
| Independent musical assessment | Canonical notes, placement, timing, patch/send/filter data inspected; valid final reviews match accepted hashes with no remaining findings | Passed symbolically, not acoustically |
| Scoped protected revision | Browser-selected Last train groove; hats 24→8 and total drums 48→40; bass/lead/chord dependency hashes and every other section unchanged | Passed after one diagnosed/repaired interruption |
| Immutable history and explicit selection | Original version hash unchanged; comparison leaves head unchanged; Use Before then Use After increments selection counter, reload retains V2 | Passed |
| Desktop/mobile/keyboard | Score and section inspection, 390px comparison, Space toggle and Escape focus return; captured browser errors empty | Passed in Chromium/emulation |
| Complete trace/log/accounting inspection | Terminal LangSmith imports for every attempt; actual inputs, model/tool spans, cache usage and effects examined; API/worker stderr empty | Passed |
| No duplicate/unknown spending | 264 paid model calls, total US$0.492984; zero unsettled paid calls in these jobs; four retained zero-cost aggregate records | Passed; unrelated historical liabilities preserved |
| Regressions, review and delivery | Maintained production-path tests, full verification and local reviewed commits; raw private evidence ignored | See verification and commit record below |

The fresh generation pair succeeded without unresolved errors; schema errors that occurred were corrected in the same run. The revision was **not flawless on its first attempt**: a changed-payload reuse of a committed tool key was incorrectly treated as uncertain, despite settled provider receipts. The narrowly verified local repair and explicit Continue completed the same job. This distinction is retained rather than presenting recovery as a fresh success.

## Original findings and resulting fixes

| Finding | Implemented behavior and maintained evidence |
| --- | --- |
| Tool expansion exceeds the complete envelope | Same complete-input guard at compaction/dispatch, mutually exclusive scene/sound/batch menus; production tests inspect actual schemas and reserved bounds |
| Oversized historic error exchanges remain pinned | Whole provider-valid exchange compaction; bounded old-error/observation recall; recent/pending exchanges and exact current state take priority |
| Initial context prematurely advances stage | Initial creative bookkeeping retains unbuilt stage; real worker regression constructs after saving context |
| Ordinary resource descriptions fail | Tokenized/ranked capability/recipe search with tested multiword queries and honest no-match results |
| Instructions/tools/skills conflict | Incremental scene-first runtime guidance agrees with compact advertised tools; active menu remains in resumed/finishing context |
| Excessive preparation | Compact exact-note patterns, compound scenes/sound/theme/section operations and post-edit inspection reduce serialization and avoid repeated schema discovery; first music at 88s/71s in accepted runs |
| Zero-step copy implies saved music | Recovery distinguishes retained approach from a musical draft; copy regression coverage |
| Further live-discovered defects | Text-only finishing compaction, strict critic response schema, exhaustion termination, exclusive bar labels and model-correctable committed-key rejection |
| Critic mistakes preview coverage | Explicit meter/tick/duration/omission metadata and bounded complete-when-untruncated percussion window; actual critic-input tests |
| Evidence update breaks settled replay | Same semantic review receipt can return its original paid result across evidence-format changes; exact ledger equality/no-new-call/unknown-context rejection tests |

Relevant suites: `construction-tools.test.ts`, `convergence.test.ts`, `critique.test.ts`, `review-model.test.ts`, `native-finishing-recovery.test.ts`, provider wire tests and `ui-copy.test.ts`. Integration suites retain actual worker restart/contention, cancellation, duplicate requests, ownership, protected history and financial fences. Ordinary tests clear all provider keys and disable tracing.

## Musical evidence and performance

**Amber After Hours:** D–F–E–A identity develops into a higher sparse answer and changed-register/rhythm return. The 24-bar form is 4/8/4/4/4 bars: sparse platform, groove, rhythm-free middle, build and return. Filter automation opens through the approach and settles afterward. Explicit bass/lead/chord sound settings and restrained sends feed one configured room. The result is developed construction, though synth programming remains modest and motif lineage labels could describe relationships more consistently.

**Paper Lanterns:** 23 lead notes develop F♯–A–E into F♯–A–D, G–B–E and a changed return/cadence. Six two-note answer fragments finish before subsequent lead attacks; nine bass notes provide occasional grounding. No percussion or sample dependency. Explicit envelope/filter settings and a rising/falling tone arc support contrast within three parts.

| Completed work | Runtime | First music | Producer / critic calls | Cost |
| --- | --- | --- | --- | --- |
| Amber fresh generation | 12m48.623s | 1m27.749s | 57 / 3 | $0.126775 |
| Paper fresh generation | 6m32.821s | 1m11.440s | 38 / 3 | $0.061949 |
| Revision initial attempt | 1m23.999s | One saved batch | 8 / 0 | $0.011938 |
| Same revision recovery | 5m03.537s | Existing draft retained | 21 / 4 | $0.036690 |

The full attempt/cost table, including unsuccessful runs, is in [STATUS](STATUS.md). Earlier attempts cost $0.255632; the full goal costs **$0.492984**, not just the successful pair. No allowance was raised. Amber executed 88 tools (90 attempted), Paper 52 (53 attempted); preparation/inspection still dominates. Amber selected tool menus twenty times, Paper twice after active-menu retention. These different briefs are not a controlled speed comparison.

Provider-reported Amber input/cache-read/cache-creation/output/reasoning tokens: 1,198,849 / 511,936 / 686,733 / 71,530 / 59,657. Paper: 787,455 / 456,652 / 330,680 / 32,038 / 25,735. Recorded ledger pricing is authoritative; byte-based safety estimates are not billed token counts.

## Evidence locations and hands-on guide

Raw traces remain ignored in `.local/reviews/luna-goal-attempt-{1,2,2-recovery,3,4,5,6}.json` and `luna-goal-revision-1-recovery.json`. The revision terminal import contains earlier generation roots too; counts above use the correct attempt roots, not a sum of duplicated imports. Local audit helpers independently check hashes, requirements, protected dependencies and all seven jobs' effects. Worker/API logs are `.local/luna-goal-*-8*.log`, with final restarted services using suffix `9`.

1. Open the running Listening Room and select **Amber After Hours · Ready**. Version 2 should be current.
2. Inspect **Last train groove** to see the simpler drums. Bass, Amber signal and Windowlit chord stabs remain unchanged.
3. Open **Versions → Compare**. Before, After and Changes are read-only. Use Before/After explicitly if you want to change the selected version.
4. Open **Paper Lanterns · Ready** for the contrasting sparse 3/4 arrangement.
5. Audiotool copying remains an explicit separate action; none was performed during this loop.

Representative screenshots: `.local/evidence/luna-goal-5-completed.png`, `luna-goal-6-completed.png`, `luna-goal-revision-comparison.png`, `luna-goal-revision-phone.png`. These show actual browser state, not mockups. Private identifiers are not embedded in this report.

## Verification and reviewed commits

Final unit: **214/214**, 37 files (74.12s). Final PostgreSQL integration: **140/140**, 12 files (163.85s). Final application browser: **18/18** (1.4m); visual browser: **17/17** (1.6m). Same-pass hosted: **2/2** (31.3s). Full ESLint and TypeScript passed. Vite production build passed (1.44s), retaining the existing >500KB chunk warning. Exact commands are in [testing](testing.md). Final restarted services retain Version 2, with no captured browser errors; `.local/evidence/luna-goal-final-workspace.png` shows the saved result.

Reviewed checkpoints include `06b0f7c`, `233234d`, `b8889e0`, `c98eb41`, `fb9330c`, `f90441c`, `50c9500`, `90fa006` and `deadf9e`; documentation checkpoints include `23def5f` and `a39cf59`. Final critic evidence/receipt refinement is **`8d7238c`**, reviewed for exact semantic identity, receipt immutability, bounded evidence, cancellation/lease fencing and unknown-outcome rejection; no remaining actionable finding. No push or remote visibility change.

## Limits, not hidden completion claims

- Two fresh completions are bounded evidence, not a universal reliability guarantee. Amber exceeds the soft 50-turn target and reads remain expensive.
- Intermediate critic mistakes occurred, including treating different ticks as simultaneous and partial previews as complete. Independent exact-note checks, final review and completion/protection validation remain necessary.
- The final timing/coverage and settled-receipt refinement is offline production-path verified; no extra paid run was made just to claim a new quality result for that format.
- Physical-phone/non-Chromium checks, heard audio quality and new live Nexus fidelity are unverified. No native renderer, playback or Gemini listening was added.
- No user action is required for the verified local construction workflow. Listening and Audiotool-copy qualification remain separate, explicitly authorized work.
