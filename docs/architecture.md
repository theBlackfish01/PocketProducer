# Architecture — native construction is the current path

The user deliberately deferred native rendering/playback. The current vertical slice is `Listening Room → owner-scoped API → durable native job with captured run profile → OpenAI Deep Agent with plan/inspect/discover/compose/apply tools → Zod-validated native document → pinned Nexus offline validation → immutable PostgreSQL version → explicit native synchronization`. `docs/adr/002-native-construction-first.md` records the decision; [the current capability contract](native-text-to-music.md) records the implemented scope and limits. Audio/Gemini are a future boundary for these native versions; the working legacy WAV path below is preserved separately.

`native_revision`, `native_project_head` and `native_job_step` hold native state, selected head and replayable tool operations. `native_job_plan` holds a scoped plan/stage independently of graph messages; it cannot select a revision. The job request captures model, reasoning and budget/profile limits. `native_producer_completion` marks only structurally checked completed aggregates; confirmed-but-incomplete steps remain under the same resumable job and do not become a selected revision. `native_revision_sync` holds per-version remote create/apply/readback checkpoints, mapping version and verification time. `native_sample_upload` holds one fenced upload identity per owned source hash. A distinct project is made for each native version; a fresh SDK readback must match before the UI offers an Audiotool link. Source-bearing construction has owned-WAV upload/readiness and offset/loop mapping, verified against an offline worker contract double; real Audiotool synchronization remains unverified. Unknown remote/model outcomes are fenced rather than retried automatically.

The producer sees a pinned workspace, three project-local skills, the original brief, paged reads of real musical state, owned-source profiles, SDK discovery/local resource recipes and, when connected, server-mediated Audiotool sample/preset discovery. It records a durable plan, proposes an optional initial form and validated development batches; trusted code re-resolves resource identities and maps only curated writable parameters. It cannot edit arbitrary files, call remote mutation SDK methods, remove user protections or claim audio quality. Tools regenerate context after writes; dispatch compaction retains the original brief and ordered discovery/skill/error results. Fixture mode uses the same domain-operation validator without provider access, while scripted-model integration tests traverse the real Deep Agent. No subjective listening result is claimed.

The worker's Deep Agent runs can emit LangSmith traces with safe job/attempt correlation and hidden inputs/outputs by default. Tracing is diagnostic and never substitutes for the durable plan, native step ledger, provider-effect accounting or accepted version. Fixture mode disables tracing. See [observability setup and privacy](observability.md).

## Producer workspace and public activity — 2026-09-26

`/sessions/:id/start` is the idea-entry view; `/sessions/:id` is the durable working room; `/sessions/:id/audio` retains the separate playable history. Navigation is a small React/History adapter, not a framework migration. The OAuth callback is excluded. An accepted request moves into the workspace; refresh discovers work on the server even without a browser receipt. Another tab cannot start competing native construction while a request is active or awaiting a safe decision. Idempotency lookup still precedes that guard.

Migration **015_public_activity.sql** adds owner/project-scoped presentation history. Accepted directions, plans, confirmed batches, completion, explicit selection and recovery facts are projected in their existing state transactions. Payloads are a strict allowlist, never raw model/tool/trace objects. Origins deduplicate replay; a locked per-project clock allocates cursors in commit order. Acquire operational project/job locks first and the clock last; multi-job expiry sweeps prelock their jobs and visit clocks in project order. **016_activity_clock_reference.sql** makes the activity FK cascade through that clock, avoiding a late project key-share lock that could reverse the selection/publisher order. A rolled-back state change has no public event. Existing directions are marked historical, not reconstructed as invented producer speech.

`GET /api/v1/projects/:id/activity` returns a repeatable-read snapshot of head, current construction, draft identity, safe actions, allowance and bounded history. `after` pages forward, `before` pages older entries. A cursor beyond the stored watermark returns `reset=true` with recent history, supporting restored local databases. `/activity/stream` honors `Last-Event-ID`, verifies ownership/origin before opening, and repeatedly rechecks access. Shared per-room one-second tail reads use short database transactions, not a connection per browser. Batches are at most 100, total streams 64, queued output bounded; backpressure ends a stream and application shutdown closes it before awaiting connections.

