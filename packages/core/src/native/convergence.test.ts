import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it } from "vitest";
import { NativeConvergenceMonitor, nativeFinishingGuidance, nativeReadEvidence, withNativeFinishingContext, compactNativeReadHistory } from "./convergence.js";
import { nativeReviewLimit, nativeRunLimits } from "./profile.js";

describe("bounded native finishing", () => {
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
