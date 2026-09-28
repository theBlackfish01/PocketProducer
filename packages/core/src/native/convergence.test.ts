import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { boundOpenAiRequest } from "../agent/runtime.js";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import * as configuration from "../config.js";
import { NativeConvergenceMonitor, nativeFinishingGuidance, nativeReadEvidence, withNativeFinishingContext, compactNativeReadHistory } from "./convergence.js";
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
    expect(compacted.at(-1)!.text).toContain(evidence[0]!.content);
    expect(compacted.at(-1)!.text).toContain('"omittedGuidance":0');
    const roomy = withNativeFinishingContext(history, {}, evidence, 900, 40000);
    expect(roomy.at(-1)!.text).toContain('"priorGuidance":[]');
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
  it("does not let endlessly different reads substitute for musical progress", () => {
    const monitor = new NativeConvergenceMonitor();
    expect(() => { for (let i = 0; i < 25; i++) { monitor.observeTool("inspect", { page: i }); monitor.observeState({ music: "unchanged", findings: "unresolved" }); } }).toThrow(/REPEATED_NO_PROGRESS/);
    expect(monitor.observeState({ music: "changed", findings: "needs verification" }).stagnantTurns).toBe(0);
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