The browser has one activity consumer: snapshot then SSE; on interruption it closes SSE and polls the same cursor endpoint with bounded backoff (2–15 seconds), without simultaneously running both. Reload reattempts SSE. Delivery is deduplicated and ignored after room/unmount changes; mounted conversation rows are bounded to 30 with explicit older pages. Canonical draft retrieval follows changed step/hash or lifecycle identity, not every text update. Public narration cannot apply music, select a version, authorize spending or feed an unbounded conversation into the model. LangSmith remains a private diagnostic boundary with unchanged defaults.

## Preserved legacy audio implementation

## Runtime shape

Pocket Producer remains a modular monolith with three local processes: React/Vite Listening Room, loopback Fastify API, and a PostgreSQL-backed worker. PostgreSQL owns canonical state, jobs, outbox, ordered events, provider effects, immutable revisions, analysis associations and export checkpoints. Private audio is stored below the configured server-only asset root and is returned only through owner-scoped byte-range routes.

An accepted command captures stable normalized client input plus the current head once. Reusing owner/project/kind/idempotency key resolves that original command before new-work preconditions. A durable browser receipt can recover the job after an acknowledgement is lost without resubmitting.

Workers claim with `SKIP LOCKED`, database time, lease generation and attempt UUID. Heartbeats distinguish cancellation, deadline expiry, lease loss and monitor failure. A stale attempt may record late provider usage but cannot append progress, select a revision or commit/export application state. Queue time counts toward the absolute job deadline. Expired queued/running jobs settle once; transient retries are capped.

## Creative and agent boundary

1. Gemini may analyze an owned source into typed, uncertain descriptors; measured audio facts remain separate.
2. Deep Agents 1.14 on LangGraph reads a scoped virtual workspace containing the direction, supported palette skill and typed descriptor. The OpenAI model proposes only the bounded arrangement plan.
3. A conservative message/framing token bound and model price table reserve the real request before dispatch. SDK retries are disabled. Persisted successful effect output is reusable; dispatch without persisted output is explicitly uncertain, not exactly-once billing.
4. Deterministic application code validates and compiles the plan into canonical 960-PPQ composition data. Attached, selected, referenced and audibly used source identities are distinct.
5. The renderer produces a 48 kHz stereo preview, four stems, waveform peaks and measured signal facts. Optional preview critique may request the one supported repair. Zero critique passes means no preview Gemini call; one original plus one repair is the maximum.
6. Revision composition/audio/required analysis associations commit atomically. Head selection is a compare-and-swap; stale valid work remains immutable but unselected.

## Revision contract

The supported revision removes alternating hi-hat events only inside Groove. It hashes the protected melody structure, reuses the exact melody stem artifact, rerenders, rechecks signal/protection and commits a child revision. A failed repair preserves the prior valid candidate. Restore changes only the selected project head.

## Analysis and effect history

Analysis identity is `(owner, project, audio hash, provider, model, purpose, prompt version, interval, status)`. `audio_analysis_revision` provides immutable many-to-many history, so reuse never moves an old association. Measured duration/peak/RMS/non-silent ratio are never presented as model opinion.

Provider effects use attempt-bound `reserved → dispatched → succeeded|failed|uncertain` transitions under an advisory budget lock and integer micro-USD accounting. Successful output cannot be overwritten; repeated finalization adds no duplicate charge; unknown post-dispatch liabilities retain reservation value. Total model calls, input bounds, repair/critique limits and job deadline are enforced.

## Nexus boundary

Nexus is an export SDK, not the renderer. Mapping `nexus-stem-v3` converts canonical 960-PPQ ticks to Nexus 3840 ticks, sets real Config tempo/signature/duration, maps the musical body plus one-second audio tail and inserts four routed full-length regions. Project creation, each upload, arrangement insertion and completion have durable step identity and uncertainty fences across jobs. See `docs/nexus-integration.md`.

## Security and deployment boundary

The milestone binds services to loopback and uses one explicit development owner. Test mode refuses production data/asset roots and real providers. Production refuses development-local auth. Secrets remain server-side and out of frontend bundles/logs. Public identity, managed object storage, deployment and submission are later milestones.
