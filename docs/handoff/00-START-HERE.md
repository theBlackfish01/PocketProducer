# Pocket Producer — implementation handoff

Prepared 20 September 2026; **revision 3 — UI library selection and Listening Room component system**, retaining the Deep Agents/OpenAI/Gemini architecture and substantial initial build. This package is self-contained; the implementation agent does not need the preceding conversation or the personal vault. Relative links work after copying the folder elsewhere.

**Build a responsive web app that turns a user's sounds and directions into music, lets them listen and request controlled revisions, and produces an editable Audiotool project. The selected visual and interaction direction is Listening Room.**

This is an implementation specification, not an implemented application. The mockup is a concept image. Example contracts and configuration are illustrative. No authentication, audio generation, SDK round trip, deployment, or application tests have been completed by preparing this package. See [current state](CURRENT-STATE.md).

## What is settled

- The user selected **Pocket Producer** for this implementation planning and **Option 1: Listening Room** for its UI. Do not reopen the design selection or replace it with Producer Desk.
- Desktop and phone are first-class surfaces of the same **web application**. “Pocket” is a product name, not a mobile-only constraint.
- Creation from supplied sounds, agent execution, listening, and iterative direction are the core. A chat transcript, full DAW, card game, or scene editor is not the primary interface.
- Build properly from the start: modular code, reproducible setup, documentation, meaningful tests, recovery behavior, and clear development procedures.
- The user is an experienced developer/AI engineer, working solo with extensive AI assistance, with limited music-production experience. Aim for an ambitious, polished result, while proving technical risks before expanding scope.
- Keep all project instructions, skills, and configuration in the application repository. Do not install global workflows or copy unrelated personal-vault information.
- Use **Deep Agents on LangGraph with an OpenAI producer and Gemini audio-analysis adapter** as the updated starting architecture. Evaluate the candidate tools by concrete benefit; installing all of them is not a requirement.
- Reuse UI libraries. The user delegated the choice; the assistant-selected default is **shadcn/ui with Base UI, Tailwind CSS and Lucide**, customized to Listening Room. Follow [the component-system plan](15-UI-library-and-component-system.md); retain a working existing foundation when migration has no concrete benefit.
- The user reports that an **OpenAI API key is already in the destination project's environment file**. The implementation agent should locate and load it securely, verify access with a small bounded test, and not ask for it again unless missing or invalid. This package contains no key and does not verify that destination file.
- Start with the [substantial initial milestone](14-Initial-build-milestone.md), covering a working local creative loop, not scaffolding alone. Public deployment is a later milestone.

## What can improve

The stack, internal schemas, component decomposition, exact palette, musical defaults, phase estimates, and tool orchestration below are **assistant-selected implementation defaults**. Improve them when evidence warrants it. Preserve the product promises, responsive Listening Room identity, recoverability, and testing standard. Record consequential changes in a short architecture decision record (ADR), with evidence and migration impact; routine component decisions need no ceremony.

The most consequential open question is **how reliable server-side audio previews will be produced while the user's phone is closed**. Nexus document control is documented; a general official headless renderer has not been established. Follow [the feasibility gate](03-Nexus-and-audio-feasibility.md), then select the supported route. Do not build weeks of UI on an assumed audio API.

## Reading order

1. [Agent start prompt](AGENT-START-PROMPT.md), [current state](CURRENT-STATE.md), and [initial build milestone](14-Initial-build-milestone.md).
2. [Product and scope](01-Product-and-scope.md), then [Listening Room UX](04-Listening-Room-UX.md), its selected image, and [UI library/component system](15-UI-library-and-component-system.md).
3. [Nexus/audio feasibility](03-Nexus-and-audio-feasibility.md), [architecture](02-Architecture-and-decisions.md), [Deep Agents/models/candidate tools](13-Deep-Agents-models-and-candidate-tools.md), and [implementation phases](07-Implementation-phases.md).
4. [Domain/API contracts](05-Domain-and-API-contracts.md) and [agent/music pipeline](06-Agent-and-music-pipeline.md) when implementing the corresponding slice.
5. [Testing](08-Testing-and-quality.md), [engineering workflow](09-Engineering-workflow.md), [deployment/operations](10-Deployment-and-operations.md).
6. [User inputs/autonomy](11-User-inputs-and-autonomy.md) and [risks/reference register](12-Risks-and-reference-register.md).

Read only the relevant implementation sections again as work progresses. Maintain concise live state; do not keep reloading a large historical conversation.

## First working session

1. Establish the intended application workspace. Inspect existing files and git state; this handoff's source folder is in a personal vault, **not the app repository**.
2. Copy this package into the application repository as `docs/handoff/`. Adopt the [repository instructions template](repo-templates/AGENTS.md) at its root after reconciling existing instructions. The [Claude template](repo-templates/CLAUDE.md) imports that shared root file.
3. Write live `docs/STATUS.md`, recording actual environment, chosen package versions, unknowns, and next actions. The handoff stays a dated baseline; live docs describe what was actually built.
4. Run Phase 0. Ask for credentials/account actions only when the specific test needs them; keep the offline renderer, UI, schemas, and fixtures moving while external access is pending.
5. Continue beyond the first feasibility proof through the initial milestone: sound → OpenAI-led composition → real server render → responsive playback → protected revision → comparison, plus Gemini and Audiotool integration where access allows. Document missing external evidence without blocking the independent local build.

## Contents beyond the plans

- [Selected desktop/mobile mockup](design/listening-room-desktop-mobile.png) and [its original image prompt](design/mockup-generation-prompt.md).
- [Design tokens](design/tokens.json): implementation proposals, including explicit contrast pairings.
- [Composition example](contracts/composition.example.json), [revision patch example](contracts/revision-patch.example.json), and [contract notes](contracts/README.md).
- [Repository templates](repo-templates/README.md), including agent instructions, environment names, status, ADR, and pull-request structure.
- [Package validator](tools/validate-package.mjs), [validation results](VALIDATION.md), and [file manifest](MANIFEST.json). These verify the handoff, not an application.
- [Package changes](PACKAGE-CHANGES.md) records the revisions, including the UI foundation and the earlier model/tooling and initial-build instructions.

## The finished experience

On a phone or desktop, a new user adds a sound, says “make a warm, restrained instrumental around this,” receives a playable draft, then asks “simplify the drums; keep the melody.” They compare the two versions without losing the first, and open an Audiotool project with meaningful editable parts. The app explains any limitation honestly, handles interrupted connections and failed jobs, and never requires the user to operate a miniature DAW to complete this flow.
