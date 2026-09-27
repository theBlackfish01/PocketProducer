# One composition workspace: retire the separate audio workflow

Status: implemented and locally verified, 2026-09-27. The original plan follows; actual behavior, scoped test-data retirement, verification and remaining limits are recorded in [STATUS.md](STATUS.md) and [testing.md](testing.md). No compatibility product was introduced. Private orphan audio files remain unpurged; financial identities and historical migration definitions are deliberately retained, without active legacy routes or workers.

## Product decision

Pocket Producer will have one creation experience: describe a direction and optional sounds, follow the producer, inspect the arrangement, revise it, compare saved versions, and explicitly copy the selected version to Audiotool. Remove the equal **Arrange / Playable audio** destinations and delete the older four-stem production workflow.

The user explicitly clarified that this unreleased application needs **no legacy compatibility**. Do not build an archive browser, compatibility API, old-route redirects, data converter, legacy feature flag or parallel editor. Clearly disposable previous testing projects that cannot work with the retained application can be deleted. Identify the exact projects before doing so; unrelated current native work and useful source files remain.

Preserve the working Listening Room, logo, canonical native documents, score/section/part inspection, confirmed-change animation, Producer activity, protections, history selection, recovery and Audiotool integration. Keep useful upload, recording and source audition. Preserve accounting across the installation, including costs and unknown reservations attached to retired test jobs: deleting test content must not replenish the spending allowance.

Native full-mix rendering/playback and Gemini listening remain deferred. This pass needs no new provider call, remote synchronization, render experiment, UI library or infrastructure. Future playback should attach to an exact saved composition in the existing workspace.

## Inspected baseline and removal risks

Inspected HEAD: `cf4d475`. The working tree contains uncommitted course/walkthrough work, model/pricing/configuration changes and the recent Audiotool readback/reconciliation repair. Several files overlap this plan. Reinspect the diff when implementation starts and preserve these changes rather than reverting to HEAD or staging all changes together.

Read repository instructions, current status, architecture, native construction contract, design system, producer workspace plan, UI library guidance and testing configuration. Inspected the application shell, native room, routes, API, worker dispatch, shared imports and database repository/schema. Viewed the running Midnight Escalator workspace in the local browser. Its two-mode switch, separate playback notice and five session-tool buttons can be simplified around the successful score/Producer layout.

| Current coupling | Required treatment |
| --- | --- |
| `apps/web/src/App.tsx` owns the shell and legacy generation/revision/export, polling, receipts, comparison and playback. It loads old audio data even when showing the native room. | Reduce App to session navigation, connection and retained source concerns. Remove the old controller and startup reads, not just the mode buttons. |
| `native-room.tsx` receives `legacyVersionCount`/`onLegacy`, plus source assets and audition/add callbacks from App. | Delete legacy props and retain the source contract through a dedicated source controller. |
| `getProjectSnapshot()` mixes project/assets with legacy history, analyses and latest jobs. Its asset read includes all kinds. | Replace it with a lean session/source response. Ready `kind='source'` assets alone are eligible for source selection. |
| Native producer/reviewer import accounting, usage bounds and checkpoints from `agent/producer.ts`. | Extract shared helpers before deleting the legacy producer. Keep effects, pricing, callback ordering and checkpoint identity identical. |
| Native model, repository, mapper and reviewer import `canonicalHash` from the legacy composition module. | Relocate sorting/hash behavior unchanged. Saved documents, protection hashes and remote readback must still match. |
| `db/repository.ts` combines legacy commits/exports with shared ownership, queue claims, leases, cancellation and assets. | Remove only unused legacy operations. Preserve shared lifecycle semantics and lock ordering. |
| WAV decoding/measurement and optional Gemini characterization have native source/sample callers. | Retain those utilities/adapters and accounting. Remove only the obsolete full-mix render/critique orchestration. |
| Worker dispatch and queue claims admit legacy job kinds. | Remove their production handlers and claim eligibility; reject unsupported kinds explicitly. Existing test-job rows must not become runnable after a restart. |
| Tests sometimes exercise shared reliability through legacy generation. | Transfer relevant coverage to native jobs/source controls before removing obsolete feature tests. |

