# Creative native construction pass — 2026-09-24

This is the current implementation contract for the follow-up to reviewed baseline `92a8daf`. The attached handoff is a work order, not runtime evidence. Native rendering, playback and Gemini listening remain deferred. The legacy accepted WAV history is separate and untouched.

## User workflow and producer boundary

In the Listening Room, create a room, optionally add owned WAVs, describe a direction, and choose **Construct native project**. The production OpenAI Deep Agent can inspect a short pinned summary, actual parts/motifs/sections and selected source profiles, search the pinned SDK catalogue and local resource recipes, submit a model-chosen form, then inspect and refine with validated batches. The form chooses meter, 4–128 bars, 1–12 parts, nonuniform sections, notes/motifs/placements, supported devices/parameters/effects/automation and owned-source intervals. It is not the old forced 32/64-bar blueprint. Deep Agent tools have no host shell, credential, render, Gemini or remote-mutation access. Their workspace is scoped; current context and diffs are regenerated from confirmed local state after tool calls. Long tool history is compacted only for model dispatch; durable graph and ordered musical steps remain intact. A conservative byte-bound request limit may still reject a large prompt before dispatch.

The user may hard-target one part/section or leave either unrestricted. A revision can replace a motif, localize one placement, change a mapped parameter, processing, automation, notes, structure or source region. The worker applies an explicit protect/unlock request before the producer; the model cannot submit `protect`. Part protection hashes the part and referenced motifs, covering notes, placements, device, mix, processing, automation and source regions. Shared motif changes affecting a protected part are rejected. A section target forbids global timing/sound changes and changes outside that section. A protection-only version is permitted when explicitly requested; label/objective-only revisions are rejected as musical work. Compare shows selected-versus-current diffs; restore selects a local immutable head only.

All ordinary tests force fixture mode, clear provider keys and use an isolated database/storage root. Scripted-model tests enter the same `produceNative` Deep Agent, tools, validation, effect ledger and worker-facing commit contracts, but do **not** prove live model quality. The deterministic fixture generator remains for offline browser/demo coverage only.

## Finding disposition

| Finding | Disposition and evidence | Remaining limit |
| --- | --- | --- |
| F1 forced blueprint | Fixed in production path: model-chosen `compose_native_form` plus lower-level batches, actual inspection and optional refinement. Three structurally distinct scripted briefs pass through Deep Agents. | No new paid real-model quality trial was authorized. |
| F2 narrow creative controls | Expanded: curated synth/effect fields, edit/remove operations, motifs, meter, source intervals and serial effect-chain routing; offline SDK values are checked. | No arbitrary buses/sends, public preset search, full parameter surface or subjective mix assessment. |
| F3 lossy readback | Fixed for the supported v2 mapper: semantic entities/pointers, region placement/loop, routes, mixer, effects, automation, samples and interval fields are fingerprinted. Independent equivalent IDs agree; move/gain/pan/effect/automation changes disagree. Verification records mapping version/time; recheck opens afresh and conflicts rather than overwrites. | Live new-adapter synchronization remains unverified; SDK readback is not an atomic lock against concurrent Studio edits. |
| F4 resources/sources | Partly fixed: selected owned WAVs are hashed, profiled in bounded timed segments, available to agent tools, and mapped with nonzero offsets/once-or-loop. Durable upload identities and a two-source worker contract double pass. | Public sample/preset catalogue and authorized remote sample readiness/readback are not live verified; local recipes are not Audiotool presets. |
| F5 unlocking | Fixed: explicit expected/desired lock transition survives a protect → accept → unlock → edit and restore path. Stale heads and model-authored unlocks are rejected. | Structural protection is not an audible identity guarantee. |
| F6 Beatbox semantics | Fixed by supported contract: lanes 36/38/42/46, boolean on/off velocity 1, sixteenth grid, fixed step duration and five slots. Unsupported transpose/expression/pitches are rejected before acceptance. | Continuous drum velocity and arbitrary timing are not implemented. |
| F7 diffs/compare | Fixed: actual before/after tool results, part field/motif/source/protection and global tempo/meter/bars/section changes; UI compare is pairwise. Metadata-only musical revisions are rejected. | No audio A/B exists for a native draft. |
| F8 late accounting | Fixed for observed evidence: late cost/request ID settles uncertain or failed effects once without promoting stale output; contradictory observations conflict. | Unknown provider usage remains held; no blind replay or invented zero cost. |
| R6 retry/recovery/legacy | Definite failed/cancelled attempts can use an explicit new key after effect safety checks; duplicate receipts replay. Confirmed steps/model effects recover without redispatch. Uncertain create/upload/write/model outcomes fence further dispatch. Legacy audible-source check uses the selected rendered excerpt. | An unobserved post-dispatch result still requires reconciliation; exact-once external billing is not claimed. |
| UI | Composer is above the long inspector, palette is collapsed, part/whole-piece scopes are explicit, source states and local/verified/conflict states are labeled, and short generated titles name default rooms. Desktop and 390 px screenshots inspected. | Physical phone/non-Chromium and mobile keyboard hardware remain unverified. |

