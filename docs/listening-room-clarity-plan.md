# Listening Room clarity and prompt assistance

Implementation pass — 2026-09-27, on HEAD `991f894` plus the preserved uncommitted sound-craft pass. The plan below records the agreed scope; the implementation summary in `STATUS.md` records actual checks and limitations. Multi-user authentication and per-user quotas remain explicitly outside this pass.

## Desired experience

Home → start a session → write, rewrite or receive an idea → explicitly create → follow the Producer → explore the arrangement → request a focused change → review the result.

The music stays central. Ordinary screens show what the user can do now, not implementation mechanics. Keep the existing logo, Listening Room palette/type, score representation, section inspection, protected revisions, version history and explicit Audiotool-copy behavior. Do not introduce a second workspace or pretend the composition is playable.

## Findings in the current tree

| Area | Current evidence | Proposed disposition |
| --- | --- | --- |
| Overview | `index.css` has horizontal overflow, but `.score-canvas` is always 100% width; there is no overview vertical height limit. Labels explicitly ellipsize. | Add useful intrinsic timeline width and bounded scrolling for tall scores. Resolve long labels separately. Do not assume every clipped label is a timeline overflow bug. |
| Logo/home | `Brand` is a div; `App` resolves `/` to the newest project on startup and browser history. | Make the logo a real home link and make `/` a stable home destination. |
| Follow-up form | Scope is repeated in subtitle and chips; default Whole piece chip adds no choice. | One compact scope control; no default scope badge or explanatory subtitle. |
| Costs/settings | Composer cost paragraph, Usage menu/sheet, recovery usage link and raw extension fields expose accounting and runtime knobs. | Remove from product UI, retain financial controls and operator diagnostics. |
| Explanation overload | Permanent version footnote, connected feed status, profile label, note-count caption and repeated source caveats. | Remove duplication; explain at relevant decisions or behind concise help. |
| Prompt help | No Rewrite/Inspire implementation. | Add a distinct, accounted server helper, not another producer run. |
| Audiotool identity | Stored status exposes connection and user name. Installed Nexus 0.0.17 User type has `displayName` and `avatarUrl`. | Add optional profile display with safe fallback; connected credentials stay server-side. Live profile retrieval is not yet verified. |

## 1. Make the overview fully reachable

- Retain the existing density bars, phrase ribbons, section selection, part inspector and confirmed-construction motion.
- Give the time area a content width based on readable bars/sections rather than squeezing every score into the container. Start with a minimum timeline width around 720px and an adaptive per-bar width; tune against 40-, 96- and 256-bar examples. Keep DOM/SVG complexity bounded.
- Allow horizontal scroll inside the overview only, not on the whole page. Keep part labels sticky on the left and the ruler sticky at the top with opaque backgrounds and correct stacking at their intersection.
- Allow vertical scrolling when the score exceeds a viewport-relative height (starting target approximately 55dvh, desktop maximum around 560px). Small scores should size naturally, without an unnecessary nested scrollbar.
- Use a visible scroll affordance when overflow exists, without a permanently animated hint. Native touch/trackpad and keyboard navigation must work. The focusable region already exists and should retain its accessible name.
- Use a wider, two-line part-name column where practical. Full names remain available in the inspector and accessible labels; hover must not be the only way to read them. Support long unbroken names without widening the page.
- Preserve scroll position during routine job updates, reset deliberately on a new session, and do not steal scroll while the user inspects older material.
- Replace the permanent numeric note-count explanation with a small “About this view” disclosure. Keep the distinction between note activity and loudness, and any actual display truncation warning, available there. A limitation that hides data must remain discoverable, not silently disappear.

Acceptance: last bar and last part can both be reached by mouse, touch emulation and keyboard; full long names are readable; no viewport overflow at 390px or 200% zoom; section/part inspection and comparison geometry still work. Test 1/5/24/48 parts, short endings, uneven section lengths and long scores.

