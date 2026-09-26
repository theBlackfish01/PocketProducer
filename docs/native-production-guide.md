# Pocket Producer: hands-on native construction

## Start locally

From the repository root, with Docker running:

```powershell
pnpm install --frozen-lockfile
pnpm db:up
pnpm db:migrate
pnpm dev
```

Open `http://127.0.0.1:5173`. The root `.env` is private server configuration; never paste it into a browser. `pnpm budget:status` reads known provider usage without sending a request. The development login is loopback-only and not a production account system. `pnpm generate:fixtures` and `pnpm seed:demo` are optional for the demonstration room, not required to make your own text-only piece.

## Make and refine a piece

1. Choose **New session** and stay on **Arrange**. Enter either a detailed brief (up to 32,768 characters) or a few words. A recording is optional; **Add** lets you upload/record an owned WAV if desired. Choose Standard or Extended depth. The installation-wide allowance can be lower than the profile's nominal per-request target.
2. Choose **Create arrangement**. Progress and a saved plan appear while the worker constructs. A plan is an intention; **Work in progress** is confirmed but unselected structure. Only a successful version becomes current. You can leave and return while a durable job runs.
3. Inspect **Arrangement** for section boundaries and **Parts & instruments** for roles. **Details** shows notes, phrases, sources, sound settings, processing, routing and automation. The document is editable structure, **not playable native audio**. Your separate older playable versions remain under **Playable audio**.
4. To revise, select a section and/or part, mark any parts **Keep**, and write a precise change such as “Make the second chorus sparser, change the answer's ending, and keep the bass unchanged.” The producer cannot silently unlock a kept part. A scoped change must preserve behavior outside its section.
5. Use **Compare** to inspect version differences, then **Restore this version** to select an earlier immutable version. Restoring locally does not rewrite an Audiotool copy. The room labels the current local version and verified remote copy separately.

## If a request pauses

The current accepted version is safe. The pause card shows confirmed draft work, actual used/held/unknown cost, model calls, remaining installation allowance and the minimum estimated reservation for another call. **Continue saved draft** appears only when the same request can proceed safely. If its captured request limit is exhausted, choose higher numeric limits within the displayed installation ceiling, select **Increase request limits**, inspect the refreshed reason, then choose **Continue saved draft**. Increasing a request limit cannot increase the installation-wide allowance or reconcile an uncertain provider outcome. A changed selected version, cancellation or unknown external outcome may require human review rather than replay.

## Make an Audiotool copy

When Audiotool is connected and no earlier uncertain synchronization blocks it, choose **Make editable copy**. The application performs explicit checkpointed synchronization and independent semantic readback before labeling that exact revision verified. Notes and mapped native controls can be editable; source clips, presets and licenses have separate constraints. A historical verification under an older mapper does not verify the new routing surface. Do not use this action just to listen—native rendering/playback is deferred. Audiotool Studio changes are not automatically overwritten.

## Verification levels

Ordinary tests use an isolated `_test` database, fake/scripted model or fixture mode and zero provider access. Offline Nexus SDK readback proves structure, not live remote fidelity or sound. A real-model run can assess creative construction only under a separately approved numeric spend cap. Expanded live Nexus sync/readback needs a separate disposable-project authorization. Heard quality, loudness, peak and compressor movement remain unknown until native audio is available.
