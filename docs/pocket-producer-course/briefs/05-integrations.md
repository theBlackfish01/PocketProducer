# Module 5: Gemini and Nexus Boundaries

### Teaching Arc
- **Metaphor:** Two border checkpoints: an audio critic may advise but cannot rewrite the passport; an export broker labels exactly what crosses the border.
- **Opening hook:** Pocket Producer can make music without either integration, and never pretends an unavailable provider ran.
- **Key insight:** Gemini provides bounded opinion over actual WAV bytes; Nexus packages editable stems but is not the renderer or a verified live Audiotool connection.
- **Why should I care?:** It teaches honest provider boundaries, cost/idempotency controls, and export-fidelity language.

### Code Snippets (pre-extracted)

File: packages/core/src/providers/gemini.ts (lines 47-58)
```ts
    const idempotencyKey = `gemini:${purpose}:${input.hash}:audio-critique-v1`;
    const reserved = await getPool().query<{ id: string }>(
      "INSERT INTO effect(job_id,step,idempotency_key,input_hash,state,provider) VALUES($1,$2,$3,$4,'pending','gemini') ON CONFLICT(job_id,idempotency_key) DO NOTHING RETURNING id",
      [input.jobId, purpose, idempotencyKey, canonicalHash({ hash: input.hash, purpose, measured })]
    );
    effectId = reserved.rows[0]?.id;
    if (!effectId) {
      const prior = await getPool().query<{ state: string; output: { analysis?: AudioAnalysis } | null }>("SELECT state,output FROM effect WHERE job_id=$1 AND idempotency_key=$2", [input.jobId, idempotencyKey]);
      if (prior.rows[0]?.state === "succeeded" && prior.rows[0].output?.analysis) return prior.rows[0].output.analysis;
      return { status: "unavailable", assetHash: input.hash, model: config.GEMINI_MODEL, promptVersion: "audio-critique-v1", purpose, inspectedInterval: { start: 0, end: input.durationSeconds }, measured, observations: [], uncertainty: "A previous Gemini attempt did not complete; it was not repeated to avoid duplicate billing.", suggestedActions: [], repairAction: "none", usage: { promptTokens: 0, candidateTokens: 0, totalTokens: 0 } };
    }
    await getPool().query("UPDATE job SET estimated_cost_usd=estimated_cost_usd+$2 WHERE id=$1", [input.jobId, estimatedCallCost]);
```

File: packages/core/src/nexus/adapter.ts (lines 20-32)
```ts
export async function writeNexusManifest(input: { revisionId: string; composition: Composition; stems: Record<string, string>; outputDirectory: string }): Promise<{ path: string; manifest: NexusExportManifest }> {
  const manifest: NexusExportManifest = {
    mappingVersion: "nexus-stem-v1",
    revisionId: input.revisionId,
    tempoBpm: input.composition.tempoBpm,
    sections: input.composition.sections,
    parts: input.composition.tracks.map((track) => ({ trackId: track.id, role: track.role, stemPath: input.stems[track.id] ?? "", fidelity: "editable-stem" })),
    liveProject: { status: "needs-auth", requiredClientConfiguration: ["AUDIOTOOL_CLIENT_ID", "AUDIOTOOL_REDIRECT_URL", "AUDIOTOOL_SCOPES"] }
  };
  await mkdir(input.outputDirectory, { recursive: true });
  const path = join(input.outputDirectory, `nexus-${input.revisionId}.json`);
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { path, manifest };
}
```

### Interactive Elements
- [x] Code↔English translation of Nexus manifest or Gemini effect reservation.
- [x] Quiz: 3 scenarios on ambiguous provider failures, measured facts vs opinion, and editability claims.
- [x] Side-by-side boundary cards: Gemini analysis and Nexus/Audiotool export.
- [x] Fidelity ladder: notes > clips > editable stems > stereo mix, with current export highlighted as stems.

### Reference Files to Read
- `references/interactive-elements.md` → Code ↔ English Translation Blocks, Pattern/Feature Cards, Permission/Config Badges, Multiple-Choice Quizzes, Glossary Tooltips
- `references/design-system.md` → Module Structure, Responsive Breakpoints
- `references/content-philosophy.md` → all content rules
- `references/gotchas.md` → full checklist

### Connections
- Previous: renderer produced WAV and stems.
- Next: safety and tests prove the whole system under failure.
- Tone/style: be explicit that Gemini is currently unavailable and Nexus is local-manifest verified, not live remote mutation verified.
