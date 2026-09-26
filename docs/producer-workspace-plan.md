# Producer workspace: a clearer session journey

Status: implemented locally on `8ee9fcf`, 2026-09-26. Original review was against `6a5aa9a`. See [current verification](testing.md) and [hands-on guide](native-production-guide.md). The unrelated course/walkthrough work and subsequent LangSmith implementation were preserved.

Delivery decisions: desktop uses the proposed score/Producer split at 1,060 px of **content** width; intermediate widths share the phone's in-page Arrangement/Producer switch rather than a modal Producer sheet, keeping conversation navigation consistent without trapping focus. Secondary tools use the existing Base UI sheets. Updates are durable whole messages, not token animations or private reasoning. No extra narrator model, new dependency, tracing integration or provider call was added. Historical directions are backfilled honestly; historical producer commentary is not invented. Native score, inspection and comparison components were preserved.

The detailed plan below records the intended contract. Maintained tests cover the core journey, rollback/commit ordering, killed-process recovery, competing workers, duplicate/lost acknowledgements, cursor replay/reset, long feed, pending direction, partial recovery and preserved visualization. Slow-client limits are implemented defensively but have not been load-tested at the 64-stream cap. Physical phones, screen readers, Firefox/WebKit and live LangSmith ingestion remain unverified. This increment does not implement general Q&A, in-flight steering, an automatic follow-up queue or native playback.

## 1. Product decision

Keep the arrangement, section navigation, note/clip/control inspection, protection choices and Before/After visualization flows. They are the successful center of the product. Change the surrounding information architecture and the way a request progresses.

Use two distinct screens:

1. **Start a session** — one idea, optional sounds, one clear create action.
2. **Producer workspace** — the existing arrangement canvas beside a focused producer conversation, with secondary tools opened only when needed.

Creating, refining, ready, paused and stopped are states of the workspace, not successive new pages. Move from Start to the workspace once the server has durably accepted the request. Do not move the user again whenever the agent changes stage or saves a batch.

The conversation should feel like working with a producer, not reading a service log. Show concise public-facing intent, confirmed actions and results. Do not expose private model reasoning, chain-of-thought, raw tool arguments, graph messages, prompts, SDK internals or accounting diagnostics. Do not fabricate a thought stream while no new information is available.

## 2. What the review found

- `App.tsx` keeps selected project and Arrange/Playable audio mode in component state. There is no session URL/page contract for returning directly to an active production workspace.
- `native-room.tsx` owns loading, receipts, editing scope, job polling, draft polling, recovery, limits, plans, source/library tools, saved versions and comparison. These render as a long stack rather than a state-specific journey.
- Jobs are polled every 900 ms; native drafts every 1,800 ms. The draft endpoint replays persisted steps. The UI does not have a persistent project conversation or an incremental public activity subscription.
- PostgreSQL already stores ordered `job_event` rows, `native_job_plan`, `native_job_step`, immutable versions, provider effects and command receipts. These are useful foundations, not a reason to add another queue/service.
- `saveNativePlan` and `saveNativeStep` persist their state but do not currently append a user-facing musical activity event in that same transaction. The producer calls `agent.invoke`; it does not expose a live public message stream.
- The native worker uses discovering/constructing/validating/synchronizing stages, while `jobProgress` mainly translates older legacy-audio stages. Several distinct operations therefore collapse to a generic “Working on your piece”.
- The inspected page places its hero, audio availability notice, recovery alert and toolbar before the score. With tools expanded, source caveats, capability categories, inspiration, export state and library search all compete with the music.
- The current session showed an Audiotool readback conflict in a broad “We need to check what happened” warning. The plan must identify the affected action without implying that all saved music or local editing is unavailable. This review did not retry or diagnose the live synchronization defect.

## 3. Screen and navigation contract

### Start a session

Keep the inviting typography/artwork and logo. Show a short question (“What would you like to make?”), direction input and primary **Create arrangement** action. Optional sources live behind **Add a sound** with a compact attachment list. A small set of useful examples can appear only while the direction is empty.

