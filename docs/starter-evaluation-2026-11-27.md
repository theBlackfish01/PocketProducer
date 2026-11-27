# Arrangement starter evaluation, November 27, 2026

All 12 generations and both revisions saved a version. The shared ledger recorded $0.368622 across 231 settled calls, including $0.004219 in direction interpretation. All 14 completed job traces were imported (1,339 spans). Every saved score passed offline Nexus readback.

## Method

The local worker ran live Luna generations against an isolated database, with a shared $1 ceiling including direction interpretation and symbolic review. Each new brief received a fresh project. The revision used the saved French-house baseline and locked its bass. The jobs used local instrument recipes. Private LangSmith exports were matched by job ID, including tool arguments, error responses and successful scene receipts. A request for a starter counted as adoption only when its scene actually applied.

The separate score checks expanded motif placements and repeats into timed notes and mapped each accepted document through the pinned offline Nexus adapter. They checked meter, tempo, instrumentation, timing, section contrast, ending and revision scope. These checks establish what was written. Listening preference, sound balance in Studio and remote copy success require separate evidence.

## What the worker did

- **French house.** Before the changes, Luna wrote a three-note hook but redeclared the starter voices. Its first scene failed. It recovered, then applied recipes that doubled the chorus/reverb on keys, the tube/delay on lead, and compression on bass. On the identical brief, the rerun applied the starter on its first scene and wrote a separate hook and higher answer. The saved score has a silent lead and bass in the break. Across the two runs, traced model calls fell from 19 to 8 and tool calls from 20 to 9. The rerun used one compressor on bass and one copy of each effect on keys and lead. One pair cannot establish typical savings.
- **Chamber waltz.** Luna chose the 3/4 starter. It wrote an eight-note glass melody, rested it for bars 5–8, then brought back all eight pitches exactly one octave lower. The final arrangement contains bowed bass, strings and glass, with no drum part. Its trace shows that it added bass during the glass rest. Targeting one voice's silence did not empty the entire section.
- **Protected revision.** The last two bars of the original house lead were silent. Luna wrote F4–A4–D4 there, lower than the preceding answer. All four parts have identical material for the first ten bars. Bass, keys and drums remained identical as complete parts; the revision has a new version ID.
- **Broken beat.** The baseline tried a remote kit, redeclared starter voices and then tried to layer a groove over existing drums. It finished by composing from scratch. Its falling glass phrase crossed the bar line, but the ten bass notes averaged 3.98 quarter notes long. The identical rerun kept the starter, wrote a different falling answer and left room between bass notes (26 attacks averaging 0.71 quarter notes). The harmony had 73 off-grid note onsets versus 8 originally. The rerun still received an inaccurate symbolic-review observation about its glass patch, which prompted the evidence change below.
- **Bass-led house.** Initially Luna chose a free scene to write its own bass hook. The bass had no fresh attack on the last chord. With the optional authored-bass setting, the rerun kept the drums and chords, wrote a new bass hook, thinned the middle and landed bass, keys and kick together. Traced duration fell from 433 to 164 seconds. Both runs honored the three-part limit.
- **Bass-led neo-soul.** Both scores contained only keys, bass and kit, with an original bass hook. Luna chose free composition first, then the broken-beat starter with authored bass on the rerun. This pair showed little efficiency difference (196 vs. 188 seconds). The second run actually took three more model calls. It spent two attempts trying to alter on/off drums with MIDI-note tools. The final keys and bass spelled E–G–D–F♯, an Em9 color with the fifth omitted.
- **Free composition controls.** With an explicit request to compose the same D-minor house brief from scratch, Luna used a free scene. It wrote 57 bass notes and 154 drum hits, compared with 20 and 57 in the successful starter rerun. Both left the bass and lead out of the middle, then answered higher. An unrelated 5/4 solo electric-piano brief produced exactly one part, eight bars at 94 BPM and a three-note answer an octave below the question.

## Range of the three starters

Holding each reference's chords, sections, tempo, lead setting and ending fixed, all nine combinations of starter and pocket passed offline Nexus mapping. Bass note counts for spare, signature and driving were 46/74/81 in house, 27/51/57 in broken beat and 13/19/25 in waltz. These figures describe within-style variation. Changing pocket alone kept the keys' note counts unchanged in every family. Signature and driving also retained identical drum patterns. The section arc, chords, authored melody or bass, and subsequent edits do much of the work of differentiating two projects in the same style.

