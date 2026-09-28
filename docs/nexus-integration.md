# Nexus / Audiotool integration contract

## September 28 note-lane layout repair

New exports use mapper `nexus-native-v9`: a part's supplementary individual notes use a separate timeline lane when phrase placements also exist, targeting the same player with no duplicate instrument or mixer channel. The existing note data and phrase loops remain exact. This avoids the full-song supplementary clip obscuring the regular pattern clips. No automatic rewriting of existing Audiotool projects occurs.

`native_revision_sync.mapping_version` is now captured before the first remote effect. Null historical checkpoints use v8 layout on recovery. Verified copies keep their saved mapper and compare fresh readback to their original verified hash, not a regenerated v9 layout. Unrecognized unfinished mapper versions fail closed. Structural readback format itself is unchanged. Production-worker contract tests use offline SDK documents, not live Studio playback.

## Earlier integration evidence (historical)

Pinned SDK: `@audiotool/nexus@0.0.17`. Current mapper `nexus-native-v7` covers grouped channels, shared sends, presets, library/owned-source intervals, expressive parameters, effect automation, and parallel processing. The explicit native-sync command has per-version create/apply/readback and per-source upload checkpoints. On September 27 the source-free *Midnight Escalator* score was created in a live Audiotool project and verified by a fresh SDK readback after correcting an enumeration-order false conflict; this is one supported structural case, not a general editability or listening verdict. The connected sample/preset and owned-WAV paths still rely on offline/contract-double evidence. A distinct earlier legacy path creates an editable-stem project from rendered audio; its contract follows below. A historical native-render probe accepted two `RenderAudio` requests but could not retrieve results; [evidence](../spikes/nexus-audio/RESULTS-2026-09-23.md). Do not rerun it for native-construction work.

## Native synchronization contract

`nexus-native-v7` converts 960 canonical ticks per beat to Nexus 3840. Semantic readback follows entity relationships and musical fields rather than counts; it normalizes generated IDs, enumeration order and precision and ignores UI layout. Bounded rounds of typed neighbour signatures preserve pointer topology and socket indexes before sorted-multiset comparison. Offline tests assert source gain/pan/FX/automation, synth/preset overrides, group/send pointers, resource intervals, curve target/shape and changed hashes. The mapper remains bounded to its owned entity subset; an SDK document does not prove sound.

For an explicitly sped-up source interval, `insertSample.sample.musicDurationTicks` maps the full real sample duration to project musical time, and the trim offset/selected length are scaled by the same bounded 0.5–2× rate. The SDK-generated playback-automation end tick is checked independently against normal speed. `audioRegion.timestretchMode` selects resampling (pitch changes with speed) or pitch-preserving time stretch; optional pitch shift is accepted only in the latter mode. This is structural readback, not listening. The installed SDK documents no tempo-independent native-speed option, so later project tempo edits can still stretch these regions.

The remote worker, when explicitly requested with authorization, persists `create_in_flight` *before* project creation, persists the returned project identity, then uploads each selected owned WAV to a durable source-hash identity and waits for `uploaded` and `ready`. Missing/ambiguous outcomes fence new commands. It records `apply_in_flight` *before* document mutation. A second `open/start` readback must match the validated local structure before a version checkpoint becomes `verified`, with mapping version and timestamp. Recheck is separate from duplicate command replay and conflicts on a changed remote hash; it does not overwrite Studio edits. A fenced copy with a known project identity can be read back and reconciled with `pnpm reconcile:native-sync <job-id>`; that command makes no remote write and marks success only when the selected revision, remote identity and full current-mapper structural hash agree. Interrupted creates are not recreated; interrupted writes are never blindly replayed. Nonempty native remote targets are conflicts. The UI exposes a Studio link only for a matching current-mapper checkpoint of the selected revision. Local restore does not mutate the remote project; a later Studio edit can race a readback because there is no provider transaction lock.

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
