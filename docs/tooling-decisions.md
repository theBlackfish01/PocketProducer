# Tooling decisions

| Tool | Version / state | Benefit and proof target | Fallback |
| --- | --- | --- | --- |
| shadcn CLI | 4.21.0 | Own Base UI-backed accessible component source; inspect generated diff and theme it | Hand-maintained Base UI wrappers |
| Base UI | 1.8.0 | Dialog, menu, slider and selection keyboard/focus behavior | No second primitive family |
| Tailwind CSS | 4.3.3 | Semantic theme tokens and responsive composition | Local CSS for waveform/layout |
| Lucide React | 1.47.0 | One consistent icon family | Text labels remain authoritative |
| wavesurfer.js | 7.12.12 selected/verified | Renders server peaks around the one shared `HTMLAudioElement`; real playback advanced the labeled seek input | Native audio plus accessible range input |
| Deep Agents | 1.14.0 selected | Scoped workspace/skills and LangGraph harness | Direct validated OpenAI adapter for provider-unavailable tests only |
| Tonal | deferred | Current compiler needs only a constrained scale/progression table | Deterministic local music primitives |
| Mediabunny / Essentia / QuickJS | deferred | No first-slice benefit worth added runtime surface | Server inspection and typed tools |
| LangSmith | optional/off | Not required for local execution | Structured local job/effect records |

The repository pins exact runtime versions and upgrades only after reviewing generated component/API changes and rerunning affected tests.

The Nexus 0.0.17 node entry point creates a validated offline document but exposes no supported standalone renderer. It remains an export/document boundary rather than the audio engine. The substantive mapping now creates one audio track/region per canonical stem; browser PKCE and server token handoff use the same pinned SDK. See `docs/nexus-integration.md` for exact operations and scope uncertainty.

`@google/genai` 2.23.0 is kept because it accepts real WAV bytes, JSON Schema output and usage metadata. The configured `gemini-3-flash-preview` model and current pricing/audio support were checked against official Gemini documentation; the live execution still needs the host's explicit external-data/spend approval. Optional Tonal, Mediabunny, Essentia and QuickJS candidates remain deferred because canonical scheduling, WAV inspection and validated tools are already covered with less runtime surface.

TypeScript 7.0.2 was evaluated during bootstrap but required a separate native Windows compiler package that the local pnpm runtime did not materialize reliably. The repository therefore pins TypeScript 5.9.3 for a portable JavaScript compiler path; revisit after the native packaging path is dependable in clean Windows installs.
