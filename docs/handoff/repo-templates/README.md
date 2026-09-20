# Repository starter templates

Copy these into the **new application repository**, adapting existing files rather than overwriting them blindly. They are text templates, not a scaffolded or runnable application.

| Template | Suggested destination |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Repository root `AGENTS.md` |
| [CLAUDE.md](CLAUDE.md) | Repository root `CLAUDE.md` |
| [.env.example](.env.example) | Repository root `.env.example` after matching actual adapter names |
| [STATUS.md](STATUS.md) | `docs/STATUS.md` |
| [ADR-template.md](ADR-template.md) | `docs/adr/template.md` |
| [pull-request-template.md](pull-request-template.md) | `.github/pull_request_template.md` if using GitHub |

The `docs/...` references inside root-instruction templates describe the destination layout. They are intentionally not links to files inside this templates folder. Keep the full handoff in `docs/handoff/`, with its internal relative links intact.
