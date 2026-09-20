# Engineering workflow and documentation

## Start with a reproducible repository

Inspect the chosen directory before scaffolding; preserve uncommitted user work. Create a separate app repository if the current workspace is the personal vault. Do not infer a remote owner, public visibility, or permission to publish from this handoff. Local repository setup is routine; remote/public actions need the authorization appropriate to them.

Pin the runtime and package manager, commit the dependency lockfile, and document the tested OS/container assumptions. Use strict TypeScript and validated configuration. Do not use `any`, suppressed errors, disabled tests or broad `try/catch` success responses to hide integration uncertainty. A deliberately unimplemented adapter should fail explicitly or be enabled only in a labeled fixture mode.

Provide `.env.example` with variable names and safe local defaults, never real secrets. Ignore local secret files, audio scratch data, generated builds and test artifacts. Track only small owned fixtures and documentation assets. Review frontend build output for accidental server configuration imports. Dependencies must be selected against current compatibility, not a stale version list in this package.

For the UI, follow [the component-system plan](15-UI-library-and-component-system.md). Keep generated component source and configuration in the app repository, document provenance/customizations, and review upstream diffs before overwriting local changes. Install only needed components and use one primitive family. Pin the CLI generation version and runtime dependencies; preserve the Listening Room theme through upgrades. A small development preview route is sufficient initially; no separate design-system platform or global skill install is required.

## Commands the new repository should implement

These are **target interfaces**, not commands already present in this handoff:

| Command | Intended contract |
| --- | --- |
| `pnpm install --frozen-lockfile` | Reproduce dependency graph |
| `pnpm dev` | Start documented UI/API/worker development roles, or clearly list separate commands |
| `pnpm db:migrate` | Apply tracked migrations with safety checks |
| `pnpm seed:demo` | Idempotent owned demo fixtures; never inject fake user data into production |
| `pnpm lint` / `pnpm typecheck` | Required source checks |
| `pnpm test` | Fast deterministic domain and contract suite |
| `pnpm test:integration` | Real DB/storage/worker integration suite |
| `pnpm test:e2e` | Browser core flows against a production-like build |
| `pnpm test:live` | Explicit opt-in real-provider smoke with configured caps |
| `pnpm build` | Produce UI/API/worker release artifacts |
| `pnpm check` | Documented aggregate of required local checks |

If choosing a different manager, adapt once and use consistent commands everywhere. Do not leave a README that describes nonexistent scripts. Document FFmpeg/system dependencies and verification commands. Local setup should have an ordinary path for Windows and a reproducible deployment container path; don't silently assume Linux-only shell syntax.

## Work loop

1. Read live status and inspect current changes.
2. Select one concrete acceptance slice and relevant tests. Write a short plan for material work.
3. Implement the smallest complete path, including meaningful error behavior and contracts.
4. Run targeted checks; investigate failures rather than weakening assertions.
5. Run the required broader checks appropriate to changed boundaries.
6. Inspect the real UI for visual changes and listen to real audio for renderer/music changes.
7. Update the concise status, affected docs and evidence. Commit coherent changes when repository policy permits.

Keep commits reviewable: describe behavior and reason, not only filenames. Avoid unrelated refactors, generated junk, secrets, private source assets and enormous binary audio in git. Do not force-push, rewrite unrelated history, merge or publish without suitable authorization. A local branch/worktree is useful only when it provides real isolation.

## Definition of done for a feature

- Its user-visible acceptance story works with real application data.
- Contracts and ownership checks are enforced server-side.
- Important failure/retry/cancellation behavior is covered where relevant.
- UI remains usable on phone, desktop and keyboard; visual quality is inspected.
- New durable fields have migrations; persisted behavior remains compatible or has a documented migration.
- Appropriate tests pass; live/unavailable checks are honestly marked.
- Setup/API/architecture docs are updated when their behavior changed.
- Logs and errors disclose neither secrets nor unnecessary user content.
- No TODO hides the central promised capability. Follow-ups have explicit scope and priority.

A reversible spacing change does not need a new unit test. A revision-lock guarantee, external side effect or cross-user asset route does.

## CI progression

From the first scaffold: frozen install, formatting/lint/types, domain/contracts and production build. As persistence and audio land, add a real Postgres service, pinned FFmpeg and small fixture tests. Add browser tests for creation and revision using deterministic provider responses. Use caches keyed by lockfile/runtime, but never let stale generated state hide setup failures.

For a release: required PR checks plus live Nexus/model smoke, representative musical assessment, production-like deploy/rollback, device checks and clean-clone setup. A test requiring secrets should run only in trusted environments. Keep recorded evidence private when it contains account information, and sanitize screenshots before putting them in public docs.

## Documentation map

| Document | What it must answer |
| --- | --- |
| Root README | What works; screenshot/demo; local setup; commands; limitations; license |
| `docs/STATUS.md` | Current milestone, actual tested state, blockers, next three actions |
| `docs/architecture.md` | Components, data flow, invariants, why this structure |
| `docs/adr/` | Significant decisions with evidence and revisit triggers |
| `docs/api/` | Generated OpenAPI plus auth/job/event semantics |
| `docs/music.md` | Supported palette, musical limits, renderer and export fidelity |
| `docs/design.md` | Listening Room tokens, components, behavior and accessibility |
| `docs/testing/` | Test strategy and real release evidence |
| `docs/runbooks/` | Deployment, worker failures, token reconnect, restore and rollback |
| `docs/assets.md` | Source/fixture/artwork/font provenance and licenses |

Do not copy all handoff prose into all these docs. Link the dated baseline and write concise implementation truth. Explain the non-obvious invariants in code comments; avoid comments that repeat syntax. Keep status current enough that a new session does not have to infer completion from commits.

## Project-local agent guidance

Adopt the supplied AGENTS template and CLAUDE import only inside the application repo. Add a skill later if a repeated workflow benefits from it, such as validated Nexus export or audio regression review. A pile of speculative skills is not a prerequisite for building. Repository instructions should direct agents to tests and domain invariants, not encode hundreds of implementation details that become stale.

Do not introduce global model settings, hidden personal memories, app automations or recurring jobs from this package. Product runtime jobs are application code and distinct from the builder's personal assistant scheduler.
