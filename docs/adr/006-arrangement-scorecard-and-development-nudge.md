# ADR 006: an arrangement scorecard and a development nudge

Accepted 2026-10-12 by explicit user direction (iterate on musical complexity with measured local builds, without regressions).

## Context

The [music quality review](../music-quality-review.md) found that every gate checks that the music is not wrong and none measures how much music there is. Nine hosted builds were 2–5 parts with a median of three writes. The prompt told the producer to finish after one refinement pass, and the craft guidance argued for fewer parts. Builds used 1–2% of their budget.

## Decision

**A scorecard says what is still thin.** `native/richness.ts` reads the score and reports, for a depth of `focused` or `detailed`:

| Gap | Fires when |
|---|---|
| `THIN_ARRANGEMENT` | the fullest section has fewer parts than the depth's target (4 focused, 6 detailed) |
| `FLAT_SECTIONS` | two adjacent sections differ in fewer than two of: who plays, density, register, material |
| `NO_TRANSITIONS` | no section change (focused) or not every one (detailed) breaks its loop in the bar before, and no control curve moves there |
| `NO_ENDING` | the final bar repeats the loop |
| `STATIC_SOUND` | no automation curve and no shared-space send (focused); fewer than two of each (detailed) |
| `SHARED_PATCH` | detailed only: two pitched parts use one identical patch |

Pieces under 8 bars get no gaps. Bars are compared with a 90-tick tolerance, so humanised repeats of a phrase still match. An audio part counts as a layer in every section one of its clips overlaps.

**The depth comes from the run profile.** "Focused arrangement" is `focused` and "Detailed composition" is `detailed`, so the depth option now changes the musical target. Revisions get no scorecard; they are scoped edits.

**The producer sees it every turn.** Once music exists, the per-turn checklist carries an `arrangement` entry of about 350 bytes: layers against target, the gap codes, and the next step for the first gap. It rides on every request, so the full explanation of each gap is given once, at the first finish.

**Advice never costs a request its place under the input ceiling.** When a request is still over the ceiling after every other compaction, the checklist drops `arrangement`, then `musicality`, then its two standing guidance lines, and lists what it dropped in `omittedAdvice`. Requirements and state are never dropped. An independent review found that the scripted ceiling tests ran with the scorecard off. The new test for that case (full batch menu, music present, an oversized exchange) failed at 96,243 against 96,000; by the measured sizes the same scenario was already about 770 over before this work, because the musical notes could not be dropped.

**The first finish nudges once.** For a new piece with gaps, the first `finish_native_arrangement` returns `category: "development"` with the gaps and spends no review. It never returns twice: the next call proceeds whether or not the music changed. It is skipped when a finish is performed by the server after a plain-text reply, because nobody would read it, and once any review has been paid for on the request, because following it then would cost another.

**The brief wins.** The scorecard cannot read the brief, and no code parses the direction (ADR 004). Every surface says the targets are guidance and that a brief asking for a sparse piece or naming the exact parts means developing within those parts.

**The guidance stops arguing for less.** The system prompt describes two or three development passes (supporting layers; section contrast, fills and an ending; movement and space). "At most one refinement pass" and "one memorable relationship can matter more than eight parts" are gone, and the reference describes what a full arrangement contains.

Two smaller additions ride along:

- `QUIET_MIX` joins the musicality notes when the loudest part's gain × average velocity is under 20%. This is the one failure a listener reported. A piece with audio clips is not judged, since a clip's level is in its recording.
- Removing a piece's only part on its own is a correctable `LAST_PART_REQUIRED` reply instead of a raw schema error.

**Bigger building blocks make the targets reachable.** Each compiles into ordinary operations under the session's write lock, as chord progressions do ([ADR 005](005-symbolic-helpers-and-musicality-evidence.md)):

| The producer writes | It becomes |
|---|---|
| a scene part with `kit` (one of the eight GM drum kits) or `instrument` (a GM instrument slug) | the tool fetches that sound, pins its exact identity and adds an ordinary Gakki part; without a library the reply is correctable |
| a scene `grooves` entry: style, density, ghost notes, cycle length, fill | explicit kit notes with the style's swing, velocity layers and a fill closing each listed section; on Beatbox8, two reusable step patterns |
| scene `space: "room"` or `"hall"` | one shared reverb bus and a send per part by role; later scenes add only the missing sends |
| a chord progression `ending` | the last listed section written as explicit notes that land on the chosen chord and its bass note |

`native/grooves.ts` holds nine styles and five fills as pure, seeded generators; `native/groove-tools.ts` compiles them. A voicing with more tones than voices now drops the fifth and keeps the root, because a rootless Dm9 reads as Fmaj7.

