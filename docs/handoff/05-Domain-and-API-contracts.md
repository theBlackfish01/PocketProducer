# Domain model and API contracts

This document specifies semantic requirements. Generate production schemas, validators, TypeScript types and OpenAPI from one authoritative contract representation; do not maintain disconnected copies by hand. Example JSON in [contracts](contracts/README.md) is illustrative and deliberately contains no playable asset files or real credentials.

## Core records

| Record | Required fields / constraints |
| --- | --- |
| User | Internal ID; verified provider subject; creation/deletion timestamps |
| Connection | User/provider; encrypted token bundle; expiry; scope/version; refresh lock state |
| Project | Owner; title; accepted head revision; optimistic version; active job; deletion state |
| Asset | Owner/project; source/derived kind; content hash; private object key; MIME; measured duration/rate/channels; readiness; provenance/rights reference |
| SourceUse | Source asset; role; exact/idea/reference mode; trims; permitted transforms; analysis confidence |
| Revision | Project; parent/base; immutable IR; normalized hash; rendered artifact refs; actual change summary; validation report; creator job |
| Job | Project/owner; kind; base revision; request snapshot; state/stage; budget; lease/fence; attempts; error; timestamps |
| JobEvent | Job; monotonically increasing sequence; public event type/payload; timestamp |
| Effect | Job/step/idempotency key; input hash; pending/succeeded/unknown/failed; provider request/object ID; output reference |
| Export | Revision; target provider/project; mapping version; entity/asset map; fidelity by part; state; last verification |
| Outbox | Transactionally inserted event; stable job key; dispatch state; retry metadata |

Use UTC timestamps in storage and ISO 8601 over the wire. Display in the user's locale; do not bake the builder's timezone into the public application. UUID/ULID IDs are fine; authorization never rests on unpredictability. Add foreign keys, ownership-scoped indexes, check constraints and unique keys for idempotency. Prefer real columns for important queryable state, with JSONB for validated versioned composition documents.

## Canonical composition v1

- `schemaVersion`, explicit `ppq`, fixed `tempoBpm`, time signature, musical body length in ticks, optional declared tail duration, and random seed.
- Ordered non-overlapping named sections with start/end ticks. A section may have silence, but boundaries remain inside the body.
- Stable track IDs with musical role, gain/pan, processing chain, and ordered clips/events.
- Sample events reference a ready immutable asset, trim, scheduled start, duration policy, gain, and explicitly supported pitch/stretch transformations. All events lie in permitted bounds; clipping an event requires an explicit tail/truncation policy.
- Notes, when supported, have MIDI pitch, duration, velocity and a supported instrument reference. A note's renderer/export mapping is capability-checked.
- Source-use records distinguish literal audio usage, motif preservation and reference-only intent. Provenance is retained through transformations.
- Render configuration declares rate/channels, algorithm version, master chain and output target. An implementation may keep executable derived processing outside the IR but must hash all inputs to output identity.

No executable code, arbitrary URLs, shell text, filesystem paths, raw credentials, or unbounded model metadata belongs in a composition. Set maximum counts and string lengths. Reject NaN/Infinity, invalid ranges, unknown opcodes and unsupported schema versions. Save future migrations as explicit versioned transforms; never reinterpret old compositions in place.

## Revision patch v1

The agent returns a constrained patch containing base revision ID/hash, scope, protected-track IDs, operations, intent summary, and expected musical outcome. Supported initial operations: replace a target track's events; adjust an allowed track gain; replace supported track processing; set a section's arrangement using allowed tracks; add/remove an explicitly unprotected part.

Use semantic operations with stable IDs, not arbitrary JSON Pointer edits into the entire database. Applying a patch is a pure function that validates all IDs and produces a new IR plus a structural diff. Enforce protection after patch application as well as while building tool instructions. A patch that changes a protected hash fails even if its explanation says “melody unchanged.”

Global tempo/key changes are separate capability-gated operations. If they affect a protected track, return a conflict needing a choice, not a silent partial edit. Retry on transient model format failure with bounded repair; never relax the protected constraint to get a successful result.

## HTTP surface, proposed `/api/v1`

