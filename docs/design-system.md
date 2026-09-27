# Listening Room design system

## Producer chooser (2026-09-27)

The composer footer includes a labelled native select, styled with existing ivory/forest tokens; on phones it has a full-width row. No new primitive family or UI dependency. Selection belongs to the project-local unsent direction and applies only to new requests; active work hides the control rather than implying an in-flight model switch. Unconfigured options are disabled. Availability is configuration, not live credit verification. Preserve keyboard-native selection and readable labels; do not reintroduce a budget dashboard into the composer. Desktop/390px evidence: `.local/evidence/model-picker-{desktop,phone}.png`.

## Current clarity increment — 2026-09-27

Keep the logo, palette, editorial typography and existing musical score/inspection/compare interactions. The start hero and direction surface now share a content edge. One composer footer groups prompt help, Undo, optional sound and Options opposite Create; phone submission has its own full-width row. Settings use the existing owned Base UI dialog. Rewrite success is a brief screen-reader announcement, not another visible instruction.

Before musical structure exists, the workspace centers a compact Producer panel instead of an empty score canvas. Once confirmed music exists, the existing score-first layout returns. Running or paused requests disclose **Draft next change** rather than a disabled creation form. The draft remains local and never auto-sends. Long messages switch between a three-line preview and the same expanded paragraph, with Read more/Show less and accessible expanded state.

Use Working/Paused/Draft/Version N · Current only where true. A stored unfinished draft is not "unsaved" and must not be passed to Audiotool. Pauses explain the specific cause once; raw diagnostics are in Details. Continue is only offered for a safe continuation or an explicit supported call-limit extension. Ending an attempt is secondary and confirmed. Successful revisions still become current automatically; comparison remains read-only.

Copy/Open in Audiotool is prominent beside the session title. When an unfinished draft is displayed over an accepted version, label the action **Copy Version N to Audiotool**. Connection and history use content-sized dialogs; sound and instrument browsers retain their sheets. Compare is omitted until two versions exist. Dialogs return focus to their invoking control. No new dependency, primitive family, component generator or paid kit was introduced; owned React/Base UI components and CSS remain the upgrade boundary. Check keyboard/focus return, phone overflow, reduced motion, late-response handling and explicit recovery/copy on upgrades.

## Single composition workspace (2026-09-27; supersedes earlier dual-history entries)

There is no Arrange/Playable audio product switch. The retained score, section inspection, confirmed motion and comparison geometry are unchanged. The compact editorial header now owns the explicit Audiotool handoff; Sounds and Versions remain visible, Usage and connection details move to the session menu, and Manage parts is grouped with arrangement actions.

Sounds combines upload, record, source selection and a compact source-only transport with labeled seek/volume. Its secondary sound-ideas disclosure now lists original, explicitly unheard local parameter recipes. Connected users can inspect one short Audiotool sample's measured slices, audition those original bytes with a native browser control and save a project-specific fit note; that control is not the arrangement player. No empty waveform or whole-song controls ship; wavesurfer was removed because no remaining view supplied real waveform peaks. Source preview stops when its sheet or session closes. Uploaded sounds refresh on reopen; late permission resolves to stopped tracks.

Owned shadcn source still uses Base UI consistently; no new UI framework/kit. The React review checklist informed late-response guards and cleanup. The original logo, ivory/forest/orange tokens, serif headings, Motion/SVG/CSS score remain. Upgrade through the pinned workspace lockfile, inspect generated Base UI changes, and rerun unit/integration/browser/visual checks including menu/dialog focus and source lifecycle.

Earlier dated entries below describe historical passes, not supported audio compatibility. Current UI contract: Start → workspace → scoped change → read-only comparison → explicit version choice; successful revisions still become current automatically. Physical keyboard/screen-reader and non-Chromium checks remain separate gates.


## Current: Start and Producer workspace — 2026-09-26

Keep the existing logo, ivory/forest/burnt-orange palette, editorial typography and score geometry. Start asks for one idea with optional sounds and collapsed creation settings. Acceptance opens a compact working room: the score is primary, Producer contains persisted directions and confirmed updates, and Sounds, Parts, Versions, Usage and Audiotool open only when requested. The existing score, inspector and Before/After/Changes components are unchanged; the surrounding layout is not a replacement DAW.

