# Testing, quality gates and evidence

Test the promises and failure boundaries. Avoid tests that merely assert the presence of a CSS class or reproduce implementation arithmetic without an independent expected result. Package validation is not application testing; this handoff contains no executed app tests.

## Test layers

| Layer | What belongs here | When to run |
| --- | --- | --- |
| Domain/unit | Tick conversion, event scheduling, source lineage, patch/lock invariants, state transitions, budget accounting | Every relevant change / PR |
| Contract | Public schema acceptance/rejection, adapter response fixtures, migrations of stored IR | Every PR |
| Audio integration | Real decoding/rendering with tiny owned fixtures, output metrics and timing | Every renderer change; bounded CI suite |
| Data/worker integration | Real Postgres transactions, outbox, lease races, retries, cancellation and ownership | Every API/worker/data change; required CI |
| Browser E2E | Core creation/revision/export UI journeys with deterministic server/provider fixtures | Required CI; several browser projects |
| Live adapter smoke | Real model, real Nexus auth/sample/project and provider failures | Opt-in protected/staging run; before release |
| Listening/UX review | Musical coherence, source identity, perceptible revision and usability | Each musical milestone / release |
| Operations | Clean setup, migrations, restart, backup/restore, deploy/rollback | Before release; after operational changes |

CI needs no paid credentials for deterministic core tests. Live tests must be explicitly named and report skipped/pending truthfully. If a release gate requires live evidence, a skipped live test does not satisfy it. Protect CI secrets from untrusted forks and redact diagnostics/artifacts.

## Canonical fixture set

Create tiny synthetic or owned licensed files: an impulse at a known sample offset, a sine tone, silence, a short percussive sample, a tempo-labeled loop, stereo channels with different content, a malformed file, and a sample with near-full-scale peaks. Include license/provenance and a generator script where possible. A file named `.wav` containing unrelated bytes must be rejected. A correctly decodable but unusually long compressed file must hit decoded-duration/resource limits.

Use a fixed reference composition with known tempo/bar count and exact expected event onsets. Test multiple tempos and non-integer samples-per-tick. Avoid assuming rounding every tick independently produces accurate cumulative timing. Validate the full event-time conversion against independent rational calculations.

Store expected metrics with tolerances, not large binary snapshots for every change. Byte-level golden renders are useful only in a pinned environment with deterministic encoding; otherwise compare onset locations, duration, peak/RMS, channel behavior and toleranced signal differences. An unchanged protected artifact can and should keep its exact stored hash.

## Core acceptance cases

| ID | Scenario | Required observation |
| --- | --- | --- |
| A01 | New user creates from owned tap sample | Actual source lineage and audible rendered output; no developer preload |
| A02 | Phone tab closes after `202` acceptance | Worker completes; reopening shows one result |
| A03 | Repeat submit after network timeout | Same idempotency key returns original job; no duplicate spend/job |
| A04 | Invalid/oversized source | Clear per-file failure, no render attempt, other inputs retained |
| A05 | Sample still processing | Creation/export waits safely or explains; no dangling remote reference |
| A06 | Simplify drums, protect melody | Drum diff audible; melody structure and protected artifact unchanged |
| A07 | Revise Groove only | Other sections/parts unchanged within documented tail policy |
| A08 | Request tempo change with protected melody | Concrete conflict choice; no silent unlock |
| A09 | Failed revision | Previous accepted version still playable; error can be recovered |
| A10 | Two devices change current version | CAS conflict or unselected candidate; newer head not overwritten |
| A11 | Cancel during/after render | No stale post-cancel commit; terminal success handled consistently |
| A12 | Duplicate/reordered progress events | Stable UI; finished job does not regress to rendering |
| A13 | Export correct selected revision | Remote structure, sound and fidelity match declared version |
| A14 | Token expires during export | Controlled refresh/reconnect, no token disclosure/duplicate project |
| A15 | Remote project creation succeeds but reply is lost | Effect reconciled or marked needs-attention; no blind repeated create |
| A16 | User B requests user A's asset/job/export | No metadata, media URL or event disclosure |
| A17 | Signed audio URL expires during seek | Refreshed URL and recoverable playback position |
| A18 | Mic denied/unsupported format | Typed/upload alternatives usable; no stuck recording indicator |
| A19 | Restore an older version | Explicit head change; later revisions preserved |
| A20 | Delete project with active worker | Access revoked and commit fenced; references cleaned safely |
| A21 | Gemini analyzes a preview | Real current audio content/interval reaches the adapter; structured report records its hash |
| A22 | Render changes after analysis | Old critique cache is not used for the new audio |
| A23 | Gemini missing or unavailable | Core OpenAI creation works within supported limits; critique is honestly unavailable |
| A24 | Critic requests a protected/global change | Domain validation rejects it or asks a concrete constraint question |
| A25 | Critique or delegated run exceeds cap | Combined provider spend/steps/renders stop within policy; earlier candidate remains usable |
| A26 | Another user guesses workspace/report identity | Agent memory, virtual files and analysis reports stay owner/project-scoped |
| A27 | Production starts with local development auth | Startup fails; there is no silent public authentication bypass |
| A28 | Local env already contains the OpenAI key | Setup preserves it, logs no value and excludes it from git/browser output |

