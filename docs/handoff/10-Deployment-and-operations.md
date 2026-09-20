# Deployment and operations

## Deployment shape

Recommended initial shape: one region, managed PostgreSQL, private object storage, and a container-capable service for API plus a separately managed long-running worker. Serve the built frontend through the same origin or a reverse proxy routing `/api` to the API. A CDN/static frontend is fine if session, CSRF, CORS and streaming behavior are deliberately configured.

Do not choose a short request timeout/function execution limit as the home of a multi-minute render. The API enqueues work; a worker with adequate CPU/memory and process support executes it. If a provider's durable workflow/container offering can meet these requirements, evaluate it instead of assuming a brand or service works. Choose hosting only after checking current limits, region, prices and user account access.

Separate development, staging and production databases, buckets/prefixes, OAuth apps/callbacks, tokens and budgets. Production should not use a developer's full-account Audiotool PAT. Avoid accidental publicly readable sample buckets. Configure lifecycle rules only after mapping ownership/revision references.

## Configuration classes

- Public browser values: app origin, public OAuth client identifier, UI feature availability. No server secret belongs in client build variables.
- API/worker secrets: database URL, session key, token-encryption key, object-store credentials, model/transcription keys and optional observability credentials.
- Operational controls: allowed origins, upload limits, queue concurrency, per-job time/render/model-call limits, budget caps, temporary-object retention, log level.
- Reproducibility: model identifier, prompt/schema/palette versions, FFmpeg/renderer build, Nexus version and export mapping version.

Validate mandatory variables at startup and fail with safe field names. Production must refuse fixture authentication/provider modes and insecure cookie settings. Empty paid-service keys should disable those features clearly or block the relevant worker role, not cause silent fallback to fake success.

## Deployment sequence

1. Produce a release artifact and sanitized configuration checklist. Confirm costs, domain/origin and scope of publication with the user at the point required.
2. Provision approved infrastructure and least-privilege service credentials. Store secrets in provider secret storage, not shell history/chat/files committed to git.
3. Apply backward-compatible schema migrations, then deploy API and worker versions that understand both transitional states as needed. For breaking IR/job changes, drain or migrate outstanding work explicitly.
4. Register the exact staging/production OAuth callback and test a fresh browser authorization. A local callback working does not prove production login.
5. Verify readiness: DB reachable, storage permission limited, queue dispatcher active, renderer available, model configuration validated, Nexus adapter loads. Liveness should not restart the process merely because an external provider is temporarily down.
6. Run production smoke with owned fixtures: create → close/reopen → play → revise/protect → compare → export → open/edit → sign out. Inspect privacy, audio access and actual effect counts.
7. Record release version, deployed image/build identifiers, migration level, region, measured limits and rollback target.

## Worker operations

Set low initial render concurrency and increase from measurement. Limit each subprocess and kill its process tree on timeout/cancellation where supported. Clean scratch paths only after resolving them beneath a configured task directory. A storage cleanup must never accept an arbitrary client filename as a deletion path.

Graceful shutdown stops new claims, marks/drains work within a bounded period, then lets leases expire safely for recovery. Persist enough state to resume or restart a deterministic stage; do not assume an in-memory graph can recover after a deploy. Stale leases require a fencing check before committing results.

Maintain operational views for job age, running count, retries, failed stages and uncertain effects. An administrative retry must respect job identity/budget and not accidentally duplicate exported projects. Prefer a small authenticated CLI or internal view over building a large admin dashboard initially.

## Observability and budget

Log request/job/revision IDs, stage transitions, dependency error class, durations, retries, render resource usage and token/cost totals when available. Do not log raw audio, refresh credentials, signed media URLs, full prompts or personal transcripts by default. Restrict any temporary detailed diagnostic capture and set its retention.

Track p50/p95 job latency, render failure ratio, queue age, export failures, token-refresh failures, storage growth and approximate spend. Alert only on actionable thresholds after establishing a baseline; no noisy per-step notifications. Expose understandable user limits before a command starts. Stop new paid work when a configured cap is reached, preserving prior results.

Model API billing is separate from the user's coding-assistant subscription. Do not interpret plentiful development tokens as unlimited public-product usage. Demo mode and concurrency/rate limits protect a public demo without requiring a billing product.

## Recovery runbooks to write and exercise

**Render failure:** inspect job stage/error and inputs; reproduce with the fixed composition; retry only the failed deterministic stage; keep accepted audio available.

**Expired/revoked connection:** invalidate usable token state; ask the user to reconnect through the normal flow; resume export only after ownership and expected revision are verified.

**Unknown remote create/upload outcome:** consult effect ledger and remote identifiers; reconcile known resources. If no supported lookup makes the outcome knowable, retain needs-attention and explain; do not loop creating projects.

**Database restore:** restore a backup to an isolated instance, verify migrations and relational integrity, reconcile object references, and confirm sessions/jobs can be read. Do not let restored queued jobs immediately replay paid/external effects until their ledger state has been reconciled.

**Release rollback:** stop new claims as needed, deploy the prior compatible image, preserve database data and render artifacts, and check in-flight jobs. Destructive schema rollbacks are not a routine recovery plan; use expand/contract migrations and forward repair.

**Project deletion:** tombstone immediately, deny access and cancel/fence jobs, then remove exclusively referenced owned artifacts. A locally deleted Pocket Producer session must not silently delete an Audiotool project unless the user explicitly chose that external deletion behavior.

## Publication and hackathon delivery

Before public hosting, prepare a working release candidate, exact resource configuration, costs/limits and publication scope. Ask only for missing access/authorization; do not stop routine local implementation behind an unnecessary approval step. Provide a live URL only after it actually resolves and the production journey has been checked.

Prepare hackathon assets locally: README/source instructions, product description, integration/fidelity explanation, demonstration script, screenshots and video if feasible. Recheck current rules, eligibility, cutoff timezone and repository access requirements. Registration and submission are not implied by researching the event or preparing a package. Do not send messages to organizers or submit on the user's behalf without authorization.