Move profile/usage options into **Creation options**. Explain the practical difference between Standard and Extended without listing model calls, token sizes or runtime seconds. Show the effective spending cap before a paid submission; do not hide consequential cost consent inside diagnostics. A nominal profile allowance never implies permission to increase the installation allowance.

Do not show empty version history, disabled Compare, instrument catalogues, export setup or several future-feature disclaimers on this screen. Keep a concise visible statement that this creates an editable arrangement and native playback is not available yet.

Submit behavior:

1. Persist the pending request identity before dispatch, as today.
2. Show “Starting…” while acknowledgement is pending; do not imply a job exists yet.
3. On accepted/recovered receipt, navigate to the workspace and show the user's actual request once.
4. On rejection, retain the idea and sources on Start with one specific corrective message.
5. On lost acknowledgement, recover that command. Never create a second request to make navigation appear successful.

### Producer workspace

Replace the established-session marketing hero with a compact title/current-version/status header. The arrangement takes priority. Keep the existing visualization components and their inspect-versus-change behavior.

Desktop, when enough content width is available:

```text
Session rail | Title · current version                  Sounds  History  …
             |----------------------------------------------------------
             | Existing arrangement canvas | Producer                   |
             | Existing section inspection | Your request               |
             |                              | Latest useful update       |
             |                              | Collapsed earlier activity |
             |                              |----------------------------|
             |                              | Scope / kept material      |
             |                              | Direction input + action   |
```

The producer column is approximately 320–380 px. Only use the split layout when the arrangement can retain roughly 680 px or more of useful content width; tune from the real page, not viewport labels alone. At intermediate widths use a Producer sheet rather than squeezing the score.

Phone: a compact **Arrangement / Producer** switch inside the same workspace. Preserve the current score and section-inspection layout inside Arrangement. Producer contains the chronological request/update feed and keyboard-safe composer. A small persistent status row links the two. Before any confirmed score exists, Producer is the initial view; when music becomes available, offer **View arrangement** rather than forcibly switching tabs while the user reads or types. Remember the user's choice during a request.

Use session URLs such as `/sessions/:projectId/start` and `/sessions/:projectId`. Retain `/` as the entry/fallback and preserve the exact Audiotool callback route. A small tested URL-state adapter is sufficient for this two-screen local SPA; do not introduce a framework migration. Support direct load, refresh, Back/Forward, deleted/unauthorized project handling and server-derived active-request recovery. Visiting a URL must never submit work or start synchronization.

An empty existing project can use Start. A project with active or saved partial work belongs in the workspace even if it has no accepted version. Legacy-only projects retain their playable-audio route/view; native construction and older recordings remain distinct.

## 4. Workspace states: one clear emphasis at a time

| State | Main content | Producer panel / primary action |
| --- | --- | --- |
| Accepted, awaiting worker | Honest empty score area or existing saved arrangement | Original request + “Waiting to begin”; Stop |
| Planning, no confirmed music | Brief summary and neutral empty score state; no invented notes | One current intent/status and optional “View approach” |
| Building first arrangement | Existing score component shows only confirmed work, labeled **In progress** | Grouped musical updates; Stop |
| Revising | Existing selected arrangement remains default; explicit **View work in progress** reveals confirmed draft in the same canvas slot | Scope/kept material pinned to the request; concise progress |
| Successful create | Saved score and current version | Result card with facts and **Keep shaping** |
| Successful revision | Existing version lifecycle and Before/After flow | Result card linked to the exact pair; automatic selection stated honestly |
| Safe partial pause | Latest confirmed draft available; earlier accepted version remains safe | Specific reason + Continue when allowed, or Review limits |
| Cancel requested | Current displayed evidence remains | “Stopping…”; no new mutating request until acknowledged |
| Cancelled / failed | Saved version or clearly unfinished work remains inspectable | Specific outcome; explicit retry only where server permits |
| Connection interrupted | Retain last confirmed state with freshness status | “Reconnecting”; never falsely say the producer stopped |
| Audiotool-only issue | Local score remains usable according to server permissions | Connection/export status in Audiotool panel, not a generic creative failure |

