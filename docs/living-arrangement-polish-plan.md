# Listening Room: focus, legibility and meaningful motion

Reviewed 2026-09-26 against `7563021`; implementation followed in the same checkout. The findings below are the pre-change review, not a description of the current UI. See `STATUS.md` for actual checks and `living-arrangement.md` for the delivered contract.

Implementation choices: a responsive Base UI inspector sheet at every size; direction form immediately after the score in document order, with a phone shortcut that hides while typing; Sounds/tools as a disclosure; progressive eight-lane detail instead of virtualization. Comparison retains visible header/footer and stable time, pitch and part order. Motion represents bounded confirmed changes, not unobserved construction order. No new package, API or renderer was introduced.

## Assessment

The logo, warm palette, editorial headings and central data-driven arrangement give Pocket Producer a recognizable direction. Saved versions, confirmed drafts and explicit selection provide a sound basis for interaction. The next increment should make the path from seeing music to directing a change feel continuous.

The present workspace reads as a long report: overview, phrase buttons, section detail, another grid of the same parts, composer, then history. The inspected desktop capture is 3,240 px tall; the phone capture from the same pass is 5,544 px tall. These are particular fixture states, not fixed page dimensions. The right column gives considerable space to static categories while inspection appears farther down the main column. The current animation implementation gives only limited feedback about construction.

Review evidence: current desktop, phone comparison and large-tablet captures under `.local/evidence/`; `native-score.tsx`, `native-room.tsx`, `score.ts`, theme CSS and maintained browser assertions. Motion observations below follow from the current code; no new recorded animation session or usability study was run for this review.

## Findings and priorities

| Priority | Finding | Consequence | Proposed improvement |
| --- | --- | --- | --- |
| P0 | Clicking a part in the overview sets inspectedPartId, but its inspector is inside the selected-section conditional. | A part click can produce no visible result until a section is also selected. | Open a visible inspector for any part click; make the selected row clear. Preserve optional section scope separately. |
| P0 | The composer follows the full part-card grid on desktop. Phone moves it to the top, far from later inspection. | Inspecting a phrase and giving direction require repeated scrolling. | Put a compact scope summary and composer beside/below the working score; use a keyboard-safe collapsed change action on phone. |
| P1 | Motion currently covers a 320 ms opacity change for changed note counts in confirmed drafts. Pitch, timing, clips and automation are absent from the animated delta. Removed cells have no exit transition; first snapshots have no prior state; more than 120 changed cells disable the effect. | Many meaningful edits appear static, and density alone cannot explain the revision. | Derive semantic visual deltas from confirmed snapshots and show additions, removals, movement and control changes with bounded, distinct treatments. Group larger updates into an honest summary. |
| P1 | The overview has a 780–800 px minimum width and non-sticky part labels. | The initial phone view exposes only a fraction of the piece; horizontal movement can lose the names. | Fit the whole-piece overview, keep labels/ruler visible, and reserve zoom/pan for detailed inspection. Provide an explicit section navigator. |
| P1 | The same parts appear in overview lanes, detail lanes, cards and dialogs. | The interface repeats controls and leaves users to infer which selection changes what. | Use one contextual inspector containing Inspect, Change and Keep actions; retain a compact Parts view for ensemble-wide management. |
| P1 | The phone comparison spends most of its first viewport on explanatory text, tabs and the summary. Selection actions sit after the score. | The actual evidence and decision are separated by scrolling. | Lead with the selected section and concise change summary; keep the comparison header and version actions visible. Show changed parts first, with an explicit way to include preserved parts. |
| P1 | Pitch ranges are independently normalized for each detail lane/view. Bar labels are mostly outside the note field. | Different registers can look similar; switching Before/After can change the visual scale. | Show bar/beat references and a labeled pitch range. Share one coordinate system across a compared pair. |
| P2 | Motif families use only four hash-derived colors, also close to role/action colors. Related variations are mainly explained by tooltip. | Color collisions and competing meanings weaken theme recognition. | Pair color with a named family marker and a variation badge; highlight one family across all appearances and expose its actual relationships. |
| P2 | Automation/effects are mostly raw text: target paths, device identifiers and long point lists. | The inspector feels technical and makes control development hard to see. | Draw read-only control curves with friendly names and appropriate units; retain exact stored values in an advanced disclosure. |
| P2 | The large hero, repeated caveats and persistent static library categories compete with working content. | The room has strong branding but weak task hierarchy. | Use a compact working header after creation, a concise audio-availability status, and contextual Sounds/History panels. Retain the logo and palette. |

