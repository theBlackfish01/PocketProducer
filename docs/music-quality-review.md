# Music quality review — 2026-10-11

A review of how Pocket Producer builds music today, why its output is still simple, and what to change. Evidence comes from the nine hosted GPT-6 Luna builds of October 9–10 (traces imported read-only to `.local/reviews/hosted-2026-10-11/`), the code, and the Audiotool SDK's bundled defaults. Nothing here was heard; "quality" means what the score and the traces show.

## 1. What the hosted builds produced

| Build | Form | Parts | Notes | Drums | Automation | Buses / master | Left unresolved |
|---|---|---|---|---|---|---|---|
| Copper Window (811 s, 37 calls) | 16 bars, 4 sections | 5 | 504 | Beatbox8 | none | none | **high**: ending not on Dm |
| Copper Window (142 s) | 16 bars, 4 sections | 4 | 479 | Beatbox8 | none | none | low: straight drums |
| Copper Window Release Check | 16 bars, 4 sections | 4 | 470 | Beatbox8 | none | none | medium: stabs not syncopated |
| Willow Return (3/4) | 12 bars, 3 sections | 3 | 68 | none | none | none | none |
| Harbour Pulse | 12 bars, 3 sections | 3 | 76 | none | none | none | none |
| Harbour Pulse revision | 12 bars | 3 | 84 | none | none | none | none |
| Afterglow Arcade (420 s) | 24 bars, 3 sections | 4 | 711 | **Gakki kit** | gain, filter | none | **high** + medium: ending |
| Afterglow Arcade revision | 24 bars | 4 | 713 | Gakki kit | gain, filter | none | none |
| Quiet Orbit | 24 bars, 4 sections | 2 | 112 | none | none | none | none |

Patterns across the nine:

- **Small ensembles.** 2–5 parts, 12–24 bars. No build used a shared reverb or delay bus, a group or master processing. One build used automation.
- **One synth does almost everything.** Heisenberg plays chords, leads, bells and often bass. Pulverisateur appears only as bass. The 128 GM instruments were never searched, and the reference examples were never opened.
- **Two reads for every write.** About 80 read-only calls (44 of them `inspect_native_part`) against 40 writes (22 batch, 15 scene, 2 theme, 1 sound). `shape_native_sections` never ran.
- **Most output is hidden reasoning.** 153k of 189k producer output tokens (81%) were reasoning. The music itself is about 280 visible tokens per call.
- **Builds stop early.** A median of 3 writes per build. The first scene is usually most of the piece.
- **Two of nine were saved with an unresolved high finding**, both about the final chord (see 3.3).
- **The helpers are used.** Scene `harmony` in all six new pieces that have a chord part, and recipes and feel in every new piece. In-key moves appear in one.
- **Gakki is used once in four.** All nine ran with the kit-search fix. Afterglow Arcade searched for, inspected and used a Gakki kit; the three Copper Window builds still chose the Beatbox8 `dry-step-kit`.
- **Budget is not the limit.** A standard run allows 80 calls, $5 and 30 minutes, with four reviews. These builds used 6–37 calls, $0.01–0.08, and one or two reviews.

## 2. The "can't hear anything" session (Quiet Orbit)

Session `272e79e8` could not be matched by id (traces carry job ids, and the review browser was not signed in to the deployed app). Quiet Orbit is the most recent hosted build (October 10, 20:32 UTC, job `5b099c81`) and fits the description.

The trace shows no error and no failed call. The piece is soft by construction:

- two voices only: a pluck pulse and a bell motif, 112 notes in 24 bars;
- note velocities 0.25–0.47, on a Heisenberg whose velocity sensitivity defaults to full;
- patches that die quickly: the pulse sustains at 0.04 with a short decay, the bell at 0.08;
- no bass, no pad, nothing sustained.

The channel levels are not the cause. Part gains of 0.40 and 0.38 become the mixer channel's pre-gain, and Audiotool's own default pre-gain is 0.398.

So the likely answer is that the project is very quiet rather than broken. The trace cannot prove what was heard. Nothing estimates loudness before saving, which is a gap (see 5.3).

## 3. How it builds music today, and how well each part works

### 3.1 The loop

