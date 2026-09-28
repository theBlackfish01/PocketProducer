import { expect, it } from "vitest";
import { relocatedAssetPath } from "./relocation.js";
const owned=`${"a".repeat(36)}/${"b".repeat(36)}/sources/${"c".repeat(64)}.wav`;
it("relocates exact Windows and Linux roots and is idempotent",()=>{
  expect(relocatedAssetPath("C:\\app\\audio", `C:\\app\\audio\\${owned.replaceAll("/","\\")}`)).toBe(owned);
  expect(relocatedAssetPath("/old/audio",`/old/audio/${owned}`)).toBe(owned);
  expect(relocatedAssetPath("C:\\app\\audio",owned)).toBe(owned);
});
it("rejects sibling roots, traversal, drive changes and unrecognized files",()=>{
  for(const path of [`C:\\app\\audio-other\\${owned}`,`D:\\app\\audio\\${owned}`,`../${owned}`,".env"]) expect(()=>relocatedAssetPath("C:\\app\\audio",path)).toThrow();
});
