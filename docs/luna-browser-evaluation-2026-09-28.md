# Luna browser evaluation — 2026-09-28

## Result

**Real-provider run, incomplete.** Started a new session through the actual local website, selected **GPT-6 Luna · xhigh**, typed a musical brief and pressed Create arrangement. No fixture/model substitution or direct job insertion was used. The user authorized this run under the existing configured allowances. No limits were increased, no earlier job was resumed and no Audiotool mutation was performed.

The request was accepted at 07:26:09 UTC and paused at 07:30:18 UTC (approximately **4 minutes 9 seconds**). It saved a **12-bar, two-section, four-part draft** in one 14-operation batch, but did not complete the requested 24 bars or accept a version. First music was saved after approximately 2 minutes 25 seconds. It remains available in the local session titled **Amber After Hours**; the sidebar still calls the session Untitled listening room.

Actual recorded cost: **US$0.029140**, all from **13 completed Luna producer calls**. There was no critic call. The 14th LLM span was blocked before dispatch, with zero reported tokens and no paid model effect. All 13 model effects have observed cost; the unfinished aggregate producer-result effect has zero reservation/cost and is not another paid call. Existing installation liabilities were preserved. This is application-ledger evidence, not an independently audited OpenAI invoice.

## Brief submitted

> Create a 24-bar instrumental called Amber After Hours: a warm, lightly syncopated electronic groove at 104 BPM, like the last train passing through a quiet city. Use a compact ensemble of drums, rounded bass, soft chord stabs and one memorable synth motif. Give it a sparse opening, a confident groove, a contrasting middle that leaves some space, and a clear build into the final return. Develop the motif rather than looping every part unchanged; let the final return feel earned through rhythm, register and a gradual change in tone. Keep the low end restrained and use subtle shared ambience. Choose the notes, harmony and sound settings yourself. Use built-in synth/drum sounds; no samples or recordings are needed. Finish a coherent editable arrangement.

## Evidence and findings

Read-only LangSmith import: **one root trace, 129 spans: 14 LLM, 34 tool, 81 chain**. Reported usage across completed calls: **359,972 input tokens and 19,377 output tokens**. The token total is different from the application's conservative byte-based input bound. Private raw traces, job identifiers and screenshots remain in ignored `.local`, not this report.

### 1. Blocking: compaction and dispatch measure different inputs

Worker log, job event and root trace agree:

`OPENAI_INPUT_LIMIT_EXCEEDED:131409:128000`

Reconstructing the final LangSmith message envelope with the production normalization produces **131,409 exactly**. Removing only the system message yields **125,662**. The **5,747** difference is the system envelope appended after the compaction check. Consequently, `withNativeFinishingContext` thinks the input fits and does not take its more aggressive fallback; `AccountedOpenAICalls` then correctly refuses the larger final message set.

Relevant code: `packages/core/src/native/convergence.ts`, the `wrapModelCall` middleware in `native/producer.ts`, and `boundOpenAiRequest` in `agent/runtime.ts`. This reproduces the previous sparse-session failure on a fresh prompt and job. It is **not an insufficient-credit error**, output-token failure, exhausted model-call limit or a failure caused by using the browser while the worker runs.

The final retained four assistant groups contain **60,947 serialized bytes of provider output**, including required Responses replay material. Do not strip reasoning/function-call associations to save space: that would risk reintroducing the earlier orphaned function-call error. An offline, non-dispatch counterfactual retaining the latest complete assistant/tool group plus all human/system/current-state context measures **38,339**. This demonstrates available space through whole-group compaction, not a verified production repair or a guarantee of creative completion.

**Repair:** make compaction account for the complete system/message envelope used at dispatch, recheck after final middleware assembly and compact whole completed exchanges within existing invariants. Keep the final accounting guard. Add a production-orchestration regression with large opaque Responses items and the system message; helper-only tests missed this mismatch. Separately audit tool-schema/framing coverage instead of assuming the fixed 768-byte allowance represents all tool definitions.

### 2. Efficiency: discovery dominates construction

Of **34 tools**, **29** were reads/searches/inspection, four wrote plan/stage/creative-state bookkeeping and one constructed music. There were **no tool-status errors or rejected musical batches** in this run. The form tool successfully constructed 14 operations, demonstrating that useful compound construction already works.