This planning review did not inventory current database rows or run a fresh suite. Test-project cleanup targets and actual verification results are implementation deliverables.

## Intended experience and design

### New session

Retain the existing Start screen: logo, warm artwork, inviting title, one direction field, **Create arrangement**, optional **Add a sound**, and the creation/spending-options disclosure.

Set expectations once near first submission: “Create an editable arrangement to develop here and open in Audiotool. In-app listening is not available yet.” No empty transport, alternate audio destination, archive controls or blank history on this page.

Rejected requests keep the direction/sources. Accepted or receipt-recovered requests open the existing working room exactly once. Creating a session or visiting a URL must not create a paid request.

### Producer working

Preserve the current Start → workspace journey and durable Producer feed. Waiting, planning, confirmed construction, saved result and recovery remain states of the same workspace. Only confirmed data enters the score. Continue using one canvas for the saved arrangement or explicitly selected unfinished work.

Keep the phone's **Arrangement / Producer** switch: these show the same session and solve a real space constraint. Remove only the global **Arrange / Playable audio** split.

Source refreshes, opening a panel and copy-status updates must not remount the working room, restart the activity feed, discard unsent text, change scope or steal focus. The producer retains its existing job, captured limits, plan and accounting through the refactor.

### Saved arrangement

The arrangement becomes the sole main page. Preserve the current score geometry, section navigation, inspection, family markers, comparison coordinates and motion. Refine the surrounding hierarchy:

```text
Session rail | Listening Room / Session name                   [More]
             | Title · Version · bars · parts     [Copy/Open in Audiotool]
             | [Sounds] [Versions]                          copy status
             |-----------------------------------------------------------
             | Existing arrangement / section view | Existing Producer
             | Existing notes / clips / inspector  | Updates + direction
```

- Keep the compact editorial header. Borrow the restrained artwork/style from the retired page only where it fits without pushing music down. Do not restore a large hero above an established arrangement.
- Keep **Sounds** and **Versions** visibly available. Rename **Sounds & tools** to **Sounds**; preserve advanced discovery inside its disclosure.
- Move **Parts** beside the arrangement's management controls. Clicking a part still opens the existing inspector; all current management/protection actions remain accessible.
- Move **Usage** into the session menu, with a direct **Review usage** action whenever a budget pause needs it. Preserve visible costs before submission/continuation.
- Put the selected version's Audiotool action/status in the header. Keep recovery/connection details in its current sheet. Use a quieter outline action so the orange revision submit remains the main musical action.
- Keep one concise listening-availability explanation at the relevant entry/handoff point. Remove repeated caveats and internal terms from surrounding UI.

One status row, one relevant recovery card and a small set of actions should explain the next step. Do not replace removed detail with verbose friendly commentary. Use actual saved summaries if useful; do not invent an artwork-driven musical description.

### Audiotool action contract

| Selected version/connection state | Visible behavior |
| --- | --- |
| No saved version | Create music first; no unusable copy button. |
| Saved, consent missing | **Connect Audiotool**; return to the current session after consent, with copying still explicit. |
| Connected, this version not verified | **Copy to Audiotool**. |
| Copying | Compact **Copying…** status, separate from musical construction. |
| Verified for this revision/current mapper | **Open in Audiotool**; **Recheck copy** is a secondary explicit action. |
| Another version was copied | State that this selected version has not been copied; preserve the earlier version's own link. |
| Conflict/unknown result | **Review copy** with server-authorized recovery; no bypassing reconciliation or repeated remote creation. |
| Expired consent | **Reconnect** where required; safe local work remains usable. |

Keep the existing explicit synchronization semantics and recent order-independent readback fix. Opening a room, selecting history, finishing a revision or reconnecting must not automatically write to Audiotool. Structural copy verification does not establish heard quality.

