# Private repository preparation — 2026-09-27

Destination: [theBlackfish01/PocketProducer](https://github.com/theBlackfish01/PocketProducer). GitHub returned `isPrivate: true` before any source was pushed. This is repository sharing, not deployment, public release or Audiotool submission.

## What was prepared

- Replaced the historical milestone README with a product introduction, a real fixture-data screenshot, the creative loop, architecture, safe local setup, verification commands and explicit capability boundaries.
- Refreshed setup instructions and the example environment. A fresh configuration uses deterministic fixtures and zero spending caps. The existing `.env`, credentials, local data and accumulated usage were not changed.
- Added security and third-party/asset provenance guidance. No project-wide open-source license was selected on the owner's behalf.
- Preserved and reviewed the pending Luna xhigh feature and interactive-course refresh, saving them as separate commits.
- Made pnpm's optional native dependencies support the current host as well as Windows x64. The previous Windows-only filter was inappropriate for Linux CI.
- Hardened CI with read-only repository permissions, cancellation of obsolete runs, a timeout, the correct PostgreSQL health-check database, explicitly blank provider credentials and static course verification.
- Added a maintained provider-free README screenshot journey. The published image was inspected and contains isolated test data, not a user's private session.
- Updated the visual-test fixture for the read-only producer-model catalogue. It previously miscounted those unhandled GET requests as writes; application mutation behavior was not changed.
- Quoted test exclusion globs after clean Linux CI reproduced Bash expansion of the old unquoted script. Unit, database and browser runners remain separate.

## Sensitive material review

A local heuristic scan checked every reachable commit/blob plus nonignored working files, known credential patterns and exact configured secret values without printing those values. The initial scan covered **47 commits, 936 blobs, four configured secret values and 70 ZIP-entry reads** (the archived handoff appears in history and the working tree). No matches or files over 20 MiB were found. The pre-push scan covered **51 commits / 980 blobs / 320 working files** and also found no matches. The pushed tree was checked separately: no `.env`, `.local/`, `node_modules/` or `playwright-report/` entries were uploaded.

The checked-in handoff archive and older design/research notes are retained as project history. `.env`, `.local/`, provider traces, database exports, OAuth encryption keys, generated audio, dependencies and build/test outputs are ignored. Additional ignore rules cover common private-key, database and raw-trace filenames. This review is not a comprehensive security certification or permission to make the repository public.

## Verification

See the current entry in [STATUS](STATUS.md) for final suite counts and GitHub CI results. The repository-preparation pass runs ordinary offline checks only; it does not call paid providers, continue paused generation, copy to Audiotool or probe rendering. The README screenshot is evidence of the working interface with fixtures, not live-model quality.

The musical-construction integration suite now uses the same 45-second lease as production. Its earlier generic three-second lease could expire during synchronous offline-SDK work, causing varying failed seed/revision assertions on a loaded machine. The full integration rerun passed all 99 tests. Linux CI then exposed the same issue in successful contending child workers: these also use production leases now, while deliberately killed workers retain three-second expiry and all exact fencing/revision-count assertions remain. The final repository integration subset passed 14/14 locally. Production lease/cancellation safeguards and spending limits were not relaxed. Follow the hosted run linked in STATUS for its separate result.

## Before a public release or submission

Choose a project license and recheck third-party/handoff redistribution rights. Decide how reviewers will access a private repository. Record a demo that clearly distinguishes arrangement construction, explicit Audiotool copying and actual listening. Public hosting requires real user authentication and deployment hardening; neither the development identity nor an Audiotool avatar supplies that. Native full-mix playback remains deferred. The previously recorded reconciliation CLI v7 label is still a known minor documentation/diagnostic inconsistency with mapper v8; no render or synchronization redesign was undertaken here.