## Intended flow

Open the session → understand its form → select a section or part → inspect its musical details → describe a change and see what will be kept → observe confirmed work → inspect the result → continue shaping or explicitly choose a saved version.

Desktop: compact session header; section navigator; wide arrangement with an optional contextual inspector; adjacent scope/composer; compact history access. Sounds and library search remain available through a purposeful panel rather than permanently taking width from the score.

Phone: compact title and section navigation; a legible overview/focused score; a visible Change [section] action opening the scoped composer; inspector and history sheets. The active section, keep choices and typed direction persist as these surfaces open and close. Expanding the composer must accommodate the virtual keyboard and safe areas without covering its own input or submit button.

## Phase 1 — coherent static working surface

1. Fix whole-piece part inspection and add an unambiguous selected-row state.
2. Separate viewing scope from revision scope in state and copy. Inspecting a different note should not silently redirect an already written request.
3. Bring the revision composer and keep summary into the working area. Replace the repeated card grid with compact parts management or a disclosure.
4. Compact the established-session hero and move secondary Sounds/History/connection content into responsive panels.
5. Rewrite high-visibility copy around the musical task. For example, “Ascent · drums changed” can lead the result; exact note counts and structural verification remain available underneath.

Acceptance: every part/section click has a visible result; the selected section and revision input can be reached together without traversing a repeated card grid; selection, keep controls, pending text and keyboard focus remain intact across inspector/history navigation. The existing successful-revision automatic selection remains explicit in the UI.

## Phase 2 — a more readable musical score

1. Introduce separate whole-piece overview and focused-detail scales. Keep the overview legible with 24 parts/128 bars, with optional role-group collapse. Keep part labels and time context visible while panning detail.
2. Draw useful bar/beat reference marks and labeled pitch ranges; compare both versions using the same range and time window. Preserve meaningful rests and sustained-note lengths.
3. Add an inspectable phrase-family identity: family label/marker, original/variation relationship and all matching placements. Unrelated families sharing a color must still be distinguishable.
4. Show clip excerpt/loop boundaries and control curves where canonical data supports them. Friendly labels come from validated metadata; unknown physical units stay as stored values.
5. Make exact note/clip/control facts available through keyboard and touch, beyond SVG hover titles. Empty sections and silent roles receive clear, lightweight states.

Acceptance: independent canonical fixtures match displayed timing, pitches, clip intervals and automation. A same-ID pitch edit is visibly distinguishable; a preserved phrase stays in the same location and scale in comparison. No animation is required to understand the structure.

## Phase 3 — motion that explains confirmed change

Build a small change-presentation layer between canonical projection and the score. Use stable part, placement and note identities, with indexed delta sets; ordinary score cells remain static SVG where possible. Animate only the bounded changed subset. No new graphics library is required.

| Interaction / event | Proposed motion | Starting duration | Durable non-motion cue |
| --- | --- | --- | --- |
| Select section or part | Focus outline/background moves or crossfades; inspector appears without a large page jump | 160–220 ms | Selected label and scope text |
| Confirmed added material | Brief appearance of the actual added notes/phrases/clips | 240–360 ms | Added marker and summary |
| Confirmed removed material | Outline of prior material fades from the affected location | 180–260 ms | Removed count/details |
| Confirmed pitch/timing/duration edit | Matched note geometry transitions in a stable coordinate system | 280–420 ms | Before/After values and modified marker |
| Confirmed control change | Old/new curve crossfade or restrained interpolation | 240–360 ms | Named control and value change |
| Many changes received together | One affected-section/role highlight, followed by a grouped summary | 400–650 ms | “Updated three sections” with exact affected items |
| Before/After navigation | Short crossfade in a stable viewport; optional user-triggered replay of the saved diff | 120–180 ms | Persistent viewed-version and current-version labels |