| Stage | What it does | Verdict | Evidence |
|---|---|---|---|
| Direction check | One small call turns the direction into hard checks (bars, tempo, meter, sections, roles, keeps) | Works | No hosted build failed a form requirement |
| Plan and creative state | Free-text plan, then bookkeeping | Weak lever | The plan must exist, but its content is never compared with the music. Plans promise things nothing enforces ("swung beat", "D-minor landing") |
| First scene | One `compose_native_scene` writes form, parts, patterns and harmony | Works, and sets the ceiling | First music in 21–74 s. Later turns rarely add a layer |
| After each write | The model gets changed field names and counts, not notes | Costly | This is why there are two reads per write |
| Development | `develop_native_theme`, section variations | Barely used | 2 calls in 9 builds |
| Musicality notes | Eight deterministic defect checks in the checklist | Works for defects | A flagged clash was fixed on the next turn. None of the checks asks for more music |
| Completion checks | Captured brief items only | Works for form | There is no minimum for parts, notes, density or contrast |
| Focused review | Same model at low reasoning, 1,600 output tokens | A consistency check, not a quality bar | It sees the first 8 and last 4 onsets per part per section. Its prompt says an instrument "does not require extra effects" merely for a subjective character. "No concrete weakness" for a 2-voice, 112-note piece |
| Review response | Only the first review with a non-low finding blocks, once | Lets problems through | 2 of 9 saved with an unresolved high finding |
| Finishing rules | Prompt and checklist push toward finishing | Works as designed, and that is the problem | "At most one coherent targeted refinement pass"; "Prefer one focused review/refinement cycle, then finish" |
| Depth option | "Focused" versus "Detailed composition" | No musical effect | With default config both get the same input cap and $5. Only the deadline and review count differ, and no prompt mentions the profile |

### 3.2 The guidance

- The craft guidance leans sparse. `creative-development.md` says "One memorable relationship can matter more than eight parts" and "Avoid equating more notes with more excitement". It also cites two examples that do not exist.
- There are three reference examples: two 4-part disco studies and one 2-part sparse study, with motifs of 3–17 notes. They sit behind a search tool that no build called.
- The 18 recipes are 13 Heisenberg, 3 Pulverisateur and 2 Beatbox8. None is a Gakki kit or a GM instrument, and all are unheard.

### 3.3 The helpers

- **`chordProgression`** is the most successful addition: every piece with chords uses it and its output is in key and voice-led. It is rigid on form. It repeats one cycle through every named section, writes only into silent sections, and cannot end on a different chord. The producer then patches endings by hand while the progression's last chord still sounds. Both unresolved high findings come from this.
- **In-key moves and feel** work when used. Revisions lift melodies cleanly. New pieces rarely develop a phrase at all.
- **Drums** are the weakest musical area. Patterns are 8–26 hand-typed events with no fills, and three of four drum builds used Beatbox8.

### 3.4 The sound surface

What the producer can and cannot shape, from the model and the SDK defaults:

| Device | Writable | Not writable | Consequence |
|---|---|---|---|
| Heisenberg | 49 parameters: four FM operators, unison, filter cutoff and resonance, main envelope, LFO rates | LFO depth and target, filter type, the second and third envelopes | Rich timbres are possible; movement is not, because LFO depth stays 0 |
| Pulverisateur | Gain, tune, glide, drive, filter | Oscillators and both envelopes | Without a library preset, every note is one oscillator with a 500 ms decay to silence. A "round bass" held for two beats is a half-second pluck. Three bass recipes use it |
| Gakki | Gain | Everything else | Usable only with a GM preset: 8 kits and 128 instruments |
| Beatbox8 | Kick, snare, hat tone | Toms, rim, clap, cowbell, cymbal, accent steps | Four on/off voices at one velocity |

A note is tick, duration, pitch and velocity. There is no slide, bend or per-note pan, one global tempo, and no key field.

### 3.5 The Audiotool copy

The copy maps devices, effects, notes, sends and automation faithfully and verifies a structural readback. Three leads are worth checking, none verified by listening:

- Channel gain automation writes normalized 0–1 points onto a pre-gain whose raw range goes to +18 dB, with no conversion from the part's raw gain.
- Automation points without an interpolation become steps.
- Mixer channel names, EQ and compressor are not mapped.

## 4. Diagnosis

**Everything in the loop checks that the music is not wrong. Nothing measures or rewards how much music there is.** A two-voice sketch and a five-layer arrangement both pass every gate, the guidance prefers the sketch, and the prompt tells the producer to stop at the first passing state. The model is doing what it is told.

Four supporting causes:

1. **The building blocks are small.** Drums, fills, counter-lines, transitions, space and mix all have to be invented event by event, so a small model leaves them out.
2. **Effort goes to reasoning and reading, not writing.** 81% of output is hidden reasoning, and two calls in three are reads because writes return no notes.
3. **Part of the palette is thin or unreachable.** Pulverisateur cannot sustain, LFOs cannot move anything, and the GM instruments are never surfaced.
4. **The depth option changes nothing musical.**

## 5. Ideas, by leverage

### 5.1 Give ambition a number (highest leverage)

- **An arrangement scorecard.** Deterministic richness measures beside the defect list:
  - layers per section;
  - onsets per bar by role;
  - rhythmic variety;
  - harmonic rhythm;
  - register span;
  - contrast between adjacent sections;
  - how many motifs were developed;
  - distinct patches;
  - automation and shared-space use;
  - dynamic range.
- **Targets from the brief and the depth option.** "Focused" might mean 4 layers and one contrast. "Detailed" might mean 6–7 layers, a counter-line, fills, a transition into each section, shared reverb and two automated arcs. A brief that says "sparse" lowers the targets.
- **A soft gate on finishing.** The first finish below target returns "below target on: layers in Lift (2 of 4), no transition into Return", the way review findings do today. The producer acts or states why not.
- **Rewrite the guidance that argues for less.** Keep "space matters", and add what a full arrangement contains.

