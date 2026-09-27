# How Pocket Producer Works — interactive field guide

This course is a guided, visual companion to [the detailed project walkthrough](../PROJECT-WALKTHROUGH.md), checked against the native-construction-first repository on 2026-09-27. It replaces the earlier render-first course. Eight chapters cover the single composition workspace, infrastructure, native score, Deep Agent, revision/recovery, Listening Room, Nexus/Gemini, and the evidence/security boundary. Interactions are explanatory tabs and process steppers, not required quizzes. Labels distinguish native symbolic structure, source audition, offline validation, and bounded live-provider evidence.

Open [index.html](index.html) directly in a browser. It is a local HTML page with local CSS/JavaScript and no network or provider requirement. All source links are relative to the repository.

The generated `index.html` is assembled from `_base.html`, the eight sorted `modules/*.html`, and `_footer.html`. After editing a source module, rebuild and verify from the repository root:

```powershell
& .\docs\pocket-producer-course\build.ps1
pnpm test:course:static
pnpm test:course
```

On Unix, run `bash build.sh` from this directory. The static check verifies generated source, internal/local links and tab relationships without a browser. `pnpm test:course` opens the generated page in Chromium, checks content and keyboard-operable interactions, checks phone-width overflow, and writes desktop/mobile screenshots to ignored `.local/evidence/` files. Neither test contacts OpenAI, Gemini, or Audiotool.

This is an explanation of the current implementation, not a substitute for [live status](../STATUS.md) or [the native construction contract](../native-text-to-music.md). Native rendering/playback is deferred; an editable score is not a heard audio artifact.
