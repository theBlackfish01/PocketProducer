# Initial architecture

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