After that first batch, the remaining calls inspected the draft and saved intentions, but committed no further notes or controls. This is not proof those inspections were useless; it shows a poor ratio of context/latency to musical development before the guard stopped the run.

Capability discovery returned **no matches for three of five searches**:

- `heisenberg parameter ranges`
- `Beatbox8 drum note mapping`
- `automation target Heisenberg device filter cutoff frequency`

The shorter `heisenberg` and `beatbox8` queries succeeded. `native/catalog.ts` requires every query term to appear in the root name/family/purpose, while the requested parameter details live elsewhere. The model uses natural-language questions that this search cannot answer, then re-reads guidance. This is a concrete discoverability mismatch, not evidence the controls do not exist.

**Improvement:** return ranked device/control matches and actionable empty-result suggestions, or introduce a bounded editable-sound inspection tool containing current values, valid operation/automation paths, ranges and one example. Combine a validated musical edit with a concise hash-grounded result inspection. Then add an explicit section-development compound operation with deterministic IDs/ticks and the existing validation/protection/replay boundary. Do not substitute fixed genre templates or remove useful final musical review.

### 3. Recovery copy suggests capacity when the immediate problem is an application bug

The browser says **“This direction needs more processing room before it can continue”** and offers Continue arrangement. The draft is indeed preserved, but a larger allowance is not the demonstrated remedy: the input was admitted using an incomplete preflight envelope. No continuation was attempted, so this pass does not claim its next attempt necessarily fails; the earlier six-attempt trace already demonstrates that repeated continuation can reproduce this class of stop.

**Improvement:** repair/revalidate context assembly before recommending repeated continuation. Keep unknown-charge, ownership and duplicate-effect fences intact. Distinguish a local context-assembly failure from exhausted funding or genuine provider context limits without exposing implementation noise in the main UI.

### 4. Minor UI clarity issues remain

- The header has the generated title, but sidebar/breadcrumb remain **Untitled listening room**, even after reload. A draft-aware display title would make several unfinished sessions distinguishable without selecting/accepting their music.
- The capability announcement discusses optional sample listening even though the brief explicitly needs no samples. Show only relevant capability information or move it to Sounds.
- Section labels show the padded plot range as though it were the part's pitch range. For example, the bass motif has MIDI pitches 38–48 (D2–C3), but the section lane says C♯2–C♯3 because `scoreWindow` pads by one semitone on each end. Note data itself is not shifted. Label the axis as a display range or show the actual musical range separately.

## What worked

- Browser creation, model selection, routing and owner-scoped updates used the real application path.
- The new compact status icon and Read more/Show less control worked on this live session. Expansion did not duplicate the message.
- The title, two real sections and four parts appeared from confirmed data, not placeholders.
- Section selection displayed actual notes, and the draft/pause survived a full browser reload.
- Accounting recorded successful calls; the blocked final call did not spend. No provider credit/quota error was observed.
- No browser warning/error messages were captured; API error log was empty, and worker error log showed the input-guard failure above.
- No unreviewed draft was promoted to an accepted version or shown as copy-ready.

## Limits and artifacts

The requested middle, build and final return were not constructed. There is no final critique, completed version, revision/compare qualification, live Nexus copy or heard full mix from this run. Shared ambience and patch settings are construction evidence only, not heard quality. The existing native-rendering deferral remains.

Ignored local evidence:

- `.local/reviews/luna-browser-live.json` — imported trace, scoped job events and step/effect records.
- `.local/reviews/luna-browser-summary.json` — normalized envelope sizes, call timings and tool summary.
- `.local/evidence/luna-browser-draft.png` — real saved draft after reload.
- `.local/evidence/luna-browser-paused.png` — visible recovery state and error detail.
- `.local/luna-browser-{api,worker,web}*.log` — task-launched local process logs.

This was a diagnosis/evaluation request. No application runtime fixes, migrations, dependency changes, budget edits or commits were made. Existing uncommitted UI work was preserved. Recommended order: **complete-envelope compaction regression/fix → capability discovery and edit/inspect efficiency → one explicit continuation of the preserved draft → final musical review and any separately authorized copy/listening check**.
