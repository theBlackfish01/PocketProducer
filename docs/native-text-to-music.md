# Text-to-native-music construction pass

This is the current local contract after reviewed baseline `3889331`. A recording is optional. A detailed direction is retained up to 32,768 characters; a vague direction can still start from the same producer. The accepted native v2 document, protected dependencies, immutable revisions, older playable audio and explicit Audiotool sync remain separate. Neither an SDK document nor a plan is a heard recording.

## Run envelope

The chosen **Standard** or **Extended** profile is captured with each new native job in its private request, including model, pricing evidence, reasoning effort, call/input/output limits, deadline and per-job ceiling. A restart uses that captured profile; config changes do not silently increase an old request's allowance. Standard targets 40 model calls, 64k conservative input-token bound, 16,384 output tokens including reasoning, 30 minutes and US$5 per logical job. Extended targets 80 calls, 96k input, 32,768 output, 60 minutes and US$15. Environment limits may make any of these smaller. The separate installation-wide `INITIAL_BUILD_API_BUDGET_USD` still defaults to US$5 and can only be raised explicitly; it is not reset by a new job or profile choice. Unknown provider outcomes retain their reservation; a known truncated response cannot dispatch its partial tool arguments.

These engineering envelopes are **not permission to spend** either proposed amount. Normal tests clear keys or use injected models and do not contact providers. A future live creative comparison needs a separate numeric allowance and no unresolved accounting liability. `pnpm budget:status` reads the ledger without spending.

## Producer and durable truth

The production Deep Agent can record a form/sound/constraint/development plan in `native_job_plan`, advance a stage, read the current workspace, inspect individual parts/motifs/sections and owned-source measurements, search local and connected resources, compose an optional initial form and apply small validated musical batches. The plan and confirmed operation ledger survive worker restart; the plan is progress, while only a checked immutable revision is accepted. A real-model run must review two current sections after its last mutation before recording completion. Scripted models traverse the same tools but do not prove artistic quality. Context compaction retains the original brief and ordered read/error evidence alongside current confirmed state rather than treating a stale workspace file as authority.

Hard role constraints are conservatively extracted from the brief: a global exclusion does not become a required part, and a localized exclusion such as “no drums in intro” applies only to that section while a later chorus request can still require percussion. Ambiguous durations and subjective goals remain advisory. A revision still has protected-part/section guards and checks explicit exclusion requests; this parser is not a full semantic evaluator of every possible brief.

## Current validated controls

| Area | Local operation / mapping | Boundary |
| --- | --- | --- |
| Musical form | Tempo, meter, up to 128 bars / 24 sections, parts, exact MIDI notes, motifs, local variations and section edits; one motif placement can receive exact source-note omissions/onset/pitch/duration/velocity edits without changing another placement | Structural timing; no audible judgment |
| Harmony and groove | `harmonizeSection` writes model-chosen exact polyphonic voicings over a repeated cycle; `sequenceSectionPattern` writes pitch, velocity, duration and bounded timing offsets within a section | Best with MIDI-capable instruments; Beatbox8 remains boolean-step only |
| Instruments | Heisenberg A–D waveforms/detune/phase-modulation links, selected envelopes/LFO, Pulverisateur drive/filter, Gakki with pinned sound discovery, Beatbox8 voice shaping | Only allow-listed SDK ranges mapped into real constructor fields |
| Effects | Ordered per-part compressor, EQ, filter, reverb, delay, pitch delay, chorus and tube saturation; a real part-level dry/wet split, processed branch and blend; automation of selected targets | Parallel is per part, not a shared group bus |
| Shared routing | Mixer groups with compressor/sidechain, shared reverb/delay returns and send automation, master gain/pan/limiter | Wider arbitrary bus graph and group FX automation remain unimplemented |
| Resources | Owned WAV source regions and resolved Audiotool sample/preset identities with fingerprint checks | Offline mapping evidence; no new live permission/readback result in this pass |

The pinned Nexus `0.0.17` offline mapper now creates and semantically reads back the additional effects and FM parameters. Bounded deterministic note identities prevent a legal long placement/note ID from breaking section development. All new operations pass native schema and protected hash checks; rejected batches do not replace the accepted version.

## Still open

The full 96-bar/roughly 12-part benchmark and contrasting sparse/vague briefs have not been artistically assessed with a real model, and the full requested shared/parallel saturation graph is not yet mapped. A safely paused Standard request can be explicitly extended to the configured Extended envelope on the **same job**; original request/effect identity, steps and accounting remain intact, and uncertain effects or changed heads refuse extension. Beyond Extended, or beyond the installation-wide budget, a fresh request must not be used to evade unknown effects. Provider cached-input discounts are not modeled: input is conservatively charged at the standard captured rate, so ledger estimates may overstate known billed cost. Live Nexus sound fidelity, remote resource rights and playable rendering remain unverified or deliberately deferred. Do not label any scripted form as successful original music in audio terms.

Verification commands and exact latest results belong in [STATUS.md](STATUS.md) and [testing.md](testing.md). `pnpm test:integration` uses the separate `_test` PostgreSQL database; browser tests use isolated fixture services and zero provider access.
