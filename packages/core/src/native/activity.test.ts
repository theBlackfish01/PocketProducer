import { expect, it } from "vitest";
import { activityPayloadSchema } from "./activity.js";

it("rejects diagnostic/model payloads instead of spreading them into public messages", () => {
  expect(activityPayloadSchema.safeParse({ version: 1, kind: "music", text: "Changed the bass", toolArguments: { private: true } }).success).toBe(false);
  expect(activityPayloadSchema.safeParse({ version: 1, kind: "reasoning", text: "Private" }).success).toBe(false);
  expect(activityPayloadSchema.safeParse({ version: 1, kind: "approach", text: "<script>ignored as text</script>" }).success).toBe(true);
});