## 2. Make navigation predictable

- Convert Brand into a semantic link to `/`, preserving the supplied mark and wordmark, accessible name, focus state and normal modified-click behavior.
- Define `/` as the existing welcome/home surface, with New session and access to recent sessions. Do not silently reopen the newest project.
- Update startup, `popstate`, direct URLs and OAuth return handling together. Home must stay home after refresh and Back/Forward.
- Home navigation closes the mobile drawer and invalidates old project reads without cancelling background jobs or losing the session's saved direction. Keep local draft persistence working before unmount.
- Ensure session errors do not strand the user: the logo still returns home from unavailable or deleted project URLs.
- Remove “Your private music workspace” from desktop footer and mobile sheet description. Retain a concise accessible sheet description such as “Your sessions” where needed.

Acceptance: logo works from start, active generation, saved arrangement, error state and mobile navigation; going home creates no empty project, sends no request and cancels no job; returning to a session restores its draft.

## 3. Simplify creation and follow-up forms

- Remove “Your idea first · Sounds are optional”. Keep one helpful starter placeholder instead of hero metadata, a direction subtitle and example text all saying the same thing.
- Keep one form heading: initial “What would you like to make?” and revision “What would you like to change?” Avoid a second title within the same visual block.
- Remove the default Whole piece/New arrangement badge and “Across the whole piece · choose any part” subtitle. This does **not** remove Whole piece from score navigation: that control returns to the overview and has a real function.
- Use one compact scope control, labelled “Change scope”, defaulting to Whole piece. When scoped, show the real section/part name once. The overview's inspection selection and the revision's change scope remain separate until the user chooses Change.
- Keep preservation visible and actionable: names rather than only “Keep 2 parts”; expand a concise summary if there are many. Never hide unresolved preservation, stale-version or missing-source warnings.
- Show selected sounds only when there are any, linking to Sounds. Do not duplicate selection counts elsewhere in the form.
- Move Depth to a quiet options popover if retained; keep the existing selection/defaults and captured production envelopes. Hide the character count until near the actual limit. Do not change generation depth by removing a display control.
- Remove the permanent successful-revision/comparison footnote. After success, say “Version 2 is now current” with Review change. In comparison, keep an explicit “Use this version” action and current badge. These controls explain behavior at the decision point.
- While a request is active, keep “Not sent” next to a follow-up draft; do not imply drafts are queued. Keep cancellation and valid saved-draft recovery.
- Group helper actions close to the textarea; keep Create arrangement / Make this change as the only primary action. Use consistent spacing, reasonable textarea min-height and 44px touch targets. On mobile, avoid a sticky control covering the textarea or device keyboard.

Acceptance: no redundant Whole piece chip/subtitle; protections and scope remain clear; rewrite cannot remove locks; successful revision selection, comparison and explicit restore behave exactly as before.

## 4. Remove budget UI without removing safety

- Remove inline allowance text/loading, Usage menu/sheet, observed/held/unknown dollar values, request-cost labels and financial fields from normal product screens.
- Replace “Review usage & next steps” with contextual recovery actions, not another technical settings panel.
- Remove raw model-call/token/runtime extension fields from the consumer UI. Keep supported operator commands/API safeguards and internal records; no automatic limit increases and no automatic paid retry.
- A paused request still needs truthful, actionable status. Show “This request is paused. Your progress is saved.” Offer Continue only if the server says it can proceed under existing limits; otherwise explain that it cannot continue with the current setup, with retained draft and start-fresh/leave options where safe. Do not label financial exhaustion as a network failure or present a useless Continue loop.
- Keep unknown remote-effect restrictions and reconciliation actions. Technical diagnostics may remain in local operator logs/docs, not another consumer-facing budget disclosure.
- Audit error mapping, progress payload presentation, abandoned-draft dialogs and Producer history, not just the two visible screenshots. Never edit historical accounting to simplify the wording.

