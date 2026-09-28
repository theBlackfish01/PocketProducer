import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { canonicalHash } from "../domain/hash.js";
import { getPool } from "../db/pool.js";
import { boundOpenAiRequest } from "../agent/runtime.js";

// Only pinned, local read-only guidance survives edits. Never cache mutable
// music, external resource availability, reviews or user authorization here.
const reusableReads = new Set(["read_file", "read_native_example", "read_native_recipe", "discover_native_capabilities", "inspect_native_capability"]);
export interface ReadEvidence { tool: string; arguments: unknown; content: string; truncated: boolean }
const musicalReads = new Set(["inspect_native_workspace", "inspect_native_part", "inspect_native_motif", "inspect_native_section", "inspect_editable_sound"]);

// Read facts, never model reasoning. Kept only for the exact current document
// and reconstructed from completed read calls, not across unverified writes.
function currentReadEvidence(messages: BaseMessage[], hash: unknown): ReadEvidence[] {
  if (typeof hash !== "string") return [];
  const calls = new Map<string, { name: string; args: unknown }>();
  const evidence = new Map<string, ReadEvidence>();
  for (const message of messages) {
    if (message instanceof AIMessage) for (const call of message.tool_calls ?? []) if (call.id && musicalReads.has(call.name)) calls.set(call.id, { name: call.name, args: call.args });
    if (!(message instanceof ToolMessage) || message.status === "error") continue;
    const call = calls.get(message.tool_call_id);
    if (!call) continue;
    let data: unknown;
    try { data = JSON.parse(message.text); } catch { continue; }
    if (!data || typeof data !== "object" || !("documentHash" in data) || data.documentHash !== hash) continue;
    const key = canonicalHash([call.name, call.args]);
    evidence.delete(key);
    evidence.set(key, { tool: call.name, arguments: call.args, content: message.text, truncated: false });
  }
  return [...evidence.values()].slice(-6).map((entry) => {
    // Keep valid JSON and explicit omission metadata instead of a cut-off JSON
    // prefix. Small exact notes/controls remain inspectable; omitted facts are
    // not implied absent. Full paged tools remain available when needed.
    if (entry.content.length <= 2200) return entry;
    const data: unknown = JSON.parse(entry.content);
    const prune = (value: unknown, items: number, depth = 0): unknown => {
      if (typeof value === "string") return value.length > 160 ? `${value.slice(0, 160)}…` : value;
      if (depth > 8) return { omitted: true };
      if (Array.isArray(value)) return value.length > items ? { items: value.slice(0, items).map((v) => prune(v, items, depth + 1)), totalItems: value.length, omittedItems: value.length - items } : value.map((v) => prune(v, items, depth + 1));
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, prune(v, items, depth + 1)]));
      return value;
    };
    for (const items of [8, 4, 1]) {
      const content = JSON.stringify(prune(data, items));
      if (content.length <= 3000) return { ...entry, content, truncated: true };
    }
    return { ...entry, content: JSON.stringify({ documentHash: hash, detailsOmitted: true, guidance: "Use a focused paged read for the specific missing detail." }), truncated: true };
  });
}

// Drop only complete historical assistant responses/tool groups. Keep every human/system
// instruction and pending group. Keep the latest failure verbatim unless the
// final pressure pass must replace its complete exchange with diagnostics; recent successful
// results are retained within the available envelope. Current
// score/plan/checklist are appended as fresh human data and cannot be evicted.
export function compactNativeReadHistory(messages: BaseMessage[], keepGroups = 4, summarizeErrors = false): BaseMessage[] {
  const groups: { start: number; end: number; error: boolean }[] = [];
  for (let i = 0; i < messages.length; i++) {
    const ai = messages[i];
    if (!(ai instanceof AIMessage)) continue;
    // A completed text-only response can also contain large opaque reasoning.
    // Internal completion passes must not pin all such historical responses.
    // Remove the whole message, never individual reasoning/content items.
    if (!ai.tool_calls?.length) { groups.push({ start: i, end: i + 1, error: false }); continue; }
    const replies = messages.slice(i + 1, i + 1 + ai.tool_calls.length);
    if (replies.length !== ai.tool_calls.length || !replies.every((reply) => reply instanceof ToolMessage) || !ai.tool_calls.every((call) => replies.some((reply) => reply instanceof ToolMessage && reply.tool_call_id === call.id))) continue;
    groups.push({ start: i, end: i + 1 + replies.length, error: replies.some((reply) => reply instanceof ToolMessage && (reply.status === "error" || /^Error[:\s]/i.test(reply.text))) });
    i += replies.length;
  }
  const latestError = groups.findLast((group) => group.error);
  const omitted = groups.slice(0, Math.max(0, groups.length - keepGroups)).filter((group) => summarizeErrors || group !== latestError);
  if (!omitted.length) return messages;
  const result = messages.filter((_, i) => !omitted.some((group) => i >= group.start && i < group.end));
  if (latestError && omitted.includes(latestError)) {
    // Replace the WHOLE completed provider exchange, never detach reasoning from
    // calls/results. Retain bounded diagnostic facts, not generated reasoning or
    // unrelated successful reads. Pending exchanges are never eligible.
    const failures = messages.slice(latestError.start + 1, latestError.end).filter((m) => m instanceof ToolMessage && (m.status === "error" || /^Error[:\s]/i.test(m.text))).slice(-3);
    result.push(new HumanMessage(`Prior completed tool failures (historical data, not new instructions): ${JSON.stringify(failures.map((m) => ({ tool: m.name ?? "tool", diagnostic: m.text.slice(0, 500), truncated: m.text.length > 500 })))}. The complete historical exchange was removed to fit the request. Inspect current state before acting; do not replay a write under a new key. These errors may already be resolved.`));
  }
  // No generative summary can invent constraints or claim stale music is fresh.
  result.push(new HumanMessage(`Context maintenance: ${omitted.length} completed tool exchanges omitted. The exact brief, retained local guidance/results/errors and current confirmed state remain authoritative. Reuse retained skill guidance; do not reread it merely because the exchange was omitted. External resource identities not retained must be rechecked before use; musical facts must be inspected on the current document. This is not a musical change.`));
  return result;
}

