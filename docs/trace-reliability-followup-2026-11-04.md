# Trace-driven reliability follow-up — 2026-11-04

This implements a bounded local follow-up to the imported October 27–November 3 workflows. Raw traces, private directions and ownership evidence remain in ignored `.local/reviews/full-traffic-analysis-2026-11-03/`. The audit's Audiotool HTTP acceptance records did not prove copy completion; this change does not alter synchronization or claim those copies succeeded.

## Interpretation and scope

New captures treat recognizable musical identity as creative guidance, not an exact note lock. Explicit unchanged/as-written wording still creates exact protection. Contradictory change and preserve roles in the same resolved scope are shown in the existing interpretation confirmation, retaining the exact keep rule. Keeping one phrase while developing another remains valid. Historical captured briefs, protected parts, accepted versions and operation replay are unchanged.

An independent scope defect was confirmed in the producer prompt: an unscoped revision said to choose one section. It now names the whole piece and all relevant unprotected parts. Tool guidance explicitly distinguishes section-local changes from whole-piece changes. This improves instruction accuracy; it does not claim deterministic enforcement of every subjective change across a whole piece.

## Playback and upload guidance

A shared, deliberately narrow recognizer handles complete playback questions such as “how can I hear it”. The web UI shows listening instructions without clearing the draft, and both interpretation and job creation refuse paid construction for those questions after ownership checks. The stable API issue is `PLAYBACK_HELP` (422). Mixed edit/help requests remain musical requests. A help button works independently of paid creation availability.

The status response includes the configured `maxUploadBytes`; the sound panel shows the WAV limit and checks format/size before upload. Failed status reads fall back to existing server validation. No upload limit or server validation is relaxed. Creation options explain the 128-bar/native-instrumental boundary and the option to supply vocal audio. Busy-owner copy/creation failures point people to their Working session; admission rules and retries remain unchanged.

## Factual review and recovery

Review context now carries tempo, meter and length differences against the accepted base alongside part changes. New review output includes nullable `claimedTempoChange` and `claimedCitedChord` fields. The first is checked against actual before/after BPM. The second describes exactly the cited voicing, not a proposed chord or an inferred full ensemble chord. Complete pitch sets are checked; inversions/enharmonic or other equivalent chord names remain valid. Partial/ambiguous citations should use null, and unsupported notation does not establish a contradiction. Existing note-citation checks still run.

Only contradicted findings are discarded, with reasons retained. Other findings and the existing bounded best-effort finish policy remain available. No finding remaining is explicitly described as such, not proof of heard musical quality. Historical reviews without these fields still parse/replay. These bounded checks are not a general natural-language fact checker and cannot guarantee the model will always select an appropriate non-null claim.

An explicit continuation stores the previous bounded stop detail in the existing private job event before clearing it from the queued job. The fresh producer receives it as diagnostic data plus the freshly measured checklist, confirmed steps and existing review state. Instructions prioritize the named blocker and discourage another tour of unchanged music. No new table, mutable-score cache, automatic retry, budget reset or relaxation of hard requirements was added. Historical contradictory locks can still require ending the request and issuing a clarified revision; this pass never rewrites them.

## Construction efficiency

The existing scene/batch tools remain the mutation path. Added guidance covers replacing the seed in the same construction call, whole-bar chord cycles (up to 16), rhythmic/bass cycles (up to 8 and 96 notes), and splitting work by section. The existing validated operations, atomic commits, inspection receipts, per-call accounting and unknown-outcome handling remain authoritative. Live speed/cost improvements have not been measured in this pass.

## Verification and release

Verification is provider-free: unit regressions, real local PostgreSQL integration tests, scripted production-graph generation/revision/recovery, and desktop/phone Chromium fixtures. Screenshots are under ignored `.local/evidence/`. No paid generation, live Audiotool action, deployment or production data change is part of this implementation. See `STATUS.md` for final command results.

There is no database migration. Rollback is the previous application build; old readers tolerate the extra optional review fields and private event payload. A later hosted comparison should measure completion, calls, read/write ratio and cost using fresh requests, without changing allowances or deleting saved projects.
