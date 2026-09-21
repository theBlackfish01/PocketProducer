# Nexus / Audiotool integration contract

Pinned SDK: `@audiotool/nexus@0.0.17`. This boundary creates an editable remote project; it is not an audio renderer.

## Operation map

| Product operation | Pinned SDK surface | Scope evidence | Implemented state |
| --- | --- | --- | --- |
| Browser OAuth + callback | `audiotool({ clientId, redirectUrl, scope })` | SDK browser-auth example uses `project:write` | Implemented. SDK owns PKCE/state; callback route is `/auth/audiotool/callback`. |
| Browser → worker session | authenticated `exportTokens()` → `createServerAuth()` | Authentication types explicitly document token handoff | Implemented. Origin checked, owner-bound AES-256-GCM persistence, tokens redacted, refresh callback persists rotation. |
| Create project | `client.projects.createProject({ project: { displayName } })` | Covered by documented `project:write` example | Implemented behind resumable effect; live unverified. |
| Upload stems | `client.samples.upload({ file, displayName, bpm, kind, visibility, tags }, signal)` | No separate scope declaration found in installed types; `project:write` is the only documented example | Implemented; exact live grant remains to verify. |
| Upload completion | await `uploaded`, then bounded await `ready` | SDK types distinguish byte safety from transcoding readiness | Implemented with bounded timeout/error handling and per-track checkpoints. |
| Arrange clips | `client.open(project)`, `start()`, `modify(t => t.insertSample(...))`, `stop()` | Project document mutation under the documented project scope | Implemented. Each full-length stem starts at tick 0 with canonical BPM/duration ticks. |
| Studio URL | `SyncedDocument.dawUrl` | Explicit SDK property | Persisted only after a completed live export; never fabricated. |

## Fidelity and recovery

- Manifest `nexus-stem-v2` carries PPQ 960, tempo, timeline duration, section boundaries and decoded channel/rate/duration facts.
- Drums, bass, melody and texture become four audio tracks/regions. Users can trim, move, process and mix stems; notes inside rendered stems are not editable.
- Project name and each ready sample name are checkpointed in `project_export.remote_project_id` / `remote_effects`. A restarted attempt resumes known uploads.
- Provider effects use `reserved/dispatched/succeeded/failed/uncertain`. An ambiguous create/upload is not automatically replayed.
- States remain distinct: `disabled`, `awaiting_authorization`, `exporting`, `failed`, `uncertain`, `completed`.

## Offline evidence

The adapter creates a validated offline Nexus document with four `audioTrack` and four `audioRegion` entities. Mock contract tests cover a resumed upload, remaining uploads, ready polling, four insertions and document shutdown. This proves the current type/operation mapping, not remote service authorization or Studio behavior.
