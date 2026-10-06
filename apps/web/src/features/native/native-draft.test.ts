import { expect, it } from "vitest"
import type { NativeSnapshot } from "../../lib/api"
import { reconcileNativeDraft } from "./native-draft"

const snapshot: NativeSnapshot = { currentRevisionId: null, headVersion: 0, current: null, versions: [], comparisons: {}, context: null, synchronization: { state: "not_synced", projectId: null, observedHash: null, mappingVersion: null, verifiedAt: null, url: null, revisionId: null, error: null } }

it("retains Luna in an unsent draft and replaces the removed DeepSeek choice without losing direction", () => {
  const saved = { headId: null, direction: "Warm keys", model: "gpt-6-luna" }
  expect(reconcileNativeDraft(saved, snapshot, []).draft).toMatchObject(saved)
  for (const model of ["gpt-6-sol", "gemini-3.7-flash", "deepseek/deepseek-v4-pro-0813"]) {
    expect(reconcileNativeDraft({ ...saved, model }, snapshot, []).draft).toMatchObject({ direction: "Warm keys", model: "gpt-6-luna" })
  }
})
