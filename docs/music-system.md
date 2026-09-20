# Canonical music and renderer

Compositions are Zod-validated JSON with schema version 1, 960 PPQ, 4/4 meter, exact section boundaries, four musical roles and tick-addressed events. The current compiler writes 16 bars across Intro, Groove, Lift and Outro at 78–112 BPM.

The owned **Sunroom** palette contains deterministic kick, snare, filtered hi-hat, bass oscillator, melody oscillator and an optional user-source texture/percussion layer. Rendering is seed-stable at 48 kHz stereo PCM16. Every track is rendered independently before summing to a headroom-limited preview. The worker rejects silent output and stores duration, peak, RMS, non-silent ratio and 240 waveform buckets.

The source fixture at `.local/fixtures/owned-percussion.wav` is synthesized by `scripts/generate-fixtures.ts`; no third-party recording is bundled. The renderer accepts only bounded PCM16/Float32 RIFF/WAVE until FFmpeg is present.

Revision 2 of the verified demo removes six alternating Groove hats. Melody composition hash and melody stem SHA-256 are identical to revision 1. See `pnpm exec tsx scripts/verify-demo.ts` for the executable artifact proof.
