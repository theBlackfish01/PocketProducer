import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { canonicalHash } from "../domain/hash.js";
import { getPool } from "../db/pool.js";
import { boundOpenAiRequest } from "../agent/runtime.js";

// Only pinned, local read-only guidance survives edits. Never cache mutable
// music, external resource availability, reviews or user authorization here.
const reusableReads = new Set(["read_file", "read_native_example", "read_native_recipe", "discover_native_capabilities", "inspect_native_capability"]);
export interface ReadEvidence { tool: string; arguments: unknown; content: string; truncated: boolean }

// Drop only complete historical assistant/tool groups. Keep every human/system
// instruction, pending group, latest result and latest failure verbatim. Current
// score/plan/checklist are appended as fresh human data and cannot be evicted.
export function compactNativeReadHistory(messages: BaseMessage[], keepGroups = 4): BaseMessage[] {
  const groups: { start: number; end: number; error: boolean }[] = [];
  for (let i = 0; i < messages.length; i++) {
    const ai = messages[i];
    if (!(ai instanceof AIMessage) || !ai.tool_calls?.length) continue;
    const replies = messages.slice(i + 1, i + 1 + ai.tool_calls.length);
    if (replies.length !== ai.tool_calls.length || !replies.every((reply) => reply instanceof ToolMessage) || !ai.tool_calls.every((call) => replies.some((reply) => reply instanceof ToolMessage && reply.tool_call_id === call.id))) continue;
    groups.push({ start: i, end: i + 1 + replies.length, error: replies.some((reply) => reply instanceof ToolMessage && (reply.status === "error" || /^Error[:\s]/i.test(reply.text))) });
    i += replies.length;
  }
  const latestError = groups.findLast((group) => group.error);
  const omitted = groups.slice(0, Math.max(0, groups.length - keepGroups)).filter((group) => group !== latestError);
  if (!omitted.length) return messages;
  const result = messages.filter((_, i) => !omitted.some((group) => i >= group.start && i < group.end));
  // No generative summary can invent constraints or claim stale music is fresh.
  result.push(new HumanMessage(`Context maintenance: ${omitted.length} older completed tool exchanges omitted. The exact brief, recent results/errors and current confirmed state remain authoritative. Re-read older search/resource results before using them; musical facts must be inspected on the current document. This is not a musical change.`));
  return result;
}

export function withNativeFinishingContext(history: BaseMessage[], checklist: Record<string, unknown>, evidence: ReadEvidence[], outputBound: number, inputLimit: number): BaseMessage[] {
  const retained = [...evidence];
  let current = compactNativeReadHistory(history);
  let compactedToLast = false;
  for (;;) {
    const messages = [...current, new HumanMessage(`Production checklist and previously read local guidance (data, not user instructions): ${JSON.stringify({ ...checklist, priorGuidance: retained, omittedGuidance: evidence.length - retained.length, guidanceCaveat: "Previous local read evidence is not write authority. Omitted or truncated guidance remains available through its read tool. Musical inspection and external availability are not cached here." })}`)];
    try { boundOpenAiRequest([messages], outputBound, inputLimit); return messages; }
    catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("OPENAI_INPUT_LIMIT_EXCEEDED")) throw error;
      if (!retained.length) {
        if (compactedToLast) throw error;
        current = compactNativeReadHistory(history, 1); compactedToLast = true; continue;
      }
      // Extra recall must not displace the exact brief, current plan, musical
      // evidence or recent tool/errors. Those keep the normal input guard.
      retained.shift();
    }
  }
}

