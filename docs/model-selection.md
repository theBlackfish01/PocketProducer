# Producer choice and shared usage

September 27, 2026. Existing Deep Agents/LangGraph construction, canonical score, protected revisions and explicit Audiotool copy remain unchanged.

## Choosing a producer

The prompt footer has a labelled model chooser on desktop and phone. It applies to a new construction or revision, not a paused/running job. Selection persists with the project-local direction draft. The API allowlists IDs and captures the model, billing provider and price with the job. Retries/continuations retain that snapshot; no model fallback switches wallets. Missing credentials reject live work instead of generating a fixture silently. Fixture mode is explicit.

| Choice | Route | Exact model |
| --- | --- | --- |
| GPT-6 Sol | Existing OpenAI Responses client | `gpt-6-sol` |
| Gemini 3.7 Flash | Google's OpenAI-compatible chat endpoint | `gemini-3.7-flash` |
| DeepSeek V4 Pro | Vercel AI Gateway chat endpoint | `deepseek/deepseek-v4-pro-0813` |

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
- [Google pricing](https://ai.google.dev/gemini-api/docs/pricing): Flash 3.7 standard text $0.75 input/$3.75 output per million through December 31, 2026; revisit before January 1 price change. No explicit paid cache storage is created.
- [Gateway live catalogue](https://ai-gateway.vercel.sh/v1/models): Pro 0813 is newer than original V4 Pro, supports tools and structured output. Base $0.66/$1.98 per million; provider/regional/peak rates vary. Reservation envelope uses 2× published regional rate ($2.64/$7.92) with no assumed cache saving. Settlement uses Gateway reported total cost, including surcharges, not the base catalogue estimate.
- [Gateway generation lookup](https://vercel.com/docs/ai-gateway/observability-and-spend/usage) and [Google compatibility](https://ai.google.dev/gemini-api/docs/openai).

DeepSeek is a lower listed-cost alternative, not a benchmark-proven music-quality winner. Offline wire/tool/ledger/browser tests do not establish real-model creative performance. No paid comparison or automatic restart of Lantern was performed. A subsequent [focused finishing-recovery pass](native-finishing-recovery.md) repairs the context/critic/convergence paths independently of model choice; Lantern remains paused until explicitly continued.
