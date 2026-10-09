# ADR 005: symbolic helpers compile to explicit operations; musicality is score evidence

Accepted 2026-10-09 by explicit user direction ("Implement the quick wins", after a review of the October 9 live builds; the user noted that the producer is a relatively small model and asked for ways to help it make richer music).

## Context

The October 9 builds met every explicit requirement but were musically thin (see [STATUS](../STATUS.md)):

- Soft Corner v1 moved its hook up three semitones and shipped 9 out-of-key notes and 5 minor-9th or tritone clashes over the bass. The review saw "a uniform transposition" but not the clash.
- Drums were fixed-velocity, quantized Beatbox8 loops; bass and drums repeated one 2-bar cell; chords were root-position blocks; two roles shared one patch.

The producer was doing music-theory arithmetic by hand: every chord tone, voicing and swung tick. A small model does that arithmetic poorly and spends its output budget on it. Until now the scene tool also promised "no templates or automatic genre choices": every note had to be written out by the model.

## Decision

**The model chooses the musical decisions; deterministic code does the arithmetic.** New symbolic inputs compile into the existing validated operations *before* a step is stored, so the step ledger, versions, diffs, protection checks and Audiotool synchronization still see explicit notes and settings:

| Model writes | Compiled into |
|---|---|
| `chordProgression`: chord symbols, a key, a comp pattern and/or a bass pattern, one shared feel | `harmonizeSection` (held chords) or `sequenceSectionPattern` (rhythmic comping, bass) |
| `varyMotifInstance` / `developSectionNotes` with `key` + `diatonicSteps` or `invertAround` | stored as these parameters and evaluated on apply and replay into in-key pitches |
| `feel` (swing, grid, humanize, accents) on a scene pattern or a progression | fixed per-note timing offsets and velocities in the compiled notes, seeded so the same input is identical |
| `feel` on `developSectionNotes` | stored as a parameter and evaluated on apply and replay, seeded |
| a scene part's `recipe` or an `applyRecipe` operation | `setDevice` plus `addEffect`/`replaceEffect` with the recipe's effect chain |

`packages/core/src/native/harmony.ts` holds the theory: chord-symbol parsing, scales and modes, voice leading, comp and bass patterns, and feel. `construction-tools.ts` compiles. Nothing chooses a genre, a progression or a pattern for the model; these are vocabulary, not templates. Misuse returns a correctable `SYMBOLIC_EDIT_INVALID` with the next step to take (for example, a progression that does not add up to whole bars, or a part that already plays in the target section). Beatbox8 still refuses feel: its strict on/off step contract is unchanged.

**Musicality analysis is evidence, not a gate.** `musicality.ts` reads the score and reports the estimated key and a short list of issues:

- harsh intervals over the sounding bass;
- runs of out-of-key notes;
- parts repeated unchanged across sections;
- fixed velocities;
- mechanical drums;
- crowded registers;
- large voice leaps;
- no low end.

The producer's per-turn checklist carries a compact form once music exists. The focused review gets the key, the issues and the limits. The review is told to treat a high-severity clash or out-of-key run in a melodic part as a concrete finding unless the brief asks for that tension. None of it is a completion requirement, and none of it is a claim about heard audio.

**Recipes stay original, versioned and unheard** (`local-palette-v3`, 18 recipes with style tags and effect chains). A recipe is a named starting point the model chooses and then adjusts.

**The tool envelope stays within the existing input bound.** The production default is 96k, and the batch menu was already near it:

- keys are short strings (`"D minor"`);
- a progression has one feel shared by comp and bass;
- the batch menu leaves out `develop_native_theme` and `shape_native_sections`, because `apply_native_batch` already accepts every one of their operations with the same inspection (they still run if called);
- the recipe shortlist is one line per recipe;
- guidance appears once, in the system prompt's Craft paragraph.

The batch-menu envelope is 74.7 KB, against 75.9 KB before.

## Consequences

- Chord progressions, recipes and scene feel compile to explicit operations. The variation operations' `key`, `diatonicSteps`, `invertAround` and `feel` are stored as parameters, so the functions that evaluate them (`diatonicShift`, `diatonicInvert`, `feelFor` and their seeds) are part of replayable history: changing their results needs a new field or version, not an in-place edit.
- Symbolic arguments are compiled under the session's write lock. A retried call with a committed step key compiles against that step's predecessor document, so identical arguments replay rather than failing on their own earlier result.

- A chord part or bass line is one short operation instead of dozens of hand-computed notes. Its output is still explicit, inspectable and editable like any other note.
- "In key" is a property the code guarantees for helper output and measures for everything else, rather than something the model has to remember.
- A progression writes only into sections where the chosen parts are silent; reharmonizing means clearing the notes in the same batch first.
- Rhythmic comping and bass cycles are limited to 8 bars and 96 notes per cycle; held chords to 16 bars. Held (`sustain`) chords always keep their full length: feel varies only their velocity, because swing or a timing nudge cannot usefully move a held chord. Other notes longer than a bar are re-struck each bar.
- Bass roots take the line with the least movement around the whole repeating cycle, pulled gently toward the register's centre, so a progression does not leap when it repeats.
- Focused-review findings cite the notes they mean (`evidence`: section-relative tick and pitch). The application checks each citation against the score. A finding citing a note that is not there is discarded and recorded in `discardedFindings`; the rest of the review stands. A revision's reviewer also receives the application's diff against the version being revised (`previousVersion`), so "keep it unchanged" is judged against that version, not against repetition across sections.
- The analysis is heuristic (Krumhansl key profiles, simple interval rules). It can flag intended tension or miss subtler problems; the producer and review weigh it against the brief.
- Grooves with swing and dynamics need a Gakki kit, which needs the Audiotool library connection. Without it the guidance says to vary Beatbox8 patterns between sections instead.
- Whether this makes the music better is unverified until a live A/B build runs (live spend needs the user's approval).
