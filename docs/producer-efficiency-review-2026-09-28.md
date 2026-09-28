# Sparse-session trace review and compound-tool priorities

## Evidence and scope

Read-only import from the configured private LangSmith project on September 28, 2026: six root traces, 432 spans (44 LLM, 117 tool, 271 chain), correlated with the requested local session's durable jobs, events and effects. Private IDs, raw prompts/responses and URLs remain only in ignored `.local/reviews/current-session.json`, not this report. No provider generation, continuation, credit changes or Audiotool mutation was performed. This report is diagnosis and design guidance, not a producer-runtime repair or musical-quality evaluation.

The job used **GPT-6 Luna**, with 38 observed successful producer effects and six additional pre-dispatch LLM spans with zero reported tokens. The application ledger records **US$0.092953**; this is recorded application cost, not a verified OpenAI invoice. The job's effects contained no unknown-cost liabilities at inspection time. Imported LLM spans total 1,059,887 reported input tokens and 61,155 output tokens. All six attempts stopped with `OPENAI_INPUT_LIMIT_EXCEEDED`, between 129,565 and 132,764 against 128,000. No credit/quota error was found in these attempts. Replenishing provider credits does not change this application limit or its request-building mismatch.

Only one nine-operation musical batch was confirmed. The final job is paused, with no accepted native revision. The retained work is not a completed arrangement, nor a verified Audiotool copy or heard score. No draft/history/accounting record was changed during this inspection.

## Why continuation did not resolve it

The current producer calls `withNativeFinishingContext` on middleware messages; the final model callback independently bounds the complete messages after system context is included. Reconstructing the last imported callback message envelope gives **129,565** conservative UTF-8/framing units, exactly matching the recorded stop. Removing the system message gives **123,818**: the missing system envelope is **5,747** units. Thus the earlier fit check can pass without invoking its tighter compaction, while the final guard rejects the complete request. These units are an application upper-bound estimate, not measured model tokens.

The existing compaction is present; saying there is no compaction would be incorrect. The problem is inconsistent input coverage across its preflight and the final callback. The latest retained four assistant groups also carry about 50.9 kB of provider replay output, which includes reasoning/function protocol data, not just displayed prose. Do not strip that data: doing so reintroduces the missing-reasoning-item replay defect. Compact complete matched assistant/tool exchanges instead.

Recommended narrow repair, separately from this UI pass:

1. Make compaction evaluate the **same complete request envelope** as final dispatch, including the actual system message, rather than adding a guessed constant or raising all budgets.
2. Preserve exact brief, current plan/canonical state, protections, pending calls and the latest actionable error; drop old complete exchanges under pressure without breaking Responses envelopes.
3. Retain the final pre-dispatch guard and financial reservation. The trace also records approximately 72.7 kB of tool definitions (45.7 kB for `apply_native_batch` alone). This is separate schema overhead, not the cause of the exact message-limit mismatch above. Validate actual schema/wire accounting before claiming the current fixed framing allowance covers it.
4. Add a production-path regression where middleware input fits but the system-inclusive callback does not, including nonempty provider reasoning output and a recoverable tool error. Assert a bounded outgoing request, no orphaned function/reasoning items, and no duplicate reservation/mutation on continuation.
5. Verify a reconstructed continuation offline before the user explicitly resumes the paid job. Do not loop Continue or silently extend its captured allowance.

## Where turns went

Of 117 tool spans, 106 were reads/searches/inspections, eight were plan/stage/creative-state writes, and three attempted musical construction. The read-heavy path included 26 `read_file`, 10 plan reads, nine workspace reads, nine brief reads, 10 capability discoveries and 11 capability inspections. Five capability inspections rejected invalid schema paths; errors were recoverable but discovery did not reliably lead to the next musical edit.

Two construction calls were rejected:

- `compose_native_form`: a duration of 0.72 beats is not exactly representable at 960 PPQ. The tool correctly refused silent quantization and returned a nearest-tick hint.
- `apply_native_batch`: a new root motif did not own its family identity. The validator correctly protected provenance; no invalid draft was committed.

The one successful batch followed the first continuation. Subsequent attempts repeatedly rediscovered context without another confirmed musical edit. Many reads occurred in multi-tool model turns already; reducing tool-span count alone will not necessarily reduce model turns or latency.

## Bounded compound tools worth adding

Keep existing `compose_native_form`, `apply_native_batch`, `harmonizeSection`, `sequenceSectionPattern`, `handoffMotif` and exact sample sequencing. Do not add a second generic composer or hard-coded genre template. Prefer a few thin deterministic compilers into the existing canonical operations:

| Priority | Capability | Agent chooses | Deterministic work and result |
| --- | --- | --- | --- |
| 1 | **Inspect an editable sound** | Current part or supported instrument and desired control family | Return canonical parameter/automation paths, units/ranges and current values, with a small valid operation example. Distinguish these paths from raw Nexus SDK schema paths. Avoid five rounds of guessing SDK entity names. |
| 2 | **Build a musical scene** | Parts/recipe or pinned preset, exact tick-based phrases, entrances, shared bus and per-section placements | Atomically add related parts, motifs, placements and routing; assign valid root family identities and stable derived IDs; return exact changed entities and a bounded section inspection. Reuse existing operations and scope checks. |
| 3 | **Develop a theme across sections** | Source motif, named sections, exact variations/omissions, transposition/register, timing/velocity and phrase handoff | Compile placements and instance variations with proven family lineage, preserving protected and out-of-scope material. No automatic added layers or density assumptions. |
| 4 | **Shape a section's sound** | Named controls, explicit endpoints/curve, shared send relationships and scope | Build boundary-correct automation and supported routing as one validated batch; return curve/routing evidence and untouched-boundary checks. No guessed parameter aliases or universal build-up preset. |
| 5 | **Apply and inspect a focused change** | Bounded operation batch and one/two section or part IDs | Commit through existing fencing, then return current-hash scoped inspection and completion checklist in the same result. This is not critic approval or automatic acceptance. Separate readback failure from an already committed batch so retry cannot reapply it. |

The smallest useful increment is **sound-control inspection + apply-and-inspect**, with a tick-native scene input afterward. The current bottleneck is repeatedly learning how to express an edit, not a lack of raw operations. Resource search remains a separate read unless a compound operation has an exact pinned identity; discovery is not write permission or evidence of sample rights.

### Safety and quality bar

- Reuse `NativeToolSession.apply`, stable step keys, canonical validation, owner/lease/head checks, immutable history and protection hashes. Test atomic rejection and duplicate/restart behavior through production orchestration, not a parallel shortcut path.
- Use ticks, or an explicit user/model-selected quantization policy with reported deltas. Never silently round an entire detailed form to make it pass.
- Bounded optional controls and small responses; avoid expanding every schema on every turn. Measure the complete request, not only conversation text. Tool restriction must not remove the operations needed to finish a current revision.
- Return hash-grounded changes/inspections rather than full duplicated documents. Reuse pinned guidance; reread mutable music when its hash changes.
- Compare the sparse, demanding and vague briefs on successful edit latency, completed model turns, invalid-call rate, request size, cost and protection fidelity. Then separately evaluate real-model musical development and human listening. A faster scripted run alone is not quality evidence.

## Disposition

Implemented in this pass: welcome-page hierarchy/artwork/features, compact conversation links, accessible sidebar status icons, and a neutral GitHub link. The input-envelope repair and compound tools above are **not implemented** here: the requested producer work was trace inspection and brainstorming. Repeated continuation is not recommended until the request-envelope mismatch is repaired. Native full-mix playback remains deferred.