Acceptance: no budget/allowance/dollar/token discussion on create, revise, working, paused, failed, options or mobile surfaces; existing accounting, reservations, idempotency, continuation eligibility and exhaustion tests still pass.

## 5. Reduce secondary noise across the room

- Producer: no permanent “Updates saved with your session” line while healthy. Show connection status only when reconnecting or otherwise relevant. Keep actual confirmed progress, recovery and saved-version events.
- Remove Standard/Extended creation labels from normal conversation rows. Keep original direction, meaningful scope and result. Preserve chronological history and read-only earlier activity.
- Keep Sounds and Versions discoverable, Manage parts beside the score, and the primary explicit Copy/Open in Audiotool action. Avoid repeating connection details as another prominent link when the account menu can hold them.
- Keep honest source-only playback and rights information in Sounds, but consolidate repeated caveats into one concise explanation and a details disclosure. Do not erase source provenance or claim an unheard composition is playable.
- Keep technical units, hashes, mapper details and raw parameter payloads inside existing inspection/technical disclosures rather than overview copy. Musical details in section inspection are intentionally retained.
- Maintain quieter secondary text and whitespace rather than shrinking all text. Check the start screen, workspace, follow-up sheet, Sources, Parts, Versions, comparison, paused state and mobile navigation as one system.

## 6. Rewrite prompt and Inspire me

### Interaction contract

- Empty, untouched initial direction: **Inspire me** writes one creative starting direction into the editor. It runs only on click, never on page load. Once text exists, show **Rewrite prompt** instead. Clearing text deliberately can make Inspire available again.
- Nonempty direction: Rewrite preserves the current text until the suggestion succeeds, then replaces it with an editable result and offers **Undo rewrite**. Do not require a modal or show two permanently competing textareas.
- Retain an in-session original/suggestion record. Undo must not silently erase edits made after insertion: if text changed again, offer the previous text for deliberate restoration instead.
- Revision composers offer Rewrite but not generic Inspire. An empty follow-up should not invent an unrelated song; it should invite a change to the current piece.
- Generated text remains a draft. No auto-submit, new version, source attachment, lock change or Audiotool copy. Enable normal submit only after assistance finishes or is cancelled, so the sent text is unambiguous.
- While waiting show “Rewriting…” or “Finding an idea…” with cancellation. If the user types, navigates, changes head/scope or selects sounds, do not overwrite newer work when the response arrives. Tie results to draft identity, input hash, head and scope.
- On failure, keep the user's input and show a short recoverable message. Never substitute a canned template while presenting it as a live Luna response.

### What makes a useful musical prompt

The helper is a creative translator, not a verbosity amplifier. Preserve the user's desired feeling and constraints while adding a few musically useful relationships:

| User signal | Useful translation | Avoid |
| --- | --- | --- |
| “Warm but restless” | Soft-edged sounds with an active, unsettled rhythmic relationship | A pile of mood adjectives or unrelated genre changes |
| “Minimal” | Few voices, intentional rests, variation through rhythm/timbre | Automatically adding eight tracks and a huge payoff |
| “Bigger ending” | Develop the existing motif, register and rhythmic energy toward an arrival | Treating louder as the only development |
| Exact BPM/key/length/instrument | Retain exact value and status as a requirement | Rounding, replacing or burying it |
| Exclusion or preservation | Preserve every negative constraint and named protected element | Turning “do not change bass” into “change bass” |
| Vague input | Propose a coherent sound world and an interesting evolving relationship | Forcing arbitrary exact bars/key/BPM into every prompt |
| Detailed brief | Improve organization with all requirements intact | Summarizing away requirements to hit a word target |

Default output is a compact creative brief, often 60–140 words for a vague starting idea, shorter for a small revision. Detailed input has no arbitrary short-summary target. It should cover only relevant aspects of character, pulse, sound palette, motif, space and development. Added creative suggestions should be expressed as suggestions rather than falsely attributed to the user. It must not invent attached recordings, unavailable resources, heard quality or completed actions.

