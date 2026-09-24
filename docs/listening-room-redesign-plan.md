# Listening Room redesign plan — 2026-09-24

Status: first integrated UI pass implemented locally on 2026-09-24; see `STATUS.md` and `testing.md` for verification. The user-supplied mockup is a visual reference, not a claim that preview, sharing, or a public sound library already works. This plan applies to the current React/Vite Listening Room, not a new site or a new product stack.

## 1. Outcome and guardrails

Make the product feel like a guided music workspace: start an idea, see what was made, choose a section or part, describe a change, inspect the result, and recover or compare without losing accepted work. Use the reference's editorial scale, compact cards, integrated right rail, abstract artwork, and prominent composer. Keep the existing Pocket Producer SVG mark and wordmark in the desktop rail, mobile header, navigation sheet, and favicon.

The native v2 document remains the source of truth for editable arrangements. Native rendering/playback and Gemini listening are deferred. Existing playable four-stem audio is separate history. The interface must never imply that native notes or an uploaded source have been heard or rendered, that a structural compare is an audio A/B test, that the SDK catalogue is an auditionable sound library, or that an Audiotool project is editable remotely before verified synchronization. No live provider calls, export, render probe, deployment, or new paid service is part of this UI pass.

Success means a first-time user can answer three questions at every point: **Where am I? What can I do next? What will be preserved?**

## 2. Information architecture and state map

The app currently has a shared shell, a native arrangement view, a separate playable-audio view, source and comparison dialogs, plus empty, loading, job, error, and connection states. Preserve the two data histories but replace the top-level labels **Native construction** / **Legacy audio** with **Arrange** / **Playable audio**. Add one concise explanation at the switch: playable audio versions are separate from the editable arrangement. Do not switch the playback controller into the arrangement view.

| State | Primary message/action | Secondary path | Truth boundary |
| --- | --- | --- | --- |
| No session | “Start a new piece” / New session | Open a recent session | No implied generated content |
| Empty session | Describe the piece / Create arrangement | Add or record an owned sound; make playable audio | Explain that an editable arrangement is not yet playable |
| Working job | Human-readable current step / Cancel | Navigate away safely | No invented percent; show durable background state |
| Arrangement ready | Explore sections and parts / Shape the arrangement | Compare versions; add a sound; Audiotool status | No native play controls |
| Revision prepared | Show selected section, selected part, and parts to keep | Clear scope/protection | Protection changes take effect only on submission |
| New version ready | Summarize actual changed parts/sections | Compare with earlier version; restore explicitly | A structural change is not an audible assessment |
| Playable-audio view | Play/seek the accepted artifact | Audition source; audio A/B; restore | Use the one coordinated playback controller |
| Remote sync | Explain local, sending, verified, conflict, or uncertain state | Open verified Studio project or check known outcome | No blind retry or false remote-editability claim |

The default native path should be progressive, not a wizard with arbitrary gates. A person can start with text alone; adding a source remains optional. After creation, the arrangement itself becomes the primary navigation.

## 3. Screen and interaction design

### 3.1 Shared shell and session navigation

- Retain the logo lockup. Make the left rail close to the reference: logo, high-contrast New session button, Sessions entry, recent session list, and a compact private-workspace footer. Show a clear selected session and handle long titles without cutting the active title mid-word.
- Use one room header for both views: breadcrumb, status eyebrow, editorial title, short musical description, and only true metadata derived from the current document or audio artifact. A right-side abstract composition of forest, orange, and ivory shapes may be generated in CSS/SVG. Its decorative artwork must not resemble a playable waveform.
- Place only available actions in the header. For an arrangement, use a primary “Shape this arrangement” focus/scroll action and contextual Compare or Audiotool controls. The mockup's Play preview and Share controls are not copied into native mode; they need real features first. For playable audio, the actual player can own Play.
- On a narrow screen, preserve logo and session access in the existing sheet. Keep the active room name and view switch visible without consuming the whole first viewport.

### 3.2 Starting a session