Across the generation and revision scores, no placed lead motif of at least three notes matched a complete reference lead motif after ignoring absolute pitch and initial delay. The comparison used durations, intervals and onset offsets. It establishes that the reference hooks did not simply recur in these scores. It cannot measure how similar two tracks sound.

## A remaining musical weakness

On the final broken-beat generation, Luna created an extra glass lead and left the supplied lead empty. It picked `close` for a three-bar return. The score had four drum hits over that return versus six in the preceding break. The reviewer correctly identified the weak return. Luna saved the score with that suggestion outstanding after two unsuccessful drum edits. The earlier false complaint about the glass-bell patch did not recur.

The tool now explains that `lift` restores the groove, `close` thins the full section, and the final chord is independent. It also explains when to omit the supplied lead. Replaying the same successful scene arguments locally with `lift` and the extra empty lead disabled produced 24 return drum hits and four tracks. The earlier performance stayed identical on every remaining part. This is a controlled replay, separate from the live generation.

In a subsequent **live scoped revision**, Luna was asked to restore the Pocket kick and backbeat in the first two return bars and leave the final bar silent. It inspected the motif and used one `replacePlacements` operation. The three return bars went from 2/2/0 hits to 9/9/0. The requested kick and snare matched the Pocket exactly in both bars. Earlier drum performance and every pitched part remained identical. It saved in 53 seconds, with seven traced model calls and no rejected tool calls.

## Paired live runs

Counts come from the imported producer traces. The durations cover the traced job, and per-job costs exclude the separate submit-time interpretation. The bass-led pairs used identical musical directions before and after enabling an authored bass. The free-house control added an explicit instruction to compose from scratch.

| Brief | First run: model calls / time | Second run: model calls / time | Recorded cost per job |
|---|---:|---:|---:|
| Restrained French house | 19 / 4m 30s | 8 / 1m 42s | $0.0386 → $0.0138 |
| Late broken beat | 18 / 4m 22s | 13 / 2m 38s | $0.0371 → $0.0239 |
| Bass-led French house | 26 / 7m 13s | 16 / 2m 44s | $0.0573 → $0.0287 |
| Bass-led neo-soul | 15 / 3m 16s | 18 / 3m 08s | $0.0281 → $0.0294 |

The explicitly free house control took 12 traced model calls and 2m 03s. The third broken-beat generation, which exposed the return issue, took 10 calls and 1m 56s.

## Changes prompted by the traces

- The first-scene instructions distinguish the starter's supplied backing from a free scene. The rejection for a duplicate starter voice names the conflict and tells the producer how to retain its hook. The success receipt tells it that the supplied voices already have patches, effects and mix settings.
- Applying a sound recipe to an intact v1 starter reuses compatible effect slots and preserves their IDs. A customized, different effect is preserved. Existing stored documents are only affected when an explicit edit is applied. Regression tests cover reapplying a recipe, switching the bass recipe, retaining custom settings and rejecting a duplicate voice. The original v1 score hashes are pinned.
- A producer can select `starter.bassLine: "authored"` and place its own notes or motifs on the existing bass voice. The original bass patch, keys, drums and ordinary note validation still apply. Omitting this option preserves each original v1 foundation and its pinned score hash.
- The model's sound menu omits GM search and inspection when a library connection is unavailable. Both the solo control and the original bass-led run spent a call on that dead end. The connected path still offers the catalog. Failed MIDI-style Beatbox8 edits now explain how to edit the placed pattern with valid on/off steps. The symbolic reviewer now sees the name of any exact local parameter recipe matching the part's device and ordered serial effects. A genuinely modified chain does not receive that label.

## Scope

Three starters give this producer useful coverage for French house, broken beat/neo-soul and chamber waltz. They leave meaningful gaps in other meters, instrumentation and drum feels. Free composition worked in the solo control. The bass-led runs suggest that leaving authorship of a single voice open is valuable before adding near-duplicate genre presets. The generic density review can still suggest four layers for a three-instrument brief; both bass-led runs kept the requested ensemble. All efficiency comparisons here are single pairs of stochastic runs.

The private per-run traces, scores and computed comparisons are in the ignored local directory `.local/benchmarks/starter-lab-nov27/`. The three reference compositions and reproducible offline readbacks are described in [Native text to music](native-text-to-music.md).
