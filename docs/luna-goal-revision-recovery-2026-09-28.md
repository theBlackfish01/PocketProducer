# Contrasting completion and revision recovery

September 28, 2026. Real browser submissions, OpenAI Luna xhigh, local production worker and imported LangSmith traces. No direct job injection, paid-budget change, Audiotool copy or audio rendering.

## Second consecutive fresh completion

**Paper Lanterns** completed in **6m32.821s**, with first confirmed music at **1m11.440s**. There were **38 producer + 3 critic calls**, six musical batches, **US$0.061949**, 264 imported spans and 52 executed tools (53 attempted; one search argument failed schema validation and was corrected). All paid effects settled. No manual Continue, input overflow, truncated output or unresolved tool error. The accepted version survives reload; desktop and 390px section views were inspected. Trace: `.local/reviews/luna-goal-attempt-6.json`; screenshots `.local/evidence/luna-goal-6-completed.png` and `luna-goal-6-mobile-section.png`.

The ordinary contrasting brief requested 16 bars at 78 BPM in 3/4, no drums, no more than three built-in-synth parts, a sparse keyboard-like motif, quiet answers in its gaps, occasional low grounding, a warmer/searching middle and an altered return. Actual canonical evidence:

- Exactly that length, meter, tempo and part count; no percussion, samples or uploaded sources.
- Lead has 23 notes: six/six/six/five across four sections. Opening F♯–A–E becomes F♯–A–D, then G–B–E, and a changed F♯–A–D return with an A-to-D close. Derived lead motifs share real lineage.
- Bass has nine occasional notes. The answer has 12 notes in six two-note fragments, absent from the opening. Its bar-6/8/10/12/14/16 replies finish before the next lead attack; this is timing evidence, not just a claim of spaciousness.
- The lead has explicit oscillator gains/envelope settings and a rising-then-falling filter curve. Bass is low-pass filtered; the answer uses a contrasting synth. All three feed a configured shared room at restrained send levels.
- Final review is valid, matches the accepted document/context and has no unresolved finding. The final D5 lead and D2 bass last to the end. Heard sound quality remains unverified.

Efficiency improved relative to Amber, but this is a different brief, not a controlled performance comparison. Only two tool-menu selections occurred, versus twenty in Amber. Reads still dominate (36 read/search/inspection tools, six musical writes); eight sound inspections could be more economical. Provider-reported totals: 787,455 input tokens, 456,652 cache-read, 330,680 cache-creation, 32,038 output, of which 25,735 reasoning. Accounting uses the captured model pricing, not guessed cost from the conservative byte guard.

The first critic falsely described two bass events at different ticks (2880 and 8640) as simultaneous and questioned an existing MIDI-62 D ending. This was model interpretation, not duplicated input: the imported input contains distinct ticks. The producer then made a more explicit final cadence. The final review claims are independently supported, but intermediate critic opinions must not be treated as measured musical facts. A third review followed a semantic creative-context update, with unchanged score hash. These are remaining efficiency/quality limitations, not provider transport failures.

## Protected revision exposed a separate defect

The browser selected Amber's **Last train groove**, bars 5–12, and requested fewer hats while retaining kick/snare and exactly preserving the named bass, melody/lead, chord parts, their sound/automation/shared effects and every other section. Luna xhigh was explicitly selected.

The first attempt paused after **1m24s**, **8 producer calls, no critic, US$0.011938**. The model first tried a sixth Beatbox8 pattern (correctly rejected), then successfully replaced the sole groove motif under `thin-last-train-hats`. It subsequently reused that committed key for a different variation. `NativeToolSession` rejected it before mutation, but the generic `NATIVE_STEP_REPLAY_CONFLICT` classification escaped the tool and was mislabeled as an uncertain provider outcome. All eight paid calls were already settled; only the zero-cost aggregate failed. Trace: `.local/reviews/luna-goal-revision-1.json` (includes original generation plus the separate 70-span revision trace).

The accepted Version 1 remains unchanged. Independent draft inspection confirms 48→40 groove drum onsets, unchanged non-hat events, unchanged other sections, identical protected-part hashes including dependencies, and unchanged form/shared processing. This is **not yet an accepted revision or a passed history journey**.

## Focused repair

