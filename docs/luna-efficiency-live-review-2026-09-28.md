# Luna browser retest after the efficiency pass

September 28, 2026. Real local website, real OpenAI Luna xhigh, real worker and imported LangSmith trace. No fixture substitution, direct job injection, limit increase, automatic continuation or Audiotool mutation. Raw identifiers/trace data remain in ignored `.local/reviews/luna-after-efficiency.json`.

## Outcome

Repeated the previous Amber After Hours brief unchanged: 24 bars, 104 BPM, a compact synthesized drum/bass/chord/motif ensemble, sparse opening, groove, contrasting middle and developed build/return. Selected Luna in the website and submitted once. The run paused after **57.526 seconds**, with **six completed model calls / US$0.007652 recorded cost**, a retained plan/creative state, **zero committed musical batches**, no accepted version and no Audiotool copy. No critic ran. This is a failed construction evaluation, not a completed arrangement or quality result.

The refreshed services used the latest working tree. Prior to restart, the live queue had no queued/running jobs. Existing unresolved liabilities were retained. Standard captured a $5 job ceiling inside unchanged owner/model/provider/site limits; no allowance was raised. All six calls settled; the zero-cost aggregate result remains dispatched for durable continuation, not an additional unmetered model call.

## Findings, ranked

### 1. High: tool selection and pinned error history still exceed the input guard

The next request stopped at `OPENAI_INPUT_LIMIT_EXCEEDED:129365:128000`. This time there are **only six LLM spans**: the seventh call never reached dispatch. The previous complete-system measurement mismatch is not what this trace demonstrates; preflight correctly refused its complete envelope.

The model selected the `batch` specialist before constructing its initial scene. Current filtering adds `apply_native_batch` while retaining the initial scene tool. Rebuilding the advertised schema envelope from the traced schemas and current batch schema gives:

| Component | Serialized bytes |
| --- | ---: |
| Default tools envelope | 40,172 |
| Additional batch tool | 45,582 |
| Combined tools envelope (including separator) | 85,755 |
| System message | 5,746 |

In addition, compaction pins the whole latest error-containing assistant/tool group. Here a harmless stage error shares a group with a large sound inspection, creative decisions and opaque provider replay: approximately **30 KB** must remain under the current policy. Dropping other completed groups and recalled guidance cannot make the combined request fit. Input-bound units are conservative UTF-8 bytes/framing, not measured provider tokens or the model's context capacity.

**Repair direction:** make mutually alternative tool sets replace one another; partition the general operation union into discoverable bounded families, or choose another validated schema representation that fits. Preflight a requested tool set before acknowledging it. Preserve provider-valid reasoning/call/result grouping, but do not pin a resolved historical error indefinitely: retain bounded durable actionable feedback and reconstruct a fresh provider context at a safe boundary when required. Add production tests combining tool-set switching with a large mixed success/error exchange. Simply increasing limits or repeatedly pressing Continue is not the fix.

### 2. High: saving early creative context advances the stage prematurely

The trace's `advance_native_stage(building)` returned `Error: Producer stage cannot move backwards`. The database was at `refining` despite **zero musical steps**. `saveNativeCreativeState` sets `stage='refining'` whenever its semantic context changes, including the initial palette/identity save. That bookkeeping transition contradicts the expected plan → building flow and, in this run, produced the pinned error above. The tool span itself reports success even though its content is an error, so counting only span statuses misses it.

**Repair direction:** invalidate an affected review without automatically advancing an unbuilt plan to refining. Derive stage transitions from actual construction state, keep parallel tool turns ordered safely, and test first creative save plus building in both call orders. Recognize textual domain errors in diagnostic aggregates.

### 3. Medium: resource discovery still fails for ordinary phrases

`search_native_resources("warm soft synth bass lead chords")` returned no recipes. The previous fix addressed `discover_native_capabilities`; resource search still uses whole-query substring matching. An initial example query also exceeded its schema limit and was rejected; the model corrected that query successfully.

**Repair direction:** ranked token/role matching for local recipes with bounded results and clear no-match alternatives. Test the actual traced resource query as well as the capability queries.

### 4. Medium: preparation still crowds out construction

Imported **65 spans: six LLM, 17 executed tool spans, 42 chain spans**. Model messages contain 18 attempted tool calls (one invalid-argument call was handled before tool execution). Twelve executed tools were reads/searches/inspections. The arrangement skill was read twice, the unchanged workspace twice, and two large worked examples were loaded before any music was written. No scene/theme/section mutation tool was used.

The system prompt still describes the older form builder and generic batch as its main route; newer skill/tool guidance promotes scene-first construction. The sound inspection returned roughly 13 KB for the seed voice, including all controls rather than only controls relevant to the intended patch.

**Repair direction:** align the system prompt, skills and advertised default. Encourage a first small valid musical commit after one purposeful discovery pass. Offer focused/paged controls, concise example summaries before full content, and normalized cache keys for equivalent read requests. Do not force a genre template or weaken final checks. This one failed run cannot establish a statistical speed/quality improvement.

### 5. Medium: zero-step recovery UI describes a musical draft that does not exist

The paused panel says “Your draft is saved” and offers “Continue arrangement,” but this run contains only a plan. The page still says “A new piece, taking shape.” That makes the state look further along than it is. Continue may start with smaller default context, but selecting batch can reproduce the same trap; it is not evidence the underlying problem is resolved. I did not spend on that retry.

**Repair direction:** distinguish retained approach from confirmed music in the short recovery message, and show an actionable diagnostic without financial/internal clutter. Test recovery eligibility against the rebuilt envelope/tool selection rather than assuming an input pause is automatically solved.

## UI and runtime checks

- Actual reload retains the paused session and its plan. No fake score or accepted version was displayed; no copy-ready action was offered.
- New session, model selection and submission were exercised through browser controls. Keyboard activation was reliable. Some initial pointer activations produced no observed action in the in-app browser; insufficient evidence to call this an application defect.
- Read more/Show less expands one paragraph, has a compact visual treatment and retains keyboard focus. No duplicated excerpt.
- No unsolicited sample-listening notice appeared in this new run. Historical notices remain in older sessions.
- The earlier Amber draft now has its confirmed title in the sidebar. The new zero-step session remains Untitled, appropriately avoiding an invented confirmed score title.
- Desktop and 390×844 emulated-phone paused layouts inspected; controls remain available without horizontal clipping. No captured browser console warnings/errors. Worker stderr had no additional provider/transport error. A brief connection screen appeared during service restart and cleared on reload.
- Screenshots: `.local/evidence/luna-after-efficiency-desktop.png`, `luna-after-efficiency-phone.png`. Raw LangSmith import initially hit sandbox network denial; the authorized read-only escalated import succeeded. Physical phones, other browsers, accepted-score inspection, live Nexus fidelity and heard quality were not established by this run.

## Next step

Fix the tool-envelope/error-history interaction and premature stage change first, then align discovery/prompt guidance and zero-step copy. Add the traced combination to maintained offline tests before one explicit bounded live continuation. No runtime fixes were made in this diagnostic turn; prior implementation changes remain intact. The local application is running on the updated backend, with this failed test preserved for inspection.
