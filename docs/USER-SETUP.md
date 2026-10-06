# Local setup and optional integrations

Start with the [README quick start](../README.md#try-it-locally). Copy `.env.example` only when you do not already have `.env`; the example enables deterministic fixture mode and sets all spending caps to zero. Preserve existing environment values, accepted music, source assets and accumulated spend when updating a checkout. Run `pnpm db:migrate` after pulling changes; it applies outstanding additive migrations, including 024, without resetting data.

## Provider-free local demonstration

No provider key or Audiotool registration is needed. With PostgreSQL running:

```sh
pnpm db:migrate
pnpm generate:fixtures
pnpm seed:demo
pnpm dev
```

Open `http://127.0.0.1:5173`. New session → describe an idea → Create arrangement → inspect → change a section → compare versions. Fixture output is deterministic and does not establish live-model creative quality. Source recording/upload/audition remains under Sounds; there is no native full-mix player.

## Enable paid production deliberately

1. Add `OPENAI_API_KEY` for Sol/Luna, or `GEMINI_API_KEY` for Gemini Flash, to the server-only root `.env`.
2. Set `FIXTURE_MODE=false`.
3. Set an intentional `INITIAL_BUILD_API_BUDGET_USD` and `MAX_JOB_COST_USD`, plus the relevant provider cap and `DEFAULT_USER_BUDGET_USD`. All limits apply together. A zero cap blocks paid work.
4. Restart the API and worker. Choose the producer when submitting a new direction or revision.

Luna captures xhigh producer reasoning. Rewrite/Inspire uses a separate low-effort Luna request; each explicit helper click is accounted for. The small symbolic critic has its own bounded low-effort role. DeepSeek is no longer a new-request choice; its existing jobs and ledger remain readable. See [model selection](model-selection.md) for limits and historical provider observations. Configured keys do not prove model access or remaining provider credit.

`pnpm budget:status` reads the local ledger. Usage is cumulative, not reset by a new session. Never clear the ledger or repeat an uncertain external request to make a paused job proceed. Saved drafts can continue only when ownership, version head, effect state and remaining limits permit it.

## Audiotool application registration

Register a development application at `https://developer.audiotool.com/applications`:

```text
Application purpose: Pocket Producer local development
Redirect URL: http://127.0.0.1:5173/auth/audiotool/callback
Requested scopes: user:read project:write project:read sample:write sample:read preset:read preset:write
```

Merge the issued public client identifier into the existing ignored `.env`:

```dotenv
AUDIOTOOL_CLIENT_ID=<issued public client id>
AUDIOTOOL_REDIRECT_URL=http://127.0.0.1:5173/auth/audiotool/callback
AUDIOTOOL_SCOPES=user:read project:write project:read sample:write sample:read preset:read preset:write
```

Use the regular browser profile already signed in to Audiotool. Open Pocket Producer, choose **Connect Audiotool**, and complete browser consent. The PKCE callback transfers the session to the loopback API, which encrypts it under `.local/secrets/audiotool-session.key` and binds it to the app owner. Do not paste OAuth tokens into chat, source or `.env`. Existing grants may not include a refresh token; reconnect when access expires.

Copying a saved arrangement is explicit. Native notes, sound state and supported routing/automation are mapped and read back; source upload and interval placement are separate contracts. A prior verification timestamp is not a guarantee that a later version is copied. Preserve any uncertain create/upload/write receipt and reconcile it before trying again. The SDK's `unlisted` visibility is not the same as a private project; inspect the account's project visibility before sharing. Prior live-copy evidence and limits are recorded in [STATUS](STATUS.md), not claimed for every new installation or sound resource.

## Optional diagnostics

LangSmith is optional. Set its key/project and `LANGSMITH_TRACING=true` only when wanted. `LANGSMITH_HIDE_INPUTS=true` and `LANGSMITH_HIDE_OUTPUTS=true` are privacy defaults; disabling them sends directions and tool data into private tracing. Normal fixture tests disable tracing regardless of local settings. See [observability](observability.md).

The separate Gemini source-analysis adapter does not enable native composition listening. Native rendering, full-mix playback and Gemini listening remain deferred. Do not rerun old render probes as a setup step.

## Before sharing an installation

The current loopback session uses one development owner. Per-owner limits are implemented, but independent public user sign-in is not. Do not expose this server publicly. Keep `.env`, the database, local audio, OAuth keys and raw traces private. Repository sharing is separate from deployment; see [security guidance](../SECURITY.md).