- Replace the broad empty-state choices with a primary prompt and action: “What are you making?” / “Create arrangement”. Offer Add sound and Record sound as visibly optional actions. Explain in one sentence that this creates an editable arrangement and that playback is not available for it yet.
- Offer a separate, plainly named path to the existing playable-audio workflow. Do not imply the two outputs are versions of the same render.
- Use a small number of example directions that insert editable text rather than starting a paid job. Mark examples as examples, not generated recommendations.
- Preserve drafts per project when navigating, and never carry an old room's draft, selected source, or playback into a new room.

### 3.3 Arrangement workspace

- Build the reference's main card with two columns on wide screens: approximately a 2:1 content/sidebar ratio. The main column holds Arrangement, Parts & instruments, then the direction composer. The sidebar holds Your sounds, Sounds & instruments, and Need inspiration. The layout must tolerate 1–many sections and 1–12 parts; five sections/eight parts are examples, not assumptions.
- Arrangement cards show index, real section name, real bar range, and an intent/description only if available. Use deterministic decorative artwork variants, not mock waveform or fictional album art. Make the entire card a scope selection button with `aria-pressed`; include an explicit Whole piece scope control outside the card row. On desktop, use a compact scrollable strip if needed rather than shrinking cards into illegibility. On mobile, horizontal scrolling must expose the next card and remain keyboard-operable.
- Selecting a section updates a visible scope summary near the composer. The helper text explains that a section-only edit cannot change whole-piece timing or sounds. Clicking the selected section again, or choosing Whole piece, clears it.
- Part cards show role, name, and a factual short descriptor from canonical state (for example, placement range, instrument family, or effect names). Do not invent subjective labels such as “warm” from numerical parameters. A card selects a hard edit target; a distinct “Keep unchanged” toggle protects it for the next submitted change. Show both states separately. A part cannot be simultaneously the requested edit target and protected; resolve the conflict in the UI before submission.
- A part-detail sheet can expose notes/patterns, placement, device and processing in approachable terms. Technical paths and raw SDK values live under an optional Details disclosure, not in the card. The sheet must distinguish supported editable controls from discoverable but unsupported SDK entities.

### 3.4 Direction composer and feedback

- Put the composer directly after the objects it changes, styled like the mockup's wide framed input. Label it “Describe how you want to change the arrangement” once a version exists, and “Describe the piece you want to make” before first creation. Use contextual placeholders/examples that reference the selected section or part without forcing a template.
- Show compact, removable scope chips: Whole piece/section, selected part/any part, parts to keep, and selected owned sounds. The chips summarize draft intent, not accepted history. The primary button has a text label (“Create arrangement” or “Shape the arrangement”), not only an arrow icon.
- Suggestions in “Need inspiration?” prefill the composer and focus it; they never auto-submit. Base suggestions on real section/part names when available. Avoid promises about sonic results that cannot be heard.
- Translate worker stages into user language (“Planning the arrangement”, “Building the parts”, “Saving your version”) while retaining exact diagnostic codes privately. Show the current job as a durable background operation; no fake progress percentage. Cancel, definite-failure retry, and uncertain-outcome reconciliation must retain their different existing safety rules.

### 3.5 Sources and sound exploration

- Rename “Owned sources” / “Source tray” to “Your sounds”. Show uploaded and recorded WAVs with name, duration when known, selection state, and a real audition control using the existing playback controller. State plainly when a sound is attached, selected for the next change, structurally placed, or actually present in playable audio; these are distinct facts.
- Keep upload and recording in the Base UI sheet, with permission/loading/error states, recording cap, focus return, and project-safe cleanup. The source list in the sidebar is a compact entry point, not a duplicate full manager.
- Replace the default “Explore the native palette” SDK list with a curated “Sounds & instruments” view that shows only validated construction families and actions. Group by Drums, Bass, Keys, Pads/Textures, Leads, and Effects when the current supported catalogue fits; do not imply every category has an auditionable preset. Search filters supported capabilities. Keep the broader pinned SDK path catalogue behind an Advanced/technical disclosure.

### 3.6 History, comparison, and Audiotool

