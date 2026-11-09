import { expect, it } from "vitest";
import { checkpointReadEvidence } from "./checkpoint-evidence.js";

it("restores serialized local reads without caching reasoning, errors or mutable music", () => {
  const rows = [
    { kwargs: { tool_calls: [
      { id: "recipe", name: "read_native_recipe", args: { id: "warm" } },
      { id: "score", name: "inspect_native_workspace", args: {} },
      { id: "file", name: "read_file", args: { path: "/workspace/context.json" } }
    ], content: "private reasoning" } },
    { kwargs: { tool_call_id: "recipe", content: "Local recipe" } },
    { kwargs: { tool_call_id: "score", content: "Old notes" } },
    { kwargs: { tool_call_id: "file", content: "Old objective" } },
    { kwargs: { tool_call_id: "recipe", content: "Error: failed", status: "error" } }
  ];
  const facts = checkpointReadEvidence(rows);
  expect(facts).toEqual([{ tool: "read_native_recipe", arguments: { id: "warm" }, content: "Local recipe", truncated: false }]);
  expect(checkpointReadEvidence([], facts)).toEqual(facts);
  expect(checkpointReadEvidence([{ kwargs: 3 }, null, "future serializer"])).toEqual([]);
});

it("bounds preserved discovery and replaces stale hints without expanding the cache", () => {
  const prior = Array.from({ length: 30 }, (_, id) => ({ tool: "read_native_recipe", arguments: { id }, content: "x".repeat(7000), truncated: false }));
  const facts = checkpointReadEvidence([], prior);
  expect(facts.length).toBeLessThanOrEqual(12);
  expect(JSON.stringify(facts).length).toBeLessThanOrEqual(24000);
  expect(facts.every((fact) => fact.content.length === 6000 && fact.truncated)).toBe(true);
});