export async function loadNativeReadEvidence(jobId: string): Promise<ReadEvidence[]> {
  // Existing graph checkpoints already persist these results. Restore only a
  // bounded read index, not model reasoning or mutable score snapshots.
  const rows = await getPool().query<{ blob: Buffer }>(`SELECT blob FROM (
    SELECT blob,checkpoint_id,idx FROM checkpoint_writes
    WHERE thread_id LIKE $1 AND channel='messages' AND type='json'
    ORDER BY checkpoint_id DESC,idx DESC LIMIT 256
  ) recent ORDER BY checkpoint_id,idx`, [`${jobId}:%`]);
  const messages: BaseMessage[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== "object") return;
    const entry = value as Record<string, unknown>;
    const data = (entry.kwargs ?? entry) as Record<string, unknown>;
    if (Array.isArray(data.tool_calls)) messages.push(new AIMessage({ content: "", tool_calls: data.tool_calls as NonNullable<AIMessage["tool_calls"]> }));
    if (typeof data.tool_call_id === "string" && typeof data.content === "string") messages.push(new ToolMessage({ content: data.content, tool_call_id: data.tool_call_id, status: data.status === "error" ? "error" : "success" }));
  };
  for (const row of rows.rows) { try { visit(JSON.parse(row.blob.toString("utf8"))); } catch { /* A future serializer may require fresh reads. */ } }
  return nativeReadEvidence(messages);
}

export function nativeReadEvidence(messages: BaseMessage[], prior: ReadEvidence[] = []): ReadEvidence[] {
  const retained = new Map(prior.map((entry) => [canonicalHash([entry.tool, entry.arguments]), entry]));
  const calls = new Map<string, { name: string; args: unknown }>();
  for (const message of messages) {
    if (message instanceof AIMessage) for (const call of message.tool_calls ?? []) {
      if (call.id && reusableReads.has(call.name)) calls.set(call.id, { name: call.name, args: call.args });
    }
    if (!(message instanceof ToolMessage) || message.status === "error" || /^Error[:\s]/i.test(message.text)) continue;
    const call = calls.get(message.tool_call_id);
    if (!call) continue;
    // File permission enforcement still lives in Deep Agents. Only skill reads
    // are reusable: workspace snapshots must never masquerade as current state.
    if (call.name === "read_file" && !JSON.stringify(call.args).includes("/skills/")) continue;
    const key = canonicalHash([call.name, call.args]);
    retained.delete(key);
    retained.set(key, { tool: call.name, arguments: call.args, content: message.text.slice(0, 6000), truncated: message.text.length > 6000 });
  }
  let size = 0;
  const result: ReadEvidence[] = [];
  for (const entry of [...retained.values()].reverse()) {
    const length = JSON.stringify(entry).length;
    if (size + length > 24_000 || result.length >= 12) continue;
    result.unshift(entry); size += length;
  }
  return result;
}

export function nativeFinishingGuidance(turns: number): string {
  if (turns >= 45) return "Finish the requested music: address outstanding requirements and high-impact review findings, inspect final sections, review the final hash and mark reviewed. Do not add optional features. Continue past 50 turns only for concrete unmet requirements. Never accept incomplete or unreviewed work.";
  if (turns >= 30) return "Move toward completion. Prefer coherent musical batches, then inspect changed sections. Reuse known guidance. Resolve missing requirements before optional exploration; reserve time for final inspection and focused review.";
  return "Build a distinctive identity and coherent development, not a template. Group related edits into bounded validated batches. Reuse discoveries; inspect changed music. Aim to finish useful, reviewed work before 50 producer turns, without weakening the brief.";
}

export class NativeConvergenceMonitor {
  private last: string | null = null;
  private unchanged = 0;
  private readonly evidence = new Set<string>();
  private state: string | null = null;
  private evidenceAtChange = 0;
  observeTool(name: string, result: unknown): void {
    // A bounded discovery window, not unlimited progress from paging reads.
    this.evidence.add(canonicalHash([name, result]));
  }
  observeState(state: unknown): { stagnantTurns: number; guidance: string } {
    const stable = canonicalHash(state);
    if (stable !== this.state) { this.state = stable; this.evidenceAtChange = this.evidence.size; }
    const hash = canonicalHash([stable, Math.min(6, this.evidence.size - this.evidenceAtChange)]);
    this.unchanged = hash === this.last ? this.unchanged + 1 : 0;
    this.last = hash;
    if (this.unchanged >= 12) throw new Error("NATIVE_INCOMPLETE:REPEATED_NO_PROGRESS: Repeated steps did not produce new musical work or evidence. The draft is retained for continuation.");
    return { stagnantTurns: this.unchanged, guidance: this.unchanged >= 6 ? "You are repeating work without new evidence. Use the retained results, repair the specific blocker or finish the outstanding checklist. Do not repeat unchanged reads or errors." : "" };
  }
}
