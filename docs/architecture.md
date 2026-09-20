# Initial architecture

## Runtime shape

The browser talks only to the loopback Fastify API. The API validates ownership and writes PostgreSQL jobs plus an outbox row. An independent worker dispatches the outbox, claims jobs with `FOR UPDATE SKIP LOCKED`, a 45-second lease and monotonically increasing fencing generation, then commits a revision only while that lease and cancellation fence remain valid.

PostgreSQL owns users, projects, assets, jobs, ordered job events, effects, immutable revisions, audio analyses and export records. Private audio lives under `.local/audio/<owner>/<project>/`; database rows hold absolute server-only paths. The API resolves audio only after an owner-scoped lookup and supports byte ranges for rendered previews.

## Creative path

1. Deep Agents 1.14 on LangGraph reads versioned runtime skills and a per-job brief from a scoped virtual workspace.
2. `gpt-6-astra` returns a Zod-validated high-level arrangement plan. The graph cannot write arbitrary files or raw timeline events.
3. Deterministic application code compiles the plan into canonical 960-PPQ composition data.
4. The server renderer schedules owned source WAVs and the Sunroom synthesis/sample palette into 48 kHz stereo PCM, isolated stems and precomputed waveform peaks.
5. Measured duration, peak, RMS and non-silent ratio remain separate from any Gemini opinion.
6. The worker commits a new immutable revision transactionally and advances the project head only when the expected head still matches.

The first failed live graph attempt is retained as a failed effect and its checkpoint token usage was reconciled. External effects use job-scoped idempotency keys; Gemini will not repeat an ambiguous prior effect simply to hide a failure.

## Revision contract

The milestone revision is intentionally narrow. `simplifyDrums` removes alternating hi-hat events only inside the Groove section. The worker hashes the complete melody track before and after, reuses the exact melody stem path, renders a new preview, and stores both versions. Selecting a previous version changes only `project.current_revision_id`; it never deletes history.

## Security boundary

This build binds API, web and PostgreSQL ports to loopback. Development ownership is one seeded local subject. API startup is refused when `DEV_LOCAL_AUTH` is false, and production startup is refused while local auth is enabled; a real production identity layer is a later milestone. Uploads are size-limited, decoded as bounded mono/stereo PCM16 or Float32 WAV, stored by hash, and never exposed by raw filesystem path.

## Integration boundaries

- **Gemini:** the adapter sends real WAV bytes when configured, requests structured JSON, stores usage and keeps subjective observations separate from measurements. Two purposes are implemented: source analysis and preview critique. One deterministic drum-repair pass is the ceiling.
- **Nexus/Audiotool:** the installed node SDK can create an offline document but is not an established standalone renderer. Export currently maps tempo, sections and four editable stems into `nexus-stem-v1`; live project creation is not claimed.
- **FFmpeg:** absent. WAV is the honest supported upload format until a local executable is configured and tested.