### Sounds, recording and source audition

Consolidate the native Sounds panel and App's Add sounds panel into one controlled sheet. Upload/record can be a subview with Back and reliable focus return; avoid two overlapping sheets.

Keep owned-source playback with compact play/pause, labeled seek/time and volume controls. One controller coordinates auditions. Stop/clear playback when leaving the panel or session so sound cannot continue invisibly. Source choices and unsent direction remain saved.

Preserve WAV validation, upload errors, recording caps, stop/use/discard, microphone-denial handling, project binding and cleanup when permission arrives after navigation. Selecting a source does not send a request; only explicitly selected source IDs reach construction and synchronization.

Sources currently have empty waveform peaks. Remove the large empty-waveform placeholder and keep useful controls. Retain wavesurfer only if a surviving feature supplies real waveform data; otherwise remove the unused dependency. New waveform generation is not needed for this pass. Library metadata/slice suggestions retain their current behavior without invented preview controls.

### Responsive and accessible behavior

Keep the logo and ivory/forest/burnt-orange tokens, owned Base UI components, Motion, Tailwind and Lucide. Use the existing score/Producer split only at its supported content width; below it preserve the current in-page view switch.

On phone, keep a compact title, accessible session menu, reachable Sounds/Versions and the safe-area-aware composer. Overflow actions need visible text in the menu and 44 px touch targets. Panels and comparison retain Escape, focus return and scroll containment. Do not add a new sticky row that crowds the keyboard or score.

Retain motion only for confirmed musical changes and existing short transitions. Reduced motion still shows all state. Status changes announce meaningfully without reading every note or repeatedly replaying old events.

## Retain/remove map

| Area | Retain or extract | Remove |
| --- | --- | --- |
| Shell/navigation | Session selection, native Start/workspace, logo, OAuth | `nativeMode`, `/audio` route/view, legacy links/controller/receipts/polling |
| Main music | Native score, section/part inspection, protections, immutable versions and comparison | Old four-stem editor and separate audio history UI |
| Source media | Source controller, recorder, WAV codec/measurement, private source storage | Whole-piece transport, legacy revision playback/A-B/restore and Return to current piece |
| Agent | Accounted OpenAI calls, limits/cache usage, checkpoints, tracing, native skills | Old `produceArrangement`, Sunroom planning/palette tools and obsolete runtime skills |
| Worker | Native construction/sync and shared lease/cancel/recovery | Legacy generate/revise/render/critique-repair/stem-export execution |
| API | Project/source/native/activity/usage/OAuth reads and commands | Legacy generation/revision/select/export/audio-version endpoints and schemas |
| Nexus | Native mapper, semantic readback, owned sample upload, OAuth/session | Four-stem export path and unused mappings |
| Persistence | Native history, useful sources, provider ledger, necessary accounting references | Unusable disposable test projects and unused legacy-only content/schema where safe |
| Tests/scripts | Native fixture/demo setup, shared safety tests, source media checks | Retired workflow demos/live runners/fixtures and feature-only assertions |

Keep internal `native-*` names where changing them would add churn. The product can use plain language without renaming stored job identities or every file.

## Delivery phases

### Phase 1 — baseline and exact deletion inventory

1. Reinspect Git and record unrelated/overlapping edits. Capture current native/browser behavior and run affected existing checks before refactoring.
2. Read current project/job data locally. Identify native-only, mixed, source-only and legacy-only testing projects; record retained heads, hashes, source references, remote checkpoints and aggregate provider totals.
3. Identify exact disposable test projects whose only useful behavior is retired. A title alone is insufficient if a project contains current native work. Keep compatible sessions and useful sources; remove only obsolete legacy content from mixed sessions where practical.
4. Check active jobs before restarting processes. Do not kill or replay an ongoing authorized job to simplify cleanup. Independent code work can proceed while it reaches a safe state.

Exit: specific keep/delete inventory, known baseline failures and shared-import map. No archive system or conversion project is created.

