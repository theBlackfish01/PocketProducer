# Launch prompt — substantial initial implementation

Use this prompt in the application project with the **revision 3** ZIP/folder attached. The US$5 API-test allowance is a proposed conservative starting limit; edit it before sending if a different amount is intended. It concerns the application's OpenAI/Gemini calls, not coding-assistant tokens. The package contains no credentials.

---

Build a substantial working first version of Pocket Producer in this project using the attached handoff package. Read `00-START-HERE.md`, `CURRENT-STATE.md`, `13-Deep-Agents-models-and-candidate-tools.md`, `14-Initial-build-milestone.md`, and `15-UI-library-and-component-system.md`, then the relevant architecture, UI, pipeline and testing documents. Inspect existing files and instructions before changing anything.

The selected product is a responsive desktop-and-mobile web app with the **Listening Room** UI. Use **Deep Agents on LangGraph with an OpenAI main producer**, a separate **Gemini audio-analysis adapter**, durable background jobs, canonical composition data and a Nexus integration boundary. Preserve the selected visual direction and product promises. You may improve technical defaults with evidence and record significant decisions.

For the UI, start with **shadcn/ui using Base UI primitives, Tailwind CSS and Lucide icons**, customized to the selected Listening Room mockup and tokens. Reuse accessible controls, dialogs, sheets, menus and sliders; compose the music-specific player, source tray, version comparison and direction input around them. Keep the warm ivory/forest/burnt-orange palette, editorial typography and spacious layout. Own and theme the component source rather than adopting a stock dashboard. Use one primitive family consistently, pin compatible versions, inspect CLI-generated changes, and preserve an already working equivalent stack if switching would add needless churn. No UI API key or paid kit is required. Use wavesurfer.js if it passes the audio-view compatibility check; keep one coordinated playback controller.

My OpenAI API key is already in the project's environment file. Locate and load it securely on the server; preserve that file, verify access with a small test, and never print, commit, expose to the browser or ask me to paste the key. Use the configured model if present; otherwise begin with the handoff's candidate if accessible. Keep initial application API smoke/evaluation calls within **US$5 total**, or any stricter existing limit. Track combined OpenAI/Gemini usage and ask before exceeding that cap or creating billable infrastructure.

Tell me early if `GEMINI_API_KEY`, Audiotool app registration/OAuth configuration, a local executable or another actual prerequisite is missing. Explain what it enables, the exact variable/setup action, and whether it is required or optional. Keep independent work moving. LangSmith is optional; do not request a new key for a local library that needs none.

Implement the initial milestone through a genuine local create/listen/revise/compare loop:

1. Set up the repository properly: compatible pinned dependencies, project-local agent instructions, strict types, configuration validation, migrations, scripts, CI, setup docs and live status.
2. Build the durable backend: real PostgreSQL state, private local asset storage, queue/worker, progress, safe retries, cancellation and ownership checks.
3. Prove server audio generation using the bounded Nexus feasibility spike. If no supported standalone Audiotool renderer is established, implement the documented deterministic sample-based fallback. Start with one coherent owned/licensed palette and real playable instrumental output.
4. Implement Listening Room on desktop and phone: source upload/recording/audition, player and seeking, direction input, meaningful progress, empty/error states, versions and comparison. Establish the shared theme and a small reusable component set early, then connect the product views to real state; a component gallery alone is not the milestone.
5. Integrate the real OpenAI Deep Agent with scoped workspace, useful runtime skills and validated musical tools. Natural-language intent must drive a real arrangement and render, beyond fixture-only screens.
6. Implement a useful revision that simplifies drums while preserving melody, with structural/artifact checks, immutable history, A/B comparison and explicit restore.
7. Implement Gemini source/preview analysis and a bounded render–critique–repair loop when its key is available. Build the adapter, tests and honest unavailable state while waiting. Keep measured audio facts separate from model opinion.
8. Implement the Nexus mapping/auth/export flow and verify a meaningfully editable project when authorization is available. If access is pending, finish the adapter and local flow and clearly record the live verification still needed.

Evaluate the listed candidate tools by actual benefit. Keep optional/beta tools behind a fallback; don't install every candidate or let a tooling survey consume the build.

Run meaningful domain, audio, backend and browser tests, inspect desktop/mobile screenshots, and verify real audio artifacts. Include worker restart, duplicate requests, failed/cancelled revisions, protected content and provider-unavailable behavior. Use an explicit loopback-only development session if Audiotool login is pending, with production safeguards. Never present mocked integrations as live-verified.

Verify the integrated UI's keyboard navigation, dialog focus return, labeled seek controls, A/B selection, mobile keyboard/safe areas, contrast and reduced motion. Library accessibility features support this work; they do not replace testing the finished interface. Keep component provenance, theme decisions and upgrade instructions in the live design docs.

Continue through this substantial milestone without stopping at planning or scaffolding, or asking for approval after each ordinary phase. Preserve existing work, keep progress updates concise, and record actual decisions/checks in `docs/STATUS.md`. If a dependency blocks one path, complete the others and state the precise unblock action.

Finish with runnable code, exact startup commands, a real demonstration path, test results, representative screenshots/audio evidence, recorded API spend, and a clear implemented/verified/blocked/next list. Public deployment and hackathon submission are later milestones unless I explicitly authorize them.

---

Sending this prompt authorizes the future implementation scope and its stated initial test allowance. Preparing this document does not run the application or exercise any credential.