- A known receipt in the serialized tool session now raises a typed, model-correctable key-reuse rejection with the saved/current hashes. It explicitly says no new edit occurred and asks the model to inspect before an intentional additional edit. Exact same-payload replay still returns the receipt, not another mutation.
- Database receipt/predecessor conflicts, inconsistent replay, unknown provider outcomes, cancellation and lease loss remain fatal fences. The repair does not rename a key automatically or accept changed arguments as a replay.
- An operator-only local reconciliation command verifies ownership, exact historical error, no cancellation/completion, unchanged selected head, matching reviewed draft hash, consistent operation/result/predecessor replay and all confirmed provider receipts. It restores only the failed zero-cost aggregate and reclassifies the retained job as safely paused. It does not dispatch or reset spending; continuation remains an explicit browser action with all existing limits.

Inspect, then apply only the exact inspected hash:

```powershell
node --import tsx scripts/reconcile-native-step-conflict.ts JOB_ID
node --import tsx scripts/reconcile-native-step-conflict.ts JOB_ID INSPECTED_DRAFT_HASH --apply
```

The command is not a generic recovery for uncertain calls. Ordinary users do not see diagnostic hashes. No new API endpoint or broad automatic retry was added.

## Verification checkpoint

New scripted production-path tests exercise changed-key rejection, same-key replay, finishing, durable replay, immutable rejected state, exact operator reconciliation, wrong-owner/unknown-charge/changed-head/corrupt-journal rejection and explicit continuation. The original cancellation/sibling test needed its expected error text updated; its state-preservation assertions remain and were strengthened. Final focused tests passed **2/2**; full PostgreSQL integration passed **138/138**, 12 files (153.09s). Final unit **213/213**, 37 files (55.18s); hosted browser **2/2** (31.3s); types/targeted lint pass. A preceding full integration process had loaded code before the additional integrity check was edited and failed that new assertion; the clean final rerun above includes it and passed.

Before this repair: **213/213 unit**, **136/136 integration** (147.51s), **18/18 app browser** (1.6m), strict types/full lint and production build passed (2.50s; existing large-chunk warning). Those results are not claimed as final verification of this new recovery code.

## Live recovery and independent revision audit

The exact retained draft was reconciled only after checking its hash and all settled receipts. The browser's explicit Continue resumed the same job, without a new job or spending reset. It completed in **5m03.537s**, **21 additional producer + 4 critic calls**, **US$0.036690** additional. The terminal recovery import contains 151 spans and 27 tools. One attempted sixth Beatbox8 pattern was correctly rejected and corrected in place; no unresolved error remains. Total revision cost including the failed first attempt is **US$0.048628** (29 producer + 4 critic calls).

Version 2 has 40 groove drum notes versus 48 in Version 1. Hats are **24→8**; kicks remain exactly **16**; snares change **8→16**, on beats 2/4. This is not a hats-only edit. The preliminary audit's stronger assumption that all non-hat events would be identical failed; that assumption is not the submitted request, which asks for a clear kick/snare pulse and exact preservation of the named bass, lead and chords. The audit now separately reports the snare changes instead of hiding them. Actual requested protections pass: all three protected part/dependency hashes, every outside-section drum event, global form, shared routing and original version hash are unchanged. Total target density is lower, and the final model review matches the accepted hash. The original version remains available unchanged.

The browser Before/After/Changes views show 48/40 notes and three unchanged parts. Database checks confirm comparison itself leaves Version 2 selected. Explicit Use Before selects Version 1 (selection counter 3), and Use After selects Version 2 again; further reload/mobile verification is pending. Screenshot: `.local/evidence/luna-goal-revision-comparison.png`. Raw trace: `.local/reviews/luna-goal-revision-1-recovery.json`. API/worker stderr and captured browser errors are empty.

The critic twice interpreted an eight-event onset preview as a complete pattern. The producer corrected the second false finding by inspecting exact motif notes, but this consumed avoidable reviews. The summary currently omits explicit preview coverage and meter/tick units. A focused evidence-format refinement is still needed; it must not rewrite accepted music or reinterpret model prose as measured facts.

Goal spend through this recovery is **US$0.492984**. Existing earlier unrelated/historical liabilities remain untouched. The goal remains active for final evidence-format verification, reload/mobile history checks and commit/completion audit. No live Nexus fidelity or heard-quality claim is made.
