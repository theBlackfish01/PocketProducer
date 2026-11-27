# Review and recovery experiments, November 27, 2026

The producer can take a musically complete sketch straight to review. The change removes the extra turn that asked for more development based on a generic layer count. The focused editor still compares the current score with the brief. A player can ask for a sparse arrangement, and the producer can spend its effort on the phrasing of that single instrument.

## What prompted the change

In the [previous starter evaluation](starter-evaluation-2026-11-27.md), six of twelve completed generations received a first-finish development nudge. Four were flagged solely for having fewer than four parts, including a three-part chamber waltz. Separately, the editor found a weak drum return in an arrangement where the brief called for the groove to come back. Part count offered little guidance on how to fix that passage.

## Matched generations

The comparison used the same four directions, model, run profiles and local recipe library on the original starter worker and on the revised worker. Each generation started in a new project in an isolated database. Both workers used real Luna calls. The counts come from the durable job ledger and include its musical reviewer. Times run from the start to the end of the imported producer trace. Direction interpretation is charged separately and included in the overall ledger.

| Direction | Original calls | Revised calls | Original time | Revised time | What the revised worker wrote |
| --- | ---: | ---: | ---: | ---: | --- |
| Solo electric piano in 5/4 | 19 | 10 | 4m 42s | 1m 39s | One instrument. F–A♭–C returns an octave lower, with velocities falling from 0.68–0.76 to 0.30–0.34. |
| Eight-bar neo-soul trio | 21 | 7 | 3m 38s | 2m 12s | Keys, bass and dry kit. The bass repeats a two-note offbeat hook and the keys close on Em9. |
| Broken beat with a falling glass answer | 11 | 11 | 2m 05s | 3m 00s | The four-part groove drops to two parts, then returns. The glass phrase starts just before a bar line and continues across it. Its last version adds a longer low note. |
| Detailed, open-ensemble soul | 18 | 11 | 3m 24s | 3m 20s | Two opening voices, four in the middle, one in the breakdown, four on the return, then Em9. The returning piano phrase initially repeated its opening notes verbatim. |

All eight saved versions passed offline Nexus mapping. The four revised jobs used 39 billed calls against 69 originally. Combined producer time fell from 13m 49s to 10m 11s and job spend from $0.128865 to $0.073553. These are four paired, stochastic runs. The broken-beat run took longer, and the earlier open-ensemble build wrote a separate response voice. Timing and part count alone would miss that musical difference. An intermediate open-ensemble run took 9m 39s, including repeated rejections before its first complete scene.

## Checking the checks

- **Can the editor identify a wrong chord?** Two rounds used the same Em9 voicing with its optional fifth omitted. In each round the editor accepted it. Changing just F♯ to F natural produced a high-priority finding in both rounds.
- **Can it find a weak return?** The known weak version used two drum hits per bar where the fuller groove had nine. The editor flagged the return in one of two trials. The other trial made a wrong chord claim. The application discarded the unsupported finding but had kept the model's headline repeating that claim. The validator now derives the displayed verdict from surviving evidence and gives a neutral reason when all findings are discarded. An exact section duration also accompanies the note evidence.
- **Can the producer repair the groove without touching the rest?** Two real revisions started from the same weak score with every other part protected. Both restored the original kick/snare pattern and changed the final three drum-bar counts from 2/2/0 to 9/9/0. Timed notes before that section and all other parts were identical to the base. The new worker used one scoped pattern-reuse edit. It used 10 billed calls and 60 seconds versus 8 calls and 53 seconds originally.
- **Should chord writing accept every occupied instrument?** Replaying four rejected solo-piano scenes with their proposed melody stacked over the proposed chords produced one to four same-pitch overlaps in each. Two larger rejected scenes had further independent construction errors. The existing empty-passage guard stays. The scene description explains how to write the chords first and then place a melody on the same instrument.

## A literal repeat and an over-broad drum edit

A follow-up compared the same detailed piano score under three conditions. When a developed answer was requested, the editor identified the verbatim opening motif on the return. Changing just that response's pitches and phrasing removed the finding. Asking for a literal repeat also removed the finding on the original notes. Both latter reviews mentioned the hats as a low-priority preference. There is no mandatory variation check for a refrain.

In a fresh generation with the revised guidance, the piano's five-note opening became a seven-note response and a six-note turnaround. The final harmony was Em9. It used 17 billed calls and took 4m 25s. That run also exposed a worse mistake. While trying to taper just the last two bars, Luna encountered the kit's five-pattern limit and replaced its whole placement list. It erased the earlier Gather and Answer grooves. The saved intermediate version is included in the local comparison bundle so the effect can be heard.

Replaying that exact tool call against the exact reviewed score hash now returns a correctable error before committing it. This check applies to a batch that replaces kit placements while addressing a current review specifically about that kit in named sections. It detects an earlier sounding section becoming entirely silent. Whole-piece composition, an explicitly global finding and ordinary edits outside that review retain their normal behavior. A new section rest uses the existing placement operation and needs no spare drum slot.

A separate live revision started with the original four-voice score and asked for silence in the two-bar Landing. Luna used the scoped rest, completed in 35 seconds with seven billed job calls, and received a clean symbolic review. All 189 preceding drum hits retained their pitches, ticks, durations and velocities. All three other parts and all eight motifs were identical. Only the 25 ending hits were removed. The resulting version passed offline Nexus readback.

## Coverage and cost

This pass ran 16 live generations, two live revisions and 11 isolated, paid score-review controls. All 18 full jobs saved versions and passed offline Nexus readback. Their 18 job traces contained 1,425 spans. The additional drum-free waltz used the chamber starter, left the lead silent for four middle bars and brought it back an octave lower. The solo keyboard follow-up recovered from an occupied-passage error by writing its chords and melody in two scenes.

The isolated ledger settled $0.433856 for this pass. Including the earlier template evaluation, the total was $0.802478 of the approved $1. All 490 recorded effects across both evaluations had observed costs.

## Runtime safeguards and listening evidence

The worker checks objective requirements, current section evidence, the reviewed score and direction, and protected material before selecting an immutable version. Existing lease, cancellation, replay, provider-liability and spending rules apply. One section edit can reuse a previously written Beatbox8 phrase across whole repetitions. Its validation rejects a range that would cut through a drum phrase or cross a protected passage.

These tests measured score content, callback traces, recovery and offline SDK readback. The downloadable MIDI files reproduce the saved notes and timing. MP3 listening copies use substitute General MIDI sounds. Audiotool's device mix and Studio playback require a separate listening comparison.