The owned `producer-feed.tsx`, `use-producer-activity.ts`, `producer-workspace.css` and URL adapter compose existing React, shadcn/Base UI, Tailwind and Lucide. No component CLI, paid kit, new primitive family or dependency change was needed. A 350 px Producer column is used only when the content container is at least 1,060 px, retaining a 680 px score. Below that, a keyboard-operable Arrangement/Producer switch avoids squeezing the score or adding a second modal workflow. Tools reuse existing Base UI sheets and focus behavior. Phone input uses 16 px text, dynamic-viewport feed height and safe-area padding.

Activity is plain text with long directions collapsed, 30 mounted rows and explicit older pages. New updates do not move someone reading older messages. Historical rows do not animate on reload; confirmed score motion retains its existing identity/reduced-motion guards. Public updates describe intention or committed musical facts, never private reasoning, raw tools or tracing. A new direction remains explicitly unsent while work runs and requires scope review if the selected version changes.

Upgrade checks: preserve dependency pins and owned control source; run check/integration/e2e/visual suites, inspect wide desktop, intermediate/tablet and phone states, ensure the score still has useful width, verify dialog return focus and keyboard/safe-area behavior, and test lost acknowledgements plus restored history. React review kept the feed bounded/memoized and the score callbacks stable; this is not an exhaustive screen-reader or performance certification.

## Historical: focused score and confirmed-change polish — 2026-09-26

Focused correctness addition: **Leave this draft** uses the existing owned Base UI Dialog, with explicit confirmation that versions, unfinished work and spending remain. It is offered only for safe paused work, not unknown outcomes. **Refresh arrangement** retries failed reads without sending the direction. Existing score geometry, Motion behavior, branding and dependencies are unchanged; comparison includes sidechain dependencies and never calls an unsupported check “verified unchanged.”

The working score takes the full panel width unless **Sounds & tools** is opened. A compact established-session hero retains the logo and editorial palette. Section inspection is separate from revision scope; focused detail replaces the overview until explicitly reopened. The direction form follows the score on every viewport, while phone users have a safe-area shortcut hidden during form focus. **Manage parts** discloses the secondary ensemble controls instead of repeating them by default.

The responsive part inspector reuses the owned Base UI Sheet, with initial heading focus, Escape return and an explicit transfer to the direction field for **Change this part**. Comparison has a scrollable evidence body, visible header/footer, relevant-parts default and read-only Before/After/Changes. Family markers use names and original/variation relationships alongside a four-color sequence; color is supplementary and collisions are possible. Paired pitch/time coordinates, guides and exact musical facts carry the meaning.

No dependency or primitive migration was needed. Owned `native-score.tsx`, `score-detail-lane.tsx`, `score-inspector.tsx` and `score-presentation.ts` compose the existing Motion/Base UI/SVG/CSS stack. Confirmed note changes animate for 360 ms, previous outlines 260 ms, clips 320 ms, curves 300 ms and grouped lane highlights 550 ms. Only a bounded changed subset animates; reduced motion presents final geometry. Late/duplicate receipts and reload cannot fake ongoing construction. Step/linear control plots reflect stored interpolation; unsupported curved easing is shown as points, not a guessed curve. There is no native playhead or audio-reactive behavior.

Upgrade checklist: retain pinned compatible versions, review generated primitive changes, run `pnpm check`, `pnpm test:integration`, `pnpm test:e2e` and `pnpm test:visual`, inspect desktop/phone/tablet and motion evidence, and confirm scope/focus/version behavior. The React quality review led to stable score callbacks and comparison-only diff calculation so typing and opening history do not rebuild an unchanged large score. See [the behavior contract](living-arrangement.md) and [measured checks](testing.md). Earlier dated design decisions below describe their original pass, not the current layout.

## Historical: first living score and comparison — 2026-09-26

The central **Your arrangement** surface now projects the native document rather than decorating the five-section fixture. The existing ivory/forest/burnt-orange tokens, Pocket Producer logo, editorial headings, Base UI controls, Tailwind and Lucide remain. `native-score.tsx` adds an owned SVG/CSS lane composition with section-width proportions, per-bar note-start density, phrase and clip tracks, role labels, selected-section detail and a fact panel. Motif-family colors are a stable hash of explicit provenance, not a claim that similar-looking phrases sound alike. A focused section spans at most eight bars of detailed notes at once; larger pieces can be navigated without a DAW-scale DOM. The score shows a textual legend/caption and each SVG has a summary label, so color and motion are not the sole conveyors of meaning.