### 5.2 Build in stages instead of one open loop

A small model does better with one narrow job per turn. The stage machinery already exists; give each stage its own checklist, minimum deliverable and tools:

1. **Sketch:** form, harmony, core groove, main motif.
2. **Arrange:** add the supporting layers (counter-line, pad or arp, percussion) and decide who plays in each section.
3. **Develop:** vary the motif per section, add fills, transitions and a written ending.
4. **Sound:** shared space, gain staging, two or three automation arcs.
5. **Review.**

Per-stage tools also remove the menu switches and their cache misses.

### 5.3 Bigger building blocks ("larger presets")

All of these compile to ordinary operations, as `chordProgression` does.

- **Section-aware harmony.** Per-section progressions, a final cadence, turnarounds, richer voicings on later passes, and `replace: true` to reharmonize. This removes the cause of both unresolved high findings.
- **Groove generator.** Style grooves (boom-bap, four-on-the-floor, two-step, half-time, funk sixteenths, brushed waltz) with density, swing, ghost notes and a fill every N bars, written for a Gakki kit with velocity layers. Choosing a groove picks and pins the kit in the same step, so Gakki no longer depends on the model searching first.
- **Accompaniment generators.** An arpeggiator (direction, rate, octave range), a pad layer, a guide-tone counter-line from the chords' thirds and sevenths, and call-and-response (the answer is the motif moved onto the next chord).
- **Melody helpers.** Snap strong beats to chord tones, rhythm templates for syncopation, phrase forms (question and answer, AABA), and sequence, fragment and augment operations.
- **Section arranger.** One operation that says who plays in a section and how: `drums: half-time`, `bass: out`, `lead: octave up`, `pad: thin`. This is the cheapest route to contrast.
- **Transitions.** `addTransition` between two sections: drum fill, riser (filter or reverb-send ramp), one-bar drop, pickup notes, crash on the downbeat.
- **Space and mix presets.** One operation for a shared room or hall with sends by role, and one for gain staging by role. Add a loudness estimate (gain × velocity × envelope) so a mix like Quiet Orbit is flagged before saving.
- **Automation arcs.** `automateArc {part, target, shape: rise | fall | swell, sections}` in place of hand-placed points.
- **Worked reference pieces.** Twelve to twenty complete 16-bar pieces across styles, which the producer instantiates and then transforms (new key, progression, groove, patches). Their measured profiles also supply the scorecard targets per style. Offer them in the first message; a search tool was never called.

### 5.4 Widen and repair the palette

- **Fix Pulverisateur.** Map its oscillators and envelopes, or retire it from the bass recipes in favour of Heisenberg or a GM bass.
- **Make LFOs do something.** Map LFO depth and target, which gives wobble, vibrato and filter movement.
- **Surface the GM instruments.** Piano, electric piano, strings, guitar, brass and mallets are already reachable through the kit search. List a short set by role next to the recipes, and add recipes that pin them.
- **Use the whole drum machine.** Map Beatbox8's clap, rim, toms, cymbal and accent steps.
- **Expressive notes.** Map slide for basses and leads.

### 5.5 A reviewer that asks for more

- Give the reviewer more of the score than 8 onsets per part, some reasoning, and the scorecard. Ask for the three highest-impact additions as well as defects.
- Let it ask for added layers, effects and density when the scorecard is below target, at least for "Detailed".
- Keep blocking on an unresolved high finding for one more round, and say which operation would resolve it.
- Sample and select: for a weak section, generate two or three alternatives in parallel and keep the one that scores best with no clashes. At $0.02 a build this is affordable.
- Track "saved with an unresolved high finding" as a quality metric.

### 5.6 Spend effort where it shows

- Return the written notes, compactly, with each write receipt, so the producer does not need two reads per write.
- Lower the reasoning effort on reads and bookkeeping; keep it high on composing turns.
- Write creative state once, on finish.
- Make removing the seed part a correctable reply. It failed with a raw error in several traces and cost a turn each time.

### 5.7 Let the user ask for depth

After a first version, offer one-tap passes: "Add a counter-melody", "Make the drums groove", "Add transitions", "Open up the mix". Each is a cheap, focused revision the current loop already handles well, and it puts the richness decision in the user's hands.

### 5.8 Hearing it (deferred by decision)

Rendering and listening would be the strongest quality signal and remains deferred. The loudness estimate in 5.3 is the cheap stand-in for the one failure seen here.

## 6. Suggested order

1. **Scorecard, targets, the soft finish gate and the depth option** (5.1). Without a number for "enough", new tools go unused, as the examples did.
2. **Section-aware harmony and the groove generator** (5.3). They fix the two most visible weaknesses: endings and drums.
3. **Pulverisateur and the GM palette** (5.4). The bass is in every piece.
4. **Staged passes** (5.2), with the section arranger and transitions.
5. **Space, gain staging and loudness**, then the reviewer changes (5.5).
6. **Reference pieces**, then the one-tap passes.
