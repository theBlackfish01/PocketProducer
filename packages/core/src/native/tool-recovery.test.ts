import { ToolInputParsingException } from "@langchain/core/tools";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { JobControlError } from "../db/repository.js";
import { NativeSchemaPathError } from "./catalog.js";
import { NativeLibraryError } from "./library.js";
import { nativeToolArgumentFeedback, nativeToolFeedback, nativeToolFeedbackText } from "./tool-recovery.js";

describe("native producer tool feedback boundary", () => {
  it("returns corrective schema-path feedback without treating SDK discovery as write authority", () => {
    const feedback = nativeToolFeedback("inspect_native_capability", new NativeSchemaPathError("Invalid Nexus schema path"));
    expect(feedback?.code).toBe("INVALID_SCHEMA_PATH");
    expect(nativeToolFeedbackText(feedback!, false)).toContain("/beatbox8Pattern/length");
    expect(nativeToolFeedbackText(feedback!, true)).toContain("already failed repeatedly");
  });

  it("recognizes both tool-schema and handler argument validation", () => {
    expect(nativeToolArgumentFeedback(z.object({ path: z.string().max(160) }), { path: 42 })?.code).toBe("INVALID_ARGUMENTS");
    expect(nativeToolArgumentFeedback(z.object({ path: z.string().max(160) }), { path: "/beatbox8Pattern/length" })).toBeNull();
    expect(nativeToolFeedback("inspect_native_capability", new ToolInputParsingException("bad input", "{}"))?.code).toBe("INVALID_ARGUMENTS");
    expect(nativeToolFeedback("inspect_native_motif", new z.ZodError([{ code: "custom", path: ["motifId"], message: "bad" }]))?.code).toBe("INVALID_ARGUMENTS");
  });

  it("does not hide ownership, unknown effects, or unexpected failures from the worker", () => {
    expect(nativeToolFeedback("inspect_native_capability", new JobControlError("LEASE_LOST", "lost"))).toBeNull();
    expect(nativeToolFeedback("search_audiotool_presets", new Error("socket closed after dispatch"))).toBeNull();
    expect(nativeToolFeedback("inspect_native_capability", new TypeError("SDK implementation bug"))).toBeNull();
    expect(nativeToolFeedback("search_audiotool_presets", new NativeLibraryError("provider-failed", "transport broke"))).toBeNull();
    expect(nativeToolFeedback("inspect_audiotool_preset", new NativeLibraryError("not-found", "missing"))?.code).toBe("LIBRARY_SELECTION_INVALID");
  });
});
