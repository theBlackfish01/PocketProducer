# ADR 002 — Native construction before native audio

Status: accepted, 2026-09-23. Supersedes render-first sequencing in the dated handoff; preserves ADR 001 for the separate legacy audio workflow.

The current user decision defers native rendering/playback. Pocket Producer now accepts a direction into a canonical 960-PPQ native document with sections, motifs, notes, native drum patterns, instruments, effects, automation, source intervals and protection. A durable worker runs a scoped Deep Agent whose only mutation tool applies validated domain operations. PostgreSQL stores tool-step replay records, immutable versions and a selected head. The pinned Nexus 0.0.17 SDK validates a local native mapping before commit; neither that validation nor a source interval proves audibility.

The Listening Room defaults to this construction workflow. The prior Sunroom/four-stem WAV workflow remains selectable as **Legacy audio**, with its audio artifacts and histories unchanged. No migration merges their version graphs.

Native synchronization is an explicit later command. It creates a separate project for an immutable version, uploads selected owned WAVs with durable identities, writes the validated structure and requires a fresh SDK readback before showing an Audiotool link. The remote checkpoint fences uncertain project creation, sample upload and document mutation; it never overwrites a nonempty target automatically. The user explicitly barred Audiotool contact in the current follow-up, so the expanded path is implemented and tested against an offline worker contract double but not live verified. A selected source interval is never silently omitted from a claimed editable result. Details and limits are in [the creative construction follow-up](../native-construction-pass.md).

Native audio rendering, Gemini critique of that audio and a true sound-based quality claim remain future work. Existing legacy previews continue to play. No new provider spend is necessary for offline verification.
