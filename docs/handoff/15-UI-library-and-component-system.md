# UI library and component system

Decision date: 20 September 2026. Revision 3 addition. The user asked to reuse UI libraries, raised shadcn as a plausible choice, and delegated the selection. **The assistant-selected implementation default is shadcn/ui with Base UI primitives, Tailwind CSS, and a custom Listening Room theme.** This is a library decision within the selected design, not a new visual direction. No packages have been installed by preparing this document.

## Recommendation and alternatives

shadcn distributes component source that the application can own and customize. Use that head start for controls, overlay behavior and consistent styling; build the music experience by composing those components. Choosing it does not require the familiar default dashboard appearance. [shadcn introduction](https://ui.shadcn.com/docs).

| Option | Strength for this product | Tradeoff / decision |
| --- | --- | --- |
| **shadcn + Base UI** | Editable components with an unstyled interaction foundation underneath; a useful starting point for the custom theme | **Selected default.** Maintain our copied components and review upstream changes deliberately |
| Base UI directly | Complete styling control without adopting pre-styled component source | Viable, but requires more initial wrappers, variants and styling; little benefit over customizing shadcn for this build |
| React Aria Components | Strong accessible interactions and internationalization with a style-free component model | Good alternative if complex collection interaction becomes central; direct use requires more initial styling/composition. Current shadcn CLI also offers an Aria base, so it need not always mean starting from bare components |
| Mantine | Broad ready-to-use components, theme configuration and flexible styling | Good for rapid conventional application screens. My judgment is that adapting its conventions offers less benefit here than owning a smaller set of Listening Room components |
| shadcn + Radix | Established alternative with a large existing component ecosystem | Retain it if the destination already uses it successfully, or a necessary dependency demonstrably requires it. Do not migrate working code merely to follow a newer default |

These are fit judgments, not comparative benchmarks. Base UI supplies unstyled React primitives with accessibility as a central concern; React Aria likewise permits custom styles. Mantine supports custom CSS and a headless mode too, so none of these inherently prevents a distinctive design. Sources: [Base UI](https://base-ui.com/react/overview/about), [React Aria](https://react-aria.adobe.com/), [Mantine styling](https://mantine.dev/styles/styles-overview/).

The current shadcn documentation makes Base UI the default for new projects while retaining Radix support. That supports the greenfield choice; it is not a reason to rewrite an existing application. [July 2026 announcement](https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default).

## What to adopt

- **shadcn/ui:** add only components needed by the next working slice, keep their source in the repository, and style shared variants once.
- **Base UI:** use the Base UI implementations consistently for menus, dialogs, popovers, sliders and selection controls. Validate actual installed APIs rather than mixing examples from different bases.
- **Tailwind CSS:** use semantic CSS-variable tokens and the compatible Vite integration. Keep detailed waveform/layout CSS local where that is clearer than long utility expressions.
- **Lucide React:** use a single icon family with selective imports, consistent stroke/size and explicit accessible names on icon-only buttons. [React guide](https://lucide.dev/guide/react).
- **wavesurfer.js:** preferred candidate for real waveform/region presentation, subject to the existing audio compatibility check. It is a specialized audio view, not a replacement for accessible controls or the server renderer. Keep playback coordinated through one controller. See [tool register](13-Deep-Agents-models-and-candidate-tools.md).
- **Motion:** begin with CSS transitions using the existing 150–200 ms tokens and reduced-motion preference. Add an animation library only when a specific transition needs it; a product UI does not require an effects catalogue.

The selected UI foundation needs **no API keys or paid UI kit**. Package installation needs ordinary registry access. Preserve dependency licenses and any required attribution; additional commercial assets are a separate decision. The existing OpenAI/Gemini/Audiotool setup is unchanged.

Do not add another complete UI system alongside this one for miscellaneous components. AI Elements is not required for the Listening Room flow: the main view is a piece of music with a direction input, not an assistant-message feed. If a later requirement genuinely benefits from it or another registry, check its primitive compatibility before adoption. A Radix-oriented example's `asChild` API cannot simply be pasted into a Base UI component that expects a different composition API.

## Preserve the visual identity

The [selected mockup and UX specification](04-Listening-Room-UX.md) remain the visual authority. Keep the warm ivory canvas, restrained burnt orange actions, forest/ink text, editorial serif titles, real waveform, generous spacing and quiet rules. Start with the existing system-font/Georgia fallback, then refine only with properly licensed fonts.

Use library controls inside that composition. Do not begin from a generic dashboard block and let its default sidebar, card grid, zinc palette, dense labels or chat layout dictate the product. Customize the actual control styles as well as the page background: button height/radius, input borders, slider thumb, sheet surface, focus ring, typography and spacing should belong to one design.

Keep the light Listening Room theme as the first finished theme. A dark-mode switch creates a second set of states and contrast requirements; implement it later if useful. Preserve visible focus, selected, hover, pressed, disabled, invalid and pending states. Hover cannot be the only way to reveal an essential phone action.

### Token mapping

Treat [design/tokens.json](design/tokens.json) as the initial source. Translate into application CSS variables and Tailwind theme aliases; avoid duplicate handwritten hex values in components. Suggested mappings:

| Component token | Existing design value / role |
| --- | --- |
| `--background` / `--foreground` | `canvas` / `ink` |
| `--card`, `--popover` / their foregrounds | `surface` / `ink` |
| `--primary` / `--primary-foreground` | `brand` / `brandForeground` |
| `--muted` / `--muted-foreground` | `canvas` / `secondary` |
| `--secondary` / `--secondary-foreground` | `surface` / `ink`; this component token is a surface, not the design file's secondary-text color |
| `--accent` / `--accent-foreground` | A quiet hover/selection surface derived from `canvas`, with `ink`; use a tested visible selected indicator |
| `--border` | `borderDecorative` for separators and nonessential boundaries |
| `--input` | `borderInteractive` for boundaries needed to identify controls |
| `--ring` | `focus`, with visible width/offset on the adjacent surface |
| `--destructive` | `error`; verify the actual foreground/background pairing used |
| Product-specific forest / artwork accent | `forest` / `accentDecorative`; do not use bright decorative orange for small white action labels |

Set control, panel and composer radii from the existing 12/16/20 px proposals; align the generated radius scale rather than leaving conflicting defaults. Use 44 px minimum touch targets even when the icon itself is 18–20 px. Token contrast checks in this package cover only the named pairs; check new hover, error, overlay and selected states in the application. [shadcn theming](https://ui.shadcn.com/docs/theming).

## Component ownership and reuse map

| Product area | Reuse | Product-specific work |
| --- | --- | --- |
| Session rail and mobile navigation | Button, menu, sheet/dialog, separator | Responsive layout, current-session state, empty library, long names |
| Session title and rename | Input, field/label, dialog or deliberate inline edit | Editorial typography, validation and persistence |
| Main transport | Button, tooltip, slider | One playback controller, seeking, elapsed/duration labels, loading/error state |
| Waveform and section strip | wavesurfer candidate, accessible slider/buttons | Real peaks, section metadata, controlled seeking, selected version; no fictitious audio |
| Source tray and details | Button, menu, sheet/dialog, field, slider | Upload/record review, progress, audition ownership, trim and role assignment |
| Direction composer | Textarea, button, tooltip | Draft persistence, distinct recording/dictation modes, scope/protection chips, keyboard-safe positioning |
| Protect a musical part | Checkbox or pressed-state toggle | Actual protected-track IDs, server validation and explanation; the icon is not enforcement |
| A/B comparison | Radio group or single-select toggle group | Version selection, aligned playback where possible, accessible version names, explicit restore |
| Version/source panels | Tabs when they switch content panels; sheet/dialog on small screens | Immutable history, current/candidate distinction, pending and conflict states |
| Destructive confirmation | Alert dialog | Precise consequence, reversible alternatives and safe default focus |
| Job progress and errors | Progress, alert, small status text | Actual stage events, recovery actions, no invented percentage |
| Notifications | Compatible toast only for transient feedback | Persistent errors and important status stay in the page; a toast is not the only record |

Use semantic HTML for ordinary headings, lists, paragraphs and layout. Do not wrap every section in a Card component merely because one is available. Reuse the accessibility foundation for complex interaction; do not hand-build focus traps, dropdown positioning or keyboard slider behavior.

Suggested local boundary, adapted to the actual repository:

```text
apps/web/src/components/ui/          owned library-derived primitives
apps/web/src/features/listening/     room, transport, waveform, composer
apps/web/src/features/sources/       capture, source tray and detail
apps/web/src/features/versions/      version list, compare and restore
apps/web/src/styles/                 tokens, fonts and shared theme
```

Keep primitives free of project IDs, network calls, music schemas and provider logic. Feature components compose them. Start within `apps/web`; extract a shared UI package only when another real consumer exists. Avoid a generalized design-system framework or public registry for one app.

## Initial setup procedure

1. Inspect the destination's existing frontend, lockfile, `components.json`, CSS and local instructions. Preserve established work. If an equivalent foundation is already in use, record whether keeping it avoids needless churn.
2. Resolve compatible stable React/Vite/Tailwind/shadcn/Base UI versions, verify the chosen CLI's help, and record exact versions. Pin dependencies/lockfile and the CLI version used to generate components. Do not install an arbitrary beta because it is newer.
3. Initialize within the existing `apps/web` workspace, with explicit **Vite** and **Base UI** selection. The checked CLI currently names that base `base`; older guidance may call it `base-ui`. Use the installed CLI's accepted spelling. For unattended initialization, use `-d` plus explicit project options; `-y` alone is not a complete defaults strategy. Never force-overwrite the established CSS or config.
4. The command shape is `pnpm dlx shadcn@<verified-version> init -d --template vite --base base -c apps/web`. Replace the version placeholder and verify flags before running; this package has not executed the command. Do not create a second monorepo inside `apps/web`. Ensure Vite config uses React client components (`rsc: false` where applicable), correct aliases, and the compatible Tailwind Vite plugin.
5. Inspect generated files immediately. Reconcile rather than overwrite the Listening Room tokens, fonts and aliases. Add a small first set: button, input/textarea, field/label, dialog/sheet, slider and the selection control needed by the current slice. Use upstream docs for the installed base; inspect registry changes before adding them. [Vite setup](https://ui.shadcn.com/docs/installation/vite), [CLI](https://ui.shadcn.com/docs/cli).
6. Build a small development-only component preview with themed normal/focus/disabled/error states and a room view driven by an explicitly labeled fixture. This is a quick review surface, not a second product. Storybook is optional; an internal route is enough initially.
7. Wire the product views to the real backend/player as the vertical slice lands. Continue through [the initial milestone](14-Initial-build-milestone.md); a component gallery is not its completion criterion.

## Testing and maintenance

Test our composition and modifications rather than reproducing a library's entire test suite. The first meaningful checks should cover:

- Keyboard opening/closing of source and version panels, visible focus, correct modal semantics and focus return. Test the trigger disappearing after a mutation too; choose a sensible fallback target.
- Nested menu/dialog interactions, scrolling and Escape behavior. At responsive breakpoints, mount only the active presentation so hidden duplicate dialogs/IDs cannot trap focus.
- A labeled seek slider operated by keyboard and touch, with readable elapsed/duration text. Canvas/waveform pixels are not an accessible alternative. Seeking must not generate a screen-reader announcement on every playback frame.
- A/B selection semantics, protected-part toggles and a persistent indication of the current version. A disabled control's reason must be available without a hover-only tooltip.
- 360/390 px phones, tablet, desktop, 200% zoom, long names, keyboard-visible composer, reduced motion, loading/failure states and actual theme contrast. Automated accessibility checks supplement keyboard and screen-reader spot checks.
- A single audible source at a time across previews and the main player, including switching versions and closing panels. Library choice does not solve that application invariant.

Capture representative desktop/mobile screenshots and inspect against the selected concept. Keep a few stable visual checks for the main room and overlays; do not snapshot every internal DOM detail. See [the full quality plan](08-Testing-and-quality.md).

Record selected libraries, component provenance and meaningful overrides in `docs/design.md` / `docs/tooling-decisions.md`. Review upstream component diffs instead of blindly overwriting locally owned code, and rerun affected interaction checks after an upgrade. A new feature must use the common variants/tokens unless there is a clear product reason to extend them. Keep all configuration and any assistant guidance project-local.

**Completion evidence:** a themed, working Listening Room at phone and desktop sizes; reusable controls with exercised focus/keyboard behavior; real audio/player integration; pinned versions and documented customization. Library accessibility claims and a good screenshot alone do not establish this evidence.