### Phase 2 — extract shared utilities and source controls

1. Move OpenAI accounting callbacks, request bounds and usage parsing out of `agent/producer.ts`; move checkpoint setup/singleton into a focused shared module. Preserve effect keys, model/profile capture, callback order, saver schema, thread IDs and trace privacy.
2. Move `canonicalHash` with identical sorting/serialization. Verify representative native documents and mapper readbacks retain their hashes.
3. Extract project-scoped source upload/record/audition from App's legacy controller. Reuse recorder cleanup and one audio controller.
4. Leave shared queue/effects/storage behavior intact. Extract only the code needed to remove old dependencies rather than undertaking a new general architecture pass.

Exit: native orchestration/replay/accounting tests and source recording tests pass while legacy code is still available for comparison.

### Phase 3 — native-only shell and clear workspace

1. Replace broad legacy `getProjectSnapshot` consumption with a small project/source bootstrap read. Use the existing native snapshot/activity endpoints for musical truth.
2. Render Start/workspace as the only product route. Delete global mode state and legacy props. Remove `/audio` from route matching; unknown URLs use the application's normal unavailable/fallback behavior, without special compatibility logic.
3. Implement the compact header and contextual actions above while preserving score/inspector/comparison components and their stable identities.
4. Consolidate Sounds, keeping existing native sample/preset discovery, owned sources and source transport.
5. Keep reload, Back/Forward, project switching, OAuth callback and native pending drafts/receipts working. Obsolete browser keys can simply be ignored; do not clear all localStorage.

Exit: normal create → follow → inspect → revise → compare → select flow works through one workspace, with retained source and connection functions.

### Phase 4 — remove retired execution and test content

1. Delete legacy mutation/read routes, API methods/types and generation-specific status fields. Ordinary missing-route responses suffice; no 410 compatibility layer or old-command replay API is needed.
2. Restrict job claims to supported native kinds and add an explicit unsupported-kind dispatch guard. Remove legacy generation, drum revision, render and stem export handlers. Generic receipt/cancel/usage endpoints remain for supported work and financial records as appropriate.
3. Remove old producer/compiler/renderer/repair/stem-mapper code, obsolete runtime skills, wildcard exports and styles after confirming no retained callers. Keep WAV and shared Gemini/native resource helpers.
4. Delete the identified incompatible disposable test projects through scoped local cleanup. Remove their obsolete compositions/previews/stems only after checking ownership and references. Do not cascade-delete provider effects or subtract historic spending. Retain minimal project/job accounting rows where foreign keys require them; exclude removed projects from navigation. This is accounting retention, not a legacy product path.
5. Fence stored retired jobs; unknown/dispatched effects retain their uncertainty and liability and never dispatch automatically. Do not invent terminal success or zero cost. Running work must be safely settled before its handler/content is removed.
6. Remove legacy-only schema objects when safe, using a forward migration if needed. Keep migration history valid for fresh installs and existing native data; preserve required shared/accounting references. Avoid renumbering or rewriting existing migration files.
7. Remove obsolete script entry points/config examples/dependencies and replace default demo setup with a native fixture plus small owned WAV assets. Preserve the root `.env` and effective provider limits. Remove a dependency only after its final retained caller is gone.

Exit: neither the app nor a stale client/worker can launch the retired workflow. Disposable test content is gone; retained native data, sources and total spend are unchanged except for explicitly documented cleanup.

### Phase 5 — focused verification, integrated checks and visual review

Run focused tests after each extraction. After integration, run `pnpm check`, `pnpm test:integration`, `pnpm test:e2e` and `pnpm test:visual`. Repeat affected checks when a fix changes them; do not repeatedly rerun the suite without a reason.

Use the existing isolated test database/asset roots, fixture/scripted providers and tracing-disabled/outbound-fenced tests. No paid evaluation or live Audiotool write is required. Preserve the real Midnight Escalator session and its existing verified copy.

Required evidence:

| Area | Checks |
| --- | --- |
| Single flow | Fresh session has one create path; request acceptance/lost acknowledgement opens the same workspace once; no alternate audio editor or legacy startup reads. |
| Native identity | Retained head/document/protection/replay/readback hashes and version parent/ordinal relationships unchanged by utility extraction. |
| Production orchestration | Scripted worker constructs/revises through actual tools; wrong protected candidate rejects; success selects the correct immutable version. |
| Recovery | Continue, zero-step pause, explicit allowance extension, abandonment, cancellation, duplicates, real worker restart and contention remain covered on native jobs. |
| Accounting | Cache rates, callbacks, late usage, unknown reservations, job/site ceilings and LangSmith privacy survive extraction and test-project deletion. |
| History | Before/After/Changes navigation stays read-only; explicit selection preserves expected-head checks; late responses cannot reverse selection; unsent direction survives. |
| Source media | Upload/type/size errors, project switch during upload, delayed microphone permission, cap/stop/discard cleanup, source selection and actual WAV play/pause/seek. |
| Media lifecycle | One audible source; closing Sounds or leaving a session stops it. Native arrangement never acquires a misleading Play control. |
| Retired paths | Old endpoints absent, unsupported stored jobs fenced, no new job/effect/outbox/provider action from stale calls; normal native commands still work. |
| Cleanup | Only inventoried test projects/content removed; current native/source data survives; provider totals/reservations do not fall because of deletion. |
| Ownership | Cross-owner project/source access and byte-range/path checks remain enforced; no preview/stem accidentally becomes a source. |
| Navigation/auth | Direct native routes, reload, Back/Forward, unavailable session and OAuth callback return work without resubmission or loss of native drafts. |
| Audiotool | Offline SDK/readback/reconciliation tests pass; action labels reflect selected revision/current mapper; unknown effects never cause duplicate creation. |
| UI/layout | Desktop, split breakpoint/tablet, 390/360 px phone, 200% zoom, keyboard-height composer, large 128-bar/24-part fixture, Sources and comparison remain usable. |
| Accessibility | Keyboard sequence, labels, focus return, Escape, touch targets, contrast, reduced motion and sensible status announcements. |

Inspect screenshots and actual interaction, not only snapshots. Preserve the current score visual contract. Physical-device, screen-reader and non-Chromium checks must be described as verified only when performed. Recheck imports/build output for unnecessary legacy loading after deletion. Transfer shared tests from obsolete fixtures rather than deleting their protections with the feature.

Exit: meaningful maintained tests pass, retained-data/accounting checks match, and no reproducible new defect remains in preserved behavior.

### Phase 6 — docs and reviewed commits

Update current project instructions, architecture, native contract, ADR, design system, README/setup, testing and STATUS to describe one supported workflow. Historical records stay dated. Coordinate course/walkthrough references while preserving their current unrelated edits.

Suggested commit boundaries:

1. Extract shared accounting/checkpoints/hash and source controls.
2. Unify the Listening Room shell, Sounds panel and action hierarchy.
3. Remove legacy generation/API/worker code and update fixture setup.
4. Add retirement/cleanup regression coverage and record actual evidence/docs.

Inspect every staged diff and the combined change, preserving unrelated working changes. Record exactly which test projects/files were removed and whether project records are recoverable. Do not commit credentials, local data dumps or personal audio. Retained financial records need no product UI.

## Completion and boundaries

The final report should give removed features, retained behavior, exact test results, representative desktop/phone evidence, test-project cleanup results and remaining limitations. Intended hands-on path:

1. New session → direction → optional sound → Create arrangement.
2. Follow Producer → explore arrangement and sections.
3. Choose a section/part → give a protected revision → compare → explicitly select another saved version if desired.
4. Copy the selected version to Audiotool or open its verified copy.

No legacy archive or compatibility journey remains. Native in-app rendering/listening, Gemini full-mix critique, audio-reactive score motion and automatic synchronization stay deferred. When rendering is implemented, its audio will reference the exact saved native version/hash and appear in this same workspace.
