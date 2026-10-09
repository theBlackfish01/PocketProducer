import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { boundOpenAiRequest } from "../agent/runtime.js";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import * as configuration from "../config.js";
import { NativeConvergenceMonitor, foldTurnContext, nativeFinishingGuidance, nativeReadEvidence, withNativeFinishingContext, compactNativeReadHistory, type TurnNotes } from "./convergence.js";
import { nativeReviewLimit, nativeRunLimits } from "./profile.js";

describe("bounded native finishing", () => {
  it("omits the final optional observation before rejecting otherwise fitting mandatory context", () => {
    // This boundary case requires 128k; do not depend on the developer's .env
    // overriding the installation default (96k on a clean CI runner).
    const config = configuration.getConfig();
    const configSpy = vi.spyOn(configuration, "getConfig").mockReturnValue({ ...config, MAX_OPENAI_INPUT_TOKENS: 128000 });
    onTestFinished(() => configSpy.mockRestore());
    const brief = new HumanMessage("Exact original brief");
    const system = new SystemMessage("s".repeat(124500));
    const history = [brief, new AIMessage({ content: "", response_metadata: { output: [{ type: "reasoning", encrypted_content: "x".repeat(20000) }] }, tool_calls: [{ id: "read", name: "inspect_native_part", args: { partId: "bass" } }] }), new ToolMessage({ tool_call_id: "read", content: JSON.stringify({ documentHash: "current", part: { id: "bass", detail: "n".repeat(1800) } }) })];
    const result = withNativeFinishingContext(history, { documentHash: "current" }, [], 900, 128000, { systemMessage: system });
    expect(boundOpenAiRequest([[system, ...result]], 900, 128000).inputTokenBound).toBeLessThanOrEqual(128000);
    expect(result).toContain(brief);
    expect(result.at(-1)!.text).toContain('"omittedObservations":1');
    expect(result.at(-1)!.text).toContain('"currentObservations":[]');
    const pending = new AIMessage({ content: "", tool_calls: [{ id: "pending", name: "inspect_native_part", args: { detail: "p".repeat(20000) } }] });
    expect(() => withNativeFinishingContext([...history, pending], { documentHash: "current" }, [], 900, 128000, { systemMessage: system })).toThrow("OPENAI_INPUT_LIMIT_EXCEEDED");
  });
  it("compacts complete text-only reasoning responses across finishing passes", () => {
    const brief = new HumanMessage("Exact original musical brief");
    const history = [brief, ...Array.from({ length: 8 }, (_, i) => [new AIMessage({ content: `Unfinished response ${i}`, response_metadata: { output: [{ type: "reasoning", encrypted_content: `${i}:` + "x".repeat(20000) }] } }), new HumanMessage(`Complete missing requirement ${i}`)]).flat()];
    const result = withNativeFinishingContext(history, { missing: ["Final review"] }, [], 900, 30000);
    expect(() => boundOpenAiRequest([result], 900, 30000)).not.toThrow();
    expect(result).toContain(brief);
    expect(result.filter((m) => m instanceof HumanMessage)).toHaveLength(11);
    expect(result.filter((m) => m instanceof AIMessage)).toHaveLength(1);
    expect(result.some((m) => m.text === "Unfinished response 7")).toBe(true);
  });
  it("replaces old oversized error replay before discarding a newer useful exchange", () => {
    const old = new AIMessage({ content: "", response_metadata: { output: [{ type: "reasoning", encrypted_content: "x".repeat(18000) }] }, tool_calls: [{ id: "old", name: "inspect_native_part", args: { partId: "missing" } }] });
    const recent = new AIMessage({ content: "", tool_calls: [{ id: "recent", name: "inspect_native_part", args: { partId: "bass" } }] });
    const result = withNativeFinishingContext([new HumanMessage("Keep bass"), old, new ToolMessage({ tool_call_id: "old", content: "Error: Unknown part missing" }), recent, new ToolMessage({ tool_call_id: "recent", content: '{"documentHash":"current","notes":[{"pitch":41}]}' })], { documentHash: "current" }, [], 900, 8000);
    expect(result).not.toContain(old);
    expect(result).toContain(recent);
    expect(JSON.stringify(result)).toContain("Unknown part missing");
  });
  it("prefers the latest complete exchange over optional old guidance when that preserves continuity", () => {
    const current = new AIMessage({ content: "", response_metadata: { output: [{ type: "reasoning", encrypted_content: "x".repeat(7000) }] }, tool_calls: [{ id: "inspect", name: "inspect_native_part", args: { partId: "bass" } }] });
    const reply = new ToolMessage({ tool_call_id: "inspect", content: '{"documentHash":"current","notes":[{"pitch":41}]}' });
    const result = withNativeFinishingContext([new HumanMessage("Exact brief"), current, reply], { documentHash: "current" }, [{ tool: "read_native_example", arguments: {}, content: "g".repeat(6000), truncated: false }], 900, 12000);
    expect(result).toContain(current);
    expect(result).toContain(reply);
    expect(result.at(-1)!.text).toContain('"omittedGuidance":1');
  });
  it("retains exact-hash inspection facts after removing their opaque exchanges, never stale score reads", () => {
    const history = [new HumanMessage("Keep bass"), ...["old", "current"].flatMap((hash) => [new AIMessage({ content: "", response_metadata: { output: [{ type: "reasoning", encrypted_content: "x".repeat(18000) }] }, tool_calls: [{ id: hash, name: "inspect_native_part", args: { partId: "bass" } }] }), new ToolMessage({ tool_call_id: hash, content: JSON.stringify({ documentHash: hash, part: { id: "bass", notes: [{ pitch: hash === "old" ? 30 : 41, startTick: 960 }] } }) })])];
    const result = withNativeFinishingContext(history, { documentHash: "current" }, [], 900, 4000);
    expect(result.some((m) => m instanceof ToolMessage)).toBe(false);
    const text = result.at(-1)!.text;
    expect(text).toContain("currentObservations");
    expect(text).toContain('\\"pitch\\":41');
    expect(text).not.toContain('\\"pitch\\":30');
    expect(text).not.toContain("opaque");
  });
  it("recalls skill evidence after pressure evicts the exchange that formerly made it visible", () => {
    const history = [new HumanMessage("Exact brief"), new AIMessage({ content: "", response_metadata: { output: [{ type: "reasoning", encrypted_content: "x".repeat(18000) }] }, tool_calls: [{ id: "skill", name: "read_file", args: { file_path: "/skills/native-arrangement/SKILL.md" } }] }), new ToolMessage({ tool_call_id: "skill", content: "Use compose_native_scene with integer ticks; construct now, refine afterwards." })];
    const evidence = nativeReadEvidence(history);
    const compacted = withNativeFinishingContext(history, {}, evidence, 900, 6000);
    expect(compacted.some((m) => m instanceof ToolMessage)).toBe(false);
    // Recalled guidance is stable context right after the brief, not per-turn data.
    expect(compacted[1]!.text).toContain("Previously read local guidance");
    expect(compacted[1]!.text).toContain(evidence[0]!.content);
    expect(compacted.at(-1)!.text).toContain('"omittedGuidance":0');
    const roomy = withNativeFinishingContext(history, {}, evidence, 900, 40000);
    expect(roomy.some((m) => m.text.includes("Previously read local guidance"))).toBe(false);
    expect(roomy.at(-1)!.text).toContain('"recalledGuidance":0');
  });
  it("summarizes an oversized complete error group without orphaning replay or pending calls", () => {
    const group = new AIMessage({ content: "", response_metadata: { output: [{ type: "reasoning", encrypted_content: "opaque".repeat(7000) }] }, tool_calls: [{ id: "bad", name: "advance_native_stage", args: { stage: "building" } }, { id: "sound", name: "inspect_editable_sound", args: { partId: "lead" } }] });
    const pending = new AIMessage({ content: "", tool_calls: [{ id: "pending", name: "inspect", args: {} }] });
    const result = withNativeFinishingContext([new HumanMessage("Keep the bass"), group, new ToolMessage({ tool_call_id: "bad", content: "Error: Producer stage cannot move backwards" }), new ToolMessage({ tool_call_id: "sound", content: "x".repeat(13000) }), pending], { current: "exact score" }, [], 900, 12000);
    expect(result).not.toContain(group);
    expect(result).toContain(pending);
    expect(result.some((m) => m instanceof ToolMessage)).toBe(false);
    expect(JSON.stringify(result)).toContain("cannot move backwards");
    expect(JSON.stringify(result)).toContain("Keep the bass");
    expect(JSON.stringify(result)).not.toContain("opaque");
  });
  it("measures the final system, opaque replay and schemas before dispatch, preserving whole groups", () => {
    const systemMessage = new SystemMessage("system".repeat(960));
    const envelope = { tools: [{ schema: "schema".repeat(1000) }] };
    const brief = new HumanMessage("Exact user brief");
    const groups = Array.from({ length: 4 }, (_, i) => [new AIMessage({ content: "", response_metadata: { output: [{ type: "reasoning", encrypted_content: "x".repeat(22000) }] }, tool_calls: [{ id: `r${i}`, name: "inspect", args: {} }] }), new ToolMessage({ tool_call_id: `r${i}`, content: "facts" })]);
    const history = [brief, ...groups.flat()];
    expect(() => boundOpenAiRequest([history], 900, 100000)).not.toThrow();
    expect(() => boundOpenAiRequest([[systemMessage, ...history]], 900, 100000, envelope)).toThrow(/INPUT_LIMIT/);
    const compacted = withNativeFinishingContext(history, {}, [], 900, 100000, { systemMessage, envelope });
    expect(() => boundOpenAiRequest([[systemMessage, ...compacted]], 900, 100000, envelope)).not.toThrow();
    expect(compacted).toContain(brief);
    expect(compacted).toContain(groups[3]![0]);
    expect(compacted).not.toContain(groups[0]![0]);
    expect(groups[3]![0]!.response_metadata.output).toBeDefined();
  });
  it("bounds long read phases without orphaning mixed calls, losing the brief or hiding the latest error", () => {
    const brief = new HumanMessage("Exact direction: keep the bass unchanged.");
    const messages = [brief];
    const groups = Array.from({ length: 30 }, (_, i) => [new AIMessage({ content: "", additional_kwargs: { producerWire: { opaque: `signature-${i}` } }, tool_calls: [{ id: `read-${i}`, name: "inspect_native_part", args: { noteOffset: i } }, { id: `search-${i}`, name: "search_native_library", args: { query: "warm" } }] }), new ToolMessage({ tool_call_id: `read-${i}`, content: i === 12 ? "Error: parameter outside range" : "r".repeat(3000), ...(i === 12 ? { status: "error" as const } : {}) }), new ToolMessage({ tool_call_id: `search-${i}`, content: `resources-${i}` })]);
    const result = withNativeFinishingContext([...messages, ...groups.flat(), new HumanMessage("Confirmed current native state: exact current plan and protected bass")], {}, [], 400, 11000);
    expect(result[0]).toBe(brief);
    expect(result).toContain(groups[12]![0]);
    expect(result).toContain(groups[29]![0]);
    expect(result).not.toContain(groups[0]![0]);
    expect(result.some((m) => m.text.includes("exact current plan"))).toBe(true);
    for (const tool of result.filter((m) => m instanceof ToolMessage)) expect(result.some((m) => m instanceof AIMessage && m.tool_calls?.some((call) => call.id === tool.tool_call_id))).toBe(true);
    const pending = new AIMessage({ content: "", tool_calls: [{ id: "pending", name: "inspect", args: {} }] });
    expect(compactNativeReadHistory([...groups.flat(), pending])).toContain(pending);
  });
  it("keeps a shared request prefix while a window segment grows, resetting only when needed", () => {
    const brief = new HumanMessage("Exact brief");
    const exchange = (i: number) => [new AIMessage({ content: "", tool_calls: [{ id: `c${i}`, name: "inspect_native_section", args: { sectionId: `s${i}` } }] }), new ToolMessage({ tool_call_id: `c${i}`, content: JSON.stringify({ documentHash: "other", facts: "f".repeat(400) }) })];
    const window = { start: 0 };
    const history: BaseMessage[] = [brief];
    let previous: BaseMessage[] = [];
    for (let i = 0; i < 9; i++) {
      history.push(...exchange(i));
      const request = withNativeFinishingContext([...history, new HumanMessage(`state ${i}`)], { documentHash: "current", turn: i }, [], 900, 100000, {}, window);
      // Everything before the per-turn tail is unchanged from the previous request.
      const stable = request.slice(0, -2);
      if (previous.length) expect(stable.slice(0, previous.length - 2)).toEqual(previous.slice(0, -2));
      previous = request;
    }
    expect(window.start).toBe(0);
    for (let i = 9; i < 12; i++) history.push(...exchange(i));
    const reset = withNativeFinishingContext([...history, new HumanMessage("state")], {}, [], 900, 100000, {}, window);
    expect(window.start).toBe(11);
    expect(reset.filter((m) => m instanceof AIMessage)).toHaveLength(1);
    expect(reset[1]!.text).toContain("Context maintenance: 11 completed tool exchanges omitted");
  });
  it("starts a fresh segment under input pressure instead of sliding by one exchange", () => {
    const brief = new HumanMessage("Exact brief");
    const history = [brief, ...Array.from({ length: 6 }, (_, i) => [new AIMessage({ content: "", tool_calls: [{ id: `c${i}`, name: "inspect", args: {} }] }), new ToolMessage({ tool_call_id: `c${i}`, content: "r".repeat(3000) })]).flat()];
    const window = { start: 0 };
    const result = withNativeFinishingContext(history, {}, [], 400, 9000, {}, window);
    expect(window.start).toBe(5);
    expect(result.filter((m) => m instanceof AIMessage)).toHaveLength(1);
  });
  it("bounds a request that extends a measured one by its reported tokens plus the new bytes", () => {
    const system = new SystemMessage("System"), brief = new HumanMessage("Exact brief");
    const exchange = (i: number) => [new AIMessage({ content: "", tool_calls: [{ id: `c${i}`, name: "inspect", args: {} }] }), new ToolMessage({ tool_call_id: `c${i}`, content: "r".repeat(6000) })];
    const tools = { tools: [{ name: "inspect", schema: "s".repeat(40000) }] };
    const first = [system, brief, ...exchange(0), ...exchange(1)];
    const measured = boundOpenAiRequest([first], 900, 200000, tools);
    expect(measured.inputTokenBound).toBe(measured.byteBound);
    const calibration = { envelopeHash: measured.envelopeHash, messageHashes: measured.messageHashes, tokens: 9000 };
    const next = [...first, ...exchange(2)];
    const plain = boundOpenAiRequest([next], 900, 200000, tools);
    const calibrated = boundOpenAiRequest([next], 900, 200000, tools, [calibration]);
    const added = plain.byteBound - measured.byteBound;
    // The shared prefix and its tools cost at most what the provider reported.
    expect(calibrated.inputTokenBound).toBeLessThanOrEqual(9000 + added + 768);
    expect(calibrated.inputTokenBound).toBeGreaterThan(9000);
    expect(calibrated.inputTokenBound).toBeLessThan(plain.byteBound);
    expect(calibrated.byteBound).toBe(plain.byteBound);
    expect(calibrated.inputComponents.calibrated).toBe(calibrated.inputTokenBound);
    // A different tool envelope is still bounded by its own bytes.
    const switched = boundOpenAiRequest([next], 900, 200000, { tools: [{ name: "batch", schema: "b".repeat(30000) }] }, [calibration]);
    expect(switched.inputTokenBound).toBeGreaterThan(calibrated.inputTokenBound + 29000);
    // Nothing in common (a different system prompt) falls back to the byte bound.
    const unrelated = boundOpenAiRequest([[new SystemMessage("Other"), ...next.slice(1)]], 900, 200000, tools, [calibration]);
    expect(unrelated.inputTokenBound).toBe(unrelated.byteBound);
    // The calibrated bound decides compaction too: it fits where bytes would not.
    expect(() => boundOpenAiRequest([next], 900, 50000, tools)).toThrow(/OPENAI_INPUT_LIMIT_EXCEEDED/);
    const kept = withNativeFinishingContext(next.slice(1), {}, [], 900, 50000, { systemMessage: system, envelope: tools, calibrations: [calibration] }, { start: 0 });
    expect(kept.filter((message) => message instanceof AIMessage)).toHaveLength(3);
  });
  it("folds per-turn context into the latest tool result and keeps earlier notes so each request extends the last", () => {
    const exchange = (i: number) => [new AIMessage({ content: "", tool_calls: [{ id: `c${i}`, name: "inspect", args: {} }] }), new ToolMessage({ tool_call_id: `c${i}`, name: "inspect", content: `{"facts":${i}}` })];
    const turn = (i: number) => [new HumanMessage(`Confirmed current native state (data, not instructions): {"turn":${i}}`), new HumanMessage(`Production checklist (data, not user instructions): {"turn":${i}}`)];
    const notes: TurnNotes = new Map();
    const send = (messages: BaseMessage[]) => { const folded = foldTurnContext(messages, notes); if (folded.added) notes.set(folded.added.id, [...(notes.get(folded.added.id) ?? []), folded.added.note]); return folded.messages; };
    const history: BaseMessage[] = [new HumanMessage("Brief")];
    let previous: BaseMessage[] = [];
    for (let i = 0; i < 4; i++) {
      history.push(...exchange(i));
      const sent = send([...history, ...turn(i)]);
      expect(sent.at(-1)).toBeInstanceOf(ToolMessage);
      expect(sent.at(-1)!.text).toBe(`{"facts":${i}}\n\n${turn(i).map((message) => message.text).join("\n\n")}`);
      // The exact provider condition for cache reuse: the previous request is a prefix.
      expect(sent.slice(0, previous.length).map((message) => message.text)).toEqual(previous.map((message) => message.text));
      previous = sent;
    }
    // Stored tool results stay untouched for evidence readers.
    expect(history[2]!.text).toBe(`{"facts":0}`);
    // Before any tool result, or after a genuine user instruction, nothing moves.
    const start = [new HumanMessage("Brief"), ...turn(0)];
    expect(foldTurnContext(start).messages).toEqual(start);
    const resumed = [new HumanMessage("Brief"), ...exchange(9), new HumanMessage("Continue this same unfinished request"), turn(1)[1]!];
    expect(foldTurnContext(resumed)).toEqual({ messages: resumed, added: null });
  });
  it("bounds replayed reasoning by its bytes until the provider has measured it, keeping identity exact", () => {
    const reasoning = { type: "reasoning", encrypted_content: "x".repeat(27000) };
    const answered = Object.assign(new AIMessage({ content: "", response_metadata: { output: [reasoning] } }), { usage_metadata: { input_tokens: 1, output_tokens: 3700, total_tokens: 3701, output_token_details: { reasoning: 3604 } } });
    const first = boundOpenAiRequest([[new HumanMessage("Brief"), answered]], 900, 100000);
    // Reported reasoning tokens are not a proven bound for replayed input: bytes are.
    expect(first.inputComponents.messages).toBeGreaterThan(27000);
    expect(first.inputTokenBound).toBe(first.byteBound);
    // Once the provider has measured a request containing it, that measurement bounds
    // the shared prefix exactly; only the new message is still counted by its bytes.
    const next = boundOpenAiRequest([[new HumanMessage("Brief"), answered, new HumanMessage("Next")]], 900, 100000, undefined, [{ envelopeHash: first.envelopeHash, messageHashes: first.messageHashes, tokens: 4200 }]);
    expect(next.inputTokenBound).toBeLessThan(6000);
    expect(next.inputTokenBound).toBeGreaterThan(4200);
    expect(next.byteBound).toBeGreaterThan(27000);
    expect(JSON.stringify(next.normalizedMessages)).toContain("x".repeat(27000));
  });
  it("does not let endlessly different reads substitute for musical progress", () => {
    const monitor = new NativeConvergenceMonitor();
    expect(() => { for (let i = 0; i < 25; i++) { monitor.observeTool("inspect", { page: i }); monitor.observeState({ music: "unchanged", findings: "unresolved" }); } }).toThrow(/REPEATED_NO_PROGRESS/);
    expect(monitor.observeState({ music: "changed", findings: "needs verification" }).stagnantTurns).toBe(0);
  });
  it("nudges a targeted action early even when each inspection returns different evidence", () => {
    const monitor = new NativeConvergenceMonitor();
    monitor.observeState({ music: "same", missing: ["Final review"] });
    for (let i = 0; i < 4; i++) { monitor.observeTool("inspect_native_section", { section: i }); monitor.observeState({ music: "same", missing: ["Final review"] }); }
    expect(monitor.observeState({ music: "same", missing: ["Final review"] }).guidance).toContain("apply one targeted batch now");
    expect(monitor.observeState({ music: "changed", missing: ["Final review"] }).guidance).toBe("");
  });
  it("gives actionable repeated-finish feedback without treating it as fresh evidence or bypassing blockers", () => {
    const monitor = new NativeConvergenceMonitor();
    expect(monitor.finishFeedback("music-a", ["Keep bass unchanged"])).toMatchObject({ repeated: false });
    expect(monitor.finishFeedback("music-a", ["Keep bass unchanged"])).toMatchObject({ repeated: true, next: expect.stringContaining("Never remove a genuine user protection") });
    expect(monitor.finishFeedback("music-b", ["Keep bass unchanged"])).toMatchObject({ repeated: false });
    monitor.observeState("same");
    for (let i = 0; i < 5; i++) {
      monitor.observeTool("finish_native_arrangement", { attempt: i });
      expect(monitor.observeState("same").stagnantTurns).toBe(i + 1);
    }
  });
  it("drops only extra recalled guidance under input pressure, retaining exact current evidence", () => {
    const brief = new HumanMessage("Exact brief and musical facts " + "x".repeat(1000));
    const messages = withNativeFinishingContext([brief], { outstandingRequirements: ["Inspect final sections"] }, [{ tool: "read_native_example", arguments: { id: "old" }, content: "g".repeat(6000), truncated: false }], 400, 3000);
    expect(messages[0]).toBe(brief);
    expect(messages.at(-1)!.text).toContain('"omittedGuidance":1');
    expect(messages.at(-1)!.text).toContain("Inspect final sections");
    expect(() => withNativeFinishingContext([new HumanMessage("x".repeat(4000))], {}, [], 400, 3000)).toThrow(/OPENAI_INPUT_LIMIT_EXCEEDED/);
  });
  it("offers room to finish without silently increasing critique or cost ceilings", () => {
    const standard = nativeRunLimits("standard");
    expect(standard.maxCalls).toBe(80);
    expect(nativeReviewLimit(standard)).toBe(4);
    expect(nativeReviewLimit({ ...standard, maxCalls: 120 })).toBe(4);
    expect(nativeReviewLimit({ ...standard, profile: "extended" })).toBe(6);
    expect(nativeFinishingGuidance(50)).toContain("Continue past 50");
    expect(nativeFinishingGuidance(45)).toContain("Never accept incomplete");
  });
  it("retains bounded static evidence, not mutable score reads or errors", () => {
    const messages = [new AIMessage({ content: "", tool_calls: [
      { id: "one", name: "read_native_recipe", args: { id: "soft" } },
      { id: "two", name: "inspect_native_section", args: { sectionId: "intro" } },
      { id: "three", name: "inspect_native_capability", args: { path: "bad" } },
      { id: "four", name: "read_file", args: { file_path: "/workspace/context.json" } }
    ] }), new ToolMessage({ tool_call_id: "one", content: "Pinned recipe" }), new ToolMessage({ tool_call_id: "two", content: "Old music" }), new ToolMessage({ tool_call_id: "three", content: "Error: bad path", status: "error" }), new ToolMessage({ tool_call_id: "four", content: "Old context" })];
    expect(nativeReadEvidence(messages)).toEqual([{ tool: "read_native_recipe", arguments: { id: "soft" }, content: "Pinned recipe", truncated: false }]);
    expect(nativeReadEvidence(messages, nativeReadEvidence(messages))).toHaveLength(1);
    const huge = Array.from({ length: 30 }, (_, i) => ({ tool: "read_native_example", arguments: { id: i }, content: "x".repeat(6000), truncated: true }));
    expect(JSON.stringify(nativeReadEvidence([], huge)).length).toBeLessThan(24_100);
  });
  it("warns, then pauses repeated no-progress work; new evidence and music reset the streak", () => {
    const monitor = new NativeConvergenceMonitor();
    monitor.observeState("same");
    for (let i = 0; i < 6; i++) monitor.observeState("same");
    expect(monitor.observeState("same").guidance).toContain("repeating");
    monitor.observeTool("inspect", { section: "new evidence" });
    expect(monitor.observeState("same").stagnantTurns).toBe(0);
    for (let i = 0; i < 11; i++) monitor.observeState("same");
    expect(() => monitor.observeState("same")).toThrow(/NATIVE_INCOMPLETE:REPEATED_NO_PROGRESS/);
    expect(monitor.observeState("edited").stagnantTurns).toBe(0);
  });
});