Do not place both the accepted score and an equally prominent draft score in a long vertical stack. Reuse one canvas slot with explicit saved/in-progress context; preserve its existing inspection behavior and keep state keyed to the document being viewed. A progress update must not retarget a pending revision, select a saved version, reset the viewed section, open an inspector or jump the user's scroll position.

On a revision completed while the user is in another session, mark that session ready; do not navigate or open its comparison over their current work. For the actively submitted revision, preserve the normal success → comparison flow. Reconnect/reload must not repeatedly reopen the comparison. Do not overwrite a next-direction draft typed while work was running.

## 5. Conversation and live activity

### Three kinds of content, visibly distinct

**Your directions.** Persist the exact submitted text with attachment references, selected section/part, requested protections, starting version, logical request ID and chosen profile. Collapse long briefs after a few lines; retain the full text behind “Read full direction”. Do not render a 32,768-character brief several times.

**Producer updates.** Short intentional or factual messages: “I’m shaping the opening around your melody”, “Added the bass part to the middle section”, “Checking that your melody stayed unchanged”. Use future/in-progress language for intentions and past tense only for confirmed changes. Tone can be conversational without implying listening or a successful edit before validation.

**Results / decisions.** A compact card with the saved version, useful changed/kept summary and relevant actions. A pause card has one reason and one next action. “Bass kept unchanged” requires evidence for that exact base/result/scope; a requested lock alone is not that evidence.

### What streams

Stream durable activity as it occurs, not raw tool execution. Initial event vocabulary:

- request accepted / worker started;
- producer approach saved or changed;
- short public producer update;
- musical batch confirmed, with affected section/part references;
- verification started;
- version saved, including whether it actually became current;
- paused / failed / stopping / stopped / continued;
- explicit local version selection;
- Audiotool action status in its own category.

Examples of confirmed summaries come from validated operations/diffs: “Added 3 parts”, “Developed the theme in Return”, “Changed the bass level through Bloom”. Use actual names and checked references. Adjacent operations in one committed batch become one expandable row, not dozens of log lines. Exact notes and settings stay in the existing inspector, not the chat feed.

Use deterministic summaries for action facts. An optional bounded public-update tool can let the existing producer describe its next musical intention during the same accounted work; it must be length/rate limited, lease-fenced and explicitly non-authoritative. Its absence must never block construction. Do not add a separate paid narrator model or a provider call per progress tick.

First implementation streams complete meaningful updates over the event channel. Genuine text deltas may be added only for an explicitly public message channel if the pinned model adapter supports them without changing accounting/cancellation semantics. No simulated token-by-token typing of previously completed prose, no hidden-reasoning blocks and no exposed `AIMessage`/`ToolMessage` objects. A quiet interval uses a truthful status (“Working on the next part”), not invented commentary or percentages.

### Composer and conversation continuity

The existing Change/Keep controls hand their scope to the producer composer. A compact chip row states section, optional target part, sources and kept material; more details expand on request. The primary action remains **Create arrangement** or **Make this change**, not an ambiguous chat send that might secretly mutate music.

While a request runs, the user may write the next direction, but it is explicitly **not sent yet**. Do not silently queue a paid follow-up or inject it into an in-flight graph. Keep Stop separate. After completion, revalidate the pending draft against the actual selected head; vanished parts/sections require resolution before submission.

This increment is a conversation-shaped musical workflow, not a general-purpose chat assistant. Arbitrary Q&A, mid-run steering and agent-requested clarification/resume can be added later as explicit command types. Do not pretend unsupported messages are handled. Feed only bounded, relevant submitted context/result references into future producer calls if needed; never copy the entire activity stream into every model prompt.

## 6. Durable backend and streaming contract

Retain PostgreSQL jobs/queue and the canonical native document. No Redis, WebSocket service, new provider or billable infrastructure is necessary.

### Public activity projection

Keep `job_event` as the operational record. Add a small owner/project-scoped, append-only **public activity projection** with schema-versioned kinds/payloads, causal job/step/revision references, timestamps and stable event IDs. The projection is presentation/history, never authority to apply music or select a revision.

