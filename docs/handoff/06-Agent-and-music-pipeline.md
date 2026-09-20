# Agent execution and music pipeline

## What the agent is responsible for

Interpret intent, choose a supported musical approach, construct a valid composition, render it, verify basic quality, explain actual changes, and offer a result. The model supplies judgment within a controlled tool system; application code owns permissions, constraints, state transitions, timing arithmetic, rendering, and final acceptance.

Do not give the runtime agent a general shell, arbitrary filesystem, unrestricted web fetch, or direct database write tool. It should not install packages, run code from a sample's metadata, or decide its own cost limit. A coding assistant used to develop the application and the music agent running inside it are different trust boundaries.

Use **Deep Agents as the main creative harness on LangGraph**, hosted inside the durable worker's explicit execution boundaries. Select a production persistent checkpointer rather than a process-memory saver. Checkpoints are not a substitute for domain transactions and the effects ledger. The producer uses an OpenAI model; Gemini handles actual audio analysis through a separately scoped adapter. Project workspace, runtime skills and bounded specialist delegation should earn their place in this flow. See [models, tools and credentials](13-Deep-Agents-models-and-candidate-tools.md), [Deep Agents](https://docs.langchain.com/oss/javascript/deepagents/overview) and [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence).

## Workflow stages

1. **Accept and snapshot.** Validate user/session, active budget, source readiness, base revision, requested duration, scope and locks. Store the complete immutable request snapshot. Reject clearly invalid requests before any paid call.
2. **Analyze sources.** Read actual decoded properties and measured/estimated signal features. With Gemini available, inspect authorized audio for compact semantic observations and suggested roles. Keep measured facts separate from model judgment and confidence. Without Gemini, continue supported creation with metadata/palette guidance and explicitly unavailable audio critique. Do not guess a musical key for an unpitched click or treat an irregular recording as a perfect loop.
3. **Interpret intent.** Convert language into a compact structured brief: style/palette, energy, tempo range, arrangement length, source constraints, requested changes and forbidden changes. Ask only if a material conflict cannot be resolved safely. Vague creative choices can use sensible defaults shown in the result.
4. **Plan composition.** Select a known harmonic/rhythmic template or constrained generated plan, allocate source roles, sections and density. A plan must fit renderer and exporter capabilities. Avoid asking an LLM to emit thousands of raw timeline events when deterministic pattern expansion will do.
5. **Compile.** Expand musical primitives into the canonical IR. Quantization, velocities, deterministic humanization, pitch ranges, bar lengths and event counts are code-validated. Model claims do not bypass schemas.
6. **Validate and repair.** Check structural, source-use, musical and protected-part invariants. Permit at most a small configured number of bounded repairs, such as two. A repair gets concrete validation errors and remaining budget; it cannot weaken the requirements.
7. **Render.** Execute the chosen audio adapter, persisting track artifacts and preview. Report truthful stage updates. Render retries reuse unchanged inputs and successful artifacts.
8. **Check and optionally improve.** Inspect actual duration, silence, peaks, invalid values and expected source presence. When Gemini is available, analyze the actual current preview against the brief. The OpenAI producer may apply a constrained repair and return to validation/rendering, within the configured critique/render/cost cap. Start with one critique repair; preserve earlier candidates. Critique does not replace measured checks, lock enforcement or human listening, and disagreement does not justify an unbounded loop.
9. **Commit.** Apply cancellation/lease/base-head checks. Store immutable revision, artifacts, source lineage, cost, validation and diff-derived explanation. Update head only under the correct condition.
10. **Export when requested.** Separate job uses the stored revision. It should not silently regenerate the music or change the selected version.

## Tool contracts

Recommended typed tools: `inspect_source`, `analyze_audio`, `list_supported_palettes`, `get_current_composition`, `propose_arrangement`, `compile_pattern`, `validate_candidate`, `render_candidate`, and `measure_candidate`. Names are application proposals, not existing SDK functions. `analyze_audio` resolves an owned asset/render ID server-side and records the exact inspected content hash/interval; it cannot fetch arbitrary model-supplied URLs. Tools return bounded structured data with stable IDs. They never return private object-store keys or account tokens to the model.

Separate read tools from costly/mutating tools. The graph controls invocation order and limits: maximum model calls, tool steps, render attempts, elapsed time, source count, event count and estimated/actual spend. Use project-scoped capabilities rather than a global `userId` parameter the model may choose. Caches include prompt/schema/tool versions, not just natural-language input.

