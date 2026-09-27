# Commit and pending-work review — 2026-09-27

## Scope

Reviewed recent history through `991f894`, with emphasis on `31ac4bc` (accounting/readback), `c87ecb5` (single-workspace retirement) and the subsequent uncommitted sound-craft, clarity, model-selection and finishing-recovery passes. Inspected provider dispatch/settlement, caps, recovery transactions, schema migrations, native mapping, UI request isolation and explicit copy behavior. This is a focused risk review, not an assertion that every historical line is defect-free.

The pending work shares core orchestration/API/export files. Commit groups therefore keep the coupled backend together, followed by the UI and its browser checks, then current documentation. No credentials, local databases, private traces or generated evidence belong in these commits. A scan of 96 candidate files found no configured secret values or matching credential patterns; `.env` is ignored and untracked. No push or paid/remote action was performed.

## Unresolved findings

### R1 — High: Extended review recovery cannot attach the seventh result

`nativeReviewLimit` permits six ordinary reviews for Extended. `saveNativeReview` explicitly permits a seventh attachment when it matches the sole observed format-recovery effect. Migration 020 still constrains `creative_review_count <= 6`. Consequently, the format-recovery call may succeed and settle, but plan attachment fails with PostgreSQL `23514 / native_job_plan_creative_review_count_check`. Replaying the settled result cannot repair this schema contradiction. Standard's fourth-to-fifth recovery tests do not cover it.

Reproduced with a fresh isolated `_test` owner and Extended job: persist a plan and native step; set six used reviews; call `focusedNativeReview` with historical-unusable recovery and a scripted valid reviewer; then call `saveNativeReview`. The effect is `succeeded`, the save rejects with the exact constraint, and the count remains six. No provider request or development data mutation. A follow-up repair needs an additive migration or a distinct recovery counter, preserving the ordinary six-review ceiling and one-repair limit, plus Extended and restart regressions. **Not fixed in this review/commit assignment.**

### R2 — Medium: Continue ignores exhausted provider/owner pools

`nativeDraftView` and `resumeNativePartialJob` check the combined allowance and job ceiling, but do not apply the new provider/owner availability checks. Those checks exist at reservation in `assertSharedUsage`. An owner exhausted at its own cap can still see and submit Continue, only for the next model reservation to fail immediately. The monetary guard works; the recovery eligibility and explanation are wrong.

Reproduced with a fresh isolated owner, confirmed native step, resumable aggregate and zero owner limit: pause with `MODEL_BUDGET_EXCEEDED:USER`; `nativeDraftView.canContinue` is true; continuation succeeds; reservation of even one micro-dollar rejects with `MODEL_BUDGET_EXCEEDED:USER`. The same omission applies statically to provider caps. A follow-up should share allowance-availability logic between reservation and recovery, preserve locking/order and give a specific non-retryable-until-changed reason. **Not fixed in this review/commit assignment.**

### R3 — Low: reconciliation output reports the old mapping version

`scripts/reconcile-native-sync.ts` prints literal `nexus-native-v7`, while current mapping/persistence uses `NATIVE_MAPPING_VERSION = nexus-native-v8`. Successful operator output therefore misreports the contract used. The correction is to report the imported mapping constant. The database checks are not bypassed by this reporting defect. No live reconciliation was run. **Not fixed in this review/commit assignment.**

## Verification this review

- Full unit suite: **33 files / 174 tests**, 53.59 s.
- Full integration suite: **9 files / 93 tests**, 119.45 s, including the final settled-review recovery test added in the preceding pass.
- Two additional isolated diagnostic probes reproduced R1 and R2 (2/2 assertions of the defective behavior, 3.11 s). These are diagnostic evidence, not passing acceptance tests for corrected behavior. Temporary probe source was removed after recording evidence to avoid silently adding database probes to the unit suite.
- Strict types, lint, static course verification and production build passed (1.31 s, existing chunk-size warning). Existing prior browser evidence remains 16/16 Chromium journeys; this review does not claim a new browser or live-provider run.
- Credentials, balances and Lantern remained untouched. The Gateway zero-credit observation, absent distinct visitor login, unverified real-model convergence and deferred full-mix listening remain documented product/external limits, not newly discovered regressions.

PostgreSQL guidance informed the short-transaction/lock review; Gateway guidance informed the dispatch-versus-billing boundary review. Neither required framework or dependency changes.
