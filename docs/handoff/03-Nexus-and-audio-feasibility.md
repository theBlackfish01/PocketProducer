# Nexus and audio feasibility gate

Evidence baseline: official documentation inspected during 20 September 2026 research, including pages labeled `@audiotool/nexus v0.0.17`. This is a documentation snapshot, not proof of the latest package release or a successful local integration. Check installed types and run small experiments before committing an adapter.

## What has documentary support

| Capability | Evidence and implementation consequence |
| --- | --- |
| Search/list/get/download/upload samples | The [API guide](https://developer.audiotool.com/js-package-documentation/documents/API.html) documents a sample service. Check returned metadata, formats, pagination, processing readiness, rights and quotas for actual assets. Samples and instrument presets are different resources. |
| Edit a synchronized project document | [SyncedDocument](https://developer.audiotool.com/js-package-documentation/types/index.SyncedDocument.html) and [transactions](https://developer.audiotool.com/js-package-documentation/types/document.TransactionBuilder.html) expose project construction. Synchronization start/stop must not be interpreted as audio transport. |
| Build drum patterns from samples | [Machiniste](https://developer.audiotool.com/js-package-documentation/types/entities.Machiniste.html), [channel](https://developer.audiotool.com/js-package-documentation/types/entities.MachinisteChannel.html), [pattern](https://developer.audiotool.com/js-package-documentation/types/entities.MachinistePattern.html), and [step](https://developer.audiotool.com/js-package-documentation/types/entities.MachinisteStep.html) types expose drum state. Check pattern/channel linkage and timing; a modulation-depth field is not automatically MIDI velocity. |
| Place audio on a timeline | [AudioRegion](https://developer.audiotool.com/js-package-documentation/types/entities.AudioRegion.html), [Sample](https://developer.audiotool.com/js-package-documentation/types/entities.Sample.html), and transaction helpers describe referenced audio and regions. Validate offsets, duration, looping and routing in the Studio. |
| Notes, devices, routing, effects, automation | The [entity reference](https://developer.audiotool.com/js-package-documentation/modules/entities.html), [Note](https://developer.audiotool.com/js-package-documentation/types/entities.Note.html), and [Config](https://developer.audiotool.com/js-package-documentation/types/entities.Config.html) establish a broad editable project model. Each supported export mapping still needs a test. |
| Browser authorization and server use | [Authentication](https://developer.audiotool.com/js-package-documentation/documents/Authentication.html) describes PKCE, exported user tokens, server auth, and token-refresh persistence. Implement a secure application session around that flow. |

Useful practical reference: [Audiotool's at-patterns example](https://github.com/audiotool/at-patterns) and the [Machiniste manual](https://www.audiotool.com/help/manuals/plugins/drums/machiniste.html). Examples can lag the installed SDK; use them to understand structure, not as unquestioned working code.

## What remains unproven

No authenticated call, native audio audition, sample upload, or export round trip was executed for this handoff. No official general-purpose server-side renderer was established. Waveform/graphics facilities are not evidence of PCM synthesis. SDK support in Node does not by itself mean the Audiotool audio engine runs headlessly there. Safari behavior, asset permissions, user quotas, and exact timing conversions need explicit verification.

## Phase 0 experiment sequence

Keep a small `spikes/nexus-audio/` directory with executable scripts and a results note. Record SDK version, date, OS/runtime, exact test steps, observed output, and remaining uncertainty. Redact credentials and user-identifying account details. Spend a bounded first working block, roughly half a day to a day if access is available, before selecting the fallback; do not spend the whole hackathon looking for an undocumented renderer.

1. **Read the installed surface.** Confirm current package exports, node/WASM loading, actual timing constants, sample service and document transaction methods. Check official examples and changelog. Compile a minimal script without inventing method names.
2. **Authenticate.** User creates/authorizes the app as needed. Verify exact redirect URI and scopes with a harmless operation. Documentation currently has inconsistent singular/plural scope wording and an HTTP/HTTPS local-URL discrepancy; do not copy both blindly. Record the successful configuration. Sample operations may require additional scopes. Avoid a full-account PAT for the shared public app.
3. **Prove sample lifecycle.** Use an owned short one-shot. Upload, wait for readiness, retrieve metadata, download/inspect the actual file, and record the identifier. Confirm that available library assets can lawfully be processed and re-exported for the intended use; discoverability alone is not permission.
4. **Prove native music.** In an app-owned scratch project, create a valid master/mixer route, one Machiniste, a linked sample/channel/pattern, and a simple four-bar drum phrase. Save/synchronize; open in Audiotool, play, and change a step. Capture project structure and observations. Dispose only of app-created scratch resources when appropriate.
5. **Prove audio regions.** Upload a known loop and place two regions at exact bar positions. Verify source rate, region offset, duration, BPM/loop metadata, routing, and the SDK tick conversion by hearing and inspecting the result. Do not assume a numeric ID or URL is interchangeable with a sample resource reference.
6. **Probe rendering.** Look for a documented render/export endpoint, supported engine package, or official example. If found, produce actual audio in a process independent of the browser, validate it, close the browser, and repeat. Check license, auth, operating limits, and deployment compatibility.
7. **Select and record a path.** If the official path passes, use an adapter around it. Otherwise implement the deterministic renderer below. Either route must keep the phone-closed promise. Do not silently substitute a browser tab kept alive on a developer machine.
8. **Prove the fallback/export pair.** Render an eight-bar sample-based piece locally, export matching clips or meaningful per-part stems through Nexus, and compare timing and content in Audiotool. Document editable granularity and differences.

## Supported fallback: own a small deterministic renderer

The fallback is not a replacement general DAW engine. Support a bounded palette that can be rendered reliably and mapped to Audiotool. Start with one-shots, known-tempo loops, and licensed/owned sampled notes; add synthesis/effects only when their preview/export behavior is understood.

Decode accepted sources into a canonical 48 kHz stereo PCM working format, preserving originals. Use a pinned FFmpeg build for decode, resampling and supported transformations; read [its filter documentation](https://ffmpeg.org/ffmpeg-filters.html) and test the actual build. Spawn a process with an argument array, never a command assembled from a filename or model output. Bound CPU, memory, wall time, decoded duration and temporary storage.

Render pipeline:

1. Resolve immutable source objects and verify their hashes. Build a sample-time event schedule from canonical tick positions and tempo.
2. Apply source trims and explicit transformations. Independent pitch shifting and time stretching are different operations; unsupported combinations must be rejected or baked with disclosed processing. Do not change a loop's speed by naïvely changing sample rate when pitch is supposed to remain fixed.
3. Mix events per track in float buffers, using short fades to avoid hard-cut clicks. Honor overlap, note duration/one-shot policy, track gain/pan, silence, and deliberate section boundaries. For large files use bounded chunks or a native processing path rather than unrestricted JS buffers.
4. Apply only allowlisted, deterministic effects. Record processing versions and parameters. Render reusable isolated track stems. Use modest headroom and a measured output safety stage; never normalize each tiny sample independently in a way that destroys dynamics.
5. Mix the preview, measure duration/peak/silence, and encode an appropriate browser-playable preview plus a lossless export intermediate. Keep output metadata and waveform peaks. Store real processing results, not fabricated audio metrics.
6. Persist content-addressed artifacts and QA results before marking a candidate ready. A successful process exit with an empty or silent file is a failure.

This renderer should function without an LLM using a known composition fixture. That separation makes musical and orchestration bugs diagnosable.

## Export fidelity ladder

| Mode | What the user can edit | Appropriate claim |
| --- | --- | --- |
| Native mapped pattern/notes | Supported notes, drum steps, instruments and parameters | “Editable notes/patterns” for verified mappings only |
| Processed sample clips with regions | Source clips, placement, repetition, volume and supported effects | “Editable audio clips”; not reconstructed native synth controls |
| Rendered per-part stems | Multiple track parts, timing, mix, cuts | “Editable stems”; internal notes/effects are baked |
| Single master file | One flattened recording | Download fallback only; insufficient as the sole meaningful integration |

Start with clip-based export where feasible, plus baked stems for unsupported effects. Native Machiniste export is a valuable demonstrable next step, but do not claim sound equivalence before checking it. For initial predictable parity, exporting processed audio from the same renderer is more controllable than imitating an undocumented instrument engine.

Use new app-owned Audiotool projects by default. Persist local revision → remote project/entity/asset mappings. Validate every referenced entity and route before commit. Some fields may require entity recreation rather than mutation; follow installed types and preserve references. Await sample readiness before inserting regions. Never clear an arbitrary existing user project to make an export easier.

Export is a separate job from creation. Preview readiness does not imply successful export. Show “Prepare in Audiotool” until the current revision has a ready remote mapping; then “Open in Audiotool.” If another version is selected, identify which version the existing export represents. Do not open a stale project as if it were the current mix.

## Required outcome of the gate

An ADR names the chosen renderer, supported sound palette, preview/export fidelity, authentication/scopes, actual tested browsers, and remaining risks. At least one audible real artifact and one editable real project are linked in development evidence when access permits. If external access is missing, label that portion blocked and continue offline work; do not mark Nexus feasibility passed.