Version the runtime skills and virtual-workspace policy alongside the application. Read current composition through a controlled tool and submit candidate patches through validation; editing a workspace JSON file cannot directly mutate an accepted revision. No shared global agent memory across users. A candidate interpreter may compose the same allowlisted tools behind a feature flag; it does not grant broader filesystem/network/shell access.

## Music primitives to implement first

**Rhythm:** curated kick/snare/hat patterns, subdivisions, controlled syncopation and fills; deterministic swing/humanization with small bounded offsets; density controls by section. Preserve explicit timing in canonical ticks. Humanization must be reproducible and cannot spill an event outside its intended section without a rule.

**Harmony:** a small set of scale-compatible progressions, limited chord voicings, bass root/approach patterns, and register constraints. Encode basic incompatibility checks. The model selects and varies parameters; code constructs valid notes. Don't claim broad music-theory correctness from a few simple rules.

**Melody:** short motifs repeated with constrained variation, pitch/range and phrase-length limits, intentional rests. The first release can use supported sampled notes or ready motifs. User-provided polyphonic audio is not automatically transcribed into editable MIDI unless an actual transcription path is built and assessed.

**Arrangement:** intro, groove, lift and outro with perceptible contrast: entry/exit of parts, density/velocity changes, tasteful fills, and a deliberate ending or loop. Avoid simply repeating one four-bar phrase for a minute and calling it a finished arrangement.

**Mix:** conservative gain staging, sensible role balance, limited effects, click-free edits, controlled peak level and some headroom. Do not disguise bad balance with aggressive loudness normalization. Retain isolated part renders for preservation and export.

Curate a small legally usable palette in code/config with provenance, source BPM/key where verified, compatible transformations and supported export mode. Synthetic and user-owned fixtures are enough to start. Never assume every publicly downloadable sample can be bundled or redistributed.

## Precise preservation semantics

Three user intentions must remain distinguishable:

- **Use this exact sound:** use actual supplied audio or specifically allowed derivatives; retain its lineage. Placement/slicing can change according to stated permission. A similar generated sound does not satisfy it.
- **Keep this musical idea:** preserve a defined motif/rhythm/contour represented in the app. If extracting it from raw audio is uncertain, state that and ask for confirmation or use exact-audio placement.
- **Use as a reference:** influences the creative brief. Do not claim literal sample presence or exact reproduction.

For “keep the melody,” the default lock freezes that existing track's notes/events, source IDs, timing, processing and isolated rendered artifact. Compute a canonical protected-track hash before/after; reuse the protected stem where possible. Changing a shared master stage can affect the full mixture, so the promise concerns the protected part's content/render, not identical master-file bytes. Explain a requested tempo/key transformation that conflicts with the lock and offer concrete choices: keep tempo, unlock the part, or revise only other tracks.

Scope is equally strict: a Groove-only drum edit should not alter the Intro drum phrase or unrelated tracks. Store section ranges and produce diff reports on event and asset identities. If renderer tails cross boundaries, define and test the intentional crossfade/tail allowance instead of pretending boundaries are acoustically absolute.

## Example revision execution

Request: “Simplify the drums in the main section, keep the melody.” Base revision R2 contains Drums, Bass and Melody; Groove is bars 5–12.

The app stores R2 and locks Melody. Planner proposes removing some hat events and one fill only within Groove. Validator checks track/section IDs and protected hashes. Renderer reuses Melody and Bass artifacts, re-renders affected Drums, then remixes. The summary derives from the accepted diff: “Fewer hi-hats and one less fill in Groove. Melody preserved.” If no relevant events changed, report no meaningful change rather than inventing success.

Candidate R3 stays independently addressable. If the user selected R1 from another device during the job, preserve R3 as an unselected candidate and explain that current-version selection changed. Do not force R3 into the project's head.

## Costs, failure and resume

Reserve estimated spend against a per-user/project budget before executing expensive steps; reconcile actual usage afterward when available. If provider pricing/usage is unknown, require a conservative configured cap and record uncertainty. Stop before exceeding call/time limits, and provide a recoverable partial state rather than retrying indefinitely.

Keep model output and prompt versions available in restricted development diagnostics as needed, with production raw-prompt logging disabled by default. Persist enough identifiers to investigate without logging private audio or tokens. Resume a graph only from a durable state consistent with completed external effects. A provider timeout after a request was accepted is not automatically a safe invitation to charge again.

No synthetic “thinking” messages or claims that the system listened when it only inspected metadata. User-visible summaries describe actions and results. Detailed technical traces belong in developer diagnostics with access controls.
