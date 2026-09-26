# Pocket Producer: hands-on native construction

## Start locally

Safe paused work now offers **Producer → Leave this draft**. Confirming keeps saved versions, unfinished steps and spending history while allowing a fresh request; it cannot bypass an uncertain provider outcome. **Refresh arrangement** recovers an unavailable score/draft read without sending your direction again. Preservation can use actual displayed part/phrase names (for example, “Keep Glass Bells unchanged in Intro”); review ambiguity messages before sending.

From the repository root, with Docker running:

```powershell
pnpm install --frozen-lockfile
pnpm db:up
pnpm db:migrate
pnpm dev
```

Open `http://127.0.0.1:5173`. The root `.env` is private server configuration; never paste it into a browser. `pnpm budget:status` reads known provider usage without sending a request. The development login is loopback-only and not a production account system. `pnpm generate:fixtures` and `pnpm seed:demo` are optional for the demonstration room, not required to make your own text-only piece.

## Make and refine a piece

1. Choose **New session**. Start with a detailed brief (up to 32,768 characters) or a few words. **Add a sound** is optional. **Creation options** chooses Standard or Extended depth; the visible request allowance respects the overall installation cap and unresolved spending.
2. Choose **Create arrangement**. Once the request is accepted, you enter the Producer workspace. **Producer** holds your direction, the saved approach and confirmed musical updates. These are public progress messages, not private model thoughts or audio. A first confirmed draft appears as unfinished; during a revision the saved score remains default, with **View work in progress** available. You can leave, reload or return by the session URL while work continues. On smaller screens use **Arrangement / Producer**; the score never forces you away from a direction you're typing.
3. Inspect **Your arrangement**: choose a section, follow a repeated phrase, and choose a part label to see exact saved notes, clip intervals, controls and routing. The bars show note-start density, not loudness. **Manage parts → Details** has additional facts. This is editable structure, **not playable native audio**. Your separate older playable versions remain under **Playable audio**. During construction, **Musical approach** can show retained identity, chosen resource IDs, remaining tasks and a symbolic score check; it is not an accepted score or listening report.
4. Browsing a section or opening its part inspector does not set an edit scope. Choose **Change this section** or the inspector’s **Change this part**, optionally mark parts **Keep unchanged**, and check the scope above the direction input. On phone these Change actions open **Producer** and focus the direction. Write a precise change such as “Thin the drums in this section, but keep the melody and bass.” Named preservation is previewed against the selected version. If “the theme” could refer to several unrelated phrases, name the part or phrase instead. The producer cannot silently unlock a kept part. A scoped change must preserve behavior outside its section.
5. A successful revision becomes current automatically and opens **Before and after**. The **Before**, **After**, **Changes** and section controls only inspect history; they do not choose a version. Changed parts appear first; use **Include unchanged parts** for the rest. Pitch/time scales are paired between views. **Show the change** replays the saved symbolic difference (unless reduced motion is enabled), without generating or playing audio. Look for “Verified unchanged here”, expand verification details and read any **unverified** caveat. Choose **Use Before** or **Use After** to explicitly select a saved version, or **Keep current version** to close the dialog. Selecting locally does not rewrite an Audiotool copy. The room labels the current local version and verified remote copy separately.

## If a request pauses

The current accepted version is safe. Producer shows the pause and **Review usage & next steps** opens observed/held/unknown cost, request limits and the next safe action. The next-call amount is a reservation **lower bound**, not a quote. If no musical change was confirmed, the room says **Your musical approach is saved** and offers **Continue this request** only when safe; it does not invent a draft. After confirmed musical work, **Continue saved draft** appears only when the same request can proceed safely. If its captured request limit is exhausted, choose higher numeric limits within the displayed installation ceiling, select **Increase request limits**, inspect the refreshed reason, then choose Continue. Increasing a request limit cannot increase the installation-wide allowance or reconcile an uncertain provider outcome. A changed selected version, cancellation or unknown external outcome may require human review rather than replay.

To explore a library sample, open **Sounds & tools → Audiotool sound library** after connecting your account. Search by description, optional type and approximate tempo; **Inspect slices** downloads only the selected short WAV to the private server and shows measured activity intervals, not playback. **Ask to use** appends an exact sample identity and, if inspected, one candidate interval to your unsent direction. The producer still checks current identity and placement bounds when you send it. Public visibility or a search result is not a license guarantee. Your own uploaded WAVs remain a separate source path.

During construction, the producer may optionally request Gemini's opinion on up to two shortlisted short sample WAVs under the same job allowance. This is an explicit provider effect, not a free search-cache hit; measured waveform facts remain separate. If that call's outcome is unknown, the request needs attention rather than silently retrying or accepting a version. Native full-mix audio is still unavailable, so neither that opinion nor the score's visualization tells you how the complete piece sounds.

You may type your next direction during work, but it is **Not sent yet**: it is neither queued nor injected into the current request. Completion preserves that text and asks you to review its scope against the new selected version. **Stop this request** does not delete earlier accepted music. **Version history** reopens comparison; conversation result cards link to the exact saved Before/After pair. Viewing history never chooses a version. Connection interruptions keep the last confirmed view and recover updates; retrying a lost acknowledgement resolves the original request rather than creating a second one.

## Make an Audiotool copy

Open **Audiotool** in the workspace toolbar. When connected and no earlier uncertain synchronization blocks it, choose **Make editable copy**. The application performs explicit checkpointed synchronization and independent semantic readback before labeling that exact revision verified. Notes and mapped native controls can be editable; source clips, presets and licenses have separate constraints. A historical verification under an older mapper does not verify the new routing surface. Do not use this action just to listen—native rendering/playback is deferred. Audiotool Studio changes are not automatically overwritten. An Audiotool-only issue is separate from local construction and does not erase your saved score.

## Verification levels

Ordinary tests use an isolated `_test` database, fake/scripted model or fixture mode and zero provider access. Offline Nexus SDK readback proves structure, not live remote fidelity or sound. A real-model run can assess creative construction only under a separately approved numeric spend cap. Expanded live Nexus sync/readback needs a separate disposable-project authorization. Heard quality, loudness, peak and compressor movement remain unknown until native audio is available.
