# User inputs versus autonomous agent work

Do not reopen settled choices. The user already selected Pocket Producer, the responsive web requirement and Listening Room. They want the agent to exercise judgment and avoid unnecessary friction.

**Latest input:** an OpenAI API key is already supplied in the destination project's environment file, according to the user. Use it securely instead of asking for it again. Deep Agents/OpenAI producer plus Gemini audio analysis is the updated architecture. The [credential register](13-Deep-Agents-models-and-candidate-tools.md) distinguishes actual provider keys, public OAuth configuration, generated local secrets and tools that need no account.

## Inputs required at specific points

| Input / action | Needed for | Agent prepares first | Can proceed meanwhile |
| --- | --- | --- | --- |
| Intended app folder/repository if not clear from session | Avoid building inside personal vault or wrong repo | Inspect workspace and propose a concrete separate app location | Read handoff and prepare feasibility scripts/specs |
| Audiotool account authorization and app registration/configuration | Real SDK proof and export | Exact callback URL, needed operations/scopes, secure login flow, explanation of requested access | Fixture renderer, schemas, UI and queue |
| Existing OpenAI key: agent verifies access | Real producer | Secure environment loading and bounded capability test; no repeat key request unless missing/invalid | Renderer, UI/domain and deterministic tests |
| Gemini key if absent | Actual audio analysis and critique | Typed adapter, exact local env name and provider setup instructions | Real OpenAI creation, signal checks and revisions |
| Runtime budget beyond initial launch-prompt allowance | Broader benchmarks, continued/public usage and hosting | Usage accounting, estimates and current limits; initial prompt proposes $5 aggregate application API-test cap | Local tests and non-paid work |
| Deployment account/project and publication approval where required | Hosted release | Tested release candidate, concrete hosting/cost/callback plan | Complete local build, docs and release assets |
| Physical phone check if the agent lacks a real device | Real iOS/Android recording/interruption confidence | Short exact steps, URL, expected results and logging approach | Browser-engine/emulated-device tests |
| Hackathon entry/submission decisions and required profile facts | Registration/submission | Verify current form/rules; prepare all materials | Build and package demonstration |

Never ask for passwords, refresh tokens, API keys or private access tokens in the conversation. Direct the user to the provider's login or local secret configuration. Verify capability through a safe test without printing the secret. Public client IDs and callback URLs can be discussed normally.

If the future session is already inside the intended app repo, the location question is answered. If a provider/key/budget is already configured and authorized, use it within that scope rather than asking again. The handoff's unknowns reflect preparation time, not a requirement to ignore fresh-session evidence.

## Optional inputs, with defaults

- **Musical taste / reference material:** helpful for palettes, not required to start. Default to a coherent short instrumental palette with owned examples; label it a product starting point, not the user's favorite genre.
- **Personal samples:** useful for a demo; do not block on them. Generate simple original fixtures or use clearly licensed material with provenance. Do not pull private work or unrelated personal recordings.
- **Brand/domain:** keep Pocket Producer as the working title and use a provider preview domain until a choice matters. Do not purchase a domain by inference.
- **Exact weekly hours:** helps calendar planning; keep phase ordering and scope priorities useful without inventing availability.
- **External testers:** invite only with user authorization for contact. The agent can prepare a test script and analyze feedback already supplied.

## What the implementation agent should do itself

- Inspect repository state and select compatible current dependency versions.
- Set up local instructions, workspace scripts, schema/migrations, fixture generation and CI.
- Implement the UI, domain, worker, provider and Nexus adapters and their recovery behavior.
- Make routine component, file, routing, database-index and test-framework decisions within the architecture.
- Research primary documentation, run bounded feasibility experiments, and record evidence/ADRs.
- Improve the mockup's accessibility, responsive fit and interaction details while retaining Listening Room.
- Design and run meaningful tests, fix discovered bugs, inspect screenshots, and measure real audio/performance.
- Keep setup docs, API contracts, status and known limitations accurate.
- Prepare deployment configuration, demo script, README and submission materials to the point where user input is the last missing step.
- Use sensible defaults for minor creative choices and make them editable rather than asking about every knob.

## Actions needing distinct authorization or access

Purchases and new billable resources, external account connections not already authorized, public publishing beyond the user's instruction, hackathon submission, contacting people, modifying unrelated projects, importing private employer material, or destructive operations outside the app's intended scope. This is not a reason to ask before ordinary reversible local coding, test runs, documentation or repairs.

When blocked, say exactly which capability is missing, what the user must do, and what work continues. Example: “The renderer and local flow work; real Audiotool export still needs the app authorization at this callback. I can finish comparison and recovery tests while that is pending.” Avoid broad questionnaires at every milestone.

## Questions to ask when starting, only if unanswered

1. Which application workspace should hold the code, if the current directory is not already that workspace?
2. If absent, can the user add `GEMINI_API_KEY` to the local environment for audio analysis? OpenAI is already supplied; only ask about its configuration if verification fails. Follow the initial prompt's bounded test budget and ask before expanding it.
3. Can the user complete Audiotool app registration/login when the feasibility script and callback are ready?

Ask hosting/domain and real-device questions later when concrete. Do not demand all accounts, assets and preferences before writing useful code.

The user also wants notification of other actual tool/prerequisite needs. Report the name, purpose, whether it needs an API key/account or just a local install, exact env variable or installation step, whether it is required for the current milestone, and what can continue without it. LangSmith is optional; Tonal/wavesurfer/Mediabunny/local Deep Agents packages do not each require a vendor API key. No live credential belongs in the handoff ZIP.
