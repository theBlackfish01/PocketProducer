# Listening Room design system

## Living score and comparison — 2026-09-26

The central **Your arrangement** surface now projects the native document rather than decorating the five-section fixture. The existing ivory/forest/burnt-orange tokens, Pocket Producer logo, editorial headings, Base UI controls, Tailwind and Lucide remain. `native-score.tsx` adds an owned SVG/CSS lane composition with section-width proportions, per-bar note-start density, phrase and clip tracks, role labels, selected-section detail and a fact panel. Motif-family colors are a stable hash of explicit provenance, not a claim that similar-looking phrases sound alike. A focused section spans at most eight bars of detailed notes at once; larger pieces can be navigated without a DAW-scale DOM. The score shows a textual legend/caption and each SVG has a summary label, so color and motion are not the sole conveyors of meaning.

Pinned `motion@13.4.0` (Motion for React) is the only new visual dependency. It animates a bounded density delta after a **confirmed** draft step; plans and unsaved speculation never move the score. `MotionConfig reducedMotion="user"` and the existing CSS media rule honor reduced motion. This does not use or invent an audio playhead. The comparison dialog now has a responsive wide desktop measure and a phone-sized scrollable layout, with clear read-only Before/After/Changes navigation and explicit version-selection buttons. Comparison focus return is browser-tested. The native phone page keeps the composer before the longer arrangement; the score can be scrolled horizontally with keyboard focus and has no document overflow at 390 px. The shared playback controller and older audio room were not changed by this visual layer.

Source/provenance: `apps/web/src/features/native/native-score.tsx` and `score.ts` are owned music-specific components above the existing locally owned shadcn/Base UI controls. The selected primitive family did not change and no CLI-generated component was added. When upgrading Motion, Base UI or Tailwind, keep exact pins, inspect component/dependency diffs, rerun the score projection and browser journeys, and visually review desktop, phone, tablet, dialog and reduced-motion states. See [the truth contract](living-arrangement.md) and [verification](testing.md).

## Guided room redesign — 2026-09-24

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

The native room reuses the same tokens and Base UI buttons/dialog/radio controls. Its arrangement cards, protected part grid, source selection, capability search and structural version comparison are composed locally in `apps/web/src/features/native/native-room.tsx`. The direction composer follows the cards on desktop and moves before them on phone. The advanced SDK catalogue is collapsed until requested. Explicit whole-piece/any-part controls avoid an accidental hard edit scope. Pairwise compare describes selected-versus-current structure; keep/unlock changes are explicit. The audio room is labeled **Playable audio** and remains a separate history. Sync shows local, past verification, uncertain or conflict state; a saved consent session is required to offer it. The 390 px fixture capture confirms composer placement and no horizontal overflow, not physical keyboard behavior.

## Responsive and accessibility behavior

At tablet width the left session rail becomes a Base UI sheet. Below 700px the player stacks, the section strip scrolls horizontally, the composer stays in document flow, and bottom padding includes `env(safe-area-inset-bottom)`. Reduced-motion media queries collapse animation and transition durations to `0.01ms`.

Verified behaviors and evidence are in `docs/testing.md`: computed 4.5:1 text/action contrast assertions, keyboard-opened sheet and dialog, focus return, named source/version seek controls, A/B selection and restore, reduced-motion emulation, mobile focused-input visibility and desktop/mobile screenshots. Physical-device verification remains separate.

## Upgrade procedure

1. Update one primitive family/version at a time and keep exact dependency versions.
2. Run the shadcn command against a temporary branch/worktree or inspect its diff before accepting generated changes.
3. Preserve semantic tokens and the Slider accessible-name forwarding.
4. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:e2e` and inspect both evidence viewports.
5. Record any generated-source divergence and migration note here.