- Make Versions visible as a secondary section or compact rail entry with count and latest change summary. The structural comparison dialog should use a clear two-version relationship, show actual added/removed/changed parts, sections, tempo/meter, sources, and protection changes, and name the current version. “Restore this version” is explicit and does not erase newer history or rewrite Audiotool.
- Keep playable audio A/B as a separate listening comparison with real seek/play controls. Do not label the native structural comparison “A/B listening”.
- Move Audiotool status out of raw provider prose into a concise “Editable in Audiotool” panel/action. States: only on this device, sending, verified with date, needs recheck, conflict, uncertain outcome, or not connected. Offer “Open in Audiotool” only for a verified current version; offer “Connect Audiotool” when required. Technical readback and mapping details can be inspected in an expanded explanation. A sync is an explicit action, never a side effect of selecting/restoring a version.

### 3.7 Playable-audio view and utility states

- Reuse the same shell, title treatment, spacing, source cards, and version visual language. Keep the real waveform, labeled seek/volume controls, section navigation, source audition, and one playback controller. Do not replace the working audio route with aspirational native controls.
- Rewrite the playable-audio hero, composer, progress, provider status, source lineage, errors, and export wording to remove fixture/producer/provider jargon. Where technical provenance matters, place it in a Details panel without hiding important unavailable or failed states.
- Apply the same design to loading, no sessions, empty session, job progress, failed/cancelled/uncertain job, source recording/upload, Compare, Audiotool connection, and navigation sheet. There should be no old-looking modal or error page left beside the new room.

## 4. Language system

Use action/outcome language on the main surface. Music terms such as section, bars, motif, tempo, part, and instrument are acceptable when they help a musician; explain the less familiar ones in context. Do not expose “native”, “legacy”, “Nexus”, “SDK”, “readback”, “structural diff”, “fixture”, “immutable head”, or raw worker states as primary UI copy. Keep truthful provider identity and technical diagnostics in an optional details layer.

| Current surface | Default-facing copy direction | Important nuance |
| --- | --- | --- |
| Native construction | Arrange / Create arrangement | An editable document, not audio |
| Legacy audio | Playable audio | Separate history from the arrangement |
| Structural versions | Versions / What changed | Structural comparison, not hearing |
| Native palette | Sounds & instruments | Show only supported choices by default |
| Protect / unlock | Keep unchanged / Allow changes | Applies on the next submitted revision |
| Sync editable native project | Open an editable copy in Audiotool | Only after verified sync; otherwise explicit sync action |
| Local validated draft | Saved in this room | No remote verification implied |
| Uncertain outcome | We need to check what happened | No blind resubmission |

Create a central UI copy map for job/status labels and friendly errors. Server messages can include untrusted/provider text; do not paste them unfiltered into prominent UI. Preserve a way to access a safe diagnostic identifier for support. Use consistent verbs: **Create**, **Shape**, **Keep unchanged**, **Compare**, **Restore**, **Connect**, **Open**.

## 5. Visual and component architecture

Keep Tailwind, the owned shadcn/Base UI source, and Lucide; do not add a second primitive family or a paid UI kit. Extend the existing warm tokens rather than replacing them. Use Georgia/Geist typography, editorial hierarchy, quiet borders and shadows, dark-forest selection, burnt-orange primary action, and abstract CSS/SVG art derived from the established cover art. Preserve the supplied logo exactly as the brand anchor; any decorative shapes must be distinguishable from it.

Suggested component split (presentational components receive canonical data and callbacks; they do not own a second project/job/playback state machine):

- `RoomShell`, `SessionRail`, `RoomHeader`, `ViewSwitch` from the current `App.tsx` shell.
- `ArrangementStrip`, `SectionCard`, `PartGrid`, `PartCard`, `PartDetailSheet`, `ScopeSummary`, and `DirectionComposer` from `features/native/native-room.tsx`.
- `YourSoundsPanel`, `SoundBrowser`, `InspirationPanel`, and reusable `VersionSummary` shared where appropriate.
- `NativeVersionCompare`, `AudioVersionCompare`, and `AudiotoolStatus` remain distinct where their semantics differ.
- Existing `AudioPlayer` remains the sole transport controller's view; the source tray/recorder keeps the established playback and cleanup contract.