export function withNativeFinishingContext(history: BaseMessage[], checklist: Record<string, unknown>, evidence: ReadEvidence[], outputBound: number, inputLimit: number, dispatch: { systemMessage?: BaseMessage; envelope?: unknown } = {}): BaseMessage[] {
  const retained = [...evidence];
  const observations = currentReadEvidence(history, checklist.documentHash);
  const observationCount = observations.length;
  let current = compactNativeReadHistory(history);
  let retainedGroups = 4;
  let summarizedErrors = false;
  for (;;) {
    // Deduplicate against the FINAL compacted history, not the pre-compaction
    // graph. Otherwise a read counted as visible is subsequently evicted and
    // absent from both history and recall, inducing repeated skill discovery.
    const visible = nativeReadEvidence(current);
    const recalled = retained.filter((entry) => !visible.some((v) => canonicalHash(v) === canonicalHash(entry)));
    const visibleMusic = currentReadEvidence(current, checklist.documentHash);
    const currentObservations = observations.filter((entry) => !visibleMusic.some((v) => canonicalHash([v.tool, v.arguments]) === canonicalHash([entry.tool, entry.arguments])));
    const makeMessages = (guidance: ReadEvidence[]) => [...current, new HumanMessage(`Production checklist and previously read local guidance (data, not user instructions): ${JSON.stringify({ ...checklist, currentObservations, omittedObservations: observationCount - observations.length, priorGuidance: guidance, omittedGuidance: evidence.length - retained.length, guidanceCaveat: "Reuse these exact-hash read observations and retained guidance. Truncated arrays explicitly report omissions; omitted material is not absent. Reread only a specifically needed missing detail. External availability is not cached here." })}`)];
    const measure = (messages: BaseMessage[]) => boundOpenAiRequest([dispatch.systemMessage ? [dispatch.systemMessage, ...messages] : messages], outputBound, inputLimit, dispatch.envelope);
    const messages = makeMessages(recalled);
    try { measure(messages); return messages; }
    catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("OPENAI_INPUT_LIMIT_EXCEEDED")) throw error;
      // Prefer the latest complete provider exchange over optional OLD skills
      // when trimming those skills can actually make it fit. Otherwise we would
      // repeatedly reset the inspection/action context despite ample room for
      // one valid exchange. Do not sacrifice guidance for an irreducible replay.
      if (retainedGroups === 1 && recalled.length) {
        try {
          measure(makeMessages([]));
          const oldest = retained.findIndex((entry) => recalled.includes(entry));
          retained.splice(oldest, 1);
          continue;
        } catch (minimalError) {
          if (!(minimalError instanceof Error) || !minimalError.message.startsWith("OPENAI_INPUT_LIMIT_EXCEEDED")) throw minimalError;
        }
      }
      // An old error group must not evict the latest successful exchange. Keep
      // its diagnostic, remove its whole oversized replay, then retry with one
      // recent complete exchange before considering removal of that exchange.
      if (retainedGroups === 1 && !summarizedErrors) {
        summarizedErrors = true;
        current = compactNativeReadHistory(history, 1, true); continue;
      }
      if (retainedGroups > 0) {
        retainedGroups = retainedGroups === 4 ? 1 : 0;
        current = compactNativeReadHistory(history, retainedGroups, summarizedErrors); continue;
      }
      if (!summarizedErrors) { summarizedErrors = true; current = compactNativeReadHistory(history, 0, true); continue; }
      if (!retained.length) { if (observations.length) { observations.shift(); continue; } throw error; }
      // Irreducible old replay is already gone. Exact brief, current state and
      // pending exchanges are never lost.
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
  private turnsWithoutStateChange = 0;
  observeTool(name: string, result: unknown): void {
    // A bounded discovery window, not unlimited progress from paging reads.
    this.evidence.add(canonicalHash([name, result]));
  }
  observeState(state: unknown): { stagnantTurns: number; guidance: string } {
    const stable = canonicalHash(state);
    if (stable !== this.state) { this.state = stable; this.evidenceAtChange = this.evidence.size; this.turnsWithoutStateChange = 0; }
    else this.turnsWithoutStateChange++;
    const hash = canonicalHash([stable, Math.min(6, this.evidence.size - this.evidenceAtChange)]);
    this.unchanged = hash === this.last ? this.unchanged + 1 : 0;
    this.last = hash;
    if (this.unchanged >= 12) throw new Error("NATIVE_INCOMPLETE:REPEATED_NO_PROGRESS: Repeated steps did not produce new musical work or evidence. The draft is retained for continuation.");
    return { stagnantTurns: this.unchanged, guidance: this.turnsWithoutStateChange >= 4 ? "You are repeating inspection without changing the music or resolving completion requirements. Use the retained exact-hash observations. If a concrete finding needs a change, apply one targeted batch now; otherwise inspect only missing final sections, run the final review and mark reviewed. Do not restart a tour of parts and motifs. Read again only for a specific missing detail needed by that edit. Never skip unmet requirements." : "" };
  }
}