Pinned `motion@13.4.0` (Motion for React) is the only new visual dependency. It animates a bounded density delta after a **confirmed** draft step; plans and unsaved speculation never move the score. `MotionConfig reducedMotion="user"` and the existing CSS media rule honor reduced motion. This does not use or invent an audio playhead. The comparison dialog now has a responsive wide desktop measure and a phone-sized scrollable layout, with clear read-only Before/After/Changes navigation and explicit version-selection buttons. Comparison focus return is browser-tested. The native phone page keeps the composer before the longer arrangement; the score can be scrolled horizontally with keyboard focus and has no document overflow at 390 px. The shared playback controller and older audio room were not changed by this visual layer.

Source/provenance: `apps/web/src/features/native/native-score.tsx` and `score.ts` are owned music-specific components above the existing locally owned shadcn/Base UI controls. The selected primitive family did not change and no CLI-generated component was added. When upgrading Motion, Base UI or Tailwind, keep exact pins, inspect component/dependency diffs, rerun the score projection and browser journeys, and visually review desktop, phone, tablet, dialog and reduced-motion states. See [the truth contract](living-arrangement.md) and [verification](testing.md).

## Historical: guided room redesign — 2026-09-24

The user-supplied arrangement mockup informed the new shared `RoomHero`, compact section artwork, two-column workspace, part cards, contextual direction composer and right-side sound/inspiration/Audiotool panels. It is a visual reference, not a source of licensed assets or a specification for unavailable play/share buttons. The existing Pocket Producer mark and wordmark remain in the desktop rail, mobile bar, navigation sheet and favicon. Hero and section art are owned CSS shapes; the mark itself is unchanged. At 390 px, the composer moves before the arrangement and parts so the first action is reachable without traversing a long card list. The playable-audio view uses the same hero, cards, spacing and language system, while keeping its actual waveform/player.

Default-facing labels now say **Arrange**, **Playable audio**, **Your sounds**, **Shape the arrangement**, **Keep unchanged**, and **Compare arrangements**. Raw SDK/provider information sits in optional technical disclosures; validated canonical counts and change summaries drive prominent text. A native arrangement has no Play or Share control because rendering/sharing are not implemented. Owned WAVs can be auditioned through the existing single `usePlayback` controller, including from the Arrange sidebar. Switching to an empty Playable audio view clears a source audition rather than carrying invisible playback across modes. Structural comparison and audio A/B remain distinct.

No new library or primitive family was added. `RoomHero` is an owned composition above existing Base UI Button/Dialog/Sheet/Radio Group/Textarea controls. The interface still uses the pinned shadcn/Base UI/Tailwind/Lucide stack. The new copy and confirmed-fact helpers live in `apps/web/src/lib/ui-copy.ts`; music-specific state and API calls remain in the room controllers. Future upgrades should preserve the explicit section/part/protection scope semantics, the absence of native playback, the logo asset and single playback clock. Recheck generated component diffs and the Slider accessible-name forwarding before any primitive upgrade.

## Direction

The interface follows the selected Listening Room mockup: warm ivory canvas, forest structure, burnt-orange action, editorial Georgia headings, restrained Geist body type and generous negative space. It is a music workspace, not a stock admin dashboard.

Core tokens live in `apps/web/src/index.css`:

| Role | Token | Value |
| --- | --- | --- |
| Canvas | `--background` | `#f4f1e9` |
| Ink | `--foreground` | `#18251f` |
| Forest | `--forest` | `#25483b` |
| Action | `--primary` | `#b83f19` |
| Card | `--card` | `#fcfbf7` |
| Quiet surface | `--accent` | `#e9e4d8` |

The cover art is generated with CSS shapes and grain, so no unlicensed visual asset ships. The only audio fixture is generated by repository code.

The user-supplied Pocket Producer logo sheet is the reference for `apps/web/public/pocket-producer-mark.svg`: overlapping forest and warm-olive organic shapes, an ivory ring and burnt-orange center. The shipped asset is a small, transparent, hand-traced SVG mark rather than a crop of the multi-variant sheet. `Brand` pairs it with the two-line Georgia wordmark in the desktop rail, mobile bar and navigation sheet; the same mark is the favicon. The wordmark remains real text, and the adjacent mark is decorative for screen readers. No remote font, image service or logo package is required.

## Component provenance