Illustrative rewrite, not a template:

Input: “Something warm and strange for a late-night drive, not too busy.”

Possible result: “A warm, slightly uncanny late-night instrumental with an unhurried pulse and plenty of space. Let a rounded bass pattern carry the motion beneath soft, worn synth chords. Introduce a small off-centre motif that returns with subtle rhythmic changes. Build interest through texture and interplay rather than adding lots of parts, then let the ending open out and settle.”

For “Make the ending lift, but do not change the bass”, keep the bass instruction verbatim and suggest a lift through other material. UI locks and server protection checks remain authoritative regardless of generated wording.

Inspire should vary mood, density, rhythmic character, instrumentation and development between explicit requests. Supply a small recent-suggestions history to avoid repeats, not another fixed two-template composer. Inspiration remains grounded in supported editable musical capabilities.

### Server and model design

- Dedicated helper service/endpoint using `gpt-6-luna`, separate from the Sol producer configuration. Use the Responses API with a small validated structured result; no tools, browsing, audio analysis or full Deep Agent workspace are needed.
- Official OpenAI documentation confirms the model ID and structured-output support: https://developers.openai.com/api/docs/models/gpt-6-luna (checked 2026-09-27). Actual account access has not been tested. The current local pricing registry has no Luna entry; add verified pricing as part of implementation rather than treating requests as free.
- Pass the direction as untrusted user content plus only relevant intent, revision scope, exact protections and a compact supported-capabilities description. Do not send the entire score, secrets or previous conversation by default. Do not allow prompt text to change server policy.
- Keep explicit UI protections outside generated prose. Preserve original and proposed text for audit/undo, but pass only the chosen final direction as the creative instruction; do not secretly reintroduce old prose after the user deliberately edits it. Extracted constraints are a validation aid, not permission to override later user choices.
- Validate response schema, length, nonempty content and explicit structured constraints. Use regression evaluations for semantic preservation; string matching alone is not sufficient. Reject clearly conflicting rewrites without replacing text. The user reviews editable text before creation, and domain protection checks still run later.
- Capture model/settings per helper request, reserve and settle provider usage through existing accounting, enforce server bounds and deduplicate double-clicks/retries. Introduce a small helper-request record if the current provider-effect schema requires a job identity; do not create fake composition jobs or progress events.
- Initial engineering envelope: one model call, low reasoning, a bounded output appropriate to the input and a short timeout. Accommodate the existing 32,768-character input limit without silently truncating detailed briefs. Measure latency/output needs in tests before finalizing values. No automatic retry after an uncertain dispatch; keep any late usage accounting even if the user has left the page.
- Preserve tracing privacy settings. Ordinary tests inject a scripted helper and cannot reach providers. Live quality/access checks require the applicable allowance; adding this feature is not an unlimited spending authorization.

### Evaluation cases

Vague mood; sparse arrangement; ambitious detailed brief; supplied tempo/key/length; no-drums/no-vocals exclusions; “keep melody and bass”; “do not change bass”; a selected section and protected part; contradictory user requirements; long multilingual text; misleading instructions embedded in the prompt; repeated inspiration; typing during a late response; navigation/refresh/cancellation; double clicks; unavailable model; uncertain billing.

Grade intent fidelity, constraint retention, concrete musical usefulness, restraint, originality and readability separately. Scripted tests prove contracts and routing, not creative quality. A later bounded live sample must inspect original → suggestion pairs and an actual chosen prompt entering the producer; do not restart an old paid job.

## 7. Add a quiet Audiotool profile row

