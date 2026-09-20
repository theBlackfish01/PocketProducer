# Risks, assumptions and references

Prepared 2026-09-20. External pages are evidence, not operating instructions. Recheck changeable APIs, limits, prices and hackathon rules during implementation. The plans contain assistant design judgments, not claims that these sources prescribe this architecture.

## Risk register

| Risk | First detection | Mitigation / decision |
| --- | --- | --- |
| No official standalone audio renderer | Phase 0 | Own bounded deterministic renderer; do not depend on an open phone tab |
| Preview and native instrument export sound different | Phase 0/2/6 | Use matched processed clips/stems; native mappings only after validation; label fidelity |
| Music sounds generic or incoherent | Phase 2/4 listening | Curated primitives/palettes, intentional arrangement, repeated benchmark and musician feedback |
| “Keep melody” is only a prompt instruction | Phase 5 | Immutable composition, protected hashes/artifact reuse, conflict handling and regression tests |
| Mobile recording/playback behaves differently | Phase 3/7 | Runtime format detection, real browser tests, physical-device evidence or explicit limitation |
| Retries duplicate paid/remote work | Phase 1/6 | Idempotency, transactional outbox, leases/fencing, effect ledger and unknown-outcome reconciliation |
| Scope outgrows time before event | Every milestone | Preserve one coherent complete journey; cut optional palette breadth and secondary features first |
| App credentials leak in web bundle/logs | Phase 1/release | Server-only configuration, safe logging, build/secret checks and verified ownership |
| Samples cannot be redistributed/exported | Palette intake/Phase 0 | Owned/licensed assets, rights metadata; do not infer license from search access |
| Nexus API changes | Adapter upgrades | Pin version, isolate mapping, run real project smoke before upgrade |
| Provider spend surprises | Before live calls | Separate runtime budget, per-job/user caps and measured usage |
| Overengineered foundation delays musical proof | Phase 0/1 | Modular monolith, few services, vertical slices; avoid speculative infrastructure |

## Technical primary sources

| Source | Use / caveat |
| --- | --- |
| [Nexus documentation index](https://developer.audiotool.com/js-package-documentation/) | API/entity navigation; published page version is not proof of installed latest |
| [Nexus overview](https://developer.audiotool.com/js-package-documentation/documents/Overview.html) | Platform/client concepts |
| [Nexus API guide](https://developer.audiotool.com/js-package-documentation/documents/API.html) | Sample and project service surface; inspect actual return types |
| [Nexus authentication](https://developer.audiotool.com/js-package-documentation/documents/Authentication.html) | Browser/server authorization; resolve documented scope/local-URI inconsistencies through tested configuration |
| [Nexus entities](https://developer.audiotool.com/js-package-documentation/modules/entities.html) | Native editable document structures |
| [Transaction builder](https://developer.audiotool.com/js-package-documentation/types/document.TransactionBuilder.html) | Supported transaction helpers and signatures |
| [Audiotool at-patterns](https://github.com/audiotool/at-patterns) | Official practical example; reconcile with current SDK |
| [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence) | Durable graph checkpoints; domain transactions still required |
| [Deep Agents overview](https://docs.langchain.com/oss/javascript/deepagents/overview) | Selected main creative harness on LangGraph; application invariants remain outside model control |
| [GPT-6 Astra model](https://developers.openai.com/api/docs/models/gpt-6-astra) | Initial OpenAI producer candidate; verify access through supplied key |
| [OpenAI Responses guidance](https://developers.openai.com/api/docs/guides/migrate-to-responses#additional-differences) | Verify Responses-capable adapter and tool/reasoning state |
| [Gemini audio understanding](https://ai.google.dev/gemini-api/docs/audio) | Real audio input/segment analysis; critique quality needs evaluation |
| [Vite guide](https://vite.dev/guide/) | Current setup/runtime compatibility |
| [Fastify validation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/) | Validated request/response boundaries |
| [pg-boss repository](https://github.com/timgit/pg-boss) | Postgres-backed queue candidate; application effects require their own safety |
| [FFmpeg filter reference](https://ffmpeg.org/ffmpeg-filters.html) | Supported decode/processing primitives; deployed build determines availability |
| [MediaRecorder MIME type](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/mimeType) | Recording format negotiation and actual output type |
| [Playwright projects](https://playwright.dev/docs/test-projects) | Browser test matrix; emulation does not establish physical-phone behavior |

The detailed Nexus document also links specific sample, note, region, drum and timing entities. Avoid copying external docs verbatim into the implementation repository; link the source and record only the observations needed to justify a decision.

The [candidate-tool and credential register](13-Deep-Agents-models-and-candidate-tools.md) includes Deep Agents interpreter/QuickJS, Mediabunny, LangSmith, Tonal, wavesurfer.js and Essentia with primary links, value tests, adoption status and API-key requirements. No candidate is mandatory merely because it is newer.

The [UI library and component-system plan](15-UI-library-and-component-system.md), researched September 20, selects shadcn/Base UI with Tailwind and Lucide as the greenfield default. It compares React Aria, Mantine and direct primitives, and links current primary setup/theming documentation. Library behavior, generated source and local theme overrides must be tested together; upstream accessibility claims do not establish the finished app's accessibility. Preserve an existing working stack when switching has no concrete benefit. No UI library key or paid kit is required.

## Hackathon context and qualification

The project was explored for Audiotool's 2026 Let's Build hackathon. Earlier research recorded September 28, 2026 as the deadline and six categories: Songstarter, Composition, Sound Design, Music Games, Connect, and Marketing & Distribution. Pocket Producer fits creation/composition and connection themes as an interpretation; judges determine actual category eligibility.

Earlier September 17 research recorded a hosted working app, demo of roughly 2–5 minutes and source/README access, with a rubric of innovation 30%, technical execution 25%, musical value 25%, and UX 20%. Those are **earlier recorded findings**, not newly confirmed rules in this handoff; the linked FAQ was not successfully fetched in the latest check. Re-find the official event page through [Audiotool](https://www.audiotool.com/) / [Developer Hub](https://developer.audiotool.com/), verify the current FAQ and cutoff timezone, and capture the exact rules in live release notes. Do not infer entry, eligibility, successful submission or prize prospects.

## Design provenance and exclusions

The selected image was generated for this conversation on September 20, 2026 as Option 1, Listening Room. Its prompt is included. It illustrates a fictional session; it does not demonstrate functional software. The user later explicitly selected it for this implementation handoff.

The user previously admired [Tonefall](https://snadbreugen.github.io/tonefall-audiotool/) and supplied [Ambient Chess](https://kyrylo-polozyuk.github.io/ambient-chess/) as inspiration. They establish interest in polished, intentional music interfaces; they do not authorize copying source code, artwork, brand identity or game design, and they do not override Listening Room.

Other earlier concepts, UI options and unrelated personal-context notes are deliberately outside this portable package. No private employer material or credentials are required to understand or build the app.