These are tuning targets, to be adjusted from recordings on the actual UI. Avoid constant pulsing, staggered fake construction, or repeated entrance effects during polling. Coalesced backend snapshots must be presented as a group, without inventing the order of events that were not observed. Reload, navigation and duplicate snapshots must not replay historical construction. A cancellation/failed batch must not animate as committed work. Reduced motion presents the final geometry immediately with the same text and state markers.

Acceptance: maintained fixture sequences exercise added, removed, moved, pitch-only, clip-only, automation-only and coalesced changes. Each has appropriate visual feedback even when note count stays the same. Record ordinary and reduced-motion sequences for review; screenshot assertions alone cannot establish motion quality.

## Phase 4 — the signature revision reveal

1. Keep the selected section when the successful result arrives. Show its concise outcome immediately, with a persistent current-version label.
2. Present Changed / Kept / Needs checking as distinct evidence states. Separate requested protection from actually verified preservation.
3. Make Before / After / Changes navigation use a fixed time window, part order and pitch scale. Preserve scroll position and focus.
4. Show the relevant section and affected parts first. Offer preserved material and the whole arrangement without hiding them permanently.
5. Keep explicit saved-version selection in a visible footer on desktop and phone. Its wording must distinguish looking at a version from choosing it.
6. Include an outside-section summary only when all relevant material was actually checked; propagate unverified comparisons rather than presenting them as preservation.

Acceptance: comparison navigation never writes the selected head; successful revisions remain automatically selected; choosing a saved version is explicit and survives reload. Protected bass/theme outcomes remain inspectable, including wrong-candidate rejection. Dismiss/reopen returns focus and retains a comprehensible comparison state.

## Phase 5 — integrated quality pass

- Review empty/new session, active construction, confirmed partial work, failed/cancelled work, completed revision, comparison, history and sources with the same spacing/copy rules.
- Use a sparse piece, an eight-part piece, a 24-part/128-bar piece, clips/automation, and a same-density pitch/timing revision as distinct cases.
- Verify desktop, tablet and 390 px layouts; keyboard-only selection and inspection; accessible names and focus return; safe-area and virtual-keyboard emulation; contrast; reduced motion; and no flashing or unwanted auto-scroll.
- Reuse the existing provider-free browser/worker harness. Add animation-specific assertions for identity changes, duplicate/late snapshots, reload, room switching and final committed state. Keep the existing preservation/history regressions.
- Record a browser performance trace for a large-arrangement update and compare navigation. Target prompt visual response to interaction (roughly 100 ms on the reference test machine), bounded SVG nodes and smooth animation; report measurements and hardware rather than treating the existing 10-second page-load assertion as proof of animation quality.
- Inspect screenshot and short motion evidence before committing. Update design provenance, motion timings, verification results and the user guide after implementation.

## Boundary and delivery

Retain React/Vite, Motion for React, SVG/CSS, shadcn/Base UI, Tailwind, Lucide, the logo and current palette. Use existing canonical/history/draft endpoints; only add a small metadata/read-only projection change if the visuals need facts not currently exposed. This is a design and interaction increment, with no new general music engine, rendering investigation, provider evaluation or external mutation required.

Suggested implementation commits: (1) working layout and selection/inspector flow; (2) score semantics and stable comparison coordinates; (3) confirmed-change motion and revision reveal; (4) responsive/accessibility verification and docs. Each stage should leave the normal app usable. The finished increment is ready when a user can see a musical idea, direct a scoped change, understand the confirmed result and choose a version without losing context.