The shortcuts refuse what they cannot do well, as correctable replies: a groove on a part that is not percussion, a groove that would pass a part's 4,096 notes, and a scene whose `space` has nothing left to add. `space` gives a protected part no send and applies the rest.

**Three safeguards against a requirement that cannot pass.** Two live builds were cancelled after spending 48 and 65 calls on one requirement each. The first direction said "main section" and the section was named "Main". The second asked to "build gently toward the end"; the six-section waltz did climb, but the check compared only the opening with the exact middle section, and no step that small counted.

- A section reference with no exact match resolves to the one section whose name shares all the words of the shorter of the two names ("the main section" → "Main"). Exact names and ids are tried first and behave as before; two candidates mean no match; ids take no part. No word list is involved: the first version dropped "section", "part" and "the", which made "A" and "Part A" collide and was a keyword list of the kind ADR 004 removed.
- A requested rise is evidenced by the middle section when it stands apart from the opening, and otherwise by whichever later section differs most. A build that arrives in the last section counts. The blocked reply states the five measures and adds `riseMeasured` (the closest section and what already differs), so the next edit has a target.
- Six finish attempts in a row blocked by the same unmet requirement stop the run as resumable partial work (`NATIVE_INCOMPLETE:REPEATED_NO_PROGRESS`), even while other music keeps changing. Each requirement is counted on its own; one that clears, or a finish that meets them all, starts its count again.

**The reviewer is given chord names instead of deriving them.** A live review reported that F–D–A–C "is not Dm7" and that a D minor piece was in F major. The musicality evidence now carries:

- `chordsByBar`: per section, the chord each bar's harmony parts and bass spell. `nameChord` returns the plainest exact match with the fifth optional. Where the chord and the bass together spell a chord on the bass note, that is the name (F–A–C over D is Dm7, as a rootless voicing is written); otherwise the bass is a slash bass. Two different chords in a bar are named separately (`C F`). Repeats collapse (`Dm7 x2`); `-` is silent and `?` is not a plain chord.
- `finalChord`, also shown on the producer's checklist.
- `key.relative`. A key and its relative share every note, so when both fit and the bass opens on the relative's tonic, the relative is reported. The reviewer is told that music in either is in key.

Given those names, a later review still called the same inverted Dm7 "an Fmaj7 voicing" from its pitch numbers. So the names are also applied after the review, where no instruction is needed: when a finding cites three or more notes that sound as one chord, the application adds `citedChord` to the stored finding, and the reply that hands the review to the producer says a finding naming those notes differently has misread the harmony. The reviewer's response schema is unchanged; it never writes this field.

**A section pattern can write over what is there.** A live review asked for a sparser opening. The producer answered with a two-stab `harmonizeSection`, which joined the existing 64 chord notes instead of taking their place; the opening went to 96 notes and the finding stood. Two changes:

- `harmonizeSection` and `sequenceSectionPattern` take an optional `replace: true`, which first removes the part's free notes that start in that section. Motif placements are untouched. The flag has no default, so an operation saved without it keeps its hash and note ids.
- When either operation joins notes the part already has in that section, the reply carries `layered`, naming the part, the section, the count and the flag.

## Consequences

- Scripted runs opt in (`richness` on the offline input), so existing fixtures are unchanged. One integration test opts in at the 96,000 ceiling with the batch menu open.
- The nudge costs one extra producer turn at most when the producer declines it.
- A producer that follows the nudge spends more calls and money per build. Budgets and limits are unchanged.
- The scorecard is structural. It cannot tell a good counter-line from a bad one, and it can be satisfied mechanically. The focused review and the musicality notes remain the checks on what was written.
- The nudge state lives in the producer run. A resumed request that has not yet paid for a review may be nudged once more.
- Grooves and kits live in the scene tool only. The batch menu gained only the two `replace` flags, without descriptions; the always-loaded skill summaries gained only the `ending` clause.
- A compiler change alters what the same arguments compile to (here, voicings with more tones than voices). Stored steps replay unchanged. A producer that re-sends an identical symbolic call for a step committed before the deploy is refused as a reused step key instead of being told it replayed, and recovers by inspecting. Deploying with no builds in flight avoids it.
- `replace` is forward-only. Code from before this change drops the flag when it reads a stored step, so rolling back while a job that used it is unfinished breaks that job's history check.
- A groove's fill and a progression's ending satisfy the scorecard's transition and ending checks by construction. That is the intent, but it also means those two checks no longer discriminate once the helpers are used.
