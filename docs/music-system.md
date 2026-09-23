# Music systems

## Current native construction

Native schema v2 is a separate canonical 960-PPQ document: title/objective/assumptions, tempo and meter, contiguous sections, instrument/percussion/source parts, direct notes, reusable motifs and placements, source intervals with owned asset hashes, effects, parameter automation and protected part/motif IDs. Domain operations are the only mutation surface. The validator enforces timing, references, ranges and protected dependency hashes. Immutable PostgreSQL revisions retain structural diffs and producer/offline-SDK evidence. Native audio is explicitly `deferred`; neither note mapping nor source placement proves audibility.

The pinned `@audiotool/nexus@0.0.17` offline adapter maps notes, Beatbox8 patterns/regions, Heisenberg/Pulverisateur/Gakki, channel routing, selected effects and gain/pan/filter automation. `Ticks.Beat` is 3840, so canonical ticks convert by four. Source sample upload and audio-region mapping, native rendering and Gemini critique remain deferred. User-uploaded sources are represented locally and hash-checked at commit, but source-bearing versions cannot synchronize until mapping is implemented.

The v1 native mapper does not expose arbitrary device/effect knob fields. Nonempty `device.parameters` or `effect.parameters` are rejected by the canonical validator instead of being silently dropped. Supported editable numeric expression is part gain/pan and bounded gain/pan/filter automation. Source start/duration is rechecked against the owned asset at commit.

## Preserved legacy canonical music and renderer

Compositions are Zod-validated JSON with schema version 1, 960 PPQ, 4/4 meter, exact section boundaries, four musical roles and tick-addressed events. The current compiler writes 16 bars across Intro, Groove, Lift and Outro at 78–112 BPM.

The owned **Sunroom** palette contains deterministic kick, snare, filtered hi-hat, bass oscillator, melody oscillator and an optional user-source texture/percussion layer. Rendering is seed-stable at 48 kHz stereo PCM16. Every track is rendered independently before summing to a headroom-limited preview. The worker rejects silent output and stores duration, peak, RMS, non-silent ratio and 240 waveform buckets.

The source fixture at `.local/fixtures/owned-percussion.wav` is synthesized by `scripts/generate-fixtures.ts`; no third-party recording is bundled. The renderer accepts only bounded PCM16/Float32 RIFF/WAVE until FFmpeg is present.

Revision 2 of the verified demo removes six alternating Groove hats. Melody composition hash and melody stem SHA-256 are identical to revision 1. See `pnpm exec tsx scripts/verify-demo.ts` for the executable artifact proof.
