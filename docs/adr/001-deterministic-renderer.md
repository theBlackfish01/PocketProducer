# ADR-001 — deterministic server renderer

Status: accepted for the initial milestone, 2026-09-20.

## Decision

Use a bounded TypeScript renderer that decodes owned PCM WAV assets, generates a coherent synthetic downtempo palette, schedules canonical tick events at 48 kHz, writes isolated stems and a browser-playable PCM WAV mix, and records hashes/measurements. Keep rendering behind an adapter so a supported Audiotool renderer can replace it later.

## Evidence

The handoff's Nexus research establishes document/sample/project editing but not a supported standalone server audio engine. The local host currently has no FFmpeg executable. Direct WAV output proves phone-independent server audio without inventing an SDK endpoint or adding a binary install blocker.

## Consequences

- Initial uploads and browser recordings must be PCM WAV; other formats fail honestly until FFmpeg is configured.
- Nexus export begins with clip/stem manifests and fidelity labels. Live native project verification remains blocked on app registration/OAuth.
- Revisit when an official headless renderer is documented and passes the independent-process test, or when FFmpeg is installed for broader decoding/encoding.

