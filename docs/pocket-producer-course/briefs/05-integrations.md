# Module 5: Gemini and Nexus Boundaries

### Teaching Arc
- **Metaphor:** Two border checkpoints: an audio critic may advise but cannot rewrite the passport; an export broker moves only declared cargo and keeps resumable receipts.
- **Opening hook:** Pocket Producer still owns a playable canonical result when either integration is unavailable or fails.
- **Key insight:** Gemini supplies bounded opinion over real WAV bytes, while Nexus maps four audio stems into an Audiotool project only after explicit authorization. Neither integration owns composition truth or rendering.
- **Why should I care?:** This teaches honest provider evidence, no-replay effect states, thought-token accounting, recoverable OAuth/export design, and exact editability language.

### Code Snippets (pre-extracted)

File: `packages/core/src/providers/gemini.ts` (`analyzePreview`)
```ts
    const response = await client.generateContent({
      model: config.GEMINI_MODEL,
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: "audio/wav", data: bytes.toString("base64") } }, { text: prompt }] }],
      config: {
        maxOutputTokens: 2_048,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        responseMimeType: "application/json",
        responseJsonSchema: schema,
        ...(input.signal ? { abortSignal: input.signal } : {}),
        httpOptions: { timeout: Math.min(60_000, Math.max(1_000, new Date(input.job.deadlineAt).getTime() - Date.now())) }
      }
    });
    const text = response.text ?? "";
    responseTextLength = text.length;
    finishReason = response.candidates?.[0]?.finishReason;
    if (text.length > 16_384) throw new Error("Gemini response exceeded the bounded JSON size");
    usage = {
      promptTokens: response.usageMetadata?.promptTokenCount ?? 0,
      candidateTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      thoughtsTokens: response.usageMetadata?.thoughtsTokenCount ?? 0,
      totalTokens: response.usageMetadata?.totalTokenCount ?? 0
    };
    const outputTokens = Math.max(usage.candidateTokens + usage.thoughtsTokens, usage.totalTokens - usage.promptTokens);
    costMicrousd = tokenCostMicrousd("gemini", config.GEMINI_MODEL, { inputTokens: usage.promptTokens, outputTokens });
```

File: `packages/core/src/nexus/adapter.ts` (`writeNexusManifest`)
```ts
const musicalBodyNexusTicks = canonicalTicksToNexus(input.composition.durationTicks);
const audioDurationNexusTicks = Math.round(secondsToTicks(decoded.durationSeconds, input.composition.tempoBpm));
const projectDurationNexusTicks = Math.max(...parts.map((part) => part.audioDurationNexusTicks));

transaction.update(config.fields.tempoBpm, manifest.tempoBpm);
transaction.update(config.fields.signatureNumerator, 4);
transaction.update(config.fields.signatureDenominator, 4);
transaction.update(config.fields.durationTicks, manifest.projectDurationNexusTicks);
```

### Current Evidence
- Gemini key/model are configured. The first approved source and preview calls returned unusable empty structured output. A later targeted identity attempted the same two stages but ended after dispatch with transport `TypeError`, zero provider telemetry, and no request ID. All ambiguous zero-telemetry effects retain unknown-cost liability and are never replayed automatically.
- The fix uses `minimal` thinking, 2,048 output tokens, thought-token accounting, and conservative transport classification; offline regression tests pass. Successful live Gemini analysis remains unverified.
- Nexus 0.0.17 offline four-track mapping converts canonical 960 PPQ to Nexus 3840 PPQ, preserves the musical body plus explicit render tail, sets tempo/signature/duration, and reads back four enabled routed tracks. Browser PKCE, encrypted owner-bound sessions, serialized refresh persistence, per-step recovery, and document cleanup are mock/offline verified.
- Live Audiotool authorization and remote Studio editability remain unverified because `AUDIOTOOL_CLIENT_ID` is absent.

### Interactive Elements
- [x] Code↔English translation of Gemini reservation, bounded thinking, and usage reconciliation.
- [x] Quiz: ambiguous provider failures, measured facts vs opinion, and honest Audiotool editability claims.
- [x] Side-by-side boundary cards: Gemini analysis and Nexus/Audiotool export.
- [x] Fidelity ladder: notes > clips > editable stems > stereo mix, with the current four-stem contract highlighted.

### Reference Files to Read
- `references/interactive-elements.md` → Code ↔ English Translation Blocks, Pattern/Feature Cards, Permission/Config Badges, Multiple-Choice Quizzes, Glossary Tooltips
- `references/design-system.md` → Module Structure, Responsive Breakpoints
- `references/content-philosophy.md` → all content rules
- `references/gotchas.md` → full checklist

### Connections
- Previous: renderer produced WAV and stems while preserving earlier candidates.
- Next: layered tests distinguish successful proof, terminal live failure evidence, and still-unverified boundaries.
- Tone/style: never collapse “configured,” “called,” “returned valid output,” and “live-verified” into one claim.
