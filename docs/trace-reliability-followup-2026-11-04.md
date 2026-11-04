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

Initial verification was provider-free: unit regressions, real local PostgreSQL integration tests, scripted production-graph generation/revision/recovery, and desktop/phone Chromium fixtures. The subsequently authorized release and two hosted generations are recorded below. See `STATUS.md` for command results.

There is no database migration. Rollback is the previous application build; old readers tolerate the extra optional review fields and private event payload. A later hosted comparison should measure completion, calls, read/write ratio and cost using fresh requests, without changing allowances or deleting saved projects.

### Hosted release verification

Runtime commits `e1dbddf` and `6674061` were reviewed, pushed and deployed on November 4. CI exposed a real edge case in the first commit: the new producer guidance put a near-maximum brief five tokens above the default 96,000 input ceiling. The follow-up shortened the guidance while preserving its rules and made offline tests explicitly use the shipped default instead of inheriting a larger developer setting. No input limit, fixture assertion, lease or spending cap was raised.

Two browser-driven Luna generations saved Version 1 without manual continuation:

| Assistant test | Structure | Trace duration | Model / tool calls | Traced generation cost |
| --- | --- | --- | --- | --- |
| Copper Lantern Release Test | 24 bars, three sections, four parts, 112 BPM, 4/4 | 240.9 seconds | 17 / 18 | $0.035926 |
| Willow Orbit Release Test | 16 bars, four sections, four parts, 90 BPM, 3/4, no percussion | 234.3 seconds | 13 / 13 | $0.027038 |

Copper ran on the initial release; Willow ran after the input-envelope correction. Both traces were imported privately, including root and tool outputs. No trace errors or tool error responses appeared. Copper's first review requested an actual melodic variation; the producer changed it and saved after a second review, retaining suggestions about a lead/bass tension and ending phrase density. Willow's reviewer emitted a self-correcting observation about a bass note while declaring its single-note citation to be Dm9; the exact-voicing guard discarded that malformed finding. This demonstrates bounded filtering, not universally correct musical judgment. Willow added a pitched atmosphere layer; the request did not require exactly three parts, and no percussion part appeared.

Section inspection, exact part facts, saved-version reload and Copper's version history worked. The standalone playback question preserved its text and displayed unpaid help without beginning a revision. The upload panel displayed the server's 20 MB WAV limit. No captured browser warnings/errors appeared. Bounded Railway HTTP windows contained 273 and 337 requests respectively, all 200/202; the second window's runtime log sample contained no errors. These successful UI generations do not prove Audiotool copy fidelity or heard audio quality: neither copying nor playback was performed. The traced costs exclude any untraced prompt-interpretation charge.

Private screenshots, trace JSON and analysis are under `.local/reviews/release-2026-11-04/`. The two test projects are `d3bf69ba-a099-4791-93d5-78865092bdc5` and `5a42fb38-a9d5-4351-b6d2-bb2014f1d3b4`; exclude them from outside-traffic reports. No existing saved projects, budgets, database records or infrastructure settings were changed by the release.