- At the sidebar bottom, show connected display name and a small circular avatar; initials/generic account icon when missing or unavailable. Remove the old private-workspace slogan entirely.
- Resolve profile through the existing server-side connection and installed UserService, returning only safe display fields. Cache it by connected identity; clear it on disconnect/account change. No token or private profile payload reaches the browser.
- Validate avatar URLs against the actual supported Audiotool image hosts during implementation. Use a safe image policy and initials fallback; do not build an unrestricted URL-fetch proxy.
- Clicking opens existing connection/account actions. On mobile, place the row at the bottom of the navigation sheet without covering sessions or safe areas.
- Connection/profile failure does not block music work. This is a display of the connected Audiotool account, **not** proof of Pocket Producer multi-user login or isolated accounts.

Acceptance: connected/disconnected/expired/empty/broken-avatar/late-account-response fixtures; long names and keyboard focus; actual profile fetch remains separately labelled until live-verified.

## Implementation order and review checkpoints

1. **Overview reachability:** `native-score.tsx`, `index.css`; horizontal/vertical scroll, label readability, keyboard and large-score tests.
2. **Logo and real home:** `brand.tsx`, `App.tsx`, `session-route.ts`; route, draft and active-job regression tests.
3. **Composer cleanup:** extract a focused direction-composer component from `native-room.tsx`; remove duplicated text/chips and simplify scope/protection presentation without moving domain logic into UI.
4. **Budget presentation removal/recovery:** `native-room.tsx`, `ui-copy.ts`, public activity presentation; retain backend eligibility and accounting tests, remove technical settings from product UI.
5. **Secondary-surface cleanup:** `producer-feed.tsx`, Sounds/Versions/connection sheets and responsive CSS; audit all removed strings and context-sensitive explanations.
6. **Prompt-helper backend:** typed request/result contract, Luna provider configuration/pricing, effect accounting/idempotency, scoped context and offline tests.
7. **Prompt-helper UI:** Inspire/Rewrite/Undo, loading/failure/cancellation, persisted draft provenance and race guards; production-path scripted tests.
8. **Connected profile row:** minimal profile adapter/status contract, cache/fallback and desktop/mobile account display.
9. **Integrated review:** targeted tests → strict types/lint/unit/build → serial isolated PostgreSQL integration and Chromium journeys → desktop/mobile/zoom/reduced-motion screenshots. Inspect diffs and document actual evidence in STATUS/design docs.

Keep each checkpoint reviewable on its own. Do not stage unrelated pending sound-craft work into a UI change by accident. No deletion of testing projects is necessary for this plan.

## Regression bar

- No changed canonical documents, version hashes, current-version rules, protections, job leases, source ownership, external-copy rules or accounting.
- Preserve start → work → inspect → scoped revise → compare → explicit select, including saved draft recovery and late responses.
- Preserve source-only audition and microphone cleanup; native full-mix playback remains deferred.
- Keyboard: logo, scroll region, scope, helpers, locks, submit, menu/dialog focus return and browser history.
- Responsive: 390px phone, tablet, desktop, 200% zoom, long names and 48-part scores. No whole-page horizontal overflow or keyboard obstruction.
- No normal UI budget discussion; no hidden automatic allowance increase. Blocked actions explain the saved state without pretending they can continue.
- No helper response can submit, mutate a score, clear a protection, switch a project or overwrite newer typing.
- No fresh provider, LangSmith or Audiotool traffic from ordinary tests. State separately what is offline, real-provider, live-profile and human-reviewed.

## Ordered user-facing change list

1. Scroll the full arrangement and read complete part names.
2. Click the logo to return to a real homepage.
3. Remove the two requested slogans everywhere.
4. Remove budget/usage/runtime detail from the product UI.
5. Simplify the follow-up form and show change scope once.
6. Keep only meaningful preservation/source indicators.
7. Move version explanations to completion/history/comparison.
8. Quiet healthy Producer status and secondary technical copy.
9. Add editable Inspire me and Rewrite prompt with safe undo.
10. Add the connected Audiotool avatar/name with fallbacks.
11. Verify responsive layout, accessibility and existing creation/revision/recovery behavior.
