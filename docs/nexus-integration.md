# Nexus / Audiotool integration contract

Pinned SDK: `@audiotool/nexus@0.0.17`. Nexus creates an editable project from already-rendered stems; it is not a standalone renderer.

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
| OAuth/PKCE | `audiotool({ clientId, redirectUrl, scope })` | Browser branches tested; live consent pending. |
| Owner-bound session | `exportTokens()` → `createServerAuth()` | AES-256-GCM local persistence and refresh callback tested. |
| Project | `projects.createProject` | Typed, checkpointed, mock verified. |
| Stem upload | `samples.upload`, await `uploaded` then `ready` | Typed, checkpointed, readiness/timeout tested. SDK supports `unlisted`; private visibility is not claimed. |
| Arrangement | `open/start/modify(insertSample)/stop` | Offline SDK and transport-boundary tests verify mapping/replay/uncertainty. |
| Studio URL | `SyncedDocument.dawUrl` | Persisted only after known completion; never fabricated. |

The installed examples identify `project:write`; no separate sample-upload scope declaration was found in the installed package. `AUDIOTOOL_CLIENT_ID` is absent, so live OAuth, grant sufficiency, remote privacy and Studio editability remain unverified. No remote export was attempted in this repair.
