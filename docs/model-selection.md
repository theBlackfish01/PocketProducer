# Producer choice and shared usage

September 27, 2026. Existing Deep Agents/LangGraph construction, canonical score, protected revisions and explicit Audiotool copy remain unchanged.

## Choosing a producer

The prompt footer has a labelled model chooser on desktop and phone. It applies to a new construction or revision, not an arbitrary change to a paused/running job. Selection persists with the project-local direction draft. The API allowlists IDs and captures the model, billing provider and price with the job. Retries/continuations retain that snapshot except for the explicit, recorded Sol-to-Luna shared-demo policy below. Missing credentials reject live work instead of generating a fixture silently. Fixture mode is explicit.

## Shared demo policy — September 27

`SOL_POOL_BUDGET_USD` and `LUNA_POOL_BUDGET_USD` are optional **cumulative installation caps**, not monthly resets, API-key balances or per-job grants. Set both to enable new-request routing. This installation was explicitly configured for Sol $5 and Luna $50. OpenAI's combined cap is $58.774889: the two model caps plus $3.774889 of already committed historical other-model charges. The installation cap is $63.774889, including the existing Gemini $5. That historical offset is not new credit and is not automatically recalculated. Historical effects continue to count; no ledger reset or provider call accompanied the configuration change. Default per-owner lifetime allowance remains $13; existing overrides and captured job limits still apply. Lower job/user/provider/installation limits take precedence. Unknown effects count at the greater of their reservation and observed cost. Helpers and symbolic reviews count against their actual model; Gemini remains separate and is never an automatic fallback.

New commands check availability inside the existing shared budget transaction, after replay/ownership checks. An exhausted Sol model pool routes to Luna xhigh; the requested model remains in the receipt, and the effective model is captured in `_nativeRun`. Idempotent repeats return the same job. Availability in the UI is advisory and refreshed on focus/periodically; the server reserves each actual request atomically. A next-call lower bound is not a promise that a long prompt fits.

A running Sol job may hand off **once**, only after a pre-dispatch Sol-model-pool rejection. Under the same budget lock, the worker verifies its lease, cancellation/deadline/head, known completed effects and remaining job/call/shared limits. Migration 025 records both captured profiles. `_nativeRunCurrent` changes only model/provider/pricing/reasoning; the original request, deadline, musical steps, plan, protections, review history and cumulative costs remain. A fresh graph restores confirmed domain state and bounded guidance, never Sol's provider-specific reasoning transcript. Aggregate effect identity stays stable; individual model-call identities separate the routes. Restart and contending workers read this persisted choice. Uncertain outcomes, per-user exhaustion and other provider failures do not trigger fallback. Existing paused requests are not restarted automatically.

The normal UI has no pool amounts. It offers Luna and explains unavailable Sol briefly; fully unavailable creation leaves saved sessions accessible. The sidebar and exhausted state link to GitHub, labelled **private** by default. `SOURCE_REPOSITORY_PUBLIC=true` changes the invitation to **Run it yourself** only after the operator intentionally publishes/licenses the repository; the flag does not change GitHub visibility. Public authentication/owner isolation remains a separate release gate; no production safeguards were removed.

Apply migration 025 and restart API/worker to load `.env` changes. `pnpm budget:status` now includes operator-only model totals. To configure a self-hosted instance, begin with the zero-spend `.env.example`, choose explicit global/provider/model/user/job limits, and use your own server-side credentials. Blank model caps retain non-demo routing. Do not expose loopback development identity to public visitors.

| Choice | Route | Exact model |
| --- | --- | --- |
| GPT-6 Sol | Existing OpenAI Responses client | `gpt-6-sol` |
| GPT-6 Luna · xhigh | Existing OpenAI Responses client, captured xhigh producer reasoning | `gpt-6-luna` |
| Gemini 3.7 Flash | Google's OpenAI-compatible chat endpoint | `gemini-3.7-flash` |

DeepSeek was removed from the chooser and new public create/revise requests at the user's request. Its adapter, prices and ledger support remain for existing captured jobs and accounting; no history or credentials are deleted. An unsent draft with that old choice falls back to Sol without losing its direction. Sol remains the default.