| Route | Semantics |
| --- | --- |
| `POST /auth/exchange` | Verify Audiotool identity and establish app session; strict origin/CSRF/exchange binding |
| `GET /me` / `POST /auth/logout` | Current session / revoke app session and clear cookie |
| `GET, POST /projects` | Cursor-paginated own sessions / create empty session |
| `GET, PATCH, DELETE /projects/:id` | Snapshot, conditional metadata update, tombstone and scheduled cleanup |
| `POST /projects/:id/upload-intents` | Validated scoped upload location with expiry and size ceiling |
| `POST /assets/:id/complete` | Enqueue probe after uploaded object exists; not instant trusted readiness |
| `GET /assets/:id` | Authorized metadata and preparation state |
| `POST /assets/:id/audition-url` | Short-lived media URL after owner check |
| `POST /projects/:id/generations` | Persist job for initial creation; return `202` and job ID |
| `POST /projects/:id/revisions` | Persist scoped revision job with required base/head IDs |
| `GET /jobs/:id` | Durable status snapshot, stage, output refs, actionable error |
| `GET /jobs/:id/events` | Authenticated SSE with monotonically increasing event IDs |
| `POST /jobs/:id/cancel` | Idempotent cancellation request; does not promise external side-effect rollback |
| `GET /projects/:id/versions` | Cursor-paginated immutable revision summaries |
| `POST /projects/:id/select-version` | Conditional accepted-head change; conflict if expected head differs |
| `POST /revisions/:id/playback-url` | Authorized preview metadata and playable URL |
| `POST /revisions/:id/exports` | Separate idempotent export job with explicit target/fidelity request |
| `GET /exports/:id` | Remote project link only when ready; fidelity and revision identity |

Media delivery must support seek/range and content headers, via object storage/CDN or an authorized proxy. Never stream multi-megabyte audio in SSE or JSON. If native EventSource is used, keep it same-origin with session cookies; do not put tokens in query strings. Implement polling as a reliable fallback.

## Command and response rules

All paid or externally mutating commands require an `Idempotency-Key`, scoped by user and action. Save request hash plus response reference. Same key + same body returns the existing job; same key + changed body returns conflict. Keys are not reused automatically for a user's intentional second attempt after edits. Enforce body limits before parsing expensive nested structures.

Return a consistent error object: stable `code`, safe `message`, `requestId`, `retryable`, optional field errors or a user-choice payload. No raw SDK stack, signed URL, token, or full provider response in a client error. Use appropriate status codes: invalid input 400/422, unauthenticated 401, forbidden or concealed missing resource 403/404, revision conflict 409, limit 413/429, dependency unavailable 503.

The job snapshot is authoritative. Events optimize responsiveness and can be repeated or missed. After reconnect, replay from event sequence when retained, otherwise request a snapshot. The frontend must tolerate duplicate events, out-of-order transport delivery and a completed snapshot arriving before older progress messages.

## Job state model

Use durable coarse states: `queued`, `running`, `needs_input`, `cancel_requested`, `cancelled`, `succeeded`, `failed`, `needs_attention`. While running, `stage` records `analyzing`, `planning`, `composing`, `rendering`, `checking`, or `exporting`. Do not mix stage strings and lifecycle states across code paths.

Terminal states are succeeded/failed/cancelled. Needs-input resumes only with a validated user answer and budget; needs-attention represents an uncertain external effect or administrative repair, not an automatic retry loop. Persist structured reason and allowable actions. A job that becomes cancelled must fail the final commit fence even if a subprocess completes afterward. An already-succeeded job cannot be retroactively cancelled; expose the existing result.

Before commit: check lease/fence, cancellation, project not deleted, assets still accessible, validation passed, and base-head condition. Persist candidate revision and final event atomically. If the head has changed, success can produce an explicitly unselected candidate branch; report that distinction in the response.

## Source and privacy boundaries

Assets are private by default. Public sharing requires a separate deliberately designed action. Keep transcripts/source metadata scoped to the correct user/project, redact logs, and document provider processing in concise user-facing settings. Uploaded content and filenames are data, not instructions to widen tool privileges. The implementation agent must not copy the builder's employer repositories, personal vault, résumé, or unrelated recordings into demo fixtures.
