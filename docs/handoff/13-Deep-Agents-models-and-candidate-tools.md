# Deep Agents, models, candidate tools and credentials

Introduced in revision 2; updated for revision 3, 20 September 2026. This integrates the user's requested architecture refinement into the implementation baseline. Candidate libraries remain candidates; assess their actual benefit and record adoption/defer decisions. No live integration or benchmark was performed in preparing this package. The selected UI foundation is specified separately in [the component-system plan](15-UI-library-and-component-system.md).

## Main architecture

Use **Deep Agents on LangGraph with an OpenAI main producer**, plus a separate **Gemini audio-analysis adapter**. Retain the durable worker, canonical composition, validated patch engine, renderer and Nexus adapter. Deep Agents packages context/workspace/skills/delegation capabilities on top of LangGraph; it does not replace application transactions, authorization or job recovery. [Official overview](https://docs.langchain.com/oss/javascript/deepagents/overview).

The producer decides musical intent and tool use. Application code owns budgets, scopes, protected-part checks, cancellation, leases, idempotency and final commits. Never let an agent write arbitrary accepted state because it can edit a file. Run the creative harness within durable execution boundaries; reconcile checkpoints with the effect ledger before resuming a paid or external step.

## Workspace, skills and delegation

Give each production run a scoped virtual workspace containing the brief, source-analysis summaries, arrangement plans and candidate notes. Store pointers to binary artifacts, not base64 audio in Markdown. Namespace durable storage by authenticated owner/project. Persist only selected context; a run scratch directory is not a general long-term memory. The accepted IR/revision database remains authoritative. See [backends](https://docs.langchain.com/oss/javascript/deepagents/backends).

Create a small set of version-controlled **application runtime skills** inside the application repo, for example under `agent-skills/`: `source-to-percussion`, `arrange-short-instrumental`, `revise-protected-parts`, and `evaluate-preview`. Each contains a real procedure, allowed tools, validation requirements, examples and failure behavior. These are consumed by Pocket Producer's runtime agent, distinct from `.agents/skills` used by a coding assistant. Do not install either globally. [Deep Agents skills](https://docs.langchain.com/oss/javascript/deepagents/skills).

Start with one producer and one audio-analysis specialist. A single Gemini request can be a typed tool; promote it to a subagent when it genuinely needs multiple excerpt queries or comparisons. Restrict its tools and return a compact structured report. Avoid independent drum/bass/melody agents all editing the same project. Keep parallel candidate work read-only until one coordinator validates a merge. [Subagent documentation](https://docs.langchain.com/oss/javascript/deepagents/subagents).

Do not expose the full agent trace in Listening Room. Show music-related stages and actual changes. An interrupt is for a meaningful constraint conflict or missing input, not routine approval of every production step.

## OpenAI integration and the existing key

The user reports an OpenAI key already present in the destination project's environment file. **Locate/load that existing configuration instead of requesting a new key.** Inspect variable names and presence without printing values or dumping the file. Preserve the file and add only missing configuration carefully. Confirm that secret files are ignored before committing. Never copy the populated env into this handoff or a frontend bundle.

Use `OPENAI_API_KEY` as the canonical application variable, or explicitly map the already supplied name server-side. Keep `OPENAI_MODEL` configurable. GPT-6 Astra (`gpt-6-astra`) is the initial model candidate because of the earlier preference and documented tool/structured-output support; verify actual API access and adapter compatibility. It is not guaranteed by possessing any OpenAI key. Its documented input is text/image, so actual audio analysis is routed to Gemini. [Model page](https://developers.openai.com/api/docs/models/gpt-6-astra).

Use a tested Responses-capable LangChain integration. Pin compatible `deepagents`, LangChain/LangGraph and provider adapter versions; verify tool calls, reasoning state and structured results with a small executable spike. Do not layer a second autonomous framework around Deep Agents just to use OpenAI. [Responses guidance](https://developers.openai.com/api/docs/guides/migrate-to-responses#additional-differences).

Presence, validity, model access and a working tool round trip are separate checks. If the key is invalid or a model inaccessible, report the safe error class and required action without exposing the token. Continue deterministic tests and UI/domain work. Do not quietly replace the configured model with a materially different provider.

## Gemini analysis and audio feedback

Use `GEMINI_API_KEY` and `GEMINI_MODEL` in the application configuration. If the environment already uses `GOOGLE_API_KEY`, detect and explicitly map it rather than requiring a duplicate secret; validate the chosen SDK's configuration. Ask the user to add a Gemini key locally if absent, never to paste it into chat. Select an actually audio-capable current model and verify uploaded audio is included in the request, not merely its filename.

Google documents audio description and timestamped segment analysis. Treat proposed musical critique as a capability to evaluate, not an established expert verdict. [Audio understanding](https://ai.google.dev/gemini-api/docs/audio).

Define an `AudioAnalysis` schema with input asset/render hash, model/prompt version, requested purpose, inspected interval, observations, uncertainty and suggested actions. Include measured metrics in a separate field populated by signal-processing tools. A reported BPM/key is an estimate; a protected-track guarantee comes from hashes/structure, not model confidence.

Cache by actual audio hash, interval, analysis purpose, model and prompt version. A new render invalidates its critique. Resolve media and provider credentials in server code using owner-scoped IDs. No model-controlled arbitrary URL fetch or cross-user workspace read is needed.

The bounded loop is: source analysis → producer → validated composition → render → actual-audio critique plus objective checks → at most one or two constrained repair passes → candidate. The number of render attempts must account for the first render plus repair renders. Preserve earlier candidates and compare against direct generation; subjective criticism can regress quality. Do not endlessly ask two models whether the result is good yet.

If Gemini is absent/unavailable, the OpenAI creative loop can still run using source metadata, curated palettes and signal checks, labeled **audio critique unavailable**. Do not claim that the system listened through Gemini, and do not silently reclassify the OpenAI text model as an audio analyst. Resume the live critique integration when access arrives.

## Candidate tool register

| Candidate | Actual benefit to test | Initial disposition | Credentials / install |
| --- | --- | --- | --- |
| Deep Agents / LangGraph JS | Workspace, on-demand skills, context management and typed delegation | Core architecture; use the smallest useful harness | Local npm packages; provider key for model calls; no LangSmith key required just to run locally |
| shadcn/ui + Base UI + Tailwind CSS + Lucide | Reusable interaction foundations and owned themed components for Listening Room | Selected greenfield UI default; alternatives, setup and tests in [UI plan](15-UI-library-and-component-system.md) | Local packages/generated source; no API key or paid UI kit |
| `@langchain/quickjs` interpreter | Batch sample analyses and aggregate results programmatically without a model turn per item | Optional feature-flagged spike after basic tools work; current docs mark beta | Local package; no separate API key, but invoked provider tools still bill normally |
| Mediabunny | Browser media inspection, optional trimming/conversion before upload | Evaluate only if it improves capture/upload UX and phone compatibility | Local library, no API key; retain server decoding fallback |
| LangSmith evaluation/tracing | Compare prompts/models on fixed briefs and inspect expensive or failing runs | Optional development integration; local test evidence works without it | Hosted service requires a separate account/API key and possible usage charges |
| Tonal | Symbolic notes, scales, chords, intervals and transposition | Strong candidate for deterministic musical compiler | Local npm library, no API key; not audio analysis or synthesis |
| wavesurfer.js | Real waveforms, regions, source audition/recording presentation | Strong candidate for Listening Room; keep one coordinated player | Local library, no API key; accessibility must still be implemented |
| Essentia / JavaScript bindings | Music-specific onset/tempo/key and other feature extraction | Optional analysis spike after defining the required algorithms | Local runtime/library; no hosted API key; assess packaging, performance and licensing |

Primary sources: [interpreter](https://docs.langchain.com/oss/javascript/deepagents/interpreters), [Mediabunny](https://mediabunny.dev/), [LangSmith evaluation](https://docs.langchain.com/langsmith/evaluation), [Tonal](https://github.com/tonaljs/tonal), [wavesurfer](https://wavesurfer.xyz/), [Essentia](https://essentia.upf.edu/), [Essentia licensing](https://essentia.upf.edu/licensing_information.html).

For each adopted tool, record selected version, problem solved, a small proof, additional runtime/keys, fallback and decision in `docs/tooling-decisions.md`. A source link is not proof of compatibility. TypeScript docs may contain mixed-language or newer examples; compile against installed versions. Do not install all candidates automatically or spend a long time on beta tooling before the basic musical flow works.

Keep ordinary typed tools available if the interpreter is disabled. Limit its execution time, memory and callable capabilities. It does not become the audio renderer or get a general production shell. Dynamic/async delegation is not necessary merely to survive a closed browser; the durable worker already serves that purpose.

## Credentials and local prerequisites

| Requirement | Needed now? | Agent action / user action |
| --- | --- | --- |
| Existing OpenAI API key | Yes, for real producer verification | Agent loads existing server env, checks presence safely, runs bounded test; user acts only if invalid/missing or account/model access is blocked |
| Gemini key | For live audio analysis/critique | Ask early if absent; agent completes adapter, fixtures and non-Gemini build meanwhile |
| Audiotool application client ID, redirect configuration, scopes and user OAuth grant | For live login/Nexus export | Agent prepares exact callback/operations and login UI; user registers/authorizes as needed. Public client ID is not an API secret; do not request a password or default to a full-account PAT |
| LangSmith key | Optional | Keep tracing off unless configured/authorized; never block the product on it |
| PostgreSQL | Yes, for durable backend | Use existing local instance or supported local container; generate app-local development credentials/connection string. No cloud API key required for local development |
| FFmpeg | Yes, if own renderer path chosen | Detect compatible binary/build, install project-scoped or document exact missing prerequisite; no API key |
| Object storage | Local adapter sufficient initially | Use bounded project-local storage; cloud bucket/service credentials are later deployment requirements |
| Session/encryption secrets | Local development needs generated values | Agent generates securely into ignored local configuration; these are not purchased API keys |
| Hosting/domain | No, not for initial milestone | Prepare later; no account or subscription required to finish local codebase |

Environment variables for a separate transcription provider are only needed if that capability uses a separate provider. Reuse an authorized supported OpenAI/Gemini service where appropriate; don't request another vendor key merely because a microphone button exists. Source recording itself uses browser APIs and requires no transcription account.

## Cost and access policy for the initial build

Existing explicit user/account limits take precedence. The launch prompt proposes **US$5 total for initial application API smoke/evaluation calls**, excluding the coding assistant's own subscription/token usage; this is an assistant-selected starting guardrail, not a historical budget fact. A stricter existing limit wins. Ask before exceeding it or provisioning billable infrastructure. If the actual configured model cannot complete a useful live test within the cap, explain and continue non-paid work.

Track combined OpenAI/Gemini spend conservatively using current model pricing and usage metadata, bounded output/step limits and persistent counters. Check estimated worst-case request cost before dispatch where possible. A provider balance is not itself an authorization to spend it. Do not set every production job's budget to the entire development allowance. Production caps remain a separate decision.

The `.env.example` contains safe zero/disabled cost placeholders; **do not overwrite the user's existing env with it**. When the user sends the launch prompt, configure the bounded development limits it authorizes, unless stricter settings exist. If zero is an explicit user setting, respect it and report the conflict. Keep public/deployed generation disabled until its own limits/access are configured.

## Evaluation and adoption gate

On the same owned sample/brief, compare direct production, production with source analysis, and production with analysis plus one audio-critique repair. Record instruction adherence, protected-part correctness, listening preference, latency and actual cost. Use reproducible seeds/inputs where supported and avoid trusting one model's score as the result. Adopt extra complexity only where it improves evidence.

The remaining Nexus rendering uncertainty is unchanged by adding these models. Prove actual server audio and meaningful editable export through the original feasibility gate.