`apps/web/components.json` records shadcn CLI 4.21.0, `base-nova`, Base UI 1.8.0 and Lucide. The initial generated source was inspected and then themed in place. Owned components include Button, Dialog, Sheet, Slider, Textarea, Input, Label, Progress, Radio Group, Alert, Separator, Tooltip and Dropdown Menu. Base UI is the single primitive family.

The generated Slider wrapper was intentionally amended to forward the consumer's accessible name to the actual native range input emitted by Base UI. This was found by inspecting the finished DOM; the browser snapshot now exposes “Seek through the current version” and “Playback volume”.

Music-specific composition lives above primitives: `AudioPlayer`, source pills/tray, arrangement sections, the direction composer and version comparison. wavesurfer.js receives the same `HTMLAudioElement` used by the transport and has interaction disabled, avoiding competing playback clocks. Playback identity is explicit (`source` or immutable `revision` plus ID); source and A/B audition cannot silently leave the transport pointing at the wrong bytes.

The native room reuses the same tokens and Base UI buttons/dialog/radio controls. Its arrangement cards, protected part grid, source selection, capability search and structural version comparison are composed locally in `apps/web/src/features/native/native-room.tsx`. The direction composer follows the score directly in DOM order at every width. Part management and Sounds/tools are explicit disclosures; the established-session hero is compact. A phone-safe **Describe a change** dock focuses the inline form and disappears while the form has focus. The advanced SDK catalogue is collapsed until requested. Explicit whole-piece/any-part controls avoid an accidental hard edit scope. Pairwise compare describes selected-versus-current structure; keep/unlock changes are explicit. There is one composition room, with no separate playable-audio history. Sync shows local, past verification, uncertain or conflict state; a saved consent session is required to offer it. The 390 px fixture capture confirms composer placement and no horizontal overflow, not physical keyboard behavior.

## Responsive and accessibility behavior

At tablet width the left session rail becomes a Base UI sheet. Below 700px the player stacks, the section strip scrolls horizontally, the composer stays in document flow, and bottom padding includes `env(safe-area-inset-bottom)`. Reduced-motion media queries collapse animation and transition durations to `0.01ms`.

Verified behaviors and evidence are in `docs/testing.md`: computed 4.5:1 text/action contrast assertions, keyboard-opened sheet and dialog, focus return, named source/version seek controls, A/B selection and restore, reduced-motion emulation, mobile focused-input visibility and desktop/mobile screenshots. Physical-device verification remains separate.

## Upgrade procedure

### September 27 clarity increment

`features/native/direction-composer.tsx` owns the lighter start/revision form; `clarity.css` contains its Listening Room overrides. Existing locally owned shadcn/Base UI buttons and account dropdown, native selects/disclosures, Tailwind tokens and Lucide icons are reused; no dependency or primitive-family migration. The supplied logo is a semantic home link. `/` stays on Home, including reload/history; session URLs retain unsent text.

The score representation/inspection is unchanged. Its overview now has a content-sized timeline inside a keyboard-focusable two-axis scroller, sticky ruler/part labels, wrapped names and viewport-bounded height. Avoid adding `scrollbar-gutter: stable` to this geometry without testing the final bar: Chromium left the last scrollbar-width of content inaccessible with that setting. The numeric explanation is under About this view. Phone layout removes the empty breadcrumb gap and stacks score actions; touch controls and safe-area padding remain.

One Change scope selector and one named preservation summary replace duplicate whole-piece chips/subtitles. Depth stays under Options; budget/runtime/accounting detail is not consumer copy. Actual failed/paused states still retain progress and recovery actions. Inspiration/rewrite is editable, cancellable text assistance, never a producer submission. Undo is safe only while the inserted suggestion is unchanged; otherwise Original direction remains inspectable. Stale responses cannot replace later typing, changed scope/head/sources or another room. The connected account row supports a safe Audiotool avatar or initials, but does not imply multi-user application authentication.

Recheck Home/history, large-score end scrolling, keyboard focus return, phone overflow, reduced motion, helper cancellation/late responses and the create/revise/compare/restore journey when upgrading these controls. Live model prose quality and physical-device checks are separate from fixture browser evidence.

1. Update one primitive family/version at a time and keep exact dependency versions.
2. Run the shadcn command against a temporary branch/worktree or inspect its diff before accepting generated changes.
3. Preserve semantic tokens and the Slider accessible-name forwarding.
4. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, `pnpm test:visual` and inspect screenshots plus motion recordings.
5. Record any generated-source divergence and migration note here.
