# Native finishing and recovery — 2026-09-27

This pass repairs the five findings from the paused Lantern review. It does not restart that paid job, increase any allowance, change models, accept a draft or copy it to Audiotool.

## Contracts

| Finding | Implemented behavior | Maintained evidence |
| --- | --- | --- |
| Growing inspection/error history | Compact complete assistant/tool groups, preserving their pairing. Retain four recent groups, latest error and pending groups; under input pressure retain one recent group and evict optional guidance. Exact brief, current durable plan/state/checklist stay authoritative. Retained messages keep opaque provider context. | `convergence.test.ts`; production-path varied-inspection regression |
| Unusable critic responses | Record JSON/schema/reference/truncation diagnosis and bounded private response text. One separately accounted format-recovery call per job, still subject to call, input and financial caps. Invalid output is never approval. Reuse only settled results with exact document and requirements hashes, including interruption after settlement but before plan attachment. | `review-model.test.ts`; `native-finishing-recovery.test.ts` |
| Overbroad review invalidation | Hash substantive intent, sections, sound goals, constraints, development tasks, creative identity/density/palette/decisions. Bookkeeping guidance references, failed lookups, task tracking and evidence links do not alone invalidate review. Changed musical requirements or music do. Reject late reviews against changed context. | Semantic-hash unit tests and transaction-backed plan/review tests |
| Endless finishing inspection | Keep latest valid findings visible with reviewed/current hashes and a finding → targeted edit → inspect → review sequence. Novel read results can reset stagnation only six times per stable musical/requirements state. Existing warn-at-six/pause-at-twelve behavior then applies. | Actual scripted producer inputs retain pending findings; varied paging pauses rather than running indefinitely |
| Input-limit recovery incorrectly requires a larger cap | Rebuild the next request from confirmed state, then enforce the same conservative pre-dispatch bound. A historical oversized estimate does not itself block continuation. Exhausted substantive reviews or consumed unusable recovery explicitly block doomed continuations. | Same-job worker continuation with unchanged captured limits and one original aggregate effect |

Compaction changes outgoing model context, not canonical music, persisted checkpoints, provider effects or immutable versions. Current musical facts must be re-inspected after changes. Older search results can be reread; they are not silently summarized as current facts. If the irreducible current request is still too large, the existing guard pauses before dispatch. Compaction is not permission to exceed a provider context window.

The dedicated repair effect uses `native-symbolic-review-repair-v1`, a fixed per-job identity, and a transaction-enforced single-slot limit. Its maximum output is 3,200 versus 1,600 for ordinary review. Both responses are charged when observed, including invalid responses; unknown outcomes retain their financial hold. A failed repair cannot create a second repair. Review counts are never reset. Recovery of a historically unusable last review can attach one additional result beyond the ordinary review count, only if it exactly matches the observed settled repair effect. It is not an extra subjective refinement allowance.

Historical invalid responses without stored raw output remain `historical_unusable`: their original parsing failure cannot be reconstructed honestly. Recovery evaluates the current score and retained valid findings. A clean review is reusable only for exact music plus exact direction/semantic plan. Editing task bookkeeping does not assert that unresolved musical findings are fixed.

## Evidence and limits

Ordinary tests use isolated owners/data and scripted providers with no network generation. The added production tests exercise tools, effects, real PostgreSQL plan state, worker acceptance and continuation; they do not prove creative quality or a below-50-turn success rate. The interrupted-settlement test simulates that boundary in persisted state; the broader suite retains actual worker-process restart/contending-worker coverage.

Read-only inspection of Lantern (`27a88030-d12b-4d82-b29d-38b5d5ee105c`) found six retained batches, 64 model calls, four prior review attempts, and US$2.086776 recorded spend. The repaired eligibility check allows explicit continuation at its existing 80-call / 128,000 conservative-input limits. No paid continuation was performed. Its future repair may still identify musical changes or fail; no accepted version or heard audio is claimed.

## Hands-on

1. Use the normal local API/worker with the updated code and open Lantern.
2. Review the retained arrangement and pause details. Continue is now eligible without increasing its input cap; starting it is an explicit paid action, not part of the offline checks.
3. The producer receives the current plan, unresolved valid findings and condensed recent history. A usable recovered review must still match the final score and requirements before completion.
4. Only a completed accepted version becomes copy-ready. Copy to Audiotool remains explicit and independent of this repair.

No new schema migration, provider key, UI primitive or dependency is needed. Native full-mix playback, Gemini listening and live Nexus verification remain deferred.