## Failure-injection checklist

Also interrupt between Gemini analysis and producer repair, expire an analysis result, simulate malformed/hallucinated observations, and disable an optional interpreter. Confirm ordinary tools still work, costs are aggregated across providers, and a confident critique cannot waive a failed lock/ownership check. Model confidence is not a test oracle.

Interrupt the worker after job claim, after paid request submission, after artifact upload, and just before revision commit. Kill the API after inserting job/outbox but before responding. Run two workers attempting the same lease. Pause the database briefly, simulate storage timeout, return provider 429/5xx, expire credentials, and restart the process. Inspect both user-visible result and number of external effects.

Assert bounded retries and finite budget, not merely eventual success. A single renderer failure must not poison unrelated jobs. Stale workers must not overwrite a cancelled or newer job. Temporary artifacts can be cleaned later; accepted revisions must never reference missing blobs.

## Audio and music checks

Automated hard checks: decodable file; finite samples; expected channels/rate; duration consistent with body plus tail; non-silent active regions; peaks within chosen output policy; valid source references; no out-of-range notes/events; source-use and lock invariants.

Soft warnings: unusually low/high energy, abrupt boundary discontinuities, suspiciously dense events, excessive repetition, estimated harmonic clashes, clipped source audio. Calibrate thresholds against real fixtures and desired style. “No clipping” does not prove good mixing; silence may be intentional in an intro.

Run a repeatable musical benchmark of roughly 8–12 briefs across the supported envelope: sparse/warm, energetic/percussive, sample-preserving, quiet texture, short motif, section lift, drum simplification, constrained harmony, and an unsupported request. Use fixed seeds for regression and a few changed seeds to detect overfitting. Record model/prompt/palette versions and output identifiers.

For human listening, ask a few testers, ideally including at least one person with production experience, to assess rhythm, arrangement, balance, source identity, instruction fit and whether they would continue editing it. Use a simple anchored 1–5 rubric only as an internal comparison, not a scientific quality claim. Collect concrete issues and A/B judgments; distinguish the builder's assessment from independent feedback. Do not block all progress if outside testers are unavailable, but disclose that limitation.

## Browser and accessibility matrix

Use [Playwright projects](https://playwright.dev/docs/test-projects) for Chromium, Firefox and WebKit plus mobile viewport emulation. Emulated WebKit is not proof of physical iOS recording/background behavior. Obtain a real-device check when possible, or state it is pending.

Test: 360/390 px phones, tablet 768 px, desktop 1024/1440 px, landscape, 200% zoom, long names, many sources, keyboard-only, reduced motion, focus after dialog close, screen-reader labels, contrast, accessible waveform seeking and progress announcements. Avoid announcing every audio-frame update through an ARIA live region. Real-time playback time can be available on demand while job stage changes are politely announced.

Mobile-specific: permission prompt, recording MIME support, keyboard over composer, safe-area padding, accidental double tap, audio start gesture, interruption/resume, tab suspend/reopen, connection change, large upload failure, seek after signed URL expiry. Never rely solely on screenshots for these behaviors.

The [component-system plan](15-UI-library-and-component-system.md) adds focused checks for the shadcn/Base UI integration: nested overlays and Escape behavior, focus return when a trigger disappears, A/B selection semantics, visible selected/protected states, labeled slider interaction, and avoiding duplicate hidden dialogs at breakpoints. Test modified components and their product composition; do not recreate the upstream library's test suite. Inspect the actual Listening Room theme, including hover/error/focus states, rather than treating library adoption as proof of accessibility. Keep a small stable visual regression set for the room and overlays.

## Initial engineering targets to measure

Proposed targets, not established results: responsive transport feedback within about 100 ms locally; ordinary API acknowledgments within 1 second absent dependency outage; first meaningful UI on a typical mobile connection in roughly 3 seconds; server job acceptance visible immediately after acknowledgment. Measure end-to-end audio generation on the selected hardware before promising a duration; target a useful short draft within a couple of minutes and improve based on p50/p95 measurements.

Record peak worker memory, CPU time, bytes stored, model tokens/cost, render seconds per audio second, retry count and export latency. Test at the configured concurrency ceiling rather than claiming internet-scale capacity. Ensure UI remains responsive while waveform data loads; use precomputed peaks rather than decoding large files in the main thread purely for decoration.

## Release evidence record

Maintain `docs/testing/release-YYYY-MM-DD.md`: commit and versions, commands actually run, pass/fail/skip counts, browser/device matrix, live-provider test identifiers, sanitized screenshots, listening feedback, performance/cost observations, known issues and sign-off criteria. Include exact failure reproduction and fix evidence where material.

No fabricated scores, response times, compatibility or test coverage. “Works locally” must name the relevant environment and journey. A failing critical flow blocks release; a known noncritical limitation can ship with clear UI/docs. Once appropriate checks pass, do not endlessly repeat them unless changes or unresolved concerns justify it.
