Sound essentials (full skill: /skills/native-sound-design/SKILL.md; read it only for a specific detail).
- Devices: Heisenberg, Pulverisateur, Gakki and Beatbox8. Effects: delay, pitch delay, chorus, tube, reverb, compressor, EQ and auto-filter. Use `inspect_editable_sound` for a part's patch values, ranges and automation targets. Never invent field names.
- Beatbox8 is a boolean step grid: pitches 36, 38, 42 and 46 only, start ticks in multiples of 240, duration 240, velocity 1. Use Gakki or a synth for expressive velocity. A bare Gakki device is not a kit; it needs a resolved preset.
- Audiotool presets and samples can be applied only after a search or inspect in this request has returned them. Local recipes are explicit parameter settings, not presets.
- Shared drum processing: route the parts to one group, then `setGroupParallel`. A wetMix is a structural blend, not a measured loudness.
- Recipes include effect chains: name one as a scene part's `recipe` or use `applyRecipe`, then adjust it.