Luna uses the existing server-only `OPENAI_API_KEY` and OpenAI allowance. Both production phases use its captured `xhigh`; the small separate symbolic critic and Rewrite/Inspire helper retain their low-reasoning role. [Official Luna documentation](https://developers.openai.com/api/docs/models/gpt-6-luna) confirms xhigh and requires Responses for reasoning with tools. The pinned LangChain package otherwise drops reasoning for GPT-6 names, so Luna explicitly forwards its effort through supported model kwargs; a mocked HTTP test checks the actual Responses request, tools and key route. No package upgrade, changed spend cap or live generation is required.

The producer and symbolic critic use the selected route. Rewrite/Inspire remains a separate Luna helper charged to OpenAI. Optional source analysis remains the existing Gemini adapter; it is not native-score listening. Choosing Gemini as producer does not enable rendering/listening.

The narrow LangChain adapter preserves Gemini opaque tool signatures and DeepSeek protocol reasoning in private checkpoints, not the public Producer feed. It binds the same validated tools. There is no model/network generation retry. Missing usage retains a liability. Gateway generation IDs support read-only billing lookup (five bounded attempts for delayed ingestion); missing billing or unexpected BYOK remains uncertain, never free or implicitly re-dispatched.

Gateway team settings must use Gateway credits, with dashboard BYOK disabled for this workflow. The application does not supply upstream credentials to Gateway. Team-wide BYOK can otherwise charge an upstream account before the response reports `is_byok`; rejecting that response is an accounting fence, not prevention of that first external charge. Check this setting before live evaluation ([Vercel BYOK behavior](https://vercel.com/docs/ai-gateway/authentication-and-byok/byok)).

## Limits

Every new reservation (including prompt help and critic) holds the existing global advisory lock and checks:

1. Combined lifetime application cap: `INITIAL_BUILD_API_BUDGET_USD` — current local authorization stays **13**, not 13 + new key balances.
2. Provider lifetime pool: `OPENAI_POOL_BUDGET_USD` (defaults to combined cap), `GEMINI_POOL_BUDGET_USD` (5), `GATEWAY_POOL_BUDGET_USD` (10).
3. Owner lifetime cap: `DEFAULT_USER_BUDGET_USD` (13), or an operator override in `owner_usage_limit`.
4. Existing job/call/deadline/input/output limits.

Observed spend plus outstanding reservations/uncertain effects deplete all applicable caps. Changing a key or starting a new job does not reset usage. Caps are local allowances, **not** automatically synchronized provider balances. Provider balances may also be spent outside this app. Gemini and OpenAI balances were not established. The read-only Gateway `/v1/credits` check on this supplied key returned HTTP 200, balance **0**, total used **0**; the reported $10 therefore needs the user's team/key/purchase check. No generation was sent.

Operator commands (PowerShell, repository root):

```powershell
.\node_modules\.bin\tsx.cmd packages/core/src/db/migrate.ts
.\node_modules\.bin\tsx.cmd scripts/check-provider-budget.ts
.\node_modules\.bin\tsx.cmd scripts/set-user-limit.ts OWNER_UUID TOTAL_LIFETIME_USD
```

The last command sets a total cap, not a top-up or spend reset. It is deliberately not a user-accessible API. New cap fields can be set in the existing root `.env`; restart API/worker to pick up configuration. Migration 023 preserves all existing data.

**Identity boundary:** enforcement is keyed to the trusted database owner, never a browser-provided user ID or Audiotool display name. Two-owner PostgreSQL tests verify independent quotas sharing a provider pool. The running app still uses its existing one-owner loopback development authentication and blocks production startup. Separate visitor sign-in/session ownership is not implemented by this pass; the account avatar does not authenticate distinct users. Do not expose this local development service publicly.

## Pricing evidence and limits

- [OpenAI Sol](https://developers.openai.com/api/docs/models/gpt-6-sol): existing captured rates retained.
- [OpenAI Luna](https://developers.openai.com/api/docs/models/gpt-6-luna): existing helper rates reused for the producer: $0.10 input, $0.01 cache read, $0.125 cache write and $0.50 output per million. Current input guards remain below the long-context pricing threshold; reasoning shares the output ceiling and price.
- [Google pricing](https://ai.google.dev/gemini-api/docs/pricing): Flash 3.7 standard text $0.75 input/$3.75 output per million through December 31, 2026; revisit before January 1 price change. No explicit paid cache storage is created.
- [Gateway live catalogue](https://ai-gateway.vercel.sh/v1/models): Pro 0813 is newer than original V4 Pro, supports tools and structured output. Base $0.66/$1.98 per million; provider/regional/peak rates vary. Reservation envelope uses 2× published regional rate ($2.64/$7.92) with no assumed cache saving. Settlement uses Gateway reported total cost, including surcharges, not the base catalogue estimate.
- [Gateway generation lookup](https://vercel.com/docs/ai-gateway/observability-and-spend/usage) and [Google compatibility](https://ai.google.dev/gemini-api/docs/openai).

The Gateway details above apply to historical jobs, not a currently selectable producer. Offline wire/tool/ledger/browser tests do not establish Luna's real-model creative performance or account access. No paid comparison or automatic restart of Lantern was performed. A subsequent [focused finishing-recovery pass](native-finishing-recovery.md) repairs the context/critic/convergence paths independently of model choice; Lantern remains paused until explicitly continued.
