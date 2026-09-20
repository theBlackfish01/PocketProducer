# Product, scope, and success

## Product promise

Pocket Producer lets someone with a musical intention but little production fluency create an instrumental from their sounds, hear it, and direct its development. The agent handles musical planning and execution. The user retains authorship over intent, acceptance, and protected material.

The differentiating demonstration is **source-grounded creation plus controlled revision plus a useful editable project**. A prompt box that returns an opaque audio file does not establish that promise. Neither does an attractive app that only launches Audiotool.

## Primary user and context

Design for a curious non-expert who has a sound, rhythm, melody, or mood in mind. They may be holding a phone or sitting at a desktop; neither surface assumes a MIDI keyboard or DAW knowledge. They should understand ordinary terms such as drums, bass, melody, brighter, quieter, and more energetic. Technical details can appear in a disclosure panel when useful.

The builder is technically capable and interested in agent systems, but not an expert musician. Use constrained musical primitives, curated palettes, and listening feedback to compensate. Do not expect the builder to invent a synthesis engine and become a mixing expert before the first prototype.

## Core journey and acceptance story

1. Start a session, choose an owned example or add/record a sound. Audition the source. Say what it should become.
2. Set an understandable source role: **Use this sound**, **Keep this musical idea**, or **Use as a reference**. The latter two are distinct capabilities and may initially be unavailable with a clear explanation.
3. Submit the request. Receive an acknowledged, persistent job. Closing the tab does not abandon server work.
4. Return to a playable draft with source attribution, duration, tempo, and a simple section summary. No automatic loud playback.
5. Ask a scoped revision: “make the drums simpler, keep the melody.” Protect melody before execution. The original remains playable.
6. Compare versions A/B. Decide which is current. Restore is explicit and reversible.
7. Prepare an Audiotool project and open it. Display whether its parts are editable notes, sample clips, or rendered stems. A rendered stem is not advertised as an editable synthesizer patch.

Release acceptance requires this journey to work with a new account/session and on both viewport classes, not only with preloaded developer state.

## Initial supported creation envelope

Recommended first release: 30–60 second instrumentals, a small curated sample palette, up to four primary roles (drums, bass, melody, texture), four section types, and a stable tempo/time signature per composition. Choose one musically coherent initial style family, such as restrained downtempo/electronic beats, then prove a second genuinely different palette if time permits.

User duration is a target, not an invitation to cut off a phrase. Snap to sensible bars, show the resulting duration, and retain intentional tails. State if the supported duration cannot satisfy a prompt. Start with 4/4 and bounded tempo, for example 70–140 BPM; these are adjustable implementation defaults, not user preferences. Do not silently reinterpret an unsupported meter or exact tempo requirement.

Accept common decodable audio uploads after server inspection; record with the browser's supported format. Text direction is always available. Dictation converts speech into an editable direction before submission. Initial melody-preservation promises apply to music already represented in the app's composition, not arbitrary polyphonic audio transcription.

For arbitrary uploaded samples, guarantee only capabilities actually built: audition, trim, gain, repeated or sliced placement, and documented transformations. Key/BPM detection is an estimate with confidence and override. Do not pretend every recording is automatically a loop or harmonically suitable.

## Priority ladder

| Priority | Deliverable | Completion evidence |
| --- | --- | --- |
| Essential | Real input → short playable output | Verified audio artifact made from the chosen source |
| Essential | Responsive Listening Room | Tested small/large layouts and all core interactions |
| Essential | Durable creation job | Refresh, disconnect, and worker restart tests |
| Essential | One precise revision with a protected part | Structural diff plus unchanged protected render evidence |
| Essential | Version comparison and restore | Playhead/selection tests and non-destructive history |
| Essential | Meaningful Nexus result | Open in Audiotool, play, and edit multiple parts |
| Essential | Reproducible setup, CI, documentation | Clean setup and required checks pass |
| Next | Better source analysis and several palettes | Calibrated musical evaluation across inputs |
| Next | Richer section edits, native instrument export | Proof of mapping, fidelity labels, regression coverage |
| Later | Long songs, vocals, collaboration, social sharing | Separate product and risk decisions |

Voice dictation is part of the intended polished experience. If provider access blocks transcription, clearly show it as unavailable while shipping a complete text flow; do not disguise a disabled button as implemented voice support. Recording a source sound is separate and remains useful without transcription.

## Deliberate exclusions from the first release

No full piano roll, multiuser live collaboration, streaming-service distribution, subscription billing, arbitrary plugin execution, open web audio scraping, real-time voice conversations, native mobile apps, game mechanics, or general autonomous shell agent. No need for push notifications: returning to a session should show the result. Installable PWA/offline creation can follow once the browser experience is reliable.

Do not integrate scene/video synchronization or a card interface merely because earlier brainstorming mentioned them. They are not needed to validate the selected product.

## Measurable quality, without invented results

- A first-time tester can create, revise, compare, and open the result without procedural coaching.
- A request either reaches a useful result or a recoverable explanation; it does not hang indefinitely.
- A protected melody retains its documented properties. Explanations are derived from actual differences.
- The source is audible or visibly accounted for when exact source use was requested. If incompatible, the app explains rather than quietly replacing it.
- Compare musical quality using listening trials, not waveform attractiveness or an LLM's self-score.
- Record job latency/cost distributions on named hardware/provider settings; set final service objectives after measurement. Initial engineering targets appear in the test plan, not as promises to users.

## Public-demo shape

Use one owned source with an obvious sonic identity, such as a glass tap or short percussion recording. Make a short groove, request a perceptible drum change while protecting melody, A/B the result, then open and edit its Audiotool parts. Keep a disclosed precomputed example available if a live service fails. A fallback recording must never be passed off as a live successful run.

The résumé story should be backed by artifacts: constrained musical planning, reliable job orchestration, immutable revisions, cross-device UX, and tested SDK integration. Avoid numerical reliability or scale claims until measured.
