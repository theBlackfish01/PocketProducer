# Nexus / Audiotool integration contract

Pinned SDK: `@audiotool/nexus@0.0.17`. Current native construction maps instruments, notes, patterns, routing, effects and automation into a validated offline SDK document. The explicit native-sync command is implemented with per-version create/apply/readback checkpoints, but **was not dispatched live in this assignment**. It refuses source-bearing documents until owned-sample mapping exists. A distinct earlier legacy path creates an editable-stem project from rendered audio; its contract follows below. A separate historical native-render probe accepted two `RenderAudio` requests but could not retrieve results; [evidence](../spikes/nexus-audio/RESULTS-2026-09-23.md). Do not rerun it for native-construction work.

## Native synchronization contract

`nexus-native-v1` converts 960 canonical ticks per beat to Nexus 3840. Offline validation reads back tempo, signature, duration, instrument counts, note tuples, drum steps, effects, routing and automation before a native revision commits. The remote worker, when explicitly requested with authorization, persists `create_in_flight` *before* project creation, persists the returned project identity, then records `apply_in_flight` *before* document mutation. A fresh `open/start` readback must hash-match the validated local structure before the per-version checkpoint becomes `verified`. Interrupted creates are not recreated; interrupted writes are read-only reconciled and never blindly replayed. Nonempty remote targets are conflicts, not overwrite candidates. The UI exposes a Studio link only for a verified checkpoint of the selected native revision. This logic has offline/restart tests, not live-provider evidence.

## Preserved four-stem export contract

## Time and fidelity

- Pocket Producer remains canonical at 960 PPQ. The adapter converts every exported timeline value with Nexus `Ticks.Beat=3840`.
- A 16-bar 4/4 body is 61,440 canonical ticks and 245,760 Nexus ticks. At 88 BPM it is 43.636 seconds.
- Config is updated to the canonical BPM, 4/4 signature and full project duration.
- Each decoded stem is checked for sample rate, channel count and body-plus-tail duration. The region begins at zero and spans the actual audio duration. The one-second render tail is preserved and recorded separately from the musical body; it is not stretched to another bar grid.
- Drums, bass, melody and texture become four enabled/routed audio tracks. A texture stem may be intentionally silent. Users can trim, move, process and mix these audio stems; notes inside them are not individually editable. Local preview mastering can differ from a raw stem sum.

`validateOfflineNexusMapping` reads Config and regions back from a validated SDK document. Tests cover 88 and 108 BPM, exact converted ticks/seconds, four routes, the tail, a silent texture and a production-shaped UUID. Local-only sample resource names are kept below the SDK's 60-byte field limit.

## Durable operation

Operation identity is owner + revision + provider + `nexus-stem-v3`. `project_export` serializes that identity across HTTP retries/jobs; `project_export_step` and the checkpoint distinguish `never_dispatched`, `in_flight`, `succeeded`, `failed` and `uncertain` for project creation, each upload, arrangement insertion and completion.

- Known project/sample IDs are persisted as soon as trustworthy and reused after restart.
- Completed arrangement replay returns the existing Studio URL with no mutation.
- A lost create/upload/modify response is uncertain. A new default export cannot bypass it or create another project.
- Cancellation/deadline is checked before every step. The whole operation shares the remaining job deadline. A dispatched SDK mutation cannot be rolled back; abort stops later steps and preserves uncertainty.
- Stop/token-persistence reporting after confirmed insertion cannot replace terminal success. Token writes are serialized so an older refresh cannot overwrite a newer expiry; persistence failures remain visible.

## SDK surface and authorization

| Operation | SDK surface | Status |
| --- | --- | --- |
| OAuth/PKCE | `audiotool({ clientId, redirectUrl, scope })` | Live browser consent and encrypted server handoff verified on 2026-09-23. The grant omitted a usable refresh token, so reconnect when it expires. |
| Owner-bound session | `exportTokens()` → `createServerAuth()` | AES-256-GCM local persistence and refresh callback tested. |
| Project | `projects.createProject` | Typed, checkpointed, mock verified. |
| Stem upload | `samples.upload`, await `uploaded` then `ready` | Typed, checkpointed, readiness/timeout tested. SDK supports `unlisted`; private visibility is not claimed. |
| Arrangement | `open/start/modify(insertSample)/stop` | Offline SDK and transport-boundary tests verify mapping/replay/uncertainty. |
| Studio URL | `SyncedDocument.dawUrl` | Persisted only after known completion; never fabricated. |

The registered app requests `user:read project:write project:read sample:write sample:read preset:read preset:write`. Live project list/create and native document writes/readback succeeded. The production stem-upload/export path, remote privacy and Studio listening remain unverified. No stem export was attempted in this native render probe. The generated `RenderAudio` RPC is outside the public client surface; operation retrieval returned regional 501 and global 403, so native audio completion is unverified.