- Write accepted user direction with command creation/receipt in the same transaction; duplicate submission returns the same message/request.
- Write plan-change and musical-step facts in their existing successful persistence transactions. No “added notes” event before the step commits.
- Add completion/selection event references in the corresponding version transaction. Record `selected=false` honestly for a saved but non-current result.
- Deduplicate by semantic origin (request, step key, plan version, completion or selection command). A worker replay must not make the feed claim the same work happened again.
- Allocate a monotonic per-project cursor under a transaction-held lock with one documented lock order. A bare global sequence assigned before concurrent transactions commit is insufficient: reconnect must not miss a lower-numbered late commit.
- Preserve attempt/lease fencing: stale workers cannot publish new progress. Late provider accounting can settle privately without creating a false success narrative.
- Build allow-listed payloads; never serialize full request/config/model/effect objects. Render user names and public text safely; no raw HTML or executable links from tool/provider content.
- Existing sessions receive honest history entries derived from stored requests/versions when possible. Label them historical; do not invent missing producer commentary or replay old animations. Avoid a destructive backfill.

### Delivery

Add a paginated project activity endpoint and an owner-checked server-sent-events endpoint. SSE is one-way delivery; commands remain ordinary idempotent HTTP requests. Reuse current loopback safeguards, configured origin and ownership checks; no bearer credentials in URLs. Preserve the production startup guard.

The initial workspace load returns current job/head/draft identity and an activity cursor from a consistent read. Tail events after that cursor. SSE supplies event IDs, reconnect cursor, keepalive and bounded batches. If the feed is unavailable, poll the same cursor-based activity endpoint with backoff; do not run both consumers indefinitely. Test an event arriving between snapshot load and subscription.

Keep database transactions and connections short-lived; do not dedicate one PostgreSQL connection to every idle browser stream. Start with a bounded shared tail/poll loop; LISTEN/NOTIFY may be a wake-up hint if useful, never the only delivery guarantee. Slow clients disconnect/resync rather than growing an unbounded memory buffer. Recheck access on reconnect and terminate streams for deleted/inaccessible projects.

A committed musical-change event carries draft step/hash identity. Coalesce adjacent refreshes and retrieve the canonical draft once per latest hash instead of replaying it for every message/poll. Ignore stale responses by project, logical job and monotonic confirmed step. Public messages are not themselves score updates.

### Safe actions and recovery

Expose typed, server-derived allowed actions and issue categories for construction, usage and Audiotool synchronization. Map them to plain language. Do not infer safe retry from error-string regexes or merely enable a button because the user dismissed an alert.

Known safe continuation reuses the existing logical job/plan/effects. An increased request allowance is explicit and cannot increase the overall installation allowance. Unknown outcomes retain reservations and remain fenced. An Audiotool conflict blocks the appropriate remote action; independently safe local actions remain available only when the backend says so. This pass does not automatically reconcile, overwrite or contact Audiotool.

Add a transactionally enforced one-active-construction-request-per-project check for the proposed single-producer composer, after duplicate receipt lookup and under the existing project lock. Two tabs must not launch two competing musical requests through different keys. Keep synchronization permission/status distinct; do not erase an existing active request during migration or invent a broad cross-operation lock.

## 7. Reduce clutter without hiding truth

| Current content | Proposed destination / treatment |
| --- | --- |
| Large established-session hero and repeated Shape buttons | Compact workspace header; one composer action |
| Plan, stage banner, draft explanation, step counts | One Producer activity area; approach disclosure |
| Model calls, input/output tokens, lease/graph/SDK wording | Optional diagnostics, never primary progress copy |
| Request cost, held/uncertain usage, effective limits | Plain-language Usage sheet; concise actionable pause when relevant |
| Repeated “not playable / not heard” paragraphs | One visible **Playback not available yet** status and targeted explanation; retain separate legacy audio identity |
| Sources, static categories, library metadata, inspiration | Dedicated Sounds sheet; contextual empty-state suggestions only |
| Full version list repeated below score | History sheet and current-version label; preserve existing comparison flow |
| Raw synchronization/readback error | Audiotool panel: affected copy, what remains safe, supported next action; details optional |
| Internal filenames, IDs, entity names, mapper versions | Diagnostics/export details only; not the conversation |

