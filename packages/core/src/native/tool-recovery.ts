import { ToolInputParsingException } from "@langchain/core/tools";
import { z } from "zod";
import { JobControlError } from "../db/repository.js";
import { NativeSchemaPathError } from "./catalog.js";
import { NativeLibraryError } from "./library.js";

export interface NativeToolFeedback { code: string; message: string; next: string }
export class NativeUnexpectedToolError extends Error {
  constructor(readonly toolName: string, cause: unknown) {
    super(`Unexpected native tool failure in ${toolName}`, { cause });
    this.name = "NativeUnexpectedToolError";
  }
}

/** LangChain may turn schema exceptions into verbose ToolMessages before middleware sees them. */
export function nativeToolArgumentFeedback(schema: unknown, args: unknown): NativeToolFeedback | null {
  if (!schema || typeof schema !== "object" || !("safeParse" in schema) || typeof schema.safeParse !== "function") return null;
  const result = (schema as { safeParse: (value: unknown) => { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } } }).safeParse(args);
  return result.success ? null : {
    code: "INVALID_ARGUMENTS", message: `The tool arguments do not match its required fields or limits. ${result.error?.issues.slice(0, 4).map((issue) => `${issue.path.map(String).join(".") || "arguments"}: ${issue.message.slice(0, 180)}`).join("; ") ?? ""}`,
    next: "Correct the arguments using the tool schema and the current workspace, then try once more."
  };
}

/** Only expected, locally correctable mistakes become model feedback. */
export function nativeToolFeedback(toolName: string, error: unknown): NativeToolFeedback | null {
  if (error instanceof JobControlError) return null;
  if (error instanceof ToolInputParsingException || error instanceof z.ZodError) return {
    code: "INVALID_ARGUMENTS", message: "The tool arguments do not match its required fields or limits.",
    next: "Correct the arguments using the tool schema and the current workspace, then try once more."
  };
  if (toolName === "inspect_native_capability" && error instanceof NativeSchemaPathError) return {
    code: "INVALID_SCHEMA_PATH", message: error.message,
    next: "Use discover_native_capabilities to choose a pinned entity, then inspect a slash-separated path such as /beatbox8Pattern/length. Do not guess paths repeatedly."
  };
  if (error instanceof NativeLibraryError) {
    if (error.code === "unavailable") return { code: "OPTIONAL_LIBRARY_UNAVAILABLE", message: "The Audiotool library is unavailable for this request.", next: "Continue with local native devices and selected owned sources; do not invent a library result." };
    if (error.code === "invalid" || error.code === "not-found") return { code: "LIBRARY_SELECTION_INVALID", message: "That library resource could not be used.", next: "Search again and inspect an exact current result, or continue with a local sound." };
    return null; // Provider/transport failures are not model-correctable guesses.
  }
  if (error instanceof Error && /^(?:Audiotool library is unavailable|Connect Audiotool before|Connect Audiotool to inspect)/.test(error.message)) return {
    code: "OPTIONAL_LIBRARY_UNAVAILABLE", message: "The Audiotool library is unavailable for this request.",
    next: "Continue with local native devices and selected owned sources; do not invent a library result."
  };
  if (error instanceof Error && /^Unknown (?:part|motif|section|group|target section)\b/.test(error.message) && (toolName.startsWith("inspect_native_") || toolName === "inspect_editable_sound")) return {
    code: "UNKNOWN_DOCUMENT_ID", message: "That identifier is not in the current document.",
    next: "Read inspect_native_workspace and use an exact current identifier."
  };
  return null;
}

export function nativeToolFeedbackText(feedback: NativeToolFeedback, repeated: boolean): string {
  return `Error [${feedback.code}]: ${feedback.message} Next: ${feedback.next}${repeated ? " This same call has already failed repeatedly; choose a different supported path or continue without this optional detail." : ""}`;
}