## Capability contract

| Capability | Search/read | Validated canonical write | Offline Nexus mapping | Live new-adapter evidence |
| --- | --- | --- | --- | --- |
| Pinned SDK entity paths | Broad schema search and path details | Only curated roots/fields | Curated operations only | None |
| Heisenberg, Pulverisateur, Gakki | Part/device/parameter inspection | Notes, motifs, gain; mapped filter, oscillator/operator/envelope subset | Yes, values and routes read back | Earlier small Heisenberg probe only; not this mapper |
| Beatbox8 | Pattern/motif/placement inspection | Four boolean lanes with strict grid/slot contract | Yes | None |
| Channel and serial effects | Gain/pan and effect-chain inspection | Instrument → ordered delay/reverb/compressor/EQ/filter → channel; replace/remove effect | Yes | None; buses/sends unsupported |
| Automation | Points and target inspection | Gain, pan, auto-filter cutoff; replace/remove curves | Yes | None |
| Owned WAV intervals | Measured segment profile and exact owned hash/rights | Multiple selected assets, offset, duration, once/loop and gain | Yes with ready sample identities | Upload/readiness and remote playback unverified |
| Public sample/preset library | SDK schema discoverable | No model-authored remote IDs | No | No; local recipes only |

Mapped values are SDK field values, not assumed physical units. `@audiotool/nexus@0.0.17` and mapper `nexus-native-v2` are pinned. A recognized entity root does not make all fields writable. Native sync allocates a distinct remote project per immutable version; local restore never rewrites it. The offline source-sync test uses a contract double with a validated SDK document and two `open` calls; it cannot establish real remote permissions, readiness timing, privacy or sound.

## Brief-to-structure evidence (scripted model, no provider access)

| Brief | Confirmed structure | Assumption / unsupported claim |
| --- | --- | --- |
| Sparse 3/4 chamber pulse | 12 bars, three 4-bar sections, one Heisenberg lead, 84 BPM, 3/4, non-default filter/operator settings, lead call and delayed return. Three model turns: form, inspect part, stop. | The brief did not specify a key; pitch choices are structural, not heard. No mix-quality claim. |
| Pulse/haze → bass/chords → break/response → return/coda | 48 bars, section lengths 4/12/8/16/8, Beatbox8 plus four pitched roles; bass/chords enter after the opening, lead enters at the break; compressor/reverb and synth parameters read back. | “Restrained” is an intent label and lower structural density, not a verified subjective property. |
| Later field event + room tap | 12 bars and three roles. Two actual owned WAVs are hashed/profiled. The first opens with four silent seconds; selected intervals start at 4.5 s and 1 s. Source placement, identities and offline SDK mapping are checked, then the worker contract double uploads both and records fresh v2 readback. | These sources are placed/referenced, not audibly verified. Contract-double upload is not real Audiotool access. |

A separate scripted revision inspects a shared pulse motif, defines a sparse variation, retargets only the Bloom instance, inspects the target section and compares/restores. Its other instance and protected lead/pad hashes are unchanged. Explicit unlock later changes a lead device while a pad remains protected. These are actual structural diffs and immutable DB versions, not fixture-only screens.

## Recovery, migration, and verification boundary

Migrations `010_native_verification.sql` and `011_native_owned_samples.sql` add mapping version/verification time and one durable upload identity per owned source. They add columns/tables without rewriting prior native or legacy revisions. Both dedicated test DB and existing development DB were migrated in place; accepted audio and `.env` were preserved. Project title is updated from the default only after a successful first native generation, not on a user-named room.

The last read-only budget audit reported USD 0.618486 known spent-or-reserved of the unchanged USD 5 cap, USD 0.25/job, four model calls/job, and unknown Gemini liability. This pass made zero live OpenAI, Gemini or Audiotool calls. Native output remains structurally editable but has no new preview. A future bounded live check needs explicit authorization for one disposable source-free and one owned-source synchronization/readback, with no render/export/publication. Reconnect Audiotool first only if its non-refreshable grant has expired.