Copy examples: “Work in progress” instead of “confirmed native draft”; “Saved your changes as Version 3” instead of “committed revision”; “Checking your protected parts” instead of “validating canonical hashes”; “The Audiotool copy needs review” instead of “remote readback mismatch”. Precision stays in the implementation and optional diagnostics.

Do not rename the user's existing projects to hide old test-style titles. Do not remove spending/uncertainty disclosures when the user is deciding whether to continue. Avoid replacing technical overload with a long stream of verbose friendly messages.

## 8. Visual, motion and accessibility rules

- Retain the logo, ivory/forest/burnt-orange tokens, editorial typography, Motion, Base UI, Tailwind and Lucide. Reuse owned Sheet/Dialog/Button/Textarea controls. No stock chat kit or Radix migration.
- One strong primary action per state, one compact current-status line and one relevant recovery card at most. Older activity is collapsed into request groups and paged, not an endlessly expanding DOM.
- Keep normal content spacing on a small 8/12/16/24/32 scale. Separate regions with whitespace/dividers; avoid cards nested inside cards and repeated full-width warning panels.
- The arrangement/section inspector itself is not redesigned. No changes to density/notes/clip geometry, musical scope semantics, protection enforcement or stable comparison coordinates are planned.
- Preserve confirmed-change score motion. New activity rows use restrained opacity/position transitions; no perpetual pulses, fake playback or animated percentages. Reduced motion preserves equivalent text/state.
- Auto-follow activity only while the user is already near its bottom. Otherwise show **New updates**. Never steal scroll/focus when a batch arrives.
- Announce meaningful stage/result changes in a polite live region, not every text fragment or note. Keep duplicate reconnect announcements suppressed.
- On Start → workspace navigation, focus the workspace title once. On Change section/part, focus the composer while preserving scope. Dialog/Sheet closure returns focus predictably. Keep current comparison keyboard behavior.
- Phone composer respects dynamic viewport and safe areas, does not cover its submit action, and retains text when switching Arrangement/Producer or opening sources/history. Emulated checks must be labeled separately from physical-device results.

## 9. Implementation phases and exit criteria

### Phase 1 — freeze the successful canvas and define the journey

Create focused tests for current section/part inspection, Change/Keep, pitch/time comparison and version selection before refactoring. Define a typed workspace state/allowed-actions model and a copy inventory. Extract controller concerns from the large native room without changing provider behavior. Define the URL adapter and project-scoped draft migration.

Exit: existing score/browser journeys still pass; empty, active, ready, partial and remote-issue states have an explicit layout contract. No provider call or remote mutation is needed.

### Phase 2 — durable conversation and event projection

Add an additive migration, typed public activity schema, paginated repository/API reads and transaction-bound event writes at command/plan/step/commit/selection boundaries. Add minimal producer/worker integration for useful public intent/stage messages. Add server-authoritative issue/allowed-action projection and concurrent-submit guard.

Exit: production-path scripted worker generates a recoverable request → plan → confirmed music → result history. Failure/cancellation/replay cannot publish a false result or duplicate musical action. Existing accepted documents and accounting remain intact.

### Phase 3 — complete static Start → workspace slice

Build Start, workspace header, Producer panel, request/result cards, scoped composer and secondary Sounds/History/Usage/Audiotool panels around the unchanged score. Initially consume the durable API via polling. Handle active/ready/partial/failed states, successful revision comparison, direct URLs and Back/Forward.

Exit: a fresh fixture session can create, watch confirmed structure, revise protected material, compare, select history and reload through the normal app without losing direction or scope. No catalogue-only or static mockup delivery.

### Phase 4 — live delivery and recovery

Add SSE cursor replay, reconnect, stream cleanup, polling fallback, snapshot/stream race handling and canonical draft refresh coalescing. Connect public updates from the real orchestration rather than a second invented client-side stage timer. Preserve public-feed and model-context separation.

Exit: real worker restart and two-client reconnect recover the same ordered feed; dropped/duplicated events cannot duplicate work, spending or score animations. Long requests remain understandable without a wall of logs.

### Phase 5 — hierarchy, copy and responsive polish

