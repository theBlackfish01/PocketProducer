# GPT-6 Sol switch and imported LangSmith review — 2026-09-27

New producer jobs now default to `gpt-6-sol`. The ignored root `.env` has no `OPENAI_MODEL` override, and the loopback API/worker were restarted. Existing jobs retain their captured model and pricing. The manual failed-effect reconciliation helper now uses the effect's recorded model and refuses an unknown one. Verified Sol text rates per million tokens are US$2 input, US$0.20 cached input, US$2.50 cache write, US$10 output ([official OpenAI model page](https://developers.openai.com/api/docs/models/gpt-6-sol)). The historical Astra entry is unchanged.

The existing private configuration enabled a read-only import of the `PocketProducer` LangSmith project: two root traces and all 151 child runs. Both historical runs used Astra, **not** Sol. Trace metadata's job ID was correlated with the development PostgreSQL ledger; neither failed job was restarted.

| Trace / job | LangSmith runs | Durable local outcome | Terminal cause |
| --- | --- | --- | --- |
| `01a0df67-1c23-736b-931f-999f2ce7d4a5` / `758151d4-c112-42a5-af6f-d6378c230a86` | 56; 5 LLM, 16 tool; ~41 s | Failed; saved plan, zero musical steps, no revision; US$0.344563 ledger cost | Two invalid `inspect_native_capability` paths in a parallel superstep; sibling preset calls aborted. This older trace hid arguments, so the exact path is unavailable. |
| `01a0dfa1-ef32-74cb-86e3-1b46689c2217` / `d6921ce1-7e49-463a-bad5-1210eb4a6ed9` | 95; 10 completed LLM calls plus one undispatched/pending span, 24 tool; ~154 s | `needs_attention`; saved plan, zero musical steps, no revision; US$0.909746 ledger cost | Site-budget pre-dispatch stop after two large `compose_native_form` attempts returned beat-grid validation errors. |

The later run spent its first eight model turns largely planning, reading and searching sounds. Calls 9–10 generated/retried a seven-part, five-section form; each was rejected before a durable `native_job_step`. A traced motif note at `1.025` beats generated only a `1.13686837721616e-13` tick-rounding residue, not a musically off-grid value. The last two calls account for about US$0.503 of LangSmith's US$0.982 estimate. LangSmith marks the two tool executions `success` even though their ToolMessage content says `Error: Native form beat positions must map exactly to 960 PPQ ticks`. Current timing tolerance, structured tool recovery and small-batch guidance postdate these traces and pass offline/scripted tests; they have **not** been live-reverified on Sol.

LangSmith root cost estimates are US$0.4014505 and US$0.9817335 versus the local ledger's US$0.344563 and US$0.909746. The differences (US$0.0568875 and US$0.0719875) are consistent with different cache-write treatment of non-cached input. The app applies cache-write rates to reported writes and reserves conservatively before dispatch. This comparison is not proof of the provider's final bill; do not rewrite accumulated accounting without a billing reconciliation.

The older root records `LANGSMITH_HIDE_INPUTS=true` and `LANGSMITH_HIDE_OUTPUTS=true`. The newer root records both `false` and includes the exact benchmark brief and workspace files. The current ignored `.env` retains those false values. They help debugging but send private creative material to LangSmith; turn masking back on deliberately when detailed payloads are no longer needed. No key was displayed or changed.

## Improvement priorities

1. Obtain a small, confirmed musical step before repeated connected-resource discovery. Set a bounded no-step exploration budget, then build/refine through smaller batches. Measure with a real Sol run; offline fixtures do not prove model behavior.
2. Return precise timing field/value/nearest-tick feedback and test the traced `1.025`-beat form through the production tool path, asserting an actual persisted step after correction.
3. Reconcile provider token classes, local ledger and LangSmith estimates against a billing source. Preserve historical prices and unknown-effect reservations.
4. Record a bounded domain result code and confirmed step/count on recoverable tool outcomes; a green tool span is currently not evidence that music was saved.
5. Give a paused, zero-step room a paused-specific empty-state headline. The live page says “The first musical shape is on its way” even while its job requires attention and has no score. Its **Continue this request** action should also disclose that this saved request remains on Astra despite the new Sol default, before any future paid continuation.
6. Evaluate contrasting sparse/detailed Sol briefs and choose tracing privacy settings intentionally. Keep symbolic checks, live Nexus fidelity and human hearing separate.

## Verification boundary

Provider-free checks passed: `pnpm check` (lint, types, 26 unit files / 140 tests, build), `pnpm test:integration` (4 files / 71 tests), `pnpm test:e2e` (13 Chromium journeys), `pnpm test:visual` (8 journeys), `pnpm test:course:static`, and `pnpm test:course`. Two budget-pause fixtures initially assumed Astra cost and were made model-price-relative. The regular loopback app loaded an existing paused room in a real browser; no creative command was submitted. Existing data and unrelated course edits were preserved. All suites use fixture/scripted providers; LangSmith retrieval was read-only. No new OpenAI, Gemini or Audiotool job ran. The site ledger remains US$3.794405 spent/reserved under US$5, at most US$1.205595 remaining with four unknown Gemini liabilities. A substantial paid Sol evaluation needs a separately bounded allowance decision. Native rendering/playback and Gemini listening remain deferred.