Start by extracting only components needed for the first vertical slice. Do not refactor the backend or all of `App.tsx` as a prerequisite. Derive displayed counts, bar ranges, scopes, and diffs from API/canonical state. If a desired descriptor is absent, show an honest fallback or add an explicitly justified read-only projection; do not manufacture facts from the visual mockup.

## 6. Responsive and accessibility contract

- Desktop: session rail about 200 px; content can grow beyond today's 1200 px cap without overly long text lines; main workspace with content and contextual sidebar. Tablet: stack or collapse sidebar as space narrows. Phone: session sheet, compact header, arrangement strip, one-column parts, composer, then sources/suggestions; no horizontal page overflow. Preserve safe-area padding and visible input/action while the software keyboard is open.
- Use 44 px minimum practical touch targets, visible focus rings, semantic headings/labels, `aria-pressed` for scope/selection, and separate accessible names for select versus protect. Announce job state and errors without repeatedly stealing focus. Dialog/sheet focus returns to its trigger. Source audition and playable-audio seeking remain labeled.
- Respect reduced motion. Decorative art is hidden from assistive technology; real status and metadata remain text. Check text and control contrast against the updated artwork and tinted card states.
- Never rely on color alone to distinguish selected, protected, current, failed, or verified. The new visual density must not bury recovery actions or status explanations.

## 7. Delivery sequence and gates

| Phase | Work | Exit gate |
| --- | --- | --- |
| 0. Baseline and copy inventory | Capture current desktop/390 px states; inventory every user-facing string in `App.tsx`, native room, player, source tray, compare, and errors; pin screenshot/interaction references. | State/copy checklist and no backend/provider change. |
| 1. Shared shell | Implement rail/header/artwork/view switch and page width; preserve logo; establish card and spacing tokens. | Welcome, arrangement and playable-audio shells all look coherent at desktop/phone; navigation still project-safe. |
| 2. Core arrangement flow | Sections, parts, scope/protection, contextual composer and truthful progress; connect to existing API state, not fixtures. | Create → select → revise → new version works in fixture-mode browser tests; protected and scoped behavior remains intact. |
| 3. Supporting panels | Sources/recording, supported sound exploration, suggestions, part detail. | Real source selection/audition and recording remain safe; no invented preview or unsupported capability action. |
| 4. History and provider states | Structural compare/restore, audio A/B consistency, Audiotool local/verified/conflict/uncertain presentation, friendly recovery. | Restore is explicit; remote mutation remains opt-in; no blind retry; accepted audio/history preserved. |
| 5. Whole-product polish | Playable-audio view, empty/error/loading/dialog/sheet states, copy sweep, docs and visual QA. | No default-facing developer terminology; tests/screenshots meet the checklist below. |

Each phase should leave the app usable and pass relevant type/lint/unit checks. Avoid a long-lived parallel redesign that disconnects the main flow. Update `docs/design-system.md`, `docs/STATUS.md`, and test guidance as implementation lands; this plan alone is not evidence that the redesign is built.

## 8. Verification and acceptance

Use ordinary offline fixture tests with zero provider access. Add/adjust browser journeys for: new session and first arrangement; section/part selection and clearing; protect then explicit unlock; source upload/record/audition; revision progress, cancellation and definite retry; uncertain outcome with no auto-retry; structural compare and restore; playable audio A/B and source return; navigation between projects and views; connected/disconnected/conflict Audiotool presentation. Assert UI text does not misidentify native structure as playable audio or legacy audio as the same history.

Inspect fresh screenshots at wide desktop, intermediate/tablet width, and 390 px phone for empty, ready, working, comparison, and error states. Test keyboard-only order, focus return, labeled controls, contrast, reduced motion, mobile keyboard/safe area, and no horizontal overflow. Physical-phone and non-Chromium checks remain separately reported if not actually performed. Run project checks (`pnpm check`, `pnpm test:integration`, `pnpm test:e2e`) and record exact results; the redesign should not require live OpenAI, Gemini, or Audiotool calls or consume the existing provider budget.

## 9. Explicit non-goals for this pass

No native audio rendering, part previews, Gemini critique, public sharing, public preset/sample browser, unverified Audiotool export, new app registration, backend data migration, or production deployment. Reserve visual space for future play/share where useful, but do not ship dead controls or imply that those outcomes exist today.