Apply spacing/content budgets, collapse historical activity, replace internal labels, implement desktop/medium/phone Producer placement, sensible completion reveal, keyboard behavior and reduced motion. Audit legacy-audio/source access so it stays functional and clearly separate.

Exit: each state answers “What am I viewing?”, “What is happening?” and “What can I do next?” within the first viewport. The score retains its useful width and original inspection behavior.

### Phase 6 — final verification and documentation

Run the maintained unit/integration/browser/visual suites; add the cases below. Inspect screenshots and actual activity/motion sequences for a sparse session, long brief, large arrangement and paused request. Review commits and update STATUS, architecture, design system, testing, setup and hands-on guide with actual results/remaining gates.

Suggested coherent commits: activity contract/storage; producer/API delivery; two-screen workflow; responsive/copy/recovery polish; final evidence/docs. Keep each implemented slice runnable; do not mark the pass complete while independent acceptance failures remain.

## 10. Verification matrix

1. **Atomic truth:** transaction rollback produces neither committed musical state nor a “completed” activity; rejected tool batch does not move the score; completion event references the actual immutable result/head-selection outcome.
2. **Replay and concurrency:** identical request keys, worker replay, contending workers, two browser tabs and a real killed/restarted worker yield one logical request, deduplicated feed and unchanged effect accounting.
3. **Stream ordering:** snapshot/subscription race, out-of-order network responses, duplicate SSE delivery, Last-Event-ID reconnect, concurrent transaction commit order, stale cursor, slow client and paged older history.
4. **Security:** cross-owner/project events denied; deleted project stream closed; malicious names/text escaped; no keys, token-bearing URLs, private model/tool payloads or diagnostic-only details in public feed.
5. **Navigation:** accepted submission changes page exactly once; rejected/lost acknowledgements preserve the idea; direct link, reload, Back/Forward and room switch recover the correct project; an old job cannot hijack a different room.
6. **Context:** 32k brief appears once in full storage, collapsed in UI; pending next direction survives result arrival and route changes; stale source/part/section/head cannot be submitted without reconciliation.
7. **Preserved visualization:** existing section/part/Keep flow, score geometry, exact facts, comparison coordinates/read-only navigation, successful automatic selection and explicit restore still pass.
8. **Non-happy paths:** queue wait, provider unavailable, known partial, unknown cost/outcome, allowance exhaustion, extension, cancellation, failed revision and Audiotool-only conflict show truthful action-specific states.
9. **Accessibility/layout:** keyboard-only journey, named controls, polite announcements, focus return, zoom, contrast, reduced motion, 390 px phone, keyboard-height emulation, tablet and a 128-bar/24-part score. Physical phone/screen reader/other browsers reported separately.
10. **Performance:** bounded mounted activity rows, no full score rerender for each message, at most one coordinated active subscription per session, no needless full draft replay per event, and recorded interaction/stream latency with fixture/hardware context. Test a long feed, not just five happy-path events.

Use `pnpm check`, `pnpm test:integration`, `pnpm test:e2e` and `pnpm test:visual`, extended with these maintained cases. Ordinary tests remain provider-free with isolated data. Scripted Deep Agent events prove orchestration, not real-model musical quality. No additional paid evaluation is required to implement or test this interface; a bounded live check is separate and must use applicable authorization. Native rendering/playback and Gemini listening remain deliberately deferred.

## 11. Additional ideas, prioritized

Include now: session sidebar Working/Ready/Needs you indicators; a persistent short creative brief behind a disclosure; **New updates** rather than forced autoscroll; result cards that link to the exact existing comparison; recoverable next-direction drafts; action-specific Audiotool status.

Defer: general conversational Q&A, interrupting/steering an active generation, automatically queued follow-ups, push notifications, collaborative editing, voice chat, new render access and automatic remote synchronization. These need separate product/runtime contracts and would distract from making this flow coherent.

## 12. Definition of done

A user can start from an idea, arrive in one understandable working room, follow truthful production updates, inspect the existing score, give a scoped follow-up, understand the result and choose a version without encountering internal operational prose or losing their place. Navigation, narration and streaming never grant mutation authority or weaken money/history/recovery safeguards. All independent local work is verified and remaining external/audio gates are stated separately.
