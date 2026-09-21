# Module 4: Canonical Music and Rendering

### Teaching Arc
- **Metaphor:** A player-piano roll plus a printing press: the roll is the source of truth, and the press always prints the same result from the same roll.
- **Opening hook:** The agent says “88 BPM, restrained”; application code turns that into exact notes, sections, sources, stems, and WAV samples.
- **Key insight:** Canonical composition data is editable intent; the rendered WAV is a reproducible artifact derived from it.
- **Why should I care?:** It explains deterministic output, protected revisions, artifact hashes, and why audio is not stored only as an opaque blob.

### Code Snippets (pre-extracted)

File: packages/core/src/music/compiler.ts (lines 80-98)
```ts
export function simplifyDrums(base: Composition): { composition: Composition; removed: number } {
  const groove = base.sections.find((section) => section.id === "groove");
  if (!groove) throw new Error("Composition has no Groove section");
  let removed = 0;
  const tracks = base.tracks.map((track) => {
    if (track.id !== "drums") return structuredClone(track);
    let hatIndex = 0;
    const events = track.events.filter((item) => {
      const inScope = item.startTick >= groove.startTick && item.startTick < groove.endTick;
      if (!inScope || !item.assetId.includes(":hat")) return true;
      hatIndex += 1;
      const keep = hatIndex % 2 === 1;
      if (!keep) removed += 1;
      return keep;
    });
    return { ...structuredClone(track), events };
  });
  return { composition: { ...structuredClone(base), tracks }, removed };
}
```

File: packages/core/src/audio/renderer.ts (lines 146-166)
```ts
  let peak = 0;
  let squareSum = 0;
  let nonSilent = 0;
  for (let i = 0; i < frames; i += 1) {
    peak = Math.max(peak, Math.abs(masterLeft[i] ?? 0), Math.abs(masterRight[i] ?? 0));
  }
  const safety = peak > 0.92 ? 0.92 / peak : 1;
  const buckets = 240;
  const waveformPeaks = Array.from({ length: buckets }, () => 0);
  for (let i = 0; i < frames; i += 1) {
    masterLeft[i] = Math.tanh((masterLeft[i] ?? 0) * safety);
    masterRight[i] = Math.tanh((masterRight[i] ?? 0) * safety);
    const value = Math.max(Math.abs(masterLeft[i] ?? 0), Math.abs(masterRight[i] ?? 0));
    squareSum += value * value;
    if (value > 0.0005) nonSilent += 1;
    const bucket = Math.min(buckets - 1, Math.floor(i / frames * buckets));
    waveformPeaks[bucket] = Math.max(waveformPeaks[bucket] ?? 0, value);
  }
  const previewPath = join(outputDirectory, "preview.wav");
  await mkdir(dirname(previewPath), { recursive: true });
  await writeFile(previewPath, encodeWav(masterLeft, masterRight, SAMPLE_RATE));
```

File: packages/core/src/audio/repair.ts (`attemptBoundedDrumRepair`)
```ts
  const protectedMelody = protectedTrackHash(input.composition, "melody");
  const simplified = simplifyDrums(input.composition);
  if (simplified.removed === 0) return { composition: input.composition, render: input.render, removed: 0 };
  try {
    const candidate = validateComposition(simplified.composition);
    const candidateRender = await input.renderCandidate(candidate);
    if (protectedTrackHash(candidate, "melody") !== protectedMelody || !input.validateCandidate(candidate, candidateRender)) {
      throw new Error("Bounded repair failed deterministic signal or melody-lock validation");
    }
    return { composition: candidate, render: candidateRender, removed: simplified.removed };
  } catch (error) {
    return { composition: input.composition, render: input.render, removed: 0, rejectedError: error instanceof Error ? error.message : "Bounded repair failed" };
  }
```

### Interactive Elements
- [x] Code↔English translation of scoped drum simplification.
- [x] Quiz: 3 scenarios on protected melody, deterministic seeds, and measured vs subjective audio facts.
- [x] Flow diagram: plan → 960-PPQ composition → track scheduling → stems → mix → measurements/waveform.
- [x] Before/after visual cards showing six Groove hats removed and exact melody stem reused.

### Reference Files to Read
- `references/interactive-elements.md` → Code ↔ English Translation Blocks, Flow Diagrams, Pattern/Feature Cards, Multiple-Choice Quizzes, Glossary Tooltips
- `references/design-system.md` → Module Structure, Responsive Breakpoints
- `references/content-philosophy.md` → all content rules
- `references/gotchas.md` → full checklist

### Connections
- Previous: Deep Agent creates the bounded plan.
- Next: external analysis and export boundaries consume real audio and stems.
- Tone/style: introduce PPQ, stem, PCM, RMS, hash, and headroom with aggressive tooltips.
