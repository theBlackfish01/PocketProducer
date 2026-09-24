# Music systems

## Current native construction

Native schema v2 is a separate canonical 960-PPQ document: title/objective/assumptions, tempo and meter, contiguous sections, instrument/percussion/source parts, direct notes, reusable motifs and placements, source intervals with owned asset hashes, effects, parameter automation and protected part/motif IDs. Domain operations are the only mutation surface. The validator enforces timing, references, ranges and protected dependency hashes. Immutable PostgreSQL revisions retain structural diffs and producer/offline-SDK evidence. Native audio is explicitly `deferred`; neither note mapping nor source placement proves audibility.

The pinned `@audiotool/nexus@0.0.17` offline adapter maps notes, strict boolean Beatbox8 patterns/regions, Heisenberg/Pulverisateur/Gakki, serial effect-to-channel routing, selected effect parameters, gain/pan/filter automation and owned ready sample intervals. `Ticks.Beat` is 3840, so canonical ticks convert by four. Native rendering and Gemini critique remain deferred. Owned WAV bytes are hash-checked, profiled by timed activity, uploaded with durable identity and mapped to audio regions with nonzero source offsets and explicit once/loop selection. That upload/readback path passed an offline worker contract double, **not** live Audiotool verification.

The v2 mapper permits only curated SDK fields/ranges: selected Heisenberg oscillator/operator/filter/envelope, Pulverisateur filter, instrument gain and delay/reverb/compressor/EQ/auto-filter controls. Unknown fields are rejected instead of silently dropped; normalized SDK parameters are not mislabeled as physical units. Beatbox8 supports only lanes MIDI 36/38/42/46, sixteenth-note on/off steps, velocity 1 and five slots: transposition, continuous accents and unsupported timing are rejected. Source start/duration is rechecked against the owned asset at commit. Shared sends/buses, arbitrary presets and the full SDK parameter surface remain unsupported. See [current capability matrix](native-construction-pass.md).

## Preserved legacy canonical music and renderer

Compositions are Zod-validated JSON with schema version 1, 960 PPQ, 4/4 meter, exact section boundaries, four musical roles and tick-addressed events. The current compiler writes 16 bars across Intro, Groove, Lift and Outro at 78–112 BPM.

The owned **Sunroom** palette contains deterministic kick, snare, filtered hi-hat, bass oscillator, melody oscillator and an optional user-source texture/percussion layer. Rendering is seed-stable at 48 kHz stereo PCM16. Every track is rendered independently before summing to a headroom-limited preview. The worker rejects silent output and stores duration, peak, RMS, non-silent ratio and 240 waveform buckets.

The source fixture at `.local/fixtures/owned-percussion.wav` is synthesized by `scripts/generate-fixtures.ts`; no third-party recording is bundled. The renderer accepts only bounded PCM16/Float32 RIFF/WAVE until FFmpeg is present.

Revision 2 of the verified demo removes six alternating Groove hats. Melody composition hash and melody stem SHA-256 are identical to revision 1. See `pnpm exec tsx scripts/verify-demo.ts` for the executable artifact proof.
